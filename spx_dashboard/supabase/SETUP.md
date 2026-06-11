# Supabase setup for X Themes

The app and pipeline work **without** Supabase (they fall back to `data/themes.json`
and per-browser localStorage). Provision Supabase to get cross-device persistence
of the followed list, a DB-backed feed, and run history/analytics.

## 1. Create the project
1. Go to https://supabase.com → New project. Pick a region close to you.
2. When it's ready, open **SQL** → paste the contents of `supabase/schema.sql` → **Run**.

## 2. Grab credentials (Settings → API)
- **Project URL** — e.g. `https://abcd1234.supabase.co`
- **service_role key** — the secret one (NOT `anon`). Treat it like a password.

## 3. Wire it up
**Vercel** (Project → Settings → Environment Variables), for Production + Preview:
- `SUPABASE_URL` = your Project URL
- `SUPABASE_SERVICE_ROLE_KEY` = the service_role key

**GitHub** (repo → Settings → Secrets and variables → Actions → New secret):
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

(The workflow already passes these through when present.)

## 4. Seed + first write
- Redeploy on Vercel so the env vars take effect.
- Run the **Refresh X Themes feed** workflow once. It seeds `followed_handles`
  (from `themes_config.py`) and `themes` if empty, writes the current feed to
  `ideas`, and appends a `runs` + `idea_snapshots` history snapshot.

## Notes
- The browser never receives a Supabase key — all DB access is server-side
  (Next.js API routes) or from the Actions runner.
- If the env vars are absent, everything keeps working off `themes.json` /
  localStorage, so you can roll this out without downtime.
- The **Diligence Tracker** shares the same Supabase project (`diligence_links`
  table in `schema.sql`). It seeds itself from `data/diligence.json` the first
  time the page is opened, then becomes the shared source of truth — no
  workflow or extra env vars needed beyond the two above.

---

# Equities Dashboard tables

The Equities Dashboard (`/dashboard`) uses the **same** Supabase project and the
same two env vars as above — no extra credentials needed. To enable shared
analyst edits and the per-company edits log:

1. Open **SQL** in Supabase → paste the contents of `supabase/equities.sql` → **Run**.
2. That's it. On the next page load the app seeds `eq_companies` from the
   committed workbook parse (`data/equities_seed.json`), and starts caching
   prior-day closes in `eq_market` (refreshed at most once per trading day,
   from Yahoo and/or a Bloomberg terminal push — see `pipeline/BLOOMBERG_PUSH.md`).

Without these tables the page still works read-only from the committed snapshot
(prior-day closes, but no shared edits).

---

# SPX Monitor daily refresh table

The SPX Monitor (`/spx` and the per-category pages) renders the committed
workbook snapshot (`data/dashboard.json`), overlaid with a daily Bloomberg
push when one exists. Same project, same env vars:

1. Open **SQL** in Supabase → paste the contents of `supabase/spx.sql` → **Run**.
2. The Bloomberg push script (`pipeline/bloomberg_push.py`) then refreshes
   `spx_market` daily: prior-day market caps and consensus net income for the
   full S&P 500. The site recomputes every aggregate row from them; the
   historical anchor columns and P/E history stay from the workbook.

Without this table the pages simply keep showing the workbook snapshot.
