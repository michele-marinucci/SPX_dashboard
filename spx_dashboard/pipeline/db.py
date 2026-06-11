"""
Optional Supabase persistence for the X Themes pipeline.

All access uses the service-role key over PostgREST. Every function is a no-op
(or returns None) when SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are absent, so
the pipeline keeps working as a pure themes.json writer until the DB is wired.

Nothing here ever raises into the caller: failures are logged to stderr and the
run continues (themes.json remains the source of truth).
"""

from __future__ import annotations

import os
import sys
from typing import Any, Optional

import requests

def _norm_url(raw: str) -> str:
    """Tolerate the common paste mistakes: trailing slashes and a "/rest/v1"
    suffix (the env var should be the bare project origin; callers append
    /rest/v1/... themselves)."""
    url = raw.strip().rstrip("/")
    if url.lower().endswith("/rest/v1"):
        url = url[: -len("/rest/v1")].rstrip("/")
    return url


URL = _norm_url(os.environ.get("SUPABASE_URL", ""))
KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
TIMEOUT = 30


def enabled() -> bool:
    return bool(URL and KEY)


def _log(msg: str) -> None:
    print(msg, file=sys.stderr)


def _headers(extra: Optional[dict] = None) -> dict:
    h = {
        "apikey": KEY,
        "Authorization": f"Bearer {KEY}",
        "Content-Type": "application/json",
    }
    if extra:
        h.update(extra)
    return h


def _norm(handle: str) -> str:
    return handle.strip().lower().lstrip("@")


def fetch_followed() -> Optional[list[str]]:
    """Return the followed handles from the DB, or None if disabled/empty."""
    if not enabled():
        return None
    try:
        r = requests.get(
            f"{URL}/rest/v1/followed_handles?select=handle",
            headers=_headers(),
            timeout=TIMEOUT,
        )
        r.raise_for_status()
        handles = [_norm(row["handle"]) for row in r.json() if row.get("handle")]
        return handles or None
    except (requests.RequestException, ValueError, KeyError) as e:
        _log(f"db.fetch_followed failed: {e}")
        return None


def ensure_seeded(default_handles: list[str]) -> None:
    """Seed followed_handles from config only when the table is still empty,
    so user removals made in the UI are never silently re-added."""
    if not enabled():
        return
    try:
        r = requests.get(
            f"{URL}/rest/v1/followed_handles?select=handle&limit=1",
            headers=_headers(),
            timeout=TIMEOUT,
        )
        r.raise_for_status()
        if r.json():
            return  # already populated
        rows = [{"handle": _norm(h)} for h in default_handles if _norm(h)]
        if rows:
            requests.post(
                f"{URL}/rest/v1/followed_handles",
                headers=_headers({"Prefer": "resolution=merge-duplicates,return=minimal"}),
                json=rows,
                timeout=TIMEOUT,
            ).raise_for_status()
            _log(f"db: seeded {len(rows)} followed handles")
    except (requests.RequestException, ValueError) as e:
        _log(f"db.ensure_seeded failed: {e}")


def _upsert_themes(themes: list[dict]) -> None:
    if not themes:
        return
    requests.post(
        f"{URL}/rest/v1/themes",
        headers=_headers({"Prefer": "resolution=merge-duplicates,return=minimal"}),
        json=themes,
        timeout=TIMEOUT,
    ).raise_for_status()


def _upsert_tweets(tweets: list[dict], retention_cutoff: str) -> None:
    """Upsert the tweet store (PK = id) and prune rows past retention.

    The store ACCUMULATES across runs — this never deletes inside the
    retention window, only upserts current rows and trims the old tail.
    """
    rows = [
        {
            "id": t["id"],
            "url": t.get("url"),
            "handle": t.get("handle"),
            "author_name": t.get("author_name"),
            "posted_at": t.get("posted_at") or None,
            "text": t.get("text"),
            "summary": t.get("summary"),
            "sentiment": t.get("sentiment"),
            "themes": t.get("themes", []),
            "tickers": t.get("tickers", []),
            "portfolio": t.get("portfolio", []),
            "views": t.get("views"),
            "has_media": bool(t.get("has_media")),
            "media_summary": t.get("media_summary"),
            "media_urls": t.get("media_urls", []),
            "first_seen": t.get("first_seen"),
            "last_seen": t.get("last_seen"),
            "seen_count": t.get("seen_count", 1),
        }
        for t in tweets
        if t.get("id")
    ]
    if rows:
        resp = requests.post(
            f"{URL}/rest/v1/tweets",
            headers=_headers({"Prefer": "resolution=merge-duplicates,return=minimal"}),
            json=rows,
            timeout=TIMEOUT,
        )
        # Tolerate a table that predates the media_urls column: retry without it
        # rather than failing the whole publish. (Run the ALTER in schema.sql.)
        if resp.status_code == 400 and "media_urls" in (resp.text or ""):
            _log("db: tweets table missing media_urls column; upserting without it")
            for r in rows:
                r.pop("media_urls", None)
            resp = requests.post(
                f"{URL}/rest/v1/tweets",
                headers=_headers({"Prefer": "resolution=merge-duplicates,return=minimal"}),
                json=rows,
                timeout=TIMEOUT,
            )
        resp.raise_for_status()
    requests.delete(
        f"{URL}/rest/v1/tweets?first_seen=lt.{retention_cutoff}",
        headers=_headers({"Prefer": "return=minimal"}),
        timeout=TIMEOUT,
    ).raise_for_status()


def publish_twitter(payload: dict) -> None:
    """Mirror a freshly built Twitter Monitor payload into Supabase.

    daily_summary.summary carries the full digest context (headline, items,
    ticker_moves, portfolio, followed) so the web app can serve the latest
    state from the DB alone.
    """
    if not enabled():
        return
    import datetime as dt

    try:
        _upsert_themes(payload.get("themes", []))
        cutoff = (
            dt.date.today() - dt.timedelta(days=45)  # retention + slack
        ).isoformat()
        _upsert_tweets(payload.get("tweets", []), cutoff)
        requests.post(
            f"{URL}/rest/v1/daily_summary",
            headers=_headers({"Prefer": "return=minimal"}),
            json={
                "generated_at": payload.get("generated_at"),
                "summary": {
                    **(payload.get("daily_summary") or {}),
                    "ticker_moves": payload.get("ticker_moves", {}),
                    "portfolio": payload.get("portfolio", []),
                },
            },
            timeout=TIMEOUT,
        ).raise_for_status()
        requests.post(
            f"{URL}/rest/v1/recurring_themes",
            headers=_headers({"Prefer": "return=minimal"}),
            json={
                "generated_at": payload.get("generated_at"),
                "data": payload.get("recurring", []),
            },
            timeout=TIMEOUT,
        ).raise_for_status()
        _log("db: published tweets + daily summary + recurring topics")
    except (requests.RequestException, ValueError, KeyError, IndexError) as e:
        _log(f"db.publish_twitter failed: {e}")
