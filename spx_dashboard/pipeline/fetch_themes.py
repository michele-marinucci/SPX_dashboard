"""
Scout X (Twitter) for grounded, actionable investment ideas per theme.

Mirrors the SPX pipeline's philosophy: pure functions that read prior state,
produce a new data structure, and leave the commit/redeploy decision to the
caller (run_themes.py + the GitHub Action). All persistence is a single
committed JSON file (data/themes.json) — themes.json IS the database.

Flow per run:
  1. For each theme, run an OPEN x_search via Grok (grok-4.3) — not restricted
     to any handle list — and ask for structured idea candidates.
  2. GROUNDING GUARD: keep only ideas backed by a real x.com/twitter.com post
     URL that is corroborated by the response-level citations. Ungrounded ideas
     are quarantined (logged, never stored) — Grok will happily synthesize a
     fluent thesis from training data when the index is empty; we reject those.
  3. Bucket each idea into a tier by source: priority (your handles) > credible
     (execs / well-known managers, soft/inferred) > discovery (unvetted).
  4. Validate the ticker via Stooq (which also gives us the YTD price series);
     drop invented/unresolved tickers.
  5. Merge with the prior themes.json keyed on (ticker, direction) so recurrence
     (first_seen / last_seen / seen_count in DAYS) survives across runs.
  6. Derive conviction + score from source weight, distinct trusted handles, and
     recurrence — never from the LLM's raw tone.
  7. EMPTY-DAY GUARD: if nothing new and grounded surfaces, return None so the
     caller keeps the last good file rather than overwriting it with emptiness.

The XAI_API_KEY is read from the environment by the xAI client inside this
process only. It is never logged and never written to themes.json.
"""

from __future__ import annotations

import csv
import datetime as dt
import io
import json
import re
import sys
from typing import Any, Iterable, Optional
from urllib.parse import urlparse

import requests

import themes_config as cfg

STOOQ_URL = "https://stooq.com/q/d/l/?s={sym}.us&i=d"
HTTP_TIMEOUT = 20

# Global set of trusted (priority) handles, lowercased, across all themes.
PRIORITY_HANDLES = {
    h.lower().lstrip("@")
    for t in cfg.THEMES
    for h in t.get("priority_handles", [])
}
WATCHLIST = {t.upper() for t in cfg.WATCHLIST}


def _log(msg: str) -> None:
    """Diagnostics go to stderr so they never pollute committed output."""
    print(msg, file=sys.stderr)


# --------------------------------------------------------------------------- #
# URL grounding helpers
# --------------------------------------------------------------------------- #
_X_HOSTS = {"x.com", "twitter.com"}


def _normalize_url(url: str) -> str:
    """Canonicalize an X post URL for set-membership comparison.

    Lowercases the host, treats twitter.com == x.com, strips www/mobile and
    any query string or trailing slash. Keeps the path so two different posts
    never collide.
    """
    try:
        p = urlparse(url.strip())
    except (ValueError, AttributeError):
        return ""
    host = (p.netloc or "").lower()
    for prefix in ("www.", "mobile.", "m."):
        if host.startswith(prefix):
            host = host[len(prefix) :]
    if host == "twitter.com":
        host = "x.com"
    path = (p.path or "").rstrip("/")
    return f"{host}{path}"


def _is_x_post(url: str) -> bool:
    """True only for a concrete X *post* URL (.../status/<id>)."""
    norm = _normalize_url(url)
    if not norm:
        return False
    host = norm.split("/", 1)[0]
    return host in _X_HOSTS and "/status/" in norm


def _handle_from_url(url: str) -> Optional[str]:
    """Pull the author handle out of an x.com/<handle>/status/... URL."""
    norm = _normalize_url(url)
    parts = norm.split("/")
    # ['x.com', '<handle>', 'status', '<id>']
    if len(parts) >= 4 and parts[2] == "status" and parts[1]:
        return parts[1].lower()
    return None


