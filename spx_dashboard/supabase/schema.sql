-- Mendo Hub — Twitter Monitor Supabase schema
-- Run this in the Supabase SQL editor (Dashboard → SQL → New query → Run).
--
-- IMPORTANT: if your handle edits weren't persisting, it's because these tables
-- did not exist yet — running this file fixes that.
--
-- Access model: the app and the pipeline talk to these tables ONLY with the
-- service-role key from server-side code (Next.js API routes + the GitHub
-- Actions pipeline). The browser never holds a Supabase key. RLS is enabled
-- with no policies, so the anon key can't read/write; the service role bypasses
-- RLS. The followed-handles list is intentionally SHARED across all users
-- (single row set, not multitenant).

-- ---------------------------------------------------------------------------
-- Followed accounts — the editable, shared "Followed accounts" set
-- ---------------------------------------------------------------------------
create table if not exists followed_handles (
  handle      text primary key,            -- lowercased, no leading '@'
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Themes (labels for the UI; mirrors pipeline/themes_config.py)
-- ---------------------------------------------------------------------------
create table if not exists themes (
  key    text primary key,
  label  text not null
);

-- ===========================================================================
-- TWITTER MONITOR — tweet-centric model (current design)
-- ===========================================================================

-- Rolling inventory of scraped tweets. Unlike the old feed this ACCUMULATES
-- (one row per tweet, kept ~30 days) so recurring-theme detection has history.
create table if not exists tweets (
  id            text primary key,          -- tweet id (from the x.com URL)
  url           text not null,
  handle        text not null,             -- lowercased author handle
  author_name   text,
  posted_at     timestamptz,
  text          text,                      -- original tweet text
  summary       text,                      -- one-line LLM summary
  sentiment     text,                      -- positive | negative | neutral
  themes        jsonb not null default '[]'::jsonb,   -- theme keys
  tickers       jsonb not null default '[]'::jsonb,   -- mentioned tickers
  portfolio     jsonb not null default '[]'::jsonb,   -- portfolio tickers hit
  views         bigint,
  has_media     boolean not null default false,
  media_summary text,                      -- vision description of chart/image
  first_seen    date,
  last_seen     date,
  seen_count    int not null default 1,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists tweets_posted_at_idx on tweets (posted_at desc);
create index if not exists tweets_handle_idx on tweets (handle);

-- One row per run: the LLM "summary of the day", organized by theme.
create table if not exists daily_summary (
  id            bigint generated always as identity primary key,
  generated_at  timestamptz not null,
  summary       jsonb not null,            -- [{theme, label, summary, tickers}]
  created_at    timestamptz not null default now()
);

-- One row per run: themes flagged as recurring over the trailing window.
create table if not exists recurring_themes (
  id            bigint generated always as identity primary key,
  generated_at  timestamptz not null,
  data          jsonb not null,            -- [{theme, label, days_seen, tweets}]
  created_at    timestamptz not null default now()
);

-- ===========================================================================
-- LEGACY long/short feed (still written by the current pipeline until the
-- tweet-centric rewrite lands; safe to keep — retired tables are just unused).
-- ===========================================================================
create table if not exists ideas (
  ticker        text not null,
  direction     text not null,
  thesis        text,
  catalyst      text,
  sources       jsonb not null default '[]'::jsonb,
  theme_keys    jsonb not null default '[]'::jsonb,
  prices        jsonb,
  citations     jsonb not null default '[]'::jsonb,
  first_seen    date,
  last_seen     date,
  seen_count    int  not null default 1,
  tier          text,
  score         real,
  conviction    text,
  active        boolean not null default true,
  on_watchlist  boolean not null default false,
  updated_at    timestamptz not null default now(),
  primary key (ticker, direction)
);

create table if not exists runs (
  id            bigint generated always as identity primary key,
  generated_at  timestamptz not null,
  idea_count    int not null default 0,
  active_count  int not null default 0,
  created_at    timestamptz not null default now()
);

create table if not exists idea_snapshots (
  run_id      bigint not null references runs(id) on delete cascade,
  ticker      text not null,
  direction   text not null,
  tier        text,
  score       real,
  conviction  text,
  seen_count  int,
  active      boolean,
  data        jsonb not null,
  primary key (run_id, ticker, direction)
);
create index if not exists idea_snapshots_ticker_idx
  on idea_snapshots (ticker, direction);

-- ---------------------------------------------------------------------------
-- Diligence Tracker: one shared link per position to its Microsoft List
-- ---------------------------------------------------------------------------
create table if not exists diligence_links (
  ticker      text primary key,            -- uppercased symbol, e.g. "MSFT"
  name        text not null default '',    -- company name
  url         text not null,               -- Microsoft List URL
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Lock everything down (service role bypasses RLS; anon/authenticated get nothing).
alter table followed_handles enable row level security;
alter table themes           enable row level security;
alter table tweets           enable row level security;
alter table daily_summary    enable row level security;
alter table recurring_themes enable row level security;
alter table ideas            enable row level security;
alter table runs             enable row level security;
alter table idea_snapshots   enable row level security;
alter table diligence_links  enable row level security;
