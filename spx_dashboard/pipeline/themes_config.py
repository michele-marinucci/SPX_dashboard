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

# How many days back x_search should look each run. A daily briefing wants
# recent chatter, but trusted accounts post intermittently — a ~1-week window
# captures them (and survives a missed/slow run) without drowning the feed.
LOOKBACK_DAYS = 7

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

# Curated "Followed accounts": the handles you trust. An idea is shown under
# "Followed accounts" (vs "Discovery") when any of its source posts is from one
# of these. Seeds the X Themes UI, which lets you add/remove handles in-browser.
# Handles are case-insensitive and stored without the leading '@'.
FOLLOWED_HANDLES = [
    # AI labs
    "sama", "demishassabis", "DarioAmodei",
    # Prominent investors
    "GavinSBaker", "bgurley", "BillAckman", "altcap", "modestproposal1",
    # Podcasters / research
    "patrick_oshag", "dwarkesh_sp",
    # Sector specialists
    "dnystedt", "dylan522p", "Beth_Kindig", "p_ferragu",
    "DataCenterHawk", "hhhypergrowth", "rihardjarc", "StockMarketNerd",
]

# Tickers you actively track. Used only as a prompt hint + an `on_watchlist`
# flag on the card — it is NOT a whitelist. Keep ticker symbols upper-case.
# This mirrors the AI-beneficiary universe tracked in the SPX Monitor.
WATCHLIST = [
    # Digital semis / hardware / memory / analog
    "NVDA", "AVGO", "AMD", "INTC", "QCOM", "ARM", "TSM",
    "CSCO", "ANET", "DELL", "SMCI", "HPE", "CIEN", "COHR", "LITE", "GLW", "APH",
    "MU", "WDC", "STX", "SNDK",
    "TXN", "ADI", "MPWR", "MCHP", "ON",
    # Electrical / cooling / power / construction
    "ETN", "VRT", "TT", "EMR", "JCI", "CARR", "CMI", "FIX",
    "GEV", "CEG", "VST", "ETR", "CAT", "PWR", "EME",
    # EDA / semicap
    "CDNS", "SNPS", "KEYS", "LRCX", "AMAT", "KLAC", "TER",
    # Software (application + infrastructure)
    "CRM", "NOW", "ADBE", "INTU", "WDAY", "PTC", "ADSK",
    "PANW", "CRWD", "FTNT", "DDOG", "VRSN",
    # AI buildout funders (big tech)
    "MSFT", "AMZN", "GOOGL", "META", "ORCL", "TSLA",
]

# The themes scouted every run. These mirror the AI-beneficiary categories in
# the SPX Monitor; the X Themes view renders them dynamically from the data, so
# adding/removing a theme here flows straight through to the UI.
#   key               stable slug used for dedup attribution + logging.
#   label             human-readable name shown in the interface.
#   prompt            natural-language intent handed to Grok.
#   priority_handles  X usernames (no '@') you trust most for THIS theme. Used
#                     only for tier bucketing, never to restrict the search.
THEMES = [
    {
        "key": "digital-semis",
        "label": "Digital Semis",
        "prompt": (
            "Surface concrete, actionable investment ideas about digital "
            "semiconductors: AI GPUs/accelerators, custom silicon (ASICs), and "
            "compute processors (e.g. NVDA, AVGO, AMD, INTC, QCOM). Favor a "
            "clear bull or bear thesis with a near-term catalyst."
        ),
        "priority_handles": ["GavinSBaker", "dnystedt", "dylan522p", "Beth_Kindig"],
    },
    {
        "key": "hardware-components",
        "label": "Hardware & Networking",
        "prompt": (
            "Surface investment ideas about AI datacenter hardware and "
            "networking: switches, optics/transceivers, servers, cabling and "
            "components (e.g. ANET, CSCO, DELL, SMCI, CIEN, COHR, LITE, GLW, "
            "APH, HPE)."
        ),
        "priority_handles": ["dnystedt", "p_ferragu", "dylan522p"],
    },
    {
        "key": "memory",
        "label": "Memory & Storage",
        "prompt": (
            "Surface investment ideas about memory and storage exposed to AI "
            "demand: HBM, DRAM, NAND and hard drives (e.g. MU, WDC, STX, SNDK)."
        ),
        "priority_handles": ["dnystedt", "Beth_Kindig", "dylan522p"],
    },
    {
        "key": "analog-mcu",
        "label": "Analog & MCU",
        "prompt": (
            "Surface investment ideas about analog and microcontroller "
            "semiconductors and the broader analog cycle (e.g. TXN, ADI, "
            "MPWR, MCHP, ON), especially power-management content for AI."
        ),
        "priority_handles": ["p_ferragu", "dnystedt"],
    },
    {
        "key": "electric-cooling",
        "label": "Electrical & Cooling",
        "prompt": (
            "Surface investment ideas about datacenter electrical equipment "
            "and thermal/cooling: power distribution, liquid cooling, HVAC and "
            "backup power (e.g. ETN, VRT, TT, EMR, JCI, CARR, CMI, FIX)."
        ),
        "priority_handles": ["DataCenterHawk", "GavinSBaker"],
    },
    {
        "key": "design-semicap",
        "label": "EDA & Semicap",
        "prompt": (
            "Surface investment ideas about chip design software (EDA) and "
            "semiconductor capital equipment (e.g. CDNS, SNPS, KEYS, LRCX, "
            "AMAT, KLAC, TER), including WFE spend and leading-edge capacity."
        ),
        "priority_handles": ["dylan522p", "p_ferragu"],
    },
    {
        "key": "power",
        "label": "Power & Utilities",
        "prompt": (
            "Surface investment ideas about power generation for AI datacenters: "
            "utilities and independent power producers, nuclear, gas turbines "
            "and grid buildout (e.g. CEG, VST, GEV, ETR, CAT)."
        ),
        "priority_handles": ["DataCenterHawk", "GavinSBaker"],
    },
    {
        "key": "construction",
        "label": "Datacenter Construction",
        "prompt": (
            "Surface investment ideas about datacenter construction and "
            "engineering: electrical contractors and infrastructure builders "
            "(e.g. PWR, EME) riding the AI buildout."
        ),
        "priority_handles": ["DataCenterHawk"],
    },
    {
        "key": "software-application",
        "label": "Application Software",
        "prompt": (
            "Surface investment ideas about application software monetizing AI: "
            "enterprise SaaS whose revenue is accelerating (or decelerating) "
            "from AI/agents (e.g. CRM, NOW, ADBE, INTU, WDAY, PTC, ADSK)."
        ),
        "priority_handles": ["GavinSBaker", "altcap", "rihardjarc", "StockMarketNerd"],
    },
    {
        "key": "software-infrastructure",
        "label": "Infrastructure Software",
        "prompt": (
            "Surface investment ideas about infrastructure software benefiting "
            "from AI: cybersecurity, observability and developer/cloud "
            "infrastructure (e.g. PANW, CRWD, FTNT, DDOG, VRSN)."
        ),
        "priority_handles": ["hhhypergrowth", "rihardjarc", "GavinSBaker"],
    },
    {
        "key": "big-tech",
        "label": "AI Buildout Funders",
        "prompt": (
            "Surface investment ideas about the hyperscalers and big-tech "
            "funders of the AI buildout: capex, cloud growth and AI "
            "monetization (e.g. MSFT, AMZN, GOOGL, META, ORCL, TSLA)."
        ),
        "priority_handles": ["GavinSBaker", "altcap", "modestproposal1"],
    },
]
