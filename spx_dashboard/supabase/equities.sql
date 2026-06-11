-- Equities Dashboard — Supabase schema
-- Run this in the Supabase SQL editor (Dashboard → SQL → New query).
--
-- Same access model as schema.sql: the app talks to these tables ONLY with
-- the service-role key from server-side API routes; RLS is enabled with no
-- policies so the anon key can't touch them. On first page load after these
-- tables exist, the app seeds eq_companies from the committed workbook parse
-- (data/equities_seed.json) automatically.

-- ---------------------------------------------------------------------------
-- One row per company (and per index row at the bottom of the sheet).
-- `model` holds every analyst-editable input keyed by absolute year, so the
-- visible 5-year window rolls forward each January 1 with no migration.
-- ---------------------------------------------------------------------------
create table if not exists eq_companies (
  ticker          text primary key,
  bbg             text not null default '',
  yahoo           text,                    -- Yahoo Finance symbol (null = no feed)
  currency        text not null default '$',
  px_scale        float8 not null default 1,  -- 0.01 for LSE pence quotes
  grp             text not null default 'Other sectors',
  grp_order       int  not null default 0,
  row_order       int  not null default 0,
  port            int,                     -- 1 = owned (green), 2 = watch
  update_date     date,
  update_by       text,
  variant         text not null default 'pe',   -- target-price formula variant
  cash_in_target  boolean not null default false,
  div_yield_mode  text not null default 'dps',  -- dps | cashbuild | none
  decomp          text not null default 'standard', -- standard | simple
  yield_input     float8,                  -- hardcoded Yield for simple decomp
  adv_3m          float8,
  perf            jsonb not null default '{}'::jsonb, -- seed-time 1M/3M/6M fallback
  model           jsonb not null default '{}'::jsonb, -- the editable model inputs
  is_index        boolean not null default false,
  best_pe         jsonb,                   -- index rows: BEst P/E by year
  removed         boolean not null default false -- soft delete; restorable in the UI
);

-- Upgrade-in-place for tables created before soft-delete existed (re-running
-- this whole file is always safe).
alter table eq_companies add column if not exists removed boolean not null default false;

-- ---------------------------------------------------------------------------
-- Append-only log of model changes ("Edits log" in the UI).
-- `changes` is an array of {field, old, new}, field being a dotted path
-- like "revs.2027" or "shares".
-- ---------------------------------------------------------------------------
create table if not exists eq_edits (
  id          bigint generated always as identity primary key,
  ticker      text not null,
  analyst     text not null,
  created_at  timestamptz not null default now(),
  changes     jsonb not null default '[]'::jsonb
);
create index if not exists eq_edits_ticker_idx on eq_edits (ticker, created_at desc);

-- ---------------------------------------------------------------------------
-- Cached market quotes (PRIOR-day close + 1M/3M/6M performance). The app
-- refreshes from Yahoo at most once a day, and/or a Bloomberg terminal pushes
-- via pipeline/bloomberg_push.py. `source` records which feed wrote the row,
-- `data_date` is the trading day the values are as-of, and `as_of` is the
-- write time (which drives the once-a-day refresh). Freshest write wins.
-- ---------------------------------------------------------------------------
create table if not exists eq_market (
  symbol     text primary key,
  price      float8,
  m1         float8,
  m3         float8,
  m6         float8,
  source     text,
  data_date  date,
  as_of      timestamptz not null default now()
);
alter table eq_market add column if not exists source text;
alter table eq_market add column if not exists data_date date;

alter table eq_companies enable row level security;
alter table eq_edits     enable row level security;
alter table eq_market    enable row level security;
