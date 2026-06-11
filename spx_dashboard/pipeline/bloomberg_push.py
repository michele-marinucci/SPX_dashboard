"""
Push live Bloomberg data into the Equities Dashboard — run on a PC where the
Bloomberg Terminal is open and logged in. No Excel involved: this talks to
the Desktop API (the same feed the workbook's BQL/BDP formulas use) and
posts the values to the website, which stores them in Supabase for everyone.

What it pushes:
  * PX_LAST + 1M/3M/6M % change for every name      → live prices on the site
    (keyed by Yahoo symbol; the freshest source wins, so while this script is
    running Bloomberg prices take precedence over the Yahoo self-refresh)
  * 3M average daily value traded                   → adv_3m
  * index BEst P/E for the displayed forecast years → the Index rows
  * 1M/3M/6M perf for the custom index (B500XM7T)   → which Yahoo can't see

If the Terminal isn't running, the script prints a note and exits cleanly —
the site simply keeps using Yahoo (or last cached) prices. Safe to schedule
every 15–30 minutes; see pipeline/BLOOMBERG_PUSH.md for Task Scheduler setup.

Setup (once, in a normal command prompt):
    pip install requests
    pip install --index-url=https://blpapi.bloomberg.com/repository/releases/python/simple/ blpapi

Usage:
    python bloomberg_push.py https://your-dashboard.vercel.app
    (you'll be prompted for the site password, or set DASHBOARD_PASSWORD)
"""

from __future__ import annotations

import datetime as dt
import os
import sys

import requests

try:
    import blpapi
except ImportError:
    sys.exit(
        "blpapi is not installed. Run:\n"
        "  pip install --index-url=https://blpapi.bloomberg.com/repository/releases/python/simple/ blpapi"
    )

STOCK_FIELDS = ["PX_LAST", "CHG_PCT_1M", "CHG_PCT_3M", "CHG_PCT_6M", "AVG_DAILY_VALUE_TRADED_3M"]
INDEX_FIELDS = ["PX_LAST", "CHG_PCT_1M", "CHG_PCT_3M", "CHG_PCT_6M"]


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


# --------------------------------------------------------------------------- #
# Dashboard API
# --------------------------------------------------------------------------- #
def main() -> None:
    base = (sys.argv[1] if len(sys.argv) > 1 else os.environ.get("DASHBOARD_URL", "")).rstrip("/")
    if not base:
        sys.exit("Usage: python bloomberg_push.py https://your-dashboard.vercel.app")
    password = os.environ.get("DASHBOARD_PASSWORD") or input("Site password: ").strip()

    web = requests.Session()
    r = web.post(f"{base}/api/login", json={"password": password}, timeout=30)
    if not (r.ok and r.json().get("ok")):
        sys.exit(f"Login failed: HTTP {r.status_code} {r.text[:200]}")

    universe = web.get(f"{base}/api/equities/bloomberg", timeout=30).json()
    stocks = [s for s in universe["securities"] if not s["is_index"]]
    indexes = [s for s in universe["securities"] if s["is_index"]]
    years: list[int] = universe["years"]

    session = open_session()
    if session is None:
        print("Bloomberg Terminal not running — nothing pushed (site stays on Yahoo).")
        return

    try:
        data = reference_data(session, [s["bbg"] for s in stocks + indexes],
                              sorted(set(STOCK_FIELDS + INDEX_FIELDS)))

        quotes = []
        companies = []
        for s in stocks + indexes:
            row = data.get(s["bbg"], {})
            perf = {
                "m1": row.get("CHG_PCT_1M", None),
                "m3": row.get("CHG_PCT_3M", None),
                "m6": row.get("CHG_PCT_6M", None),
            }
            perf = {k: (v / 100 if v is not None else None) for k, v in perf.items()}
            if s["yahoo"] and row.get("PX_LAST") is not None:
                quotes.append({"symbol": s["yahoo"], "price": row["PX_LAST"], **perf})
            entry: dict = {"ticker": s["ticker"], "perf": perf}
            if row.get("AVG_DAILY_VALUE_TRADED_3M") is not None:
                entry["adv_3m"] = row["AVG_DAILY_VALUE_TRADED_3M"] / 1e6
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
        json={"quotes": quotes, "companies": companies},
        timeout=60,
    )
    if not r.ok:
        sys.exit(f"Push failed: HTTP {r.status_code} {r.text[:300]}")
    d = r.json()
    print(
        f"Pushed {d.get('quotes', 0)} quotes and patched {d.get('companies', 0)} names "
        f"at {dt.datetime.now():%Y-%m-%d %H:%M}."
    )


if __name__ == "__main__":
    main()
