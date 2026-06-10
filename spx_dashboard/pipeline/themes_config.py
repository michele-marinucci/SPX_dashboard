"""
Shared, in-code configuration for the "X Themes" briefing.

This is the *only* place to edit what the daily scout looks for. There is no
database and nothing per-user: one curated config drives the whole feed.

  - THEMES          the investment themes to scout each day. Each has a free-
                    text intent prompt (handed to Grok) and a set of
                    `priority_handles` — accounts you trust most. NOTE: the
                    handles do NOT restrict the search; the scout searches all
                    of X openly and only uses these to *bucket* ideas into the
                    "priority" tier afterwards.
  - WATCHLIST       tickers you care about. Passed to the model as a hint and
                    flagged on the card; it is not a hard filter (any validated
                    US ticker can surface).
  - SOURCE_WEIGHTS  per-tier weights feeding the derived conviction/score.

Edit freely — the pipeline imports these names directly.
"""

from __future__ import annotations

# xAI model used for scouting. The x_search agent tool requires a tool-capable
# Grok. Bump this as xAI ships newer models.
MODEL = "grok-4.3"

# How many days back x_search should look each run. A daily briefing wants the
# most recent chatter; 2 days gives a little overlap so nothing slips through a
# missed/slow run without drowning the feed in stale posts.
LOOKBACK_DAYS = 2

# Feed shaping (consumed by the merge/aging logic, not the frontend).
#   AGE_OUT_DAYS  an idea drops out of the *main view* this many days after it
#                 was last seen — but it stays in themes.json for recurrence
#                 math (so its seen_count keeps counting if it returns).
#   PRUNE_DAYS    hard-delete a record from themes.json once it has been silent
#                 this long, to keep the file bounded.
#   MAX_FEED      safety cap on how many active ideas the file carries forward.
AGE_OUT_DAYS = 5
PRUNE_DAYS = 120
MAX_FEED = 60

# Per-tier source weight feeding the derived conviction (see fetch_themes.py).
# Priority handles are trusted most; discovery (unvetted) least.
SOURCE_WEIGHTS = {
    "priority": 1.0,
    "credible": 0.6,
    "discovery": 0.25,
}

# Tickers you actively track. Used only as a prompt hint + an `on_watchlist`
# flag on the card — it is NOT a whitelist. Keep ticker symbols upper-case.
WATCHLIST = [
    "NVDA", "AMD", "AVGO", "TSM", "MU", "ARM", "SMCI", "DELL", "ANET",
    "MSFT", "GOOGL", "AMZN", "META", "ORCL", "PLTR", "SNOW", "CRM", "NOW",
    "VRT", "ETN", "CEG", "VST", "TSLA", "ASML", "KLAC", "LRCX", "AMAT",
]

# The themes scouted every run.
#   key               stable slug used for dedup attribution + logging.
#   prompt            natural-language intent handed to Grok.
#   priority_handles  X usernames (no '@') you trust most for THIS theme. Used
#                     only for tier bucketing, never to restrict the search.
THEMES = [
    {
        "key": "ai-infra",
        "prompt": (
            "Surface concrete, actionable investment ideas about AI compute "
            "infrastructure: GPUs/accelerators, custom silicon, networking, "
            "memory (HBM), and the semiconductor supply chain. Favor specific "
            "names with a clear bull or bear thesis and a near-term catalyst."
        ),
        "priority_handles": ["dnystedt", "firstadopter", "morethanmoore"],
    },
    {
        "key": "ai-power",
        "prompt": (
            "Surface investment ideas about the power and datacenter buildout "
            "behind AI: electrical equipment, grid, cooling, utilities exposed "
            "to datacenter demand, and independent power producers."
        ),
        "priority_handles": ["DataCenterHawk", "Josh_Young_1"],
    },
    {
        "key": "ai-software",
        "prompt": (
            "Surface investment ideas about AI-monetizing software: enterprise "
            "AI adoption, inference demand, agents, and software names whose "
            "revenue is accelerating (or decelerating) because of AI."
        ),
        "priority_handles": ["jasonlk", "garrytan", "modestproposal1"],
    },
]
