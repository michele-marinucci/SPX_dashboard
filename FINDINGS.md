# Code Audit — Findings & Cleanup Report

Full-repo audit (June 2026): correctness, security, dead code, data
consistency. Scope: Next.js app (`spx_dashboard/`), Python pipelines
(`spx_dashboard/pipeline/`), GitHub Actions (`.github/workflows/`).
Verification: `tsc --noEmit` clean, `next build` clean, `py_compile` clean on
all touched pipeline files.

## What came back clean

- **Auth**: middleware gates every route except `/login`, `/api/login`,
  `/api/logout`, and static assets; HS256 JWT (jose), 7-day TTL; login has
  per-IP throttling, constant-time comparison, `httpOnly`/`secure`/`sameSite`
  cookie flags. No bypass found.
- **Secrets**: nothing committed — no `.env` tracked, no key patterns in the
  tree or recent history; pipelines and workflows read everything from env /
  GitHub Secrets; no `NEXT_PUBLIC_` leakage of the Supabase service-role key
  (all `*Db.ts` modules are server-only).
- **Injection**: no SQL strings (PostgREST with `encodeURIComponent` filters
  in all TS DB modules); xlsx builder escapes every string/formula/sheet-name
  via `esc()`; no `dangerouslySetInnerHTML`, tweets/news render as plain text;
  no `eval`/`exec`/`pickle`/`shell=True` in the pipelines; export file paths
  are hardcoded (no traversal).
- **Financial math** (`lib/equities/calc.ts`): RRI, EV/GP, Mendo P/E, MoM,
  CAGR, all four target-price variants, and the IRR decomposition were checked
  against their definitions and against the Excel-export formulas — all
  correct and consistent across UI, Excel, and PPT.
- **Workflows**: actions pinned, secrets masked, rebase-retry push loops; no
  `pull_request_target` misuse.

## Issues found and fixed

| # | Severity | Issue | Fix |
|---|----------|-------|-----|
| 1 | High | `api/equities`, `api/equities/bloomberg`, `api/spx/bloomberg` returned raw Supabase error bodies (`e.message` includes the full backend response text) to the client | Generic "Database error." to the client; full error to server log |
| 2 | High | Non-atomic JSON writes in `run_news.py` / `run_twitter.py` / `prune_unfollowed.py`: a crash mid-write leaves invalid JSON, and the next run's loader treats it as missing and **silently wipes the archive** | Temp-file + `os.replace` atomic writes |
| 3 | Medium | `bbg`/`yahoo`/`currency`/`grp` accepted arbitrary strings; `bbg` is interpolated into the Excel `=BDP("…")` formula on export, so a stray quote breaks every exported price formula | `cleanStr()`: strip `"<>`, trim, length-cap, on add and on grp update |
| 4 | Medium | `run_news.py` parsed LLM JSON with no shape validation — a malformed response would be archived and emailed | Validate object shape (`top_themes`/`positions` lists); fail the workflow loudly instead |
| 5 | Medium | `prune_unfollowed.py` built a PostgREST `not.in.(…)` DELETE filter by string concat, unencoded; with an **empty followed set** the filter would match (and delete) the whole tweets table | Filter passed via `params=` (URL-encoded) and the sweep is skipped when the followed set is empty |
| 6 | Medium | `yahoo.ts` quote fetch had no timeout — a hung Yahoo request stalls the daily refresh | `AbortSignal.timeout(10s)`; failures already contained by `Promise.allSettled` |
| 7 | Low | `TwitterMonitor` initial-fetch effect could `setState` after unmount | Cancelled-flag guard |
| 8 | Low | Stale comment: equities Excel export claimed a "Summary" tab that no longer exists | Comment corrected (two tabs) |
| 9 | Low | `fetch_gmail.py` used inline `__import__("time")` | Normal top-level import |
| 10 | Low | Dead code: `components/Commentary.tsx` (never imported), `data/commentary.json` and `data/detailed_dashboard_template.xlsx` (never read) | Deleted |

## Known limitations — deliberately NOT changed

These were flagged during the audit but left alone, either because they're by
design or because "fixing" them would change behavior:

1. **Login rate limiting is per-instance** (in-memory map). On a multi-instance
   serverless deploy, the 10-failures/15-min window applies per instance.
   Acceptable for an internal tool with a strong shared password; a shared
   store (Redis/Upstash) would be needed to make it global.
2. **Excel IRR recalculates with `TODAY()`** while the site computes the year
   fraction in UTC at render time. The exported workbook is a *live model* by
   design, so a few-bps drift vs. the site snapshot (timezones, or simply
   opening the file the next day) is expected, not a bug.
3. **365-day year fraction** in `calc.ts` (`(Dec-31 − today)/365`) matches the
   team's original Excel sheet convention; switching to 365.25 would change
   every IRR slightly.
4. **`divYield` falls back to 0** (not null) when no DPS data exists in
   "dps" mode, while "cashbuild" mode yields null. Possibly intentional
   ("no dividends" vs. "unknown"); changing it would alter decomposition
   output for names without DPS.
5. **`db.py` never raises** on Supabase failures (logs and continues) — by
   design: `tweets.json` is the source of truth and the DB is a mirror. The
   tradeoff is that DB drift is only visible in workflow logs.
6. **Index-based row keys** in `DataTable`/`NtmPeTable` sortable tables: rows
   are stateless display rows, so React reconciles them correctly; switching
   to label keys is cosmetic.
7. **Newsletter/tweet content reaches the LLM unsanitized** (prompt-injection
   surface). The tweet pipeline grounds output against tool citations, and the
   note pipeline now validates output shape (#4). Full mitigation isn't
   possible — summarizing untrusted text is the product.
8. **Workflows have `contents: write`** — required, since they commit data
   files back to `main`.
9. **Dual DST cron lines** in `morning-news.yml` (EST/EDT pair) — inherent to
   GitHub Actions' UTC-only cron; fragile but correct.
10. **Middleware matcher is prefix-based**: a hypothetical route named
    `/login-foo` or `/api/login2` would bypass auth. None exist; worth
    remembering when adding routes.
11. **No ESLint config / no test runner.** `tsconfig` has `strict: true` and
    the codebase has no `any`/`@ts-ignore`, which covers a lot. Adding
    `eslint-config-next` + a few unit tests around `calc.ts` and the xlsx/pptx
    builders would be the highest-value follow-up.

## Recommended follow-ups (in priority order)

1. Unit tests for `lib/equities/calc.ts` (pure functions, trivial to test) and
   the xlsx escaping path.
2. `eslint-config-next` with `react-hooks` rules.
3. Shared-store rate limiting on `/api/login` if the deployment is
   multi-instance.
4. Stagger `morning-news` and `refresh-themes` crons a few minutes apart to
   reduce push contention (both currently rebase-retry their way through).