# --------------------------------------------------------------------------- #
# Grok x_search
# --------------------------------------------------------------------------- #
SYSTEM_PROMPT = (
    "You are an equity-research scout. Given an investment THEME, use the "
    "x_search tool to find the most relevant RECENT posts on X (Twitter) that "
    "express a concrete, actionable investment idea about that theme. Search "
    "all of X openly; do NOT limit yourself to particular accounts.\n\n"
    "Hard rules:\n"
    "- Every idea MUST be based on at least one real X post you actually found "
    "via x_search, and you MUST include that post's full URL "
    "(https://x.com/<handle>/status/<id>).\n"
    "- Never invent posts, tickers, quotes, or handles. If you cannot find real "
    "posts for the theme, return an empty list.\n"
    "- Prefer single, specific US-listed tickers with a clear direction.\n\n"
    "Return ONLY a JSON object, no prose, of this exact shape:\n"
    '{"ideas": [{\n'
    '  "ticker": "AAPL",\n'
    '  "direction": "long|short|watch",\n'
    '  "thesis": "one concise sentence",\n'
    '  "catalyst": "near-term catalyst or empty string",\n'
    '  "sources": [{\n'
    '    "handle": "username_without_at",\n'
    '    "role": "their stated role/affiliation, or empty string",\n'
    '    "credible": true,\n'
    '    "url": "https://x.com/username/status/123"\n'
    "  }]\n"
    "}]}\n\n"
    "Field notes:\n"
    "- direction: long (bullish), short (bearish), or watch (monitoring).\n"
    "- credible: true ONLY when the author is a company executive or a "
    "well-known professional investment manager, inferable from their "
    "profile/role; otherwise false.\n"
    "- role: short human-readable description shown to a human for eyeballing.\n"
)


def _user_prompt(theme: dict) -> str:
    handles = ", ".join("@" + h for h in theme.get("priority_handles", []))
    watch = ", ".join(sorted(WATCHLIST))
    extra = (
        f"\n\nAccounts I particularly trust here (surface and attribute them if "
        f"they posted, but do NOT restrict your search to them): {handles}."
        if handles
        else ""
    )
    return (
        f"THEME: {theme['prompt']}\n"
        f"Tickers especially on my watchlist (hints, not a filter): {watch}."
        f"{extra}"
    )


def search_theme(
    client: Any, theme: dict, from_date: dt.date, to_date: dt.date
) -> list[dict]:
    """Run one open x_search for a theme; return grounded idea dicts.

    Each returned idea carries only sources whose post URL is both a real X
    post and present in the response-level citations. Ungrounded ideas are
    dropped here (quarantine) and logged.
    """
    from xai_sdk.chat import system, user
    from xai_sdk.tools import x_search

    chat = client.chat.create(
        model=cfg.MODEL,
        tools=[
            x_search(
                from_date=dt.datetime.combine(from_date, dt.time.min),
                to_date=dt.datetime.combine(to_date, dt.time.max),
            )
        ],
        messages=[system(SYSTEM_PROMPT)],
    )
    chat.append(user(_user_prompt(theme)))
    response = chat.sample()

    # Response-level citations: the URLs the tools actually consulted. This is
    # our ground truth for the grounding guard.
    cited = {
        _normalize_url(c)
        for c in (getattr(response, "citations", None) or [])
        if isinstance(c, str)
    }

    raw_ideas = _parse_ideas(getattr(response, "content", "") or "")

    grounded: list[dict] = []
    for idea in raw_ideas:
        ticker = _clean_ticker(idea.get("ticker"))
        direction = _clean_direction(idea.get("direction"))
        if not ticker or not direction:
            continue

        sources = _grounded_sources(idea.get("sources"), cited)
        if not sources:
            _log(
                f"  QUARANTINE [{theme['key']}] {ticker}/{direction}: "
                "no post URL corroborated by citations."
            )
            continue

        grounded.append(
            {
                "ticker": ticker,
                "direction": direction,
                "thesis": (idea.get("thesis") or "").strip(),
                "catalyst": (idea.get("catalyst") or "").strip(),
                "sources": sources,
                "theme_keys": [theme["key"]],
            }
        )
    _log(f"  [{theme['key']}] {len(grounded)} grounded / {len(raw_ideas)} returned")
    return grounded


