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
     If the BQL service isn't available or the login isn't entitled to BQL,
     it falls back to a handful of SHORT windowed historical requests (a few
     days around each anchor date — not months of history) and says so.

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

DEBUG = "--debug" in sys.argv
DEBUG_PATH = "bql_debug.txt"


def dbg(text: str) -> None:
    """Append a line to the debug file (written from Python directly, so it
    doesn't depend on shell stderr redirection). Only active with --debug."""
    if not DEBUG:
        return
    try:
        with open(DEBUG_PATH, "a", encoding="utf-8") as fh:
            fh.write(text + "\n")
    except Exception:
        pass


def _top_elements(msg) -> str:
    """Top-level element names + child element names of a Bloomberg message —
    the message's schema, which tells us how to read it."""
    try:
        name = str(msg.messageType())
    except Exception:
        name = "?"
    kids = []
    try:
        el = msg.asElement()
        for i in range(el.numElements()):
            child = el.getElement(i)
            try:
                sub = [str(child.getElement(j).name()) for j in range(min(child.numElements(), 6))]
            except Exception:
                sub = []
            kids.append(f"{child.name()}{sub if sub else ''}")
    except Exception as e:
        kids.append(f"<asElement failed: {e}>")
    return f"messageType={name} elements={kids}"


def dbg_message(msg, context: str) -> str:
    """Summarize a Bloomberg message: schema, toPy() form (truncated), and a
    truncated string form. Returns the schema line so callers can also surface
    it on the console. Full (truncated) detail goes to the debug file."""
    schema = _top_elements(msg)
    if not DEBUG:
        return schema
    dbg(f"\n===== raw message ({context}) =====")
    dbg(schema)
    try:
        py = msg.toPy()
        dbg(f"toPy type={type(py).__name__} value={repr(py)[:1500]}")
    except Exception as e:
        dbg(f"toPy raised {type(e).__name__}: {e}")
    try:
        dbg(f"str(msg) (truncated):\n{str(msg)[:1500]}")
    except Exception as e:
        dbg(f"str(msg) raised {type(e).__name__}: {e}")
    return schema

# Diagnostics gathered during a run: request-level and per-security errors
# from Bloomberg, printed when the run produces nothing so failures are never
# silent (entitlement problems, service issues, bad tickers, ...).
ERRORS: list[str] = []
# Informational notes (expected, non-fatal): e.g. "BQL not entitled, using
# historical instead" — surfaced once, calmly, not as a scary warning.
NOTES: list[str] = []


def _note_errors(msg, context: str) -> None:
    """Record responseError / securityError details from a Bloomberg message."""
    try:
        if msg.hasElement("responseError"):
            ERRORS.append(f"{context}: responseError: {msg.getElement('responseError')}")
        if msg.hasElement("securityData"):
            sds = msg.getElement("securityData")
            # HistoricalDataResponse: one securityData per message;
            # ReferenceDataResponse: an array of them.
            items = sds.values() if sds.isArray() else [sds]
            for sd in items:
                name = sd.getElementAsString("security") if sd.hasElement("security") else "?"
                if sd.hasElement("securityError"):
                    ERRORS.append(f"{context}: {name}: {sd.getElement('securityError')}")
                if sd.hasElement("fieldExceptions"):
                    fe = sd.getElement("fieldExceptions")
                    if fe.numValues():
                        ERRORS.append(f"{context}: {name}: fieldExceptions: {fe}")
    except Exception:
        pass
    if DEBUG:
        print(f"--- raw message ({context}) ---\n{msg}\n", file=sys.stderr)


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


# Bloomberg requests are batched, but very large universes (the S&P 500) are
# split into chunks of this size per request to stay well within limits.
CHUNK = 100


def _chunks(items: list[str]) -> list[list[str]]:
    return [items[i : i + CHUNK] for i in range(0, len(items), CHUNK)]


