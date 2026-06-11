-- SPX Monitor — daily Bloomberg refresh storage
-- Run this in the Supabase SQL editor (Dashboard → SQL → New query).
--
-- Same access model as the other tables: the app talks to spx_market ONLY
-- with the service-role key from server-side API routes; RLS is enabled with
-- no policies so the anon key can't touch it.
--
-- One row per S&P 500 member (Bloomberg-style ticker, e.g. "NVDA US Equity"),
-- holding the values pipeline/bloomberg_push.py refreshes daily:
--   mkt_cap : prior-day market cap, $ billions
--   est_ni  : consensus net income by calendar year, $ billions
--             (e.g. {"2026": 210.3, "2027": 300.8})
--   ntm_ni  : next-twelve-months consensus net income, $ billions
-- The site overlays these onto the committed workbook snapshot
-- (data/dashboard.json) when they are newer than it.

create table if not exists spx_market (
  ticker    text primary key,
  mkt_cap   float8,
  est_ni    jsonb,
  ntm_ni    float8,
  data_date date,
  as_of     timestamptz not null default now()
);

alter table spx_market enable row level security;
