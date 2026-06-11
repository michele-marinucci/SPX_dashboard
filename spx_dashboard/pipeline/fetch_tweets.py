"""
Scrape, summarize and remember the tweets of the followed accounts.

Replaces the old idea-centric scout (fetch_themes.py). The product is now a
*tweet digest*: every run collects the recent posts of the followed handles,
summarizes each one, organizes a daily briefing by theme, flags portfolio
mentions, and detects topics recurring across the trailing 30-day store.

Flow per run (build_payload):
  1. RETRIEVE   x_search restricted to the followed handles (batches of 10),
                over the lookback window. GROUNDING GUARD: keep only tweets
                whose /status/<id> URL appears in the response citations —
                Grok must not invent posts.
  2. ENRICH     one FAST_MODEL call: per-tweet one-line summary, sentiment,
                theme tags (from the cfg.THEMES taxonomy) and tickers.
  3. VISION     for tweets carrying chart/image URLs, describe the image with
                the multimodal model (capped at MAX_VISION_CALLS per run).
  4. PORTFOLIO  match tweets against cfg.PORTFOLIO via tickers + name aliases.
  5. MERGE      append into the prior store keyed by tweet id; prune anything
                older than RETENTION_DAYS. The store ACCUMULATES — this is the
                memory recurring-theme detection needs.
  6. DIGEST     one FAST_MODEL call builds the by-theme daily summary; another
                detects recurring topics over the whole store.
  7. PRICES     best-effort 1-week % move per mentioned ticker (Stooq→Yahoo).
                Non-US portfolio lines (e.g. "LSEG LN") stay None — rendered
                as a placeholder until a non-US source is wired.

The XAI_API_KEY is read from the environment by the xAI client inside this
process only. It is never logged and never written to the data file.
"""

from __future__ import annotations

import csv
import datetime as dt
import io
import json
import os
import re
import sys
from typing import Any, Optional
from urllib.parse import urlparse

import requests

import themes_config as cfg

STOOQ_URL = "https://stooq.com/q/d/l/?s={sym}.us&i=d"
YAHOO_URL = (
    "https://query1.finance.yahoo.com/v8/finance/chart/{sym}?range=1mo&interval=1d"
)
HTTP_TIMEOUT = 20
# Stooq returns "no data" to requests without a browser-like User-Agent.
HTTP_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/121.0 Safari/537.36"
    )
}

# x_search accepts at most this many allowed handles per call.
HANDLE_BATCH = 10

DEFAULT_FOLLOWED = sorted(
    {h.lower().lstrip("@") for h in getattr(cfg, "FOLLOWED_HANDLES", [])}
)
WATCHLIST = {t.upper() for t in cfg.WATCHLIST}
PORTFOLIO: list[str] = list(getattr(cfg, "PORTFOLIO", []))

# Company-name aliases so a tweet saying "Microsoft" (no ticker) still counts
# as a portfolio mention. Keys are the PORTFOLIO display tickers.
PORTFOLIO_ALIASES: dict[str, list[str]] = {
    "MSFT": ["microsoft"],
    "AMZN": ["amazon", "aws"],
    "TRU": ["transunion"],
    "COF": ["capital one"],
    "AON": ["aon plc", "aon "],
    "WDAY": ["workday"],
    "SPGI": ["s&p global"],
    "LSEG LN": ["lseg", "london stock exchange"],
    "CSGP": ["costar"],
    "DSV DC": ["dsv"],
    "MSCI": ["msci"],
    "META": ["meta platforms", "facebook", "instagram"],
    "SAP GY": ["sap"],
    "TOST": ["toast"],
    "EFX": ["equifax"],
    "VSAT": ["viasat"],
}


def _log(msg: str) -> None:
    """Diagnostics go to stderr so they never pollute committed output."""
    print(msg, file=sys.stderr)


def _base_ticker(display: str) -> str:
    """'LSEG LN' -> 'LSEG'; 'MSFT' -> 'MSFT'."""
    return display.split()[0].upper()


def _is_us_listed(display: str) -> bool:
    """Portfolio entries with an exchange suffix (e.g. 'SAP GY') are non-US."""
    return " " not in display.strip()


# --------------------------------------------------------------------------- #
# URL / citation helpers (grounding guard)
# --------------------------------------------------------------------------- #
_X_HOSTS = {"x.com", "twitter.com"}
_STATUS_RE = re.compile(r"/status/(\d+)")