def reference_data(
    session: blpapi.Session,
    securities: list[str],
    fields: list[str],
    overrides: dict[str, str] | None = None,
) -> dict[str, dict[str, float]]:
    """Batched ReferenceDataRequest → {security: {field: value}} (numeric
    only). Universes larger than CHUNK are split across several requests."""
    if not securities:
        return {}
    if len(securities) > CHUNK:
        out: dict[str, dict[str, float]] = {}
        for part in _chunks(securities):
            out.update(reference_data(session, part, fields, overrides))
        return out
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
        if ev.eventType() == blpapi.Event.TIMEOUT:
            ERRORS.append("reference: timed out waiting for Bloomberg response")
            break
        for msg in ev:
            _note_errors(msg, "reference")
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
def _as_dict(v):
    """Best-effort: turn a BQL payload piece into a dict (JSON strings are
    decoded; anything else that isn't a dict yields {})."""
    if isinstance(v, str):
        try:
            v = json.loads(v)
        except Exception:
            return {}
    return v if isinstance(v, dict) else {}


def _bql_results(msg) -> list[dict]:
    """Pull the result items out of a //blp/bqlsvc response message, across
    the slightly different shapes blpapi versions deliver them in: toPy()
    dicts, JSON strings, and dicts whose values are themselves JSON strings."""
    py = None
    try:
        py = msg.toPy()  # blpapi >= 3.18
    except Exception:
        pass
    if py is None:
        try:
            py = msg.getElementAsString("results")
        except Exception:
            try:
                py = str(msg)
            except Exception:
                return []
    py = _as_dict(py) or py
    if isinstance(py, dict):
        results = py.get("results", py)
        results = _as_dict(results) or results
        if isinstance(results, dict):
            items = list(results.values())
        elif isinstance(results, list):
            items = results
        else:
            items = []
        return [d for d in (_as_dict(i) for i in items) if d]
    return []


