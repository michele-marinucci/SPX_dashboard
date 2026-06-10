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

URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
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


def _replace_ideas(ideas: list[dict]) -> None:
    # Replace the whole current feed so the table mirrors themes.json exactly.
    requests.delete(
        f"{URL}/rest/v1/ideas?ticker=not.is.null",
        headers=_headers({"Prefer": "return=minimal"}),
        timeout=TIMEOUT,
    ).raise_for_status()
    if ideas:
        requests.post(
            f"{URL}/rest/v1/ideas",
            headers=_headers({"Prefer": "return=minimal"}),
            json=ideas,
            timeout=TIMEOUT,
        ).raise_for_status()


def _record_history(feed: dict) -> None:
    ideas = feed.get("ideas", [])
    active = sum(1 for i in ideas if i.get("active"))
    r = requests.post(
        f"{URL}/rest/v1/runs",
        headers=_headers({"Prefer": "return=representation"}),
        json={
            "generated_at": feed.get("generated_at"),
            "idea_count": len(ideas),
            "active_count": active,
        },
        timeout=TIMEOUT,
    )
    r.raise_for_status()
    run_id = r.json()[0]["id"]
    snaps = [
        {
            "run_id": run_id,
            "ticker": i["ticker"],
            "direction": i["direction"],
            "tier": i.get("tier"),
            "score": i.get("score"),
            "conviction": i.get("conviction"),
            "seen_count": i.get("seen_count"),
            "active": i.get("active"),
            "data": i,
        }
        for i in ideas
    ]
    if snaps:
        requests.post(
            f"{URL}/rest/v1/idea_snapshots",
            headers=_headers({"Prefer": "return=minimal"}),
            json=snaps,
            timeout=TIMEOUT,
        ).raise_for_status()


def publish(feed: dict) -> None:
    """Mirror the freshly built feed into Supabase and append a history snapshot."""
    if not enabled():
        return
    try:
        _upsert_themes(feed.get("themes", []))
        _replace_ideas(feed.get("ideas", []))
        _record_history(feed)
        _log("db: published feed + history snapshot")
    except (requests.RequestException, ValueError, KeyError, IndexError) as e:
        _log(f"db.publish failed: {e}")