def _normalize_url(url: str) -> str:
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
    return f"{host}{(p.path or '').rstrip('/')}"


def _is_x_post(url: str) -> bool:
    norm = _normalize_url(url)
    return bool(norm) and norm.split("/", 1)[0] in _X_HOSTS and "/status/" in norm


def _status_id(url: str) -> Optional[str]:
    m = _STATUS_RE.search(url or "")
    return m.group(1) if m else None


def _handle_from_url(url: str) -> Optional[str]:
    parts = _normalize_url(url).split("/")
    if len(parts) >= 4 and parts[2] == "status" and parts[1] and parts[1] != "i":
        return parts[1].lower()
    return None


def _collect_citation_urls(response: Any) -> list[str]:
    urls: list[str] = []
    for c in getattr(response, "citations", None) or []:
        if isinstance(c, str):
            urls.append(c)
        else:
            u = getattr(c, "url", None)
            if isinstance(u, str) and u:
                urls.append(u)
    for ic in getattr(response, "inline_citations", None) or []:
        for attr in ("url", "uri", "link"):
            u = getattr(ic, attr, None)
            if isinstance(u, str) and u:
                urls.append(u)
                break
    return urls


def _extract_json(text: str) -> Any:
    if not text:
        return None
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    candidate = fence.group(1).strip() if fence else text.strip()
    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        pass
    for open_c, close_c in (("{", "}"), ("[", "]")):
        start = candidate.find(open_c)
        end = candidate.rfind(close_c)
        if 0 <= start < end:
            try:
                return json.loads(candidate[start : end + 1])
            except json.JSONDecodeError:
                continue
    return None


# --------------------------------------------------------------------------- #
# Stage 1 — retrieval (x_search restricted to followed handles)
# --------------------------------------------------------------------------- #
RETRIEVAL_SYSTEM = (
    "You compile a digest of X (Twitter) posts for an investment team. Use the "
    "x_search tool to find ALL substantive posts from ONLY the specified "
    "accounts inside the date window. Substantive = markets, stocks, macro, "
    "AI, technology, companies, industry data, or charts; skip pure jokes, "
    "giveaways, and contentless replies.\n\n"
    "Hard rules:\n"
    "- Only include posts you actually found via x_search, each with its full "
    "URL (https://x.com/<handle>/status/<id>).\n"
    "- NEVER invent posts, text, URLs or numbers. Omit accounts that posted "
    "nothing relevant.\n"
    "- text: the post's full text, verbatim.\n"
    "- views: the post's view count if visible to you, else null.\n"
    "- media_urls: direct image URLs (e.g. pbs.twimg.com/...) when the post "
    "carries a chart/image and the URL is visible to you, else [].\n\n"
    "Return ONLY a JSON object, no prose:\n"
    '{"tweets": [{"url": "...", "handle": "username_without_at", '
    '"author_name": "Display Name", "posted_at": "ISO8601 or empty", '
    '"text": "...", "views": 12345, "media_urls": []}]}'
)