def _bql_exception_text(msg) -> str | None:
    """If a BQL response carries responseExceptions (e.g. 'User not authorized
    to use BQL'), return the human-readable message(s); else None."""
    try:
        d = _as_dict(msg.toPy())
    except Exception:
        d = {}
    exns = d.get("responseExceptions") if isinstance(d, dict) else None
    if not isinstance(exns, list) or not exns:
        return None
    msgs = []
    for e in exns:
        e = _as_dict(e)
        m = e.get("message") or e.get("internalMessage")
        if m:
            msgs.append(str(m))
    return "; ".join(msgs) or None


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
            ERRORS.append("bql: //blp/bqlsvc service not available on this terminal")
            return None
        items = ", ".join(
            f"px_last(dates='{day.isoformat()}', fill='prev') as #{key}"
            for key, day in anchors.items()
        )
        universe = ", ".join(f"'{s}'" for s in securities)
        expression = f"get({items}) for([{universe}])"

        dbg(f"BQL expression sent:\n{expression}")
        svc = session.getService("//blp/bqlsvc")
        req = svc.createRequest("sendQuery")
        req.set("expression", expression)
        session.sendRequest(req)

        out: dict[str, dict[str, float]] = {}
        done = False
        while not done:
            ev = session.nextEvent(60_000)
            if ev.eventType() == blpapi.Event.TIMEOUT:
                ERRORS.append("bql: timed out waiting for response")
                break
            for msg in ev:
                schema = dbg_message(msg, "bql")
                if DEBUG:
                    print(f"  [bql msg] {schema}")
                exn = _bql_exception_text(msg)
                if exn:
                    NOTES.append(f"BQL unavailable: {exn}")
                    dbg(f"bql responseException: {exn}")
                try:
                    parsed = _bql_results(msg)
                    dbg(f"_bql_results -> {len(parsed)} items: {parsed[:1]!r}")
                except Exception as e:
                    ERRORS.append(f"bql: parse: {type(e).__name__}: {e}")
                    parsed = []
                for item in parsed:
                    name = str(item.get("name", "")).lstrip("#")
                    if name not in anchors:
                        continue
                    ids = _as_dict(item.get("idColumn")).get("values") or []
                    vals = _as_dict(item.get("valuesColumn")).get("values") or []
                    dates = []
                    cols = item.get("secondaryColumns")
                    if not isinstance(cols, list):
                        cols = []
                    for col in cols:
                        col = _as_dict(col)
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
        # half the universe, otherwise treat it as failed and fall back. If a
        # responseException already explained why (e.g. not entitled), don't
        # pile on a second, noisier error.
        good = sum(1 for r in out.values() if "px" in r)
        if good < max(1, len(securities) // 2):
            if not NOTES:
                ERRORS.append(f"bql: only {good}/{len(securities)} securities returned a close")
            return None
        return out
    except Exception as e:
        ERRORS.append(f"bql: {type(e).__name__}: {e}")
        return None


# ---- Fallback price path: one batched historical request ------------------- #
def historical_closes(
    session: blpapi.Session,
    securities: list[str],
    start: dt.date,
    end: dt.date,
    field: str = "PX_LAST",
) -> dict[str, list[tuple[dt.date, float]]]:
    """Batched HistoricalDataRequest → {security: [(date, value), ...]} sorted
    by date. `field` defaults to closes; CUR_MKT_CAP gives daily market caps.
    Universes larger than CHUNK are split across several requests."""
    if not securities:
        return {}
    if len(securities) > CHUNK:
        out: dict[str, list[tuple[dt.date, float]]] = {}
        for part in _chunks(securities):
            out.update(historical_closes(session, part, start, end, field))
        return out
    svc = session.getService("//blp/refdata")
    req = svc.createRequest("HistoricalDataRequest")
    for s in securities:
        req.getElement("securities").appendValue(s)
    req.getElement("fields").appendValue(field)
    req.set("startDate", start.strftime("%Y%m%d"))
    req.set("endDate", end.strftime("%Y%m%d"))
    req.set("periodicitySelection", "DAILY")
    session.sendRequest(req)

    out: dict[str, list[tuple[dt.date, float]]] = {}
    done = False
    while not done:
        ev = session.nextEvent(60_000)
        if ev.eventType() == blpapi.Event.TIMEOUT:
            ERRORS.append("historical: timed out waiting for Bloomberg response")
            break
        for msg in ev:
            _note_errors(msg, "historical")
            if not msg.hasElement("securityData"):
                continue
            sd = msg.getElement("securityData")
            name = sd.getElementAsString("security")
            rows = out.setdefault(name, [])
            if sd.hasElement("fieldData"):
                for bar in sd.getElement("fieldData").values():
                    if bar.hasElement("date") and bar.hasElement(field):
                        d = bar.getElementAsDatetime("date")
                        if isinstance(d, dt.datetime):
                            d = d.date()
                        try:
                            rows.append((d, bar.getElementAsFloat(field)))
                        except Exception:
                            pass
        done = ev.eventType() == blpapi.Event.RESPONSE
    for rows in out.values():
        rows.sort()
    return out


def windowed_closes(
    session: blpapi.Session,
    securities: list[str],
    anchor: dt.date,
    cushion: int = 10,
    field: str = "PX_LAST",
) -> dict[str, tuple[dt.date, float]]:
    """Most recent value on/before `anchor` for each security, from one SHORT
    HistoricalDataRequest (a `cushion`-day window). Pulling a handful of days
    around each anchor — instead of months of daily history — keeps the
    monthly Bloomberg data usage minimal while still surviving holidays."""
    hist = historical_closes(
        session, securities, anchor - dt.timedelta(days=cushion), anchor, field
    )
    out: dict[str, tuple[dt.date, float]] = {}
    for sec, rows in hist.items():  # rows are sorted ascending by date
        on_or_before = [(d, px) for d, px in rows if d <= anchor]
        if on_or_before:
            out[sec] = on_or_before[-1]
    return out


def flush_events(session: blpapi.Session) -> None:
    """Drain any leftover events from an aborted request so they can't be
    mistaken for the next request's response."""
    try:
        while session.nextEvent(500).eventType() != blpapi.Event.TIMEOUT:
            pass
    except Exception:
        pass


def gather_prices(
    session: blpapi.Session, securities: list[str], expected: dt.date
) -> tuple[dict[str, dict], str]:
    """Prior close + perf for every security: BQL first, historical fallback.
    Returns ({security: {price, m1, m3, m6, date}}, method_used)."""
    anchors = {"px": expected}
    for key, days in PERF_DAYS.items():
        anchors[key] = expected - dt.timedelta(days=days)

    bql = bql_anchor_closes(session, securities, anchors)
    if bql is None:
        # A failed/aborted BQL attempt may leave unread events behind; drain
        # them so the historical request reads its own response, not BQL's.
        flush_events(session)
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

    # Lean fallback: one short windowed request per anchor date (≈4 small
    # pulls) rather than months of daily history, so a BQL-less terminal still
    # sips the data quota.
    anchor_closes = {
        key: windowed_closes(session, securities, day) for key, day in anchors.items()
    }
    out = {}
    for sec in securities:
        pxrow = anchor_closes["px"].get(sec)
        if not pxrow:
            continue
        close_date, close_px = pxrow
        entry = {"price": close_px, "date": close_date.isoformat()}
        for key in PERF_DAYS:
            base = anchor_closes[key].get(sec)
            entry[key] = (close_px / base[1] - 1) if base and base[1] else None
        out[sec] = entry

    if not out:
        detail = "\n".join(f"  - {e}" for e in ERRORS) or "  (no error details captured)"
        sys.exit(
            "Bloomberg returned no data for any security — nothing pushed.\n"
            f"Errors seen:\n{detail}\n\n"
            "Common causes:\n"
            "  * First API use needs a one-time consent: in the Terminal run API<GO>\n"
            "    and accept, or just retry — a popup may have appeared in the Terminal.\n"
            "  * Desktop API entitlement missing: ask your Bloomberg rep about\n"
            "    'Desktop API' access for your login.\n"
            "Re-run with --debug to dump the raw Bloomberg responses."
        )
    method = "historical (BQL not entitled on this login)" if NOTES else "historical data"
    return out, method


# --------------------------------------------------------------------------- #
# Dashboard API
# --------------------------------------------------------------------------- #
def run_equities(session, web, base: str, universe: dict, expected: dt.date) -> str:
    """The Equities Dashboard leg: prior closes + perf + ADV + index BEst P/E
    for the ~37-name dashboard universe. Returns a one-line summary."""
    stocks = [s for s in universe["securities"] if not s["is_index"]]
    indexes = [s for s in universe["securities"] if s["is_index"]]
    years: list[int] = universe["years"]

    prices, method = gather_prices(session, [s["bbg"] for s in stocks + indexes], expected)
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

    r = web.post(
        f"{base}/api/equities/bloomberg",
        json={"quotes": quotes, "companies": companies, "data_date": data_date},
        timeout=60,
    )
    if not r.ok:
        sys.exit(f"Equities push failed: HTTP {r.status_code} {r.text[:300]}")
    d = r.json()
    return (
        f"Equities: pushed {d.get('quotes', 0)} quotes and patched "
        f"{d.get('companies', 0)} names — closes as of {data_date}, via {method}."
    )


# ---- SPX Monitor leg -------------------------------------------------------- #
# The workbook (public/SPX_inputs.xlsx) pulls consensus through BQL as
# IS_COMP_NET_INCOME_ADJUST — Bloomberg's comparable ADJUSTED net income.
# The Desktop API can't run BQL on every login, so the script probes refdata
# candidates (the comparable field itself, then the BEst equivalents) and
# keeps whichever one reproduces the workbook's own snapshot values.
def _ni_candidates(year: int) -> list[tuple[str, dict[str, str]]]:
    return [
        ("IS_COMP_NET_INCOME_ADJUST", {"EQY_FUND_YEAR": str(year), "FUND_PER": "A"}),
        ("BEST_NET_INCOME", {"BEST_FPERIOD_OVERRIDE": f"CY{year}"}),
        ("BEST_NET_INCOME", {"BEST_FPERIOD_OVERRIDE": str(year)}),
    ]


def _probe_and_pull(
    session,
    tickers: list[str],
    candidates: list[tuple[str, dict[str, str]]],
    refvals: dict[str, float],
    label: str,
) -> dict[str, float]:
    """Try each (field, overrides) candidate on a handful of names and score
    it against the workbook snapshot ($b, within 20% — consensus drifts a bit
    between snapshot and run, so exact equality is too strict). The best
    scorer is pulled for the whole universe; values returned in $ millions.
    With no snapshot to score against, falls back to presence-scoring."""
    probe_names = [t for t in tickers if t in refvals][:8] or tickers[:5]
    best: tuple[int, str, dict[str, str]] | None = None
    for field, ov in candidates:
        before = len(ERRORS)
        res = reference_data(session, probe_names, [field], ov)
        del ERRORS[before:]  # probe misses are expected, not warnings
        score = 0
        for t in probe_names:
            v = res.get(t, {}).get(field)
            if v is None:
                continue
            ref = refvals.get(t)
            if ref is None:
                score += 1  # no reference → presence is the best signal
            elif abs(v / 1000.0 - ref) <= 0.2 * max(1e-9, abs(ref)):
                score += 1
        if best is None or score > best[0]:
            best = (score, field, ov)
        if score >= max(2, int(0.8 * len(probe_names))):
            break  # near-perfect match — no need to probe further
    if best is None or best[0] < 2:
        NOTES.append(f"SPX: no field matched the workbook for {label} — skipped")
        return {}
    score, field, ov = best
    ovs = ", ".join(f"{k}={v}" for k, v in ov.items())
    NOTES.append(
        f"SPX: {label} via {field}({ovs}) — matched workbook on "
        f"{score}/{len(probe_names)} probe names"
    )
    full = reference_data(session, tickers, [field], ov)
    return {s: v[field] for s, v in full.items() if field in v}


def best_ntm_ni(
    session,
    securities: list[str],
    ni_by_year: dict[int, dict[str, float]],
    refvals: dict[str, float],
) -> dict[str, float]:
    """Next-twelve-months consensus NI ($ millions): the 1BF blended-forward
    override when the terminal supports it (validated against the workbook's
    LTM/FPO=1 values), otherwise a calendar-weighted blend of this year's and
    next year's consensus."""
    out = _probe_and_pull(
        session,
        securities,
        [("BEST_NET_INCOME", {"BEST_FPERIOD_OVERRIDE": "1BF"})],
        refvals,
        "NTM NI",
    )
    if out:
        return out

    today = dt.date.today()
    y = today.year
    frac = ((dt.date(y, 12, 31) - today).days + 1) / 365.0
    this_yr, next_yr = ni_by_year.get(y, {}), ni_by_year.get(y + 1, {})
    out = {}
    for s in securities:
        a, b = this_yr.get(s), next_yr.get(s)
        if a is not None and b is not None:
            out[s] = frac * a + (1 - frac) * b
    if out:
        NOTES.append("SPX: NTM NI approximated as a calendar blend (1BF not accepted)")
    return out


def run_spx(session, web, base: str, spx_universe: dict, expected: dt.date) -> str:
    """The SPX Monitor leg: prior-day market caps + consensus NI for the full
    S&P 500. ~4 values per name per day; chunked batched requests."""
    tickers: list[str] = spx_universe["tickers"]
    years = [int(y) for y in spx_universe.get("years", [])]
    snapshot: dict[str, dict] = spx_universe.get("snapshot") or {}

    mc = windowed_closes(session, tickers, expected, field="CUR_MKT_CAP")
    ni_by_year = {
        y: _probe_and_pull(
            session,
            tickers,
            _ni_candidates(y),
            {t: r[str(y)] for t, r in snapshot.items() if str(y) in r},
            f"consensus NI {y}",
        )
        for y in years
    }
    ntm = best_ntm_ni(
        session,
        tickers,
        ni_by_year,
        {t: r["ntm"] for t, r in snapshot.items() if "ntm" in r},
    )

    # Divergence check vs the workbook snapshot: big gaps would mean the field
    # choice doesn't line up with the workbook's methodology after all.
    first = years[0] if years else None
    if first and ni_by_year.get(first):
        diffs = []
        for t, v in ni_by_year[first].items():
            ref = (snapshot.get(t) or {}).get(str(first))
            if ref:
                diffs.append(abs(v / 1000.0 - ref) / abs(ref))
        if diffs:
            diffs.sort()
            med = diffs[len(diffs) // 2]
            big = sum(1 for x in diffs if x > 0.05)
            NOTES.append(
                f"SPX: {first} consensus vs workbook snapshot — median diff "
                f"{med:.1%}, {big}/{len(diffs)} names differ >5% (drift since "
                f"the snapshot is expected; a high count would mean a "
                f"methodology mismatch)"
            )

    quotes = []
    data_date: str | None = None
    for t in tickers:
        row: dict = {"ticker": t}
        got = False
        if t in mc:
            d, v = mc[t]
            row["mkt_cap"] = v / 1000.0  # millions → $ billions
            if data_date is None or d.isoformat() > data_date:
                data_date = d.isoformat()
            got = True
        est = {
            str(y): ni_by_year[y][t] / 1000.0 for y in years if t in ni_by_year.get(y, {})
        }
        if est:
            row["est_ni"] = est
            got = True
        if t in ntm:
            row["ntm_ni"] = ntm[t] / 1000.0
            got = True
        if got:
            quotes.append(row)

    if not quotes:
        return "SPX: no data returned — nothing pushed."
    r = web.post(
        f"{base}/api/spx/bloomberg",
        json={"quotes": quotes, "data_date": data_date or expected.isoformat()},
        timeout=120,
    )
    if not r.ok:
        sys.exit(f"SPX push failed: HTTP {r.status_code} {r.text[:300]}")
    d = r.json()
    return (
        f"SPX Monitor: pushed {d.get('quotes', 0)} of {len(tickers)} names — "
        f"market caps as of {data_date or expected.isoformat()}."
    )


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    force = "--force" in sys.argv
    base = (args[0] if args else os.environ.get("DASHBOARD_URL", "")).rstrip("/")
    if not base:
        sys.exit("Usage: python bloomberg_push.py https://your-dashboard.vercel.app [--force]")
    if DEBUG:
        try:
            open(DEBUG_PATH, "w").close()  # start each debug run with a clean file
        except Exception:
            pass
        print(f"--debug: writing raw Bloomberg responses to {os.path.abspath(DEBUG_PATH)}")
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

    # SPX Monitor universe — absent on older deployments; leg skipped then.
    spx_universe: dict | None = None
    try:
        sr = web.get(f"{base}/api/spx/bloomberg", timeout=30)
        if sr.ok:
            spx_universe = sr.json()
    except Exception:
        pass

    # Cache guards, per leg: a leg runs only if a NEW weekday close exists
    # that the site doesn't have. If neither leg is stale, exit before even
    # opening a Bloomberg session — zero data pulls for redundant runs.
    expected = last_weekday_before(dt.date.today())
    eq_cached = str(universe.get("bloomberg_data_date") or "")
    eq_stale = force or not (eq_cached and eq_cached >= expected.isoformat())
    spx_cached = str((spx_universe or {}).get("bloomberg_data_date") or "")
    spx_stale = spx_universe is not None and (
        force or not (spx_cached and spx_cached >= expected.isoformat())
    )
    if not eq_stale and not spx_stale:
        print(
            f"Already up to date — cached Bloomberg data is as of {eq_cached} "
            f"(latest weekday close: {expected}). No Bloomberg requests made; "
            f"use --force to re-pull."
        )
        return

    session = open_session()
    if session is None:
        print("Bloomberg Terminal not running — nothing pushed (site stays on Yahoo).")
        return

    summaries: list[str] = []
    try:
        if eq_stale:
            summaries.append(run_equities(session, web, base, universe, expected))
        else:
            summaries.append(f"Equities: already up to date ({eq_cached}).")
        if spx_universe is not None:
            if spx_stale:
                summaries.append(run_spx(session, web, base, spx_universe, expected))
            else:
                summaries.append(f"SPX Monitor: already up to date ({spx_cached}).")
    finally:
        session.stop()

    for line in summaries:
        print(line)
    print(f"(run {dt.datetime.now():%Y-%m-%d %H:%M})")
    # De-duplicated, calm notes (e.g. BQL not entitled — expected, not a fault).
    for n in dict.fromkeys(NOTES):
        print(f"Note: {n}")
    if ERRORS:
        print("Warnings (some securities/fields had issues):")
        for e in ERRORS[:20]:
            print(f"  - {e}")


if __name__ == "__main__":
    main()
