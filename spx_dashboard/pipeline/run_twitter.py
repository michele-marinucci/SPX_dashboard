"""
Orchestrate the Twitter Monitor refresh (replaces run_themes.py):

    1. Read the prior data/tweets.json (the persistence layer), if any.
    2. Scrape the followed accounts' recent tweets, enrich, digest, merge.
    3. Write data/tweets.json ONLY when new grounded tweets surfaced;
       otherwise leave the last good file untouched (empty-day guard).

Whether to commit/redeploy is left to the caller: the GitHub Action commits
when data/tweets.json has a git diff, so an empty run produces no deploy.

Usage:
    python run_twitter.py
Env:
    XAI_API_KEY   xAI key (read by the xAI client; never logged or stored).
    SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY   optional DB mirroring.
"""

from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
DATA_DIR = os.path.join(REPO, "data")
TWEETS_JSON = os.path.join(DATA_DIR, "tweets.json")

sys.path.insert(0, HERE)
import db  # noqa: E402
import themes_config as cfg  # noqa: E402
from fetch_tweets import build_payload  # noqa: E402


def load_prior() -> dict | None:
    try:
        with open(TWEETS_JSON) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def persist(payload: dict) -> None:
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(TWEETS_JSON, "w") as f:
        json.dump(payload, f, indent=2, default=str)
    db.publish_twitter(payload)  # no-op when Supabase isn't configured


def main() -> int:
    prior = load_prior()

    # When Supabase is configured, seed the followed set on first use and let
    # the DB's (UI-editable, shared) followed list drive the scrape.
    followed = None
    if db.enabled():
        db.ensure_seeded(getattr(cfg, "FOLLOWED_HANDLES", []))
        followed = db.fetch_followed()

    payload = build_payload(prior, followed=followed)

    if payload is None:
        print("UNCHANGED: no new grounded tweets; kept last good tweets.json.")
        return 0

    persist(payload)
    print(
        f"UPDATED: wrote {TWEETS_JSON} "
        f"({len(payload['tweets'])} tweets in store, "
        f"{len(payload['daily_summary'].get('items', []))} summary sections, "
        f"{len(payload['recurring'])} recurring topics, "
        f"generated_at={payload['generated_at']})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