def _grounded_sources(sources: Any, cited: set[str]) -> list[dict]:
    """Keep only sources whose URL is a real X post present in citations."""
    out: list[dict] = []
    seen: set[str] = set()
    if not isinstance(sources, list):
        return out
    for s in sources:
        if not isinstance(s, dict):
            continue
        url = (s.get("url") or "").strip()
        if not _is_x_post(url) or _normalize_url(url) not in cited:
            continue
        handle = _handle_from_url(url) or (s.get("handle") or "").lower().lstrip("@")
        if not handle:
            continue
        tier = _tier_for(handle, bool(s.get("credible")))
        key = f"{handle}|{_normalize_url(url)}"
        if key in seen:
            continue
        seen.add(key)
        out.append(
            {
                "handle": handle,
                "role": (s.get("role") or "").strip(),
                "tier": tier,
                "url": url,
            }
        )
    return out


def _tier_for(handle: str, credible: bool) -> str:
    if handle in PRIORITY_HANDLES:
        return "priority"
    if credible:
        return "credible"
    return "discovery"


# --------------------------------------------------------------------------- #
# Parsing / cleaning model output
# --------------------------------------------------------------------------- #
def _parse_ideas(content: str) -> list[dict]:
    """Extract the ideas array from the model's content, defensively.

    Handles a ```json fenced block, a bare object, or a bare array.
    """
    obj = _extract_json(content)
    if isinstance(obj, dict):
        ideas = obj.get("ideas")
    elif isinstance(obj, list):
        ideas = obj
    else:
        ideas = None
    return [i for i in ideas if isinstance(i, dict)] if isinstance(ideas, list) else []


def _extract_json(text: str) -> Any:
    if not text:
        return None
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    candidate = fence.group(1).strip() if fence else text.strip()
    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        pass
    # Fall back to the first balanced {...} or [...] span.
    for open_c, close_c in (("{", "}"), ("[", "]")):
        start = candidate.find(open_c)
        end = candidate.rfind(close_c)
        if 0 <= start < end:
            try:
                return json.loads(candidate[start : end + 1])
            except json.JSONDecodeError:
                continue
    return None


_TICKER_RE = re.compile(r"^[A-Z][A-Z.\-]{0,6}$")


def _clean_ticker(raw: Any) -> Optional[str]:
    if not isinstance(raw, str):
        return None
    t = raw.strip().upper().lstrip("$")
    return t if _TICKER_RE.match(t) else None


def _clean_direction(raw: Any) -> Optional[str]:
    if not isinstance(raw, str):
        return None
    d = raw.strip().lower()
    return d if d in ("long", "short", "watch") else None


# --------------------------------------------------------------------------- #
# Stooq prices (free, no key) — doubles as ticker validation
# --------------------------------------------------------------------------- #
def fetch_prices(ticker: str, cache: dict[str, Optional[dict]]) -> Optional[dict]:
    """Fetch YTD daily closes from Stooq; None if the symbol is unknown.

    Returns {"currency","as_of","series"} with `series` newest-first to match
    Sparkline.tsx's expectation. A None result means Stooq has no data for the
    symbol, which we treat as failed ticker validation (invented/unresolved).
    """
    if ticker in cache:
        return cache[ticker]

    result: Optional[dict] = None
    try:
        sym = ticker.lower().replace(".", "-")
        resp = requests.get(STOOQ_URL.format(sym=sym), timeout=HTTP_TIMEOUT)
        rows = _parse_stooq_csv(resp.text)
        if rows:
            year = dt.date.today().year
            ytd = [(d, c) for (d, c) in rows if d.year == year]
            ytd = ytd or rows[-60:]  # early January: fall back to last ~3 months
            if ytd:
                result = {
                    "currency": "USD",
                    "as_of": ytd[-1][0].isoformat(),
                    # Stooq is oldest-first; store newest-first for Sparkline.
                    "series": [round(c, 2) for (_, c) in reversed(ytd)],
                }
    except requests.RequestException as e:
        _log(f"  Stooq fetch failed for {ticker}: {e}")

    cache[ticker] = result
    return result


def _parse_stooq_csv(text: str) -> list[tuple[dt.date, float]]:
    if not text or text.lstrip().lower().startswith("no data"):
        return []
    out: list[tuple[dt.date, float]] = []
    reader = csv.DictReader(io.StringIO(text))
    for row in reader:
        date_s, close_s = row.get("Date"), row.get("Close")
        if not date_s or not close_s:
            continue
        try:
            out.append((dt.date.fromisoformat(date_s), float(close_s)))
        except ValueError:
            continue
    out.sort(key=lambda r: r[0])
    return out


