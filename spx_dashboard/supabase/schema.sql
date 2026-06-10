-- X Themes — Supabase schema
-- Run this in the Supabase SQL editor (Dashboard → SQL → New query).
--
-- Access model: the app and the pipeline talk to these tables ONLY with the
-- service-role key from server-side code (Next.js API routes + the GitHub
-- Actions pipeline). The browser never holds a Supabase key. RLS is enabled
-- with no policies, so the anon key can't read/write; the service role bypasses
-- RLS. This keeps the single-password gate as the only access path.

-- ---------------------------------------------------------------------------
-- Followed accounts (the editable "Followed accounts" set)
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

-- ---------------------------------------------------------------------------
-- Current feed: latest state per (ticker, direction)
-- ---------------------------------------------------------------------------
create table if not exists ideas (
  ticker        text not null,
  direction     text not null,             -- long | short | watch
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

-- ---------------------------------------------------------------------------
-- History: one row per run, plus a per-idea snapshot for analytics over time
-- ---------------------------------------------------------------------------
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
  data        jsonb not null,              -- full idea record at run time
  primary key (run_id, ticker, direction)
);
create index if not exists idea_snapshots_ticker_idx
  on idea_snapshots (ticker, direction);

-- Lock everything down (service role bypasses RLS; anon/authenticated get nothing).
alter table followed_handles enable row level security;
alter table themes           enable row level security;
alter table ideas            enable row level security;
alter table runs             enable row level security;
alter table idea_snapshots   enable row level security;
