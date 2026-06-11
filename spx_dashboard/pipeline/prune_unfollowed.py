"""
One-shot cleanup: remove tweets from accounts no longer in FOLLOWED_HANDLES.

A bad run seeded the store from the old 18-handle default before Supabase was
reachable, leaving a handful of tweets from handles that aren't followed. This
prunes them from data/tweets.json AND the Supabase `tweets` table, and strips
the now-dead tweet-id references out of the daily summary and recurring topics
so jump-to-tweet links don't dangle. Idempotent and safe to re-run.

Usage:
    python prune_unfollowed.py
Env (optional; DB step skipped when absent):
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import requests

import db
import themes_config as cfg

STORE = Path(__file__).resolve().parents[1] / "data" / "tweets.json"


def _norm(h: str) -> str:
    return h.strip().lower().lstrip("@")


def main() -> int:
    followed = {_norm(h) for h in cfg.FOLLOWED_HANDLES if h.strip()}
    store = json.loads(STORE.read_text())

    tweets = store.get("tweets", [])
    keep, drop_ids = [], set()
    for t in tweets:
        if _norm(t.get("handle", "")) in followed:
            keep.append(t)
        else:
            drop_ids.add(t.get("id"))

    if not drop_ids:
        print("Store already clean; no unfollowed tweets.")
    else:
        store["tweets"] = keep
        # Strip dead references from the summary + recurring sections.
        for item in store.get("daily_summary", {}).get("items", []):
            if "tweet_ids" in item:
                item["tweet_ids"] = [i for i in item["tweet_ids"] if i not in drop_ids]
        for topic in store.get("recurring", []):
            if "tweet_ids" in topic:
                topic["tweet_ids"] = [i for i in topic["tweet_ids"] if i not in drop_ids]
        # Refresh the cached followed list to the canonical set.
        store["followed_handles"] = sorted(followed)
        STORE.write_text(json.dumps(store, ensure_ascii=False, indent=2) + "\n")
        print(f"Pruned {len(drop_ids)} unfollowed tweet(s) from {STORE.name} "
              f"({len(tweets)} -> {len(keep)}).")

    # Mirror the deletion into Supabase (by handle, so any stray is swept too).
    if db.enabled():
        in_list = ",".join(f'"{h}"' for h in sorted(followed))
        r = requests.delete(
            f"{db.URL}/rest/v1/tweets?handle=not.in.({in_list})",
            headers=db._headers({"Prefer": "return=minimal"}),
            timeout=db.TIMEOUT,
        )
        r.raise_for_status()
        print("Deleted unfollowed tweets from Supabase.")
    else:
        print("Supabase not configured; skipped DB cleanup.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