# --------------------------------------------------------------------------- #
# Conviction / score (derived, never raw LLM tone)
# --------------------------------------------------------------------------- #
def _distinct_trusted(sources: Iterable[dict]) -> int:
    return len(
        {s["handle"] for s in sources if s.get("tier") in ("priority", "credible")}
    )


def _score(tier: str, sources: list[dict], seen_count: int) -> float:
    """Blend source weight, # distinct trusted handles, and recurrence (days)."""
    tier_w = cfg.SOURCE_WEIGHTS.get(tier, 0.25)
    trusted = min(_distinct_trusted(sources), 3) / 3
    recur = min(max(seen_count, 1), 5) / 5
    raw = 0.5 * tier_w + 0.3 * trusted + 0.2 * recur
    return round(100 * raw, 1)


def _conviction(score: float) -> str:
    if score >= 70:
        return "high"
    if score >= 45:
        return "medium"
    return "low"


def _best_tier(sources: list[dict]) -> str:
    order = {"priority": 3, "credible": 2, "discovery": 1}
    return max((s["tier"] for s in sources), key=lambda t: order.get(t, 0), default="discovery")


# --------------------------------------------------------------------------- #
# Aggregation + recurrence merge
# --------------------------------------------------------------------------- #
def _key(ticker: str, direction: str) -> str:
    return f"{ticker}|{direction}"


def _aggregate_today(ideas: list[dict]) -> dict[str, dict]:
    """Collapse same-day ideas across themes by (ticker, direction)."""
    agg: dict[str, dict] = {}
    for idea in ideas:
        k = _key(idea["ticker"], idea["direction"])
        cur = agg.get(k)
        if cur is None:
            agg[k] = {**idea, "sources": list(idea["sources"])}
            continue
        # Union sources (dedup by handle+url), theme keys; keep best thesis.
        seen = {(s["handle"], _normalize_url(s["url"])) for s in cur["sources"]}
        for s in idea["sources"]:
            sig = (s["handle"], _normalize_url(s["url"]))
            if sig not in seen:
                seen.add(sig)
                cur["sources"].append(s)
        cur["theme_keys"] = sorted(set(cur["theme_keys"]) | set(idea["theme_keys"]))
        # Prefer a thesis/catalyst attached to the higher-tier idea.
        if _rank(idea) > _rank(cur):
            cur["thesis"] = idea["thesis"] or cur["thesis"]
            cur["catalyst"] = idea["catalyst"] or cur["catalyst"]
    return agg


def _rank(idea: dict) -> int:
    order = {"priority": 3, "credible": 2, "discovery": 1}
    return max((order.get(s["tier"], 0) for s in idea["sources"]), default=0)


def build_feed(prior: Optional[dict], now: Optional[dt.datetime] = None) -> Optional[dict]:
    """Produce the new themes.json dict, or None to keep the last good file.

    `prior` is the previously committed themes.json (or None on first run).
    Returns None when no new grounded ideas surfaced AND there is a prior feed
    to preserve (empty-day guard).
    """
    from xai_sdk import Client

    now = now or dt.datetime.now(dt.timezone.utc)
    today = now.date()
    to_date = today
    from_date = today - dt.timedelta(days=cfg.LOOKBACK_DAYS)

    client = Client()  # reads XAI_API_KEY from the environment; never logged

    todays_ideas: list[dict] = []
    for theme in cfg.THEMES:
        _log(f"Scouting theme {theme['key']} ({from_date}..{to_date})")
        try:
            todays_ideas.extend(search_theme(client, theme, from_date, to_date))
        except Exception as e:  # one bad theme must not sink the whole run
            _log(f"  theme {theme['key']} failed: {type(e).__name__}: {e}")

    aggregated = _aggregate_today(todays_ideas)

    # Ticker validation via Stooq (also yields the YTD series). Drop unknowns.
    price_cache: dict[str, Optional[dict]] = {}
    validated: dict[str, dict] = {}
    for k, idea in aggregated.items():
        prices = fetch_prices(idea["ticker"], price_cache)
        if prices is None:
            _log(f"  DROP {idea['ticker']}: ticker not resolved on Stooq.")
            continue
        idea["prices"] = prices
        validated[k] = idea

    prior_records: dict[str, dict] = {}
    if prior and isinstance(prior.get("ideas"), list):
        for rec in prior["ideas"]:
            prior_records[_key(rec["ticker"], rec["direction"])] = rec

    if not validated and not prior_records:
        _log("Empty first run: nothing grounded to write yet.")
        return None
    if not validated:
        _log("No new grounded ideas today; keeping last good themes.json.")
        return None

    merged = _merge(prior_records, validated, today, price_cache)

    records = _finalize(merged, today)
    records.sort(key=lambda r: (r["score"], r["last_seen"]), reverse=True)

    return {
        "generated_at": now.isoformat(),
        # The configured themes, carried into the file so the UI renders theme
        # labels/filters dynamically rather than hardcoding them.
        "themes": [
            {"key": t["key"], "label": t.get("label", t["key"])} for t in cfg.THEMES
        ],
        "ideas": records,
    }


