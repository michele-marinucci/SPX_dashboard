-- Mendo Hub — login brute-force throttle
-- Run this in the Supabase SQL editor (Dashboard → SQL → New query → Run).
--
-- Why: the /api/login route limits failed password attempts per IP, but the
-- counter used to live in process memory. On serverless hosting (Vercel) each
-- instance has its own memory and instances recycle constantly, so the limit
-- reset far more often than intended. Persisting attempts here makes the limit
-- hold across every instance and restart.
--
-- Access model: same as the other tables — only server-side code with the
-- service-role key touches this; RLS is on with no policies so the anon key
-- can't read/write. One row per failed attempt; rows older than the window are
-- pruned by the app on each new failure, so the table stays tiny.
create table if not exists login_attempts (
  id            bigint generated always as identity primary key,
  ip            text not null,
  attempted_at  timestamptz not null default now()
);

-- Fast lookup of recent attempts for one IP (the throttle's hot path).
create index if not exists login_attempts_ip_time
  on login_attempts (ip, attempted_at desc);

alter table login_attempts enable row level security;
