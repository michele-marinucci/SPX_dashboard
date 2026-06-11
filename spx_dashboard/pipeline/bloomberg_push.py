"""
Push PRIOR-DAY Bloomberg data into the Equities Dashboard — run on a PC where
the Bloomberg Terminal is open and logged in. No Excel involved: this talks to
the Desktop API (the same feed the workbook's BQL/BDP formulas use) and posts
the values to the website, which stores them in Supabase for everyone.

Built to sip, not gulp, the monthly data allowance:

  1. END-OF-DAY ONLY — it pulls the prior trading day's close, never live
     ticks, so one run per day is all that's ever useful.
  2. SKIP WHEN CACHED — before touching Bloomberg it asks the site which
     close date is already stored; if the latest weekday close is there
     (same-day re-run, weekend, etc.) it exits without a single Bloomberg
     request. `--force` overrides.
  3. ONE BQL QUERY FOR THE WHOLE UNIVERSE — all tickers × all four anchor
     dates go through a single BQL request (same engine as the workbook's
     range formulas), which is far cheaper than per-security reference hits.
     If the BQL service isn't available, it falls back to one batched
     historical-data request and says so.

What it pushes (all as-of the prior trading day):
  * prior close + 1M/3M/6M change for every name    → prices on the site
    (freshest source wins, so a Bloomberg push takes precedence over the
    site's once-a-day Yahoo fallback)
  * 3M average daily value traded                   → adv_3m
  * index BEst P/E for the displayed forecast years → the Index rows
  * 1M/3M/6M perf for the custom index (B500XM7T)   → which Yahoo can't see

If the Terminal isn't running, the script prints a note and exits cleanly —
the site simply keeps using Yahoo (or last cached) closes. Schedule it once a
day (e.g. early morning); see pipeline/BLOOMBERG_PUSH.md for Task Scheduler.

Setup (once, in a normal command prompt):
    pip install requests
    pip install --index-url=https://blpapi.bloomberg.com/repository/releases/python/simple/ blpapi

Usage:
    python bloomberg_push.py https://your-dashboard.vercel.app [--force]
    (you'll be prompted for the site password, or set DASHBOARD_PASSWORD)
"""

from __future__ import annotations

import datetime as dt
import json
import os
import sys

import requests

# Corporate networks often run TLS inspection (Zscaler/Palo Alto-type), which
# re-signs HTTPS with a company root CA that the browser trusts but Python's
# bundled certificates don't — yielding CERTIFICATE_VERIFY_FAILED. If the
# `truststore` package is available, route SSL through the OS trust store
# (which has that corporate root), so the site connection just works. Harmless
# on normal networks; falls back silently if truststore isn't installed.
try:
    import truststore

    truststore.inject_into_ssl()
except Exception:
    pass

try:
    import blpapi
except Exception as _blp_err:
    sys.exit(
        f"Cannot import blpapi ({type(_blp_err).__name__}: {_blp_err})\n\n"
        "If blpapi is not installed, run:\n"
        "  pip install --index-url=https://blpapi.bloomberg.com/repository/releases/python/simple/ blpapi\n\n"
        "If blpapi IS installed but you see a DLL error, you are likely using the\n"
        "Windows Store Python, which cannot load native DLLs. Install Python from\n"
        "https://www.python.org/downloads/ (tick 'Add python.exe to PATH'), then\n"
        "re-run:  pip install requests  and  pip install blpapi  in the new Python."
    )

# Slow-moving reference fields pulled once per run (a 3M trailing average
# barely moves day to day, so no date override is needed).
REF_FIELDS = ["AVG_DAILY_VALUE_TRADED_3M"]

# Calendar-day lookbacks for the 1M/3M/6M performance windows.
PERF_DAYS = {"m1": 30, "m3": 91, "m6": 182}


def last_weekday_before(day: dt.date) -> dt.date:
    d = day - dt.timedelta(days=1)
    while d.weekday() >= 5:  # Sat/Sun
        d -= dt.timedelta(days=1)
    return d


