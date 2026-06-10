"""
One-time backfill: populate the tweet store with the past month of posts so
recurring-theme detection has history from day one.

Walks the trailing window in week-sized slices (oldest first), running the
same retrieve→enrich→vision→portfolio stages as a scheduled run for each
slice, then builds the digest/recurring/prices once at the end and writes
data/tweets.json (+ Supabase when configured).

COST NOTE: this makes ~(handles/10) x_search calls per weekly slice plus one
enrichment call per slice — roughly 4-5x a normal run. Run it once.

Usage:
    python backfill_tweets.py [--days 30]
Env:
    XAI_API_KEY, optionally SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.
"""

from __future__ import annotations

import argparse
import datetime as dt
import sys

import db
import themes_config as cfg
from fetch_tweets import collect_and_enrich, finalize_payload, merge_store
from run_twitter import load_prior, persist


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=cfg.RETENTION_DAYS,
                    help="how far back to backfill (default: retention window)")
    args = ap.parse_args()

    from xai_sdk import Client

    now = dt.datetime.now(dt.timezone.utc)
    today = now.date()
    start = today - dt.timedelta(days=args.days)

    followed = None
    if db.enabled():
        db.ensure_seeded(getattr(cfg, "FOLLOWED_HANDLES", []))
        followed = db.fetch_followed()
    handles = sorted(
        {h.lower().lstrip("@") for h in (followed or cfg.FOLLOWED_HANDLES) if h}
    )

    client = Client()

    # Collect oldest-first in week slices so merge_store sets sensible
    # first_seen ordering and one failed slice doesn't lose the rest.
    all_tweets: list[dict] = []
    cursor = start
    while cursor < today:
        slice_end = min(cursor + dt.timedelta(days=7), today)
        print(f"Backfilling {cursor}..{slice_end}", file=sys.stderr)
        all_tweets.extend(collect_and_enrich(client, handles, cursor, slice_end))
        cursor = slice_end

    if not all_tweets:
        print("Backfill found nothing grounded; nothing written.")
        return 1

    # Merge everything into the (possibly pre-existing) store, then finalize.
    prior = load_prior() or {}
    prior = dict(prior)
    prior["tweets"] = merge_store(prior.get("tweets") or [], all_tweets, today)

    # finalize_payload treats `new_tweets` as "today's" set for the daily
    # summary — use only the most recent slice's tweets for that.
    latest_cutoff = (today - dt.timedelta(days=cfg.LOOKBACK_DAYS)).isoformat()
    recent = [
        t for t in all_tweets
        if (t.get("posted_at") or "")[:10] >= latest_cutoff
    ] or all_tweets[-25:]

    payload = finalize_payload(client, prior, recent, handles, now)
    if payload is None:
        print("Backfill produced no payload; nothing written.")
        return 1

    persist(payload)
    print(
        f"BACKFILLED: {len(payload['tweets'])} tweets in store, "
        f"{len(payload['recurring'])} recurring topics."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