def fetch_window(
    client: Any,
    handles: list[str],
    from_date: dt.date,
    to_date: dt.date,
) -> list[dict]:
    """Retrieve grounded tweets from `handles` between the two dates."""
    from xai_sdk.chat import system, user
    from xai_sdk.tools import x_search

    out: list[dict] = []
    for i in range(0, len(handles), HANDLE_BATCH):
        batch = handles[i : i + HANDLE_BATCH]
        _log(f"  retrieve {from_date}..{to_date} batch {batch}")
        try:
            chat = client.chat.create(
                model=cfg.MODEL,
                tools=[
                    x_search(
                        from_date=dt.datetime.combine(from_date, dt.time.min),
                        to_date=dt.datetime.combine(to_date, dt.time.max),
                        allowed_x_handles=batch,
                    )
                ],
                include=["inline_citations"],
                messages=[system(RETRIEVAL_SYSTEM)],
            )
            chat.append(
                user(
                    "Accounts: "
                    + ", ".join("@" + h for h in batch)
                    + f". Window: {from_date} to {to_date}. List their "
                    "substantive posts."
                )
            )
            response = chat.sample()
        except Exception as e:  # one bad batch must not sink the run
            _log(f"  batch failed: {type(e).__name__}: {e}")
            continue

        citation_urls = _collect_citation_urls(response)
        cited = {_normalize_url(u) for u in citation_urls}
        cited_ids = {sid for u in citation_urls if (sid := _status_id(u))}

        obj = _extract_json(getattr(response, "content", "") or "")
        raw = obj.get("tweets") if isinstance(obj, dict) else obj
        if not isinstance(raw, list):
            raw = []

        kept = 0
        for t in raw:
            if not isinstance(t, dict):
                continue
            url = (t.get("url") or "").strip()
            sid = _status_id(url)
            if not _is_x_post(url) or sid is None:
                continue
            # Grounding guard: the post must appear in the tool citations.
            if _normalize_url(url) not in cited and sid not in cited_ids:
                _log(f"  QUARANTINE ungrounded {url}")
                continue
            handle = _handle_from_url(url) or (
                (t.get("handle") or "").lower().lstrip("@")
            )
            if not handle:
                continue
            views = t.get("views")
            media_urls = [
                u for u in (t.get("media_urls") or []) if isinstance(u, str) and u
            ]
            out.append(
                {
                    "id": sid,
                    "url": url,
                    "handle": handle,
                    "author_name": (t.get("author_name") or "").strip(),
                    "posted_at": (t.get("posted_at") or "").strip(),
                    "text": (t.get("text") or "").strip(),
                    "views": int(views) if isinstance(views, (int, float)) else None,
                    "has_media": bool(media_urls),
                    "media_urls": media_urls,
                }
            )
            kept += 1
        _log(f"  batch kept {kept}/{len(raw)} grounded tweets")

    # Dedup by id across batches (quote-tweets can surface twice).
    seen: set[str] = set()
    deduped = []
    for t in out:
        if t["id"] in seen:
            continue
        seen.add(t["id"])
        deduped.append(t)
    return deduped


def _sample_json(client: Any, model: str, system_text: str, user_text: str) -> Any:
    from xai_sdk.chat import system, user

    chat = client.chat.create(model=model, messages=[system(system_text)])
    chat.append(user(user_text))
    return _extract_json(getattr(chat.sample(), "content", "") or "")


def _fast_json(client: Any, system_text: str, user_text: str) -> Any:
    """Run a JSON task on FAST_MODEL, falling back to MODEL if it's invalid
    (e.g. xAI retired the id — the grok-4-1-fast family died 2026-05-15)."""
    try:
        return _sample_json(client, cfg.FAST_MODEL, system_text, user_text)
    except Exception as e:
        if cfg.FAST_MODEL == cfg.MODEL:
            raise
        _log(f"  FAST_MODEL '{cfg.FAST_MODEL}' failed ({e}); retrying on {cfg.MODEL}")
        return _sample_json(client, cfg.MODEL, system_text, user_text)


# --------------------------------------------------------------------------- #
# Stage 2 — enrichment (FAST_MODEL: summary, sentiment, themes, tickers)
# --------------------------------------------------------------------------- #
ENRICH_SYSTEM = (
    "You are an equity research analyst annotating tweets. For EACH tweet "
    "produce:\n"
    "- summary: one concrete sentence (<=25 words) of what it says. Preserve "
    "specific numbers and names.\n"
    "- sentiment: positive | negative | neutral — the post's stance toward "
    "its main subject (company/market), not its mood.\n"
    "- themes: the matching theme keys from the provided taxonomy ([] if "
    "none fit).\n"
    "- tickers: public-company tickers explicitly mentioned or unambiguously "
    "implied (uppercase, no $). [] if none. Do not guess.\n\n"
    'Return ONLY JSON: {"items": [{"id": "...", "summary": "...", '
    '"sentiment": "neutral", "themes": [], "tickers": []}]} — one item per '
    "input tweet, same ids."
)


