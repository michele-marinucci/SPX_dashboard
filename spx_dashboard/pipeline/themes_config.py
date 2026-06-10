"""
Shared, in-code configuration for the Twitter Monitor pipeline.

The monitor scrapes the tweets of FOLLOWED_HANDLES on a Mon/Wed/Fri cadence,
summarizes them by theme, flags portfolio mentions, and tracks topics that
recur across the trailing RETENTION_DAYS window.

  - FOLLOWED_HANDLES  default followed accounts; seeds the shared (UI-editable)
                      Supabase list on first run. The DB list wins afterwards.
  - PORTFOLIO         current holdings, matched against each day's tweets.
  - THEMES            the theme taxonomy used to organize the daily summary.
  - WATCHLIST         tickers passed to the model as a tagging hint.

Edit freely — the pipeline imports these names directly.
"""

from __future__ import annotations

# xAI models. Retrieval needs a tool-capable Grok (x_search); the cheaper
# "fast" model handles summarization/sentiment/clustering; vision describes
# chart images. Bump these as xAI ships newer models.
MODEL = "grok-4.3"            # retrieval (x_search) + vision
FAST_MODEL = "grok-4.1-fast"  # summaries, sentiment, theme clustering

# How many days back each scheduled run looks. The cron fires Mon/Wed/Fri, so
# a 3-day window always covers the gap since the previous run (Fri→Mon).
LOOKBACK_DAYS = 3

# Tweet store shaping.
#   RETENTION_DAYS    tweets older than this are pruned from the store; this is
#                     the memory window recurring-theme detection sees.
#   RECUR_MIN_DAYS    a topic must appear on at least this many distinct days
#                     to count as "recurring".
#   MAX_VISION_CALLS  per-run cap on chart/image description calls (cost bound).
RETENTION_DAYS = 30
RECUR_MIN_DAYS = 3
MAX_VISION_CALLS = 12

# Curated "Followed accounts": the handles you trust. Seeds the Twitter Monitor
# UI on first run; thereafter the list is editable in-app and SHARED across all
# users (one Supabase `followed_handles` table, not per-user). Handles are
# case-insensitive and stored without the leading '@'.
FOLLOWED_HANDLES = [
    "EdZitron", "Wccftech", "Firstadopter", "SouthernValue95", "ChatGPTapp",
    "Kimmonismus", "Jukan05", "PrismML", "ClaudeAI", "Austinsemis",
    "Apoorv03", "JulienBek", "Citrini", "KobeissiLetter", "Atelicinvest",
    "Nicbstme", "Inflectionecon", "Coatuemgmt", "Wisemancap", "Bgurley",
    "Vikramskr", "Contrariancurse", "Insane_analyst", "Alexeheath", "Dnystedt",
    "Mooremorrissemi", "The_ai_investor", "Thehumanoidlab", "Similarweb",
    "Rihardjarc", "Kevinweil", "Tmtmoats", "Macroedgeres", "Fundaai",
    "Altcap", "Elerianm", "Satyanadella", "Dharmesh", "Sama", "Dylan522p",
    "Techfundies", "Modestproposal1", "Benthompson", "Deepseek_ai",
    "Artificialanlys", "Gavinsbaker",
]

# Current portfolio holdings, surfaced in the Twitter Monitor "Portfolio
# mentions" table when a name comes up in the day's tweets. Some are non-US
# (Bloomberg-style suffixes kept for display); price lookups for those will be
# placeholder until a non-US-capable finance source is wired. The Equities
# Dashboard tool will become the authoritative source for this list.
PORTFOLIO = [
    "MSFT", "AMZN", "TRU", "COF", "AON", "WDAY", "SPGI", "LSEG LN",
    "CSGP", "DSV DC", "MSCI", "META", "SAP GY", "TOST", "EFX", "VSAT",
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
