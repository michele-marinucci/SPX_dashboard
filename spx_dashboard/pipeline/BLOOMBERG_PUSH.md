# Bloomberg → dashboard auto-push

`bloomberg_push.py` runs on any PC where the Bloomberg Terminal is open and
logged in. It reads **prior-day closes** through the Desktop API (no Excel
involved) and posts them to the Equities Dashboard, where they're stored in
Supabase for the whole team:

- prior close + 1M/3M/6M performance for every name (a Bloomberg push wins
  over the site's once-a-day Yahoo fallback — freshest source wins),
- 3M average daily value traded,
- index BEst P/E for the displayed forecast years (incl. the custom
  B500XM7T index, which has no public feed).

## Designed around the monthly data limit

Three guards keep Bloomberg consumption minimal:

1. **End-of-day only.** It pulls the prior trading day's close, never live
   ticks, so one run per day is all that's ever useful.
2. **Skip when nothing changed.** Before touching Bloomberg, the script asks
   the site what close date it already has. If the latest weekday close is
   already cached — same-day re-run, weekend, etc. — it exits without making
   a single Bloomberg request. Scheduling it daily (even hourly) costs
   nothing extra; redundant runs are no-ops. Use `--force` to override.
3. **One batched BQL query for the whole universe.** Prices for all names ×
   all four anchor dates go through a single BQL request (the same engine as
   the workbook's range formulas), which is dramatically cheaper than
   per-security/per-field reference hits. If the BQL service isn't available
   on the machine, the script automatically falls back to one batched
   historical-data request and says so in its output.

If the Terminal is closed the script exits quietly and the site keeps using
Yahoo (or the last cached closes, with a stale note if the feed stops). The
dashboard toolbar shows the close date and which source it came from.

## One-time setup (on the terminal PC)

```bat
pip install requests truststore
pip install --index-url=https://blpapi.bloomberg.com/repository/releases/python/simple/ blpapi
```

`truststore` lets Python use the Windows certificate store. On a corporate
network with TLS inspection (Zscaler/Palo Alto-type), the connection to the
dashboard would otherwise fail with `CERTIFICATE_VERIFY_FAILED`; with
`truststore` installed the script picks up the company root CA automatically.
(If you can't install it, `pip install pip-system-certs` is an equivalent
fix.)

Test it manually first:

```bat
set DASHBOARD_PASSWORD=<site password>
python bloomberg_push.py https://your-dashboard.vercel.app
```

You should see something like
`Pushed 36 quotes and patched 37 names — closes as of 2026-06-10 …`
(or `Already up to date …` if today's run is redundant).

## Schedule it (Windows Task Scheduler)

Create `bloomberg_push.bat` next to the script:

```bat
@echo off
set DASHBOARD_PASSWORD=<site password>
python C:\path\to\bloomberg_push.py https://your-dashboard.vercel.app >> %TEMP%\bloomberg_push.log 2>&1
```

Then either use the Task Scheduler UI (trigger: daily, e.g. 7:30 AM) or one
line in an admin prompt:

```bat
schtasks /Create /TN "Dashboard Bloomberg push" /TR "C:\path\to\bloomberg_push.bat" ^
  /SC DAILY /ST 07:30 /F
```

Tip: in the task's settings, enable "Run task as soon as possible after a
scheduled start is missed" so a late login still triggers that day's push.

That's it — as long as the Terminal is open at some point in the day, the
dashboard stays on Bloomberg closes with zero manual steps.

## Notes

- The script authenticates with the normal site password (`/api/login`), so
  there are no extra keys to provision on Vercel.
- It fetches its universe from the site each run, so names added/removed on
  the dashboard are picked up automatically.
- Desktop API data is licensed for use by the logged-in terminal user;
  pushing it to the team's internal dashboard is the same internal-sharing
  gray area as circulating the refreshed workbook — keep it internal.