def enrich_tweets(client: Any, tweets: list[dict]) -> None:
    """Annotate tweets in place with summary/sentiment/themes/tickers."""
    if not tweets:
        return

    taxonomy = [{"key": t["key"], "label": t["label"]} for t in cfg.THEMES]
    payload = [
        {"id": t["id"], "handle": t["handle"], "text": t["text"][:2000]}
        for t in tweets
    ]
    obj = _fast_json(
        client,
        ENRICH_SYSTEM,
        f"Theme taxonomy: {json.dumps(taxonomy)}\n"
        f"Watchlist hint (not a filter): {', '.join(sorted(WATCHLIST))}\n\n"
        f"Tweets: {json.dumps(payload)}",
    )
    items = obj.get("items") if isinstance(obj, dict) else obj
    by_id = {
        i["id"]: i for i in items if isinstance(i, dict) and i.get("id")
    } if isinstance(items, list) else {}

    valid_keys = {t["key"] for t in cfg.THEMES}
    for t in tweets:
        a = by_id.get(t["id"], {})
        t["summary"] = (a.get("summary") or "").strip() or t["text"][:140]
        s = (a.get("sentiment") or "neutral").lower()
        t["sentiment"] = s if s in ("positive", "negative", "neutral") else "neutral"
        t["themes"] = [k for k in (a.get("themes") or []) if k in valid_keys]
        t["tickers"] = sorted(
            {
                x.strip().upper().lstrip("$")
                for x in (a.get("tickers") or [])
                if isinstance(x, str) and x.strip()
            }
        )


# --------------------------------------------------------------------------- #
# Stage 3 — vision (describe chart/image tweets, capped per run)
# --------------------------------------------------------------------------- #
VISION_PROMPT = (
    "Describe this image from a financial analyst's perspective in at most 25 "
    "words: what does the chart/table/figure show, and what is the takeaway? "
    "If it is not finance-relevant, say what it is in a few words."
)


# A URL is worth a vision attempt only when it plausibly serves a raw image —
# the API rejects pages/videos with an unsupported-content-type error.
_IMAGE_URL_RE = re.compile(
    r"(pbs\.twimg\.com|\.(?:png|jpe?g|webp)(?:\?|$))", re.IGNORECASE
)


def describe_media(client: Any, tweets: list[dict]) -> None:
    """Attach `media_summary` to tweets with images (best-effort, capped)."""
    from xai_sdk.chat import image, user

    budget = cfg.MAX_VISION_CALLS
    for t in tweets:
        if budget <= 0:
            break
        urls = [u for u in t.get("media_urls") or [] if _IMAGE_URL_RE.search(u)]
        for url in urls[:2]:  # at most two attempts per tweet
            try:
                chat = client.chat.create(model=cfg.MODEL)
                chat.append(user(VISION_PROMPT, image(url)))
                response = chat.sample()
                desc = (getattr(response, "content", "") or "").strip()
                if desc:
                    t["media_summary"] = desc[:300]
                    budget -= 1
                    break
            except Exception as e:
                _log(f"  vision failed for {t['id']} ({url}): {type(e).__name__}: {e}")


# --------------------------------------------------------------------------- #
# Stage 4 — portfolio matching
# --------------------------------------------------------------------------- #
def match_portfolio(tweets: list[dict]) -> None:
    """Attach `portfolio`: the display tickers of holdings each tweet hits."""
    alias_res = {
        disp: [
            re.compile(r"\b" + re.escape(a.strip()) + r"\b", re.IGNORECASE)
            for a in aliases
        ]
        for disp, aliases in PORTFOLIO_ALIASES.items()
    }
    for t in tweets:
        hits: list[str] = []
        tickers = set(t.get("tickers") or [])
        text = t.get("text") or ""
        for disp in PORTFOLIO:
            if _base_ticker(disp) in tickers or any(
                rx.search(text) for rx in alias_res.get(disp, [])
            ):
                hits.append(disp)
        t["portfolio"] = hits


