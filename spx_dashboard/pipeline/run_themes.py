"""
Orchestrate the X Themes refresh:

    1. Read the prior data/themes.json (the persistence layer), if any.
    2. Scout X per theme, ground/validate/merge into a new feed.
    3. Write data/themes.json ONLY when there is something new and grounded;
       otherwise leave the last good file untouched (empty-day guard).

Whether to commit/redeploy is left to the caller: the GitHub Action commits
when data/themes.json has a git diff, so an empty run produces no deploy.

Usage:
    python run_themes.py
Env:
    XAI_API_KEY   xAI key (read by the xAI client; never logged or stored).
"""

from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
DATA_DIR = os.path.join(REPO, "data")
THEMES_JSON = os.path.join(DATA_DIR, "themes.json")

sys.path.insert(0, HERE)
import db  # noqa: E402
import themes_config as cfg  # noqa: E402
from fetch_themes import build_feed  # noqa: E402


def _load_prior() -> dict | None:
    try:
        with open(THEMES_JSON) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def main() -> int:
    os.makedirs(DATA_DIR, exist_ok=True)

    prior = _load_prior()

    # When Supabase is configured, seed the followed set on first use and let
    # the DB's (UI-editable) followed list drive tiering.
    followed = None
    if db.enabled():
        db.ensure_seeded(getattr(cfg, "FOLLOWED_HANDLES", []))
        followed = db.fetch_followed()

    feed = build_feed(prior, followed=followed)

    if feed is None:
        print("UNCHANGED: no new grounded ideas; kept last good themes.json.")
        return 0

    with open(THEMES_JSON, "w") as f:
        json.dump(feed, f, indent=2, default=str)

    # Mirror into Supabase (feed + history). No-op when not configured.
    db.publish(feed)

    active = sum(1 for i in feed["ideas"] if i.get("active"))
    print(
        f"UPDATED: wrote {THEMES_JSON} "
        f"({len(feed['ideas'])} ideas, {active} active, "
        f"generated_at={feed['generated_at']})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
