"""
One-shot: replace the Supabase followed_handles table with the config list.

Use when the DB list has drifted from pipeline/themes_config.py and you want
the config to win (normally the DB list wins so UI edits persist). Destructive
by design: removes every handle not in FOLLOWED_HANDLES.

Usage:
    python sync_followed.py
Env:
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (required).
"""

from __future__ import annotations

import sys

import requests

import db
import themes_config as cfg


def main() -> int:
    if not db.enabled():
        print("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set; nothing to sync.", file=sys.stderr)
        return 1

    handles = sorted({h.strip().lower().lstrip("@") for h in cfg.FOLLOWED_HANDLES if h.strip()})

    r = requests.delete(
        f"{db.URL}/rest/v1/followed_handles?handle=not.is.null",
        headers=db._headers(),
        timeout=db.TIMEOUT,
    )
    r.raise_for_status()

    r = requests.post(
        f"{db.URL}/rest/v1/followed_handles",
        headers=db._headers({"Prefer": "resolution=merge-duplicates,return=minimal"}),
        json=[{"handle": h} for h in handles],
        timeout=db.TIMEOUT,
    )
    r.raise_for_status()

    r = requests.get(
        f"{db.URL}/rest/v1/followed_handles?select=handle",
        headers=db._headers(),
        timeout=db.TIMEOUT,
    )
    r.raise_for_status()
    print(f"synced followed_handles: {len(r.json())} rows (config has {len(handles)})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