# --------------------------------------------------------------------------- #
# Stage 5 — store merge (accumulate, prune to the retention window)
# --------------------------------------------------------------------------- #
def merge_store(
    prior_tweets: list[dict], new_tweets: list[dict], today: dt.date
) -> list[dict]:
    iso = today.isoformat()
    by_id: dict[str, dict] = {}
    for t in prior_tweets:
        if isinstance(t, dict) and t.get("id"):
            by_id[t["id"]] = dict(t)

    for t in new_tweets:
        cur = by_id.get(t["id"])
        if cur is None:
            t = dict(t)
            # Keep only image URLs worth rendering as chart thumbnails.
            t["media_urls"] = [
                u for u in (t.get("media_urls") or []) if _IMAGE_URL_RE.search(u)
            ]
            t["first_seen"] = iso
            t["last_seen"] = iso
            t["seen_count"] = 1
            by_id[t["id"]] = t
        else:
            if cur.get("last_seen") != iso:
                cur["seen_count"] = int(cur.get("seen_count", 1)) + 1
            cur["last_seen"] = iso
            # Refresh mutable fields (views grow; summaries may improve).
            for k in ("views", "summary", "sentiment", "themes", "tickers",
                      "portfolio", "media_summary", "text"):
                if t.get(k) not in (None, "", []):
                    cur[k] = t[k]
            img_urls = [
                u for u in (t.get("media_urls") or []) if _IMAGE_URL_RE.search(u)
            ]
            if img_urls:
                cur["media_urls"] = img_urls

    # Prune: posted_at when parseable, else first_seen, governs retention.
    cutoff = today - dt.timedelta(days=cfg.RETENTION_DAYS)
    kept: list[dict] = []
    for t in by_id.values():
        stamp = t.get("posted_at") or t.get("first_seen") or iso
        try:
            d = dt.datetime.fromisoformat(stamp.replace("Z", "+00:00")).date()
        except ValueError:
            d = dt.date.fromisoformat(t.get("first_seen", iso))
        if d >= cutoff:
            kept.append(t)
    kept.sort(key=lambda t: t.get("posted_at") or t.get("first_seen") or "", reverse=True)
    return kept


# --------------------------------------------------------------------------- #
# Stage 6 — daily summary + recurring topics (FAST_MODEL)
# --------------------------------------------------------------------------- #
DAILY_SYSTEM = (
    "You write the morning briefing for a small team of professional investors "
    "at a long-only equity fund, distilled from today's tweets. Group the "
    "substance by the provided theme taxonomy; put substantive content that "
    "fits no theme under key \"other\".\n\n"
    "AUDIENCE & TONE:\n"
    "- They are investors. NEVER explain basic finance concepts (what an IPO, a "
    "buyback, or a P/E ratio is). No definitions of common terms.\n"
    "- Assume deep familiarity with markets and the names involved.\n"
    "- Be concise. Short, simple sentences — one idea each. Avoid long or "
    "complex sentences.\n"
    "- Ordinary financial terms are fine and expected; skip buzzwords and hype.\n"
    "- Be factual and specific. Keep concrete numbers and names. No filler.\n\n"
    "FORMAT (built to be skimmed):\n"
    "- For each theme with content, every key takeaway is its own numbered "
    "bullet (an entry in `points`; rendered 1, 2, 3 …).\n"
    "- Supporting detail goes in lettered sub-bullets (`details`; rendered a, "
    "b, c …) under the relevant takeaway. Omit `details` or use [] when the "
    "takeaway stands alone.\n"
    "- A busy reader should get the whole gist from the numbered bullets "
    "alone.\n"
    "- 2-4 points per theme. Also write one headline sentence capturing the "
    "day.\n\n"
    'Return ONLY JSON: {"headline": "...", "items": [{"theme": "key", '
    '"label": "Label", "points": [{"text": "the key takeaway, one concise '
    'sentence", "details": ["a short supporting detail", "..."]}], '
    '"tickers": [], "tweet_ids": []}]}'
)

RECUR_SYSTEM = (
    "You detect RECURRING topics in a month of tweet summaries from followed "
    "investment accounts. A topic recurs when substantially the same subject "
    "(a company situation, trade, debate or data trend — not a broad sector) "
    "appears on at least {min_days} distinct dates. For each, write a short "
    "title and 1-2 sentences on how the discussion evolved.\n\n"
    'Return ONLY JSON: {{"topics": [{{"topic": "...", "summary": "...", '
    '"days_seen": 4, "tickers": [], "tweet_ids": []}}]}} — strongest topics '
    "first, at most 8."
)


