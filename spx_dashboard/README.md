# SPX Categories Dashboard

A personal, password-protected dashboard that tracks AI-beneficiary and software
stocks within the S&P 500. Data comes from `SPX_inputs.xlsx` (refreshed in
Bloomberg and emailed to a dedicated Gmail address). A scheduled job polls the
inbox, parses the workbook's `Output` sheet, and commits the parsed data, which
triggers an automatic Vercel redeploy.

```
 you refresh + email SPX_inputs.xlsx
            │
            ▼
   meritage.code@gmail.com  (dedicated inbox)
            │   every 15 min
            ▼
   GitHub Actions (poll-inbox.yml)
     • IMAP download newest .xlsx   (pipeline/fetch_gmail.py)
     • parse Output sheet           (pipeline/parse_excel.py)
     • commit data/dashboard.json   (only if it changed)
            │  git push
            ▼
        Vercel  ──redeploy──▶  https://<your-app>.vercel.app  (login required)
```

## Tech

- **Next.js 14** (App Router, TypeScript) on **Vercel** — server-rendered tables
  behind real server-side auth (a signed `httpOnly` cookie + edge middleware),
  so no data is sent to the browser until you log in.
- **Python + openpyxl** parser (`data_only=True`, no terminal needed).
- **GitHub Actions** for the scheduled Gmail poll (IMAP via App Password).

## Repository layout

```
app/                      Next.js routes
  page.tsx                the dashboard (server component)
  login/page.tsx          login screen
  api/login, api/logout   auth endpoints
components/               DataTable, NtmPeTable, CategoriesTable, Sparkline, …
lib/                      auth (JWT), data loaders + types, formatting, heatmap
middleware.ts             server-side auth gate for every protected route
data/
  dashboard.json          parsed data (committed; the site reads this)
  commentary.json         per-table bullet commentary (edit + commit to update)
pipeline/
  fetch_gmail.py          IMAP poll → download newest .xlsx
  parse_excel.py          Output sheet → dashboard.json
  run_pipeline.py         orchestrator (fetch + change-detect + parse)
  requirements.txt
.github/workflows/
  poll-inbox.yml          scheduled poll + commit
```

## Commentary

Each table shows bullet commentary from `data/commentary.json`. These are
placeholders today. Edit the strings, commit, and the site updates on redeploy.

## Tables

`SPX Categories` (universe map) · `Stock Performance` · `Earnings Growth` ·
`Estimate Revisions 2026` · `Estimate Revisions 2027` · `NTM P/E` · `Appendix`.
Each financial table also renders its "Share of S&P 500" companion, with
green/red diverging heatmaps on Δ columns and blue sequential heatmaps on level
columns. NTM P/E includes an inline P/E-history sparkline.

> **GAAP appendix:** the current export carries **Adjusted** figures only — GAAP
> is a toggle on the workbook's `Data` sheet (`Data!AL6`). The appendix section
> auto-populates if GAAP-titled tables ever appear on the `Output` sheet; until
> then it shows an explanatory note. See "Adding the GAAP appendix" below.

---

# Setup

## 0. Prerequisites

- A GitHub account (`michele-marinucci`) and this repository (private).
- A Vercel account (free Hobby tier).
- The dedicated Gmail address (`meritage.code@gmail.com`) with **2-Step
  Verification enabled** so you can create an **App Password**.

## 1. Generate a Gmail App Password

1. Sign in to the dedicated Gmail account.
2. Enable **2-Step Verification**: <https://myaccount.google.com/security>.
3. Create an App Password: <https://myaccount.google.com/apppasswords>
   (name it e.g. "SPX dashboard"). Copy the 16-character value.
4. IMAP is enabled by default on Gmail; no extra step needed.

> Note on "Gmail API": Google App Passwords authenticate **IMAP/SMTP**, not the
> OAuth Gmail API. This project polls over IMAP with the App Password — simpler,
> and exactly what an App Password is for.

## 2. Connect the repo to Vercel and set env vars

1. Go to <https://vercel.com/new>, **Import** `michele-marinucci/SPX_dashboard`.
2. Framework preset: **Next.js** (auto-detected). Leave build settings default.
3. Before deploying, open **Environment Variables** and add (Production +
   Preview + Development):

   | Name           | Value                                             |
   | -------------- | ------------------------------------------------- |
   | `SITE_PASSWORD`| the password you and your manager will type        |
   | `AUTH_SECRET`  | a long random string — generate with `openssl rand -base64 48` |

