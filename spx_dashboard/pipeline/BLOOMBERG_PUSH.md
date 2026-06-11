# Bloomberg → dashboard auto-push

`bloomberg_push.py` runs on any PC where the Bloomberg Terminal is open and
logged in. It reads live data through the Desktop API (no Excel involved) and
posts it to the Equities Dashboard, where it's stored in Supabase for the
whole team:

- live prices + 1M/3M/6M performance for every name (Bloomberg overrides the
  Yahoo self-refresh while the script is running — freshest source wins),
- 3M average daily value traded,
- index BEst P/E for the displayed forecast years (incl. the custom
  B500XM7T index, which has no public feed).

If the Terminal is closed the script exits quietly and the site keeps using
Yahoo (or the last cached prices, with a stale note after ~20h). The
dashboard toolbar shows which source the current prices came from.

## One-time setup (on the terminal PC)

```bat
pip install requests
pip install --index-url=https://blpapi.bloomberg.com/repository/releases/python/simple/ blpapi
```

Test it manually first:

```bat
set DASHBOARD_PASSWORD=<site password>
python bloomberg_push.py https://your-dashboard.vercel.app
```

You should see something like `Pushed 36 quotes and patched 37 names at …`.

## Schedule it (Windows Task Scheduler)

Create `bloomberg_push.bat` next to the script:

```bat
@echo off
set DASHBOARD_PASSWORD=<site password>
python C:\path\to\bloomberg_push.py https://your-dashboard.vercel.app >> %TEMP%\bloomberg_push.log 2>&1
```

Then either use the Task Scheduler UI (trigger: daily, repeat every 15 or 30
minutes during market hours) or one line in an admin prompt:

```bat
schtasks /Create /TN "Dashboard Bloomberg push" /TR "C:\path\to\bloomberg_push.bat" ^
  /SC MINUTE /MO 30 /F
```

That's it — as long as the Terminal is open, the dashboard stays on
Bloomberg numbers with zero manual steps.

## Notes

- The script authenticates with the normal site password (`/api/login`), so
  there are no extra keys to provision on Vercel.
- It fetches its universe from the site each run, so names added/removed on
  the dashboard are picked up automatically.
- Desktop API data is licensed for use by the logged-in terminal user;
  pushing it to the team's internal dashboard is the same internal-sharing
  gray area as circulating the refreshed workbook — keep it internal.