# --------------------------------------------------------------------------- #
# Bloomberg Desktop API
# --------------------------------------------------------------------------- #
def open_session() -> blpapi.Session | None:
    opts = blpapi.SessionOptions()
    opts.setServerHost("localhost")
    opts.setServerPort(8194)
    session = blpapi.Session(opts)
    if not session.start() or not session.openService("//blp/refdata"):
        return None
    return session


def reference_data(
    session: blpapi.Session,
    securities: list[str],
    fields: list[str],
    overrides: dict[str, str] | None = None,
) -> dict[str, dict[str, float]]:
    """One ReferenceDataRequest → {security: {field: value}} (numeric only)."""
    if not securities:
        return {}
    svc = session.getService("//blp/refdata")
    req = svc.createRequest("ReferenceDataRequest")
    for s in securities:
        req.getElement("securities").appendValue(s)
    for f in fields:
        req.getElement("fields").appendValue(f)
    for k, v in (overrides or {}).items():
        o = req.getElement("overrides").appendElement()
        o.setElement("fieldId", k)
        o.setElement("value", v)
    session.sendRequest(req)

    out: dict[str, dict[str, float]] = {}
    done = False
    while not done:
        ev = session.nextEvent(30_000)
        for msg in ev:
            if not msg.hasElement("securityData"):
                continue
            for sd in msg.getElement("securityData").values():
                name = sd.getElementAsString("security")
                row = out.setdefault(name, {})
                if sd.hasElement("fieldData"):
                    fd = sd.getElement("fieldData")
                    for f in fields:
                        if fd.hasElement(f):
                            try:
                                row[f] = fd.getElementAsFloat(f)
                            except Exception:
                                pass
        done = ev.eventType() == blpapi.Event.RESPONSE
    return out


# ---- Primary price path: one BQL query for the whole universe -------------- #
def _bql_results(msg) -> list[dict]:
    """Pull the result items out of a //blp/bqlsvc response message, across
    the slightly different shapes blpapi versions deliver them in."""
    py = None
    try:
        py = msg.toPy()  # blpapi >= 3.18
    except Exception:
        pass
    if py is None:
        try:
            py = json.loads(msg.getElementAsString("results"))
        except Exception:
            return []
    if isinstance(py, dict):
        results = py.get("results", py)
        if isinstance(results, dict):
            return list(results.values())
        if isinstance(results, list):
            return results
    return []