4. Click **Deploy**. When it finishes you'll get `https://<app>.vercel.app`.
   Visit it → you should be redirected to `/login`.

## 3. Add the Gmail secrets to GitHub Actions

The polling job runs in GitHub Actions, so its secrets live in GitHub (not
Vercel). In the repo: **Settings → Secrets and variables → Actions → New
repository secret**, add:

| Name                 | Value                                                  |
| -------------------- | ------------------------------------------------------ |
| `GMAIL_ADDRESS`      | `meritage.code@gmail.com`                              |
| `GMAIL_APP_PASSWORD` | the 16-char App Password (no spaces)                  |
| `GMAIL_FROM_FILTER`  | *(optional)* only accept mail from this sender         |
| `ATTACHMENT_NAME`    | *(optional)* `SPX_inputs` — match this filename substring |

Also ensure Actions can push: **Settings → Actions → General → Workflow
permissions → Read and write permissions**.

## 4. First end-to-end run

1. Email `SPX_inputs.xlsx` as an attachment to `meritage.code@gmail.com`.
2. In the repo: **Actions → "Poll Gmail and refresh dashboard data" → Run
   workflow** (or wait up to ~15 min for the schedule).
3. The job downloads the file, parses it, and commits `data/dashboard.json`
   if it changed. That push triggers a Vercel redeploy.
4. Open the site, log in with `SITE_PASSWORD`, and confirm the data matches.

---

# Local development

```bash
npm install
cp .env.example .env.local         # set SITE_PASSWORD and AUTH_SECRET
npm run dev                        # http://localhost:3000
```

Regenerate the parsed data from a local workbook:

```bash
pip install -r pipeline/requirements.txt
python pipeline/parse_excel.py path/to/SPX_inputs.xlsx data/dashboard.json
```

Test the Gmail poll locally (uses the same env vars as the workflow):

```bash
export GMAIL_ADDRESS=meritage.code@gmail.com
export GMAIL_APP_PASSWORD=xxxxxxxxxxxxxxxx
python pipeline/run_pipeline.py
```

---

# How the parser maps the Output sheet

Tables are located by **searching for their title strings** (not hard-coded
rows), so a refresh that shifts rows vertically won't break parsing. Columns
within each table come from the fixed template:

| Table                         | Title (anchor)                         | Label col | Value cols |
| ----------------------------- | -------------------------------------- | --------- | ---------- |
| Stock Performance             | `YTD Stock Performance …`              | B         | D/E/F, Δ in H/I, %Δ in K/L |
| Estimate Revisions 2026       | `2026 Estimates …`                     | B         | same shape |
| Estimate Revisions 2027       | `2027 Estimates …`                     | B         | same shape |
| Earnings Growth               | `Net Income Growth …`                  | M         | N–Q years, Δ S–U, %Δ W–Y |
| SPX Categories                | `AI Capex Beneficiaries` (exact)       | Z–AL grid | ticker lists |
| NTM P/E                       | `NTM P/E`                              | AN        | AP/AR/AT + AV–AY avg + BA–BD Δ + BF… history |

Only the `Output` sheet is read; the raw `Data` sheet is never touched. The raw
workbook is git-ignored and never committed.

# Adding the GAAP appendix

The workbook produces a single set of `Output` tables; GAAP vs Adjusted is a
toggle (`Data!AL6`: 1 = GAAP, 2 = Adjusted). To publish a GAAP appendix, add
GAAP-titled copies of the Earnings Growth / 2026 / 2027 tables to the `Output`
sheet (e.g. a title containing "GAAP"). `parse_excel.py:parse_appendix` detects
the `GAAP` keyword and the appendix will populate automatically. Alternatively,
maintain a second GAAP-mode export and extend the pipeline to merge both.

# Security

- Repo is **private**; the site is gated by server-side auth (no JS-only gate).
- All secrets are environment variables (Vercel for the site, GitHub Actions for
  the pipeline) — nothing is hard-coded.
- `robots` is set to `noindex`; the raw `.xlsx` (with the `Data` sheet) is never
  committed.