def build_daily_summary(
    client: Any, todays: list[dict], today: dt.date
) -> dict:
    if not todays:
        return {"date": today.isoformat(), "headline": "", "items": []}

    taxonomy = [{"key": t["key"], "label": t["label"]} for t in cfg.THEMES]
    payload = [
        {
            "id": t["id"],
            "handle": t["handle"],
            "summary": t.get("summary") or t.get("text", "")[:200],
            "tickers": t.get("tickers", []),
        }
        for t in todays
    ]
    obj = _fast_json(
        client,
        DAILY_SYSTEM,
        f"Theme taxonomy: {json.dumps(taxonomy)}\n\nTweets: {json.dumps(payload)}",
    )
    if not isinstance(obj, dict):
        obj = {}
    label_of = {t["key"]: t["label"] for t in cfg.THEMES}
    valid_ids = {t["id"] for t in todays}
    items = []
    for it in obj.get("items") or []:
        if not isinstance(it, dict):
            continue
        # New shape: numbered takeaways (`points`) each with lettered
        # sub-details. Older runs returned a single `summary` paragraph.
        points: list[dict] = []
        for p in it.get("points") or []:
            if not isinstance(p, dict):
                continue
            text = (p.get("text") or "").strip()
            if not text:
                continue
            details = [
                d.strip()
                for d in (p.get("details") or [])
                if isinstance(d, str) and d.strip()
            ]
            points.append({"text": text, "details": details})
        summary = (it.get("summary") or "").strip()
        if not points and not summary:
            continue
        # Keep a flat `summary` too, so legacy consumers (and any mid-deploy UI)
        # still render something coherent.
        if not summary:
            summary = " ".join(p["text"] for p in points)
        key = it.get("theme") or "other"
        items.append(
            {
                "theme": key,
                "label": label_of.get(key, it.get("label") or "Other"),
                "points": points,
                "summary": summary,
                "tickers": [
                    x.upper() for x in (it.get("tickers") or []) if isinstance(x, str)
                ],
                "tweet_ids": [i for i in (it.get("tweet_ids") or []) if i in valid_ids],
            }
        )
    return {
        "date": today.isoformat(),
        "headline": (obj.get("headline") or "").strip(),
        "items": items,
    }


def build_recurring(client: Any, store: list[dict]) -> list[dict]:
    if not store:
        return []

    payload = [
        {
            "id": t["id"],
            "date": (t.get("posted_at") or t.get("first_seen") or "")[:10],
            "handle": t["handle"],
            "summary": t.get("summary") or t.get("text", "")[:200],
            "tickers": t.get("tickers", []),
        }
        for t in store
    ]
    obj = _fast_json(
        client,
        RECUR_SYSTEM.format(min_days=cfg.RECUR_MIN_DAYS),
        json.dumps(payload),
    )
    topics = obj.get("topics") if isinstance(obj, dict) else None
    if not isinstance(topics, list):
        return []
    valid_ids = {t["id"] for t in store}
    out = []
    for tp in topics:
        if not isinstance(tp, dict) or not (tp.get("topic") or "").strip():
            continue
        days = tp.get("days_seen")
        if not isinstance(days, (int, float)) or days < cfg.RECUR_MIN_DAYS:
            continue
        out.append(
            {
                "topic": tp["topic"].strip(),
                "summary": (tp.get("summary") or "").strip(),
                "days_seen": int(days),
                "tickers": [
                    x.upper() for x in (tp.get("tickers") or []) if isinstance(x, str)
                ],
                "tweet_ids": [i for i in (tp.get("tweet_ids") or []) if i in valid_ids],
            }
        )
    return out[:8]


# --------------------------------------------------------------------------- #
# Stage 7 — 1-week % move per ticker (best-effort; never gates anything)
# --------------------------------------------------------------------------- #
def weekly_moves(tickers: set[str]) -> dict[str, Optional[float]]:
    """% change over the last 5 trading days. None = unavailable (placeholder)."""
    out: dict[str, Optional[float]] = {}
    for ticker in sorted(tickers):
        closes = _recent_closes(ticker)
        if closes and len(closes) >= 6 and closes[-6] != 0:
            out[ticker] = round((closes[-1] / closes[-6] - 1) * 100, 1)
        else:
            out[ticker] = None
    return out


def _recent_closes(ticker: str) -> list[float]:
    return _stooq_closes(ticker) or _yahoo_closes(ticker)


def _stooq_closes(ticker: str) -> list[float]:
    sym = ticker.lower().replace(".", "-")
    try:
        resp = requests.get(
            STOOQ_URL.format(sym=sym), timeout=HTTP_TIMEOUT, headers=HTTP_HEADERS
        )
        text = resp.text or ""
        head = text.lstrip().lower()
        if not head or head.startswith("no data") or head.startswith("exceeded"):
            return []
        rows: list[tuple[str, float]] = []
        for row in csv.DictReader(io.StringIO(text)):
            d, c = row.get("Date"), row.get("Close")
            if d and c:
                try:
                    rows.append((d, float(c)))
                except ValueError:
                    continue
        rows.sort()
        return [c for _, c in rows][-10:]
    except requests.RequestException as e:
        _log(f"  Stooq fetch failed for {ticker}: {e}")
        return []