def bql_anchor_closes(
    session: blpapi.Session,
    securities: list[str],
    anchors: dict[str, dt.date],
) -> dict[str, dict[str, float]] | None:
    """Single BQL request: px_last at each anchor date (fill=prev) for every
    security at once — the script equivalent of the workbook's range BQL.
    Returns {security: {anchor_key: close, "px_date": iso}} or None if the
    BQL service isn't available / the response can't be parsed (caller falls
    back to a batched historical request)."""
    try:
        if not session.openService("//blp/bqlsvc"):
            return None
        items = ", ".join(
            f"px_last(dates='{day.isoformat()}', fill='prev') as #{key}"
            for key, day in anchors.items()
        )
        universe = ", ".join(f"'{s}'" for s in securities)
        expression = f"get({items}) for([{universe}])"

        svc = session.getService("//blp/bqlsvc")
        req = svc.createRequest("sendQuery")
        req.set("expression", expression)
        session.sendRequest(req)

        out: dict[str, dict[str, float]] = {}
        done = False
        while not done:
            ev = session.nextEvent(60_000)
            for msg in ev:
                for item in _bql_results(msg):
                    name = str(item.get("name", "")).lstrip("#")
                    if name not in anchors:
                        continue
                    ids = (item.get("idColumn") or {}).get("values") or []
                    vals = (item.get("valuesColumn") or {}).get("values") or []
                    dates = []
                    for col in item.get("secondaryColumns") or []:
                        if str(col.get("name", "")).upper() == "DATE":
                            dates = col.get("values") or []
                    for i, sec in enumerate(ids):
                        v = vals[i] if i < len(vals) else None
                        if not isinstance(v, (int, float)):
                            continue
                        row = out.setdefault(str(sec), {})
                        row[name] = float(v)
                        if name == "px" and i < len(dates) and dates[i]:
                            row["px_date"] = str(dates[i])[:10]
            done = ev.eventType() == blpapi.Event.RESPONSE

        # Sanity: the query must have produced a prior close for at least
        # half the universe, otherwise treat it as failed and fall back.
        good = sum(1 for r in out.values() if "px" in r)
        return out if good >= max(1, len(securities) // 2) else None
    except Exception:
        return None


# ---- Fallback price path: one batched historical request ------------------- #
def historical_closes(
    session: blpapi.Session,
    securities: list[str],
    start: dt.date,
    end: dt.date,
) -> dict[str, list[tuple[dt.date, float]]]:
    """One HistoricalDataRequest → {security: [(date, close), ...]} sorted by
    date, from which the prior close and the 1M/3M/6M windows are derived."""
    if not securities:
        return {}
    svc = session.getService("//blp/refdata")
    req = svc.createRequest("HistoricalDataRequest")
    for s in securities:
        req.getElement("securities").appendValue(s)
    req.getElement("fields").appendValue("PX_LAST")
    req.set("startDate", start.strftime("%Y%m%d"))
    req.set("endDate", end.strftime("%Y%m%d"))
    req.set("periodicitySelection", "DAILY")
    session.sendRequest(req)

    out: dict[str, list[tuple[dt.date, float]]] = {}
    done = False
    while not done:
        ev = session.nextEvent(60_000)
        for msg in ev:
            if not msg.hasElement("securityData"):
                continue
            sd = msg.getElement("securityData")
            name = sd.getElementAsString("security")
            rows = out.setdefault(name, [])
            if sd.hasElement("fieldData"):
                for bar in sd.getElement("fieldData").values():
                    if bar.hasElement("date") and bar.hasElement("PX_LAST"):
                        d = bar.getElementAsDatetime("date")
                        if isinstance(d, dt.datetime):
                            d = d.date()
                        try:
                            rows.append((d, bar.getElementAsFloat("PX_LAST")))
                        except Exception:
                            pass
        done = ev.eventType() == blpapi.Event.RESPONSE
    for rows in out.values():
        rows.sort()
    return out


def close_on_or_before(rows: list[tuple[dt.date, float]], target: dt.date) -> float | None:
    best = None
    for d, px in rows:
        if d <= target:
            best = px
    return best


def gather_prices(
    session: blpapi.Session, securities: list[str], expected: dt.date
) -> tuple[dict[str, dict], str]:
    """Prior close + perf for every security: BQL first, historical fallback.
    Returns ({security: {price, m1, m3, m6, date}}, method_used)."""
    anchors = {"px": expected}
    for key, days in PERF_DAYS.items():
        anchors[key] = expected - dt.timedelta(days=days)

    bql = bql_anchor_closes(session, securities, anchors)
    if bql is not None:
        out = {}
        for sec, row in bql.items():
            px = row.get("px")
            if px is None:
                continue
            entry = {"price": px, "date": row.get("px_date") or expected.isoformat()}
            for key in PERF_DAYS:
                base = row.get(key)
                entry[key] = (px / base - 1) if base else None
            out[sec] = entry
        return out, "BQL"

    today = dt.date.today()
    history = historical_closes(session, securities, today - dt.timedelta(days=220), today)
    out = {}
    for sec, rows in history.items():
        past = [(d, px) for d, px in rows if d < today]
        if not past:
            continue
        close_date, close_px = past[-1]
        entry = {"price": close_px, "date": close_date.isoformat()}
        for key, days in PERF_DAYS.items():
            base = close_on_or_before(past, close_date - dt.timedelta(days=days))
            entry[key] = (close_px / base - 1) if base else None
        out[sec] = entry
    return out, "historical fallback (BQL service unavailable)"


# --------------------------------------------------------------------------- #
# Dashboard API
# --------------------------------------------------------------------------- #
def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    force = "--force" in sys.argv
    base = (args[0] if args else os.environ.get("DASHBOARD_URL", "")).rstrip("/")
    if not base:
        sys.exit("Usage: python bloomberg_push.py https://your-dashboard.vercel.app [--force]")
    password = os.environ.get("DASHBOARD_PASSWORD") or input("Site password: ").strip()

    web = requests.Session()
    r = web.post(f"{base}/api/login", json={"password": password}, timeout=30)
    if not (r.ok and r.json().get("ok")):
        sys.exit(f"Login failed: HTTP {r.status_code} {r.text[:200]}")

    ur = web.get(f"{base}/api/equities/bloomberg", timeout=30)
    try:
        universe = ur.json()
    except ValueError:
        body = ur.text[:200].replace("\n", " ")
        sys.exit(
            f"{base}/api/equities/bloomberg did not return JSON "
            f"(HTTP {ur.status_code}). The Equities Dashboard may not be deployed "
            f"at this URL yet — check that the branch with the equities pages is "
            f"the one live at {base}.\nResponse started with: {body!r}"
        )
    stocks = [s for s in universe["securities"] if not s["is_index"]]
    indexes = [s for s in universe["securities"] if s["is_index"]]
    years: list[int] = universe["years"]

    # Cache guard: if the site already holds the latest weekday close, exit
    # before opening a Bloomberg session — zero data pulls for redundant runs
    # (same-day re-runs, weekends, holidays-after-a-push).
    expected = last_weekday_before(dt.date.today())
    cached = universe.get("bloomberg_data_date")
    if not force and cached and str(cached) >= expected.isoformat():
        print(
            f"Already up to date — cached Bloomberg closes are as of {cached} "
            f"(latest weekday close: {expected}). No Bloomberg requests made; "
            f"use --force to re-pull."
        )
        return

    session = open_session()
    if session is None:
        print("Bloomberg Terminal not running — nothing pushed (site stays on Yahoo).")
        return

    try:
        prices, method = gather_prices(
            session, [s["bbg"] for s in stocks + indexes], expected
        )
        adv = reference_data(session, [s["bbg"] for s in stocks], REF_FIELDS)

        quotes = []
        companies = []
        data_date: str | None = None
        for s in stocks + indexes:
            row = prices.get(s["bbg"])
            if not row:
                companies.append({"ticker": s["ticker"], "perf": {}})
                continue
            if data_date is None or row["date"] > data_date:
                data_date = row["date"]
            perf = {k: row.get(k) for k in PERF_DAYS}
            if s["yahoo"]:
                quotes.append({"symbol": s["yahoo"], "price": row["price"], **perf})
            entry: dict = {"ticker": s["ticker"], "perf": perf}
            ref = adv.get(s["bbg"], {})
            if ref.get("AVG_DAILY_VALUE_TRADED_3M") is not None:
                entry["adv_3m"] = ref["AVG_DAILY_VALUE_TRADED_3M"] / 1e6
            companies.append(entry)

        # Index BEst P/E: one request per forecast year (overrides are
        # request-wide). nFY counts from the current year, mirroring the
        # workbook's best_fperiod_override.
        this_year = dt.date.today().year
        for y in years:
            n = y - this_year + 1
            if n < 1:
                continue
            pe = reference_data(
                session,
                [ix["bbg"] for ix in indexes],
                ["BEST_PE_RATIO"],
                {"BEST_FPERIOD_OVERRIDE": f"{n}FY"},
            )
            for ix in indexes:
                v = pe.get(ix["bbg"], {}).get("BEST_PE_RATIO")
                if v is None:
                    continue
                entry = next(c for c in companies if c["ticker"] == ix["ticker"])
                entry.setdefault("best_pe", {})[str(y)] = v
    finally:
        session.stop()

    r = web.post(
        f"{base}/api/equities/bloomberg",
        json={"quotes": quotes, "companies": companies, "data_date": data_date},
        timeout=60,
    )
    if not r.ok:
        sys.exit(f"Push failed: HTTP {r.status_code} {r.text[:300]}")
    d = r.json()
    print(
        f"Pushed {d.get('quotes', 0)} quotes and patched {d.get('companies', 0)} names — "
        f"closes as of {data_date}, via {method} (run {dt.datetime.now():%Y-%m-%d %H:%M})."
    )


if __name__ == "__main__":
    main()