def _merge(
    prior: dict[str, dict],
    today: dict[str, dict],
    today_date: dt.date,
    price_cache: dict[str, Optional[dict]],
) -> dict[str, dict]:
    """Recurrence merge keyed on (ticker, direction).

    Identity is (ticker, direction) — never the thesis text, which Grok
    paraphrases daily. Thesis/catalyst/sources/citations are updatable fields.
    """
    iso = today_date.isoformat()
    out: dict[str, dict] = {}

    # Carry every prior record forward (for recurrence + aging).
    for k, rec in prior.items():
        out[k] = dict(rec)

    for k, idea in today.items():
        if k in out:
            rec = out[k]
            # Count distinct DAYS: only bump if we haven't already counted today.
            if rec.get("last_seen") != iso:
                rec["seen_count"] = int(rec.get("seen_count", 1)) + 1
            rec["last_seen"] = iso
            rec["thesis"] = idea["thesis"] or rec.get("thesis", "")
            rec["catalyst"] = idea["catalyst"] or rec.get("catalyst", "")
            rec["sources"] = idea["sources"]
            rec["theme_keys"] = idea["theme_keys"]
            rec["prices"] = idea["prices"]
        else:
            out[k] = {
                "ticker": idea["ticker"],
                "direction": idea["direction"],
                "thesis": idea["thesis"],
                "catalyst": idea["catalyst"],
                "sources": idea["sources"],
                "theme_keys": idea["theme_keys"],
                "prices": idea["prices"],
                "first_seen": iso,
                "last_seen": iso,
                "seen_count": 1,
            }

    # Refresh prices for active-but-not-seen-today records so their YTD
    # sparkline stays current; keep the stored series if the refresh fails.
    for k, rec in out.items():
        if k in today:
            continue
        age = (today_date - dt.date.fromisoformat(rec["last_seen"])).days
        if age <= cfg.AGE_OUT_DAYS:
            fresh = fetch_prices(rec["ticker"], price_cache)
            if fresh is not None:
                rec["prices"] = fresh
    return out


def _finalize(merged: dict[str, dict], today_date: dt.date) -> list[dict]:
    """Prune ancient records, then (re)derive tier/score/conviction/active."""
    records: list[dict] = []
    for rec in merged.values():
        age = (today_date - dt.date.fromisoformat(rec["last_seen"])).days
        if age > cfg.PRUNE_DAYS:
            continue
        sources = rec.get("sources", [])
        tier = _best_tier(sources) if sources else "discovery"
        score = _score(tier, sources, int(rec.get("seen_count", 1)))
        rec["tier"] = tier
        rec["score"] = score
        rec["conviction"] = _conviction(score)
        rec["active"] = age <= cfg.AGE_OUT_DAYS
        rec["on_watchlist"] = rec["ticker"] in WATCHLIST
        # Flat list of grounded citation URLs for the card's "source post" links.
        rec["citations"] = sorted({s["url"] for s in sources})
        records.append(rec)

    # Bound the file: keep all active ideas plus the most-recent inactive ones.
    active = [r for r in records if r["active"]]
    inactive = sorted(
        (r for r in records if not r["active"]),
        key=lambda r: r["last_seen"],
        reverse=True,
    )
    keep = active + inactive
    return keep[: max(cfg.MAX_FEED, len(active))]