def _yahoo_closes(ticker: str) -> list[float]:
    sym = ticker.upper().replace(".", "-")
    try:
        resp = requests.get(
            YAHOO_URL.format(sym=sym), timeout=HTTP_TIMEOUT, headers=HTTP_HEADERS
        )
        res = resp.json()["chart"]["result"][0]
        closes = res["indicators"]["quote"][0]["close"]
        return [float(c) for c in closes if c is not None][-10:]
    except (requests.RequestException, ValueError, KeyError, IndexError, TypeError) as e:
        _log(f"  Yahoo fetch failed for {ticker}: {e}")
        return []


# --------------------------------------------------------------------------- #
# Orchestration
# --------------------------------------------------------------------------- #
def collect_and_enrich(
    client: Any,
    handles: list[str],
    from_date: dt.date,
    to_date: dt.date,
) -> list[dict]:
    """Stages 1-4 for one window: retrieve, enrich, vision, portfolio-match."""
    tweets = fetch_window(client, handles, from_date, to_date)
    _log(f"window {from_date}..{to_date}: {len(tweets)} grounded tweets")
    if tweets:
        try:
            enrich_tweets(client, tweets)
        except Exception as e:
            _log(f"enrich failed (keeping raw text): {type(e).__name__}: {e}")
            for t in tweets:
                t.setdefault("summary", t["text"][:140])
                t.setdefault("sentiment", "neutral")
                t.setdefault("themes", [])
                t.setdefault("tickers", [])
        describe_media(client, tweets)
        match_portfolio(tweets)
    return tweets


def finalize_payload(
    client: Any,
    prior: Optional[dict],
    new_tweets: list[dict],
    followed: list[str],
    now: dt.datetime,
) -> Optional[dict]:
    """Stages 5-7: merge into the store, digest, prices; shape the data file."""
    today = now.date()
    prior_tweets = (prior or {}).get("tweets") or []

    if not new_tweets and not prior_tweets:
        _log("Empty first run: nothing to write yet.")
        return None
    if not new_tweets:
        _log("No new grounded tweets; keeping last good file.")
        return None

    store = merge_store(prior_tweets, new_tweets, today)

    try:
        daily = build_daily_summary(client, new_tweets, today)
    except Exception as e:
        _log(f"daily summary failed: {type(e).__name__}: {e}")
        daily = {"date": today.isoformat(), "headline": "", "items": []}
    try:
        recurring = build_recurring(client, store)
    except Exception as e:
        _log(f"recurring topics failed: {type(e).__name__}: {e}")
        recurring = []

    # 1-week moves for every mentioned US ticker + US portfolio names.
    mentioned = {tk for t in store for tk in (t.get("tickers") or [])}
    mentioned |= {_base_ticker(p) for p in PORTFOLIO if _is_us_listed(p)}
    moves = weekly_moves(mentioned)

    return {
        "generated_at": now.isoformat(),
        "themes": [
            {"key": t["key"], "label": t.get("label", t["key"])} for t in cfg.THEMES
        ],
        "followed_handles": followed,
        "portfolio": PORTFOLIO,
        "daily_summary": daily,
        "recurring": recurring,
        "ticker_moves": moves,
        "tweets": store,
    }


def build_payload(
    prior: Optional[dict],
    now: Optional[dt.datetime] = None,
    followed: Optional[list[str]] = None,
) -> Optional[dict]:
    """One scheduled run: scrape the lookback window and rebuild the file.

    Returns None to keep the last good file (empty-day guard).
    """
    from xai_sdk import Client

    now = now or dt.datetime.now(dt.timezone.utc)
    today = now.date()
    effective = (
        sorted({h.lower().lstrip("@") for h in followed if h})
        if followed
        else DEFAULT_FOLLOWED
    )

    client = Client()  # reads XAI_API_KEY from the environment; never logged
    new_tweets = collect_and_enrich(
        client, effective, today - dt.timedelta(days=cfg.LOOKBACK_DAYS), today
    )
    return finalize_payload(client, prior, new_tweets, effective, now)
