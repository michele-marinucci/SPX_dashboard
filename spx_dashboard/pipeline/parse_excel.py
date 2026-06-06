"""
Parse the `Output` sheet of SPX_inputs.xlsx into a single dashboard.json.

The Output sheet is fully self-contained: when the workbook is saved from
Bloomberg, every formula carries its last cached value, so we open with
data_only=True and never touch a terminal.

Tables are located by *searching for their title strings* rather than by
hard-coded row numbers, so small vertical shifts when the user refreshes the
file do not break parsing. Column positions within each table are stable
(they come from a fixed template) and are addressed by letter.

Usage:
    python parse_excel.py <input.xlsx> <output.json>
"""

from __future__ import annotations

import datetime as dt
import json
import re
import sys
from typing import Any

import openpyxl
from openpyxl.utils import column_index_from_string as cidx


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _num(v: Any) -> float | None:
    """Coerce a cell value to float, or None if it is not numeric."""
    if v is None or v == "":
        return None
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(str(v).replace(",", "").replace("%", ""))
    except (TypeError, ValueError):
        return None


def _text(v: Any) -> str:
    return "" if v is None else str(v).strip()


def _fmt_date(v: Any) -> str | None:
    """Render a cell date as e.g. '1/1/26'."""
    if isinstance(v, (dt.datetime, dt.date)):
        return f"{v.month}/{v.day}/{str(v.year)[-2:]}"
    return _text(v) or None


def _iso_date(v: Any) -> str | None:
    if isinstance(v, dt.datetime):
        return v.date().isoformat()
    if isinstance(v, dt.date):
        return v.isoformat()
    return None


def _find_title(ws, needle: str, exact: bool = False) -> tuple[int, int] | None:
    """Return (row, col) of the first cell matching `needle` (substring, or
    exact case-insensitive match when exact=True)."""
    needle = needle.lower()
    for row in ws.iter_rows():
        for cell in row:
            if not cell.value:
                continue
            text = str(cell.value).strip().lower()
            if (text == needle) if exact else (needle in text):
                return cell.row, cell.column
    return None


def _cell(ws, row: int, col: "str | int") -> Any:
    col_idx = col if isinstance(col, int) else cidx(col)
    return ws.cell(row=row, column=col_idx).value


# --------------------------------------------------------------------------- #
# Financial tables that share the "3 dates + $Δ + %Δ" shape
# --------------------------------------------------------------------------- #
# Stock Performance, 2026 Estimates and 2027 Estimates all use this layout:
#   label in col B; values D/E/F; $Δ H/I; %Δ K/L
THREE_DATE_VALUE_COLS = ["D", "E", "F"]
THREE_DATE_DELTA_ABS = ["H", "I"]
THREE_DATE_DELTA_PCT = ["K", "L"]


def parse_three_date_table(ws, title_needle: str, value_label: str) -> dict:
    pos = _find_title(ws, title_needle)
    if pos is None:
        raise ValueError(f"Could not find table title containing {title_needle!r}")
    title_row, label_col_idx = pos
    label_col = openpyxl.utils.get_column_letter(label_col_idx)
    title = _text(ws.cell(row=title_row, column=label_col_idx).value)

    # Header rows: title+2 holds the group labels, title+3 holds the dates / Δ labels.
    date_row = title_row + 3
    dates = [_fmt_date(_cell(ws, date_row, c)) for c in THREE_DATE_VALUE_COLS]
    dates_iso = [_iso_date(_cell(ws, date_row, c)) for c in THREE_DATE_VALUE_COLS]

    main_rows: list[dict] = []
    pct_rows: list[dict] = []

    # Scan a generous window below the header.
    for r in range(title_row + 5, title_row + 80):
        label = _text(_cell(ws, r, label_col))
        if not label:
            continue
        is_pct_section = "as % of spx" in label.lower()
        values = [_num(_cell(ws, r, c)) for c in THREE_DATE_VALUE_COLS]
        if all(v is None for v in values):
            # blank gap inside the table; stop if we've left both sections
            if main_rows and is_pct_section is False and pct_rows:
                break
            continue

        row_obj = {
            "label": label.replace(" as % of SPX", ""),
            "values": values,
            "delta_abs": [_num(_cell(ws, r, c)) for c in THREE_DATE_DELTA_ABS],
            "delta_pct": [_num(_cell(ws, r, c)) for c in THREE_DATE_DELTA_PCT],
            "is_total": label.lower().startswith("total"),
        }
        if is_pct_section:
            # pct-of-spx companion: only D/E/F + H/I (share + change) are meaningful
            pct_rows.append(row_obj)
        else:
            main_rows.append(row_obj)

        if "bloomberg spx" in label.lower():
            break

    return {
        "title": title,
        "value_label": value_label,
        "dates": dates,
        "dates_iso": dates_iso,
        "rows": main_rows,
        "pct_of_spx": pct_rows,
    }


# --------------------------------------------------------------------------- #
# Net Income Growth (Earnings Growth) — 2024..2027 + $Δ yoy + %Δ yoy
# --------------------------------------------------------------------------- #
def parse_growth_table(ws) -> dict:
    pos = _find_title(ws, "Net Income Growth")
    if pos is None:
        raise ValueError("Could not find 'Net Income Growth' table")
    title_row, label_col_idx = pos
    label_col = openpyxl.utils.get_column_letter(label_col_idx)
    title = _text(ws.cell(row=title_row, column=label_col_idx).value)

    hdr_row = title_row + 3  # years
    years = [_text(_cell(ws, hdr_row, c)) for c in ("N", "O", "P", "Q")]
    delta_years = [_text(_cell(ws, hdr_row, c)) for c in ("S", "T", "U")]

    main_rows: list[dict] = []
    pct_rows: list[dict] = []
    for r in range(title_row + 5, title_row + 80):
        label = _text(_cell(ws, r, label_col))
        if not label:
            continue
        is_pct = "as % of spx" in label.lower()
        values = [_num(_cell(ws, r, c)) for c in ("N", "O", "P", "Q")]
        if all(v is None for v in values):
            if main_rows and pct_rows:
                break
            continue
        row_obj = {
            "label": label.replace(" as % of SPX", ""),
            "values": values,
            "delta_abs": [_num(_cell(ws, r, c)) for c in ("S", "T", "U")],
            "delta_pct": [_num(_cell(ws, r, c)) for c in ("W", "X", "Y")],
            "is_total": label.lower().startswith("total"),
        }
        (pct_rows if is_pct else main_rows).append(row_obj)

    return {
        "title": title,
        "value_label": "Adj. Net Income",
        "years": years,
        "delta_years": delta_years,
        "rows": main_rows,
        "pct_of_spx": pct_rows,
    }


# --------------------------------------------------------------------------- #
# NTM P/E
# --------------------------------------------------------------------------- #
def parse_ntm_pe(ws) -> dict:
    pos = _find_title(ws, "NTM P/E")
    if pos is None:
        raise ValueError("Could not find 'NTM P/E' table")
    title_row, label_col_idx = pos
    label_col = openpyxl.utils.get_column_letter(label_col_idx)

    # header row with the 'avg since' / time-series dates
    hdr = title_row + 3  # row 189 when title is 186
    avg_cols = ["AV", "AW", "AX", "AY"]
    delta_cols = ["BA", "BB", "BC", "BD"]
    avg_dates = [_fmt_date(_cell(ws, hdr, c)) for c in avg_cols]

    # historical quarterly series spans BF.. to the last non-empty header cell
    series_cols: list[str] = []
    series_dates: list[str | None] = []
    c = cidx("BF")
    while True:
        letter = openpyxl.utils.get_column_letter(c)
        d = _cell(ws, hdr, c)
        if d is None or _fmt_date(d) is None:
            break
        series_cols.append(letter)
        series_dates.append(_iso_date(d))
        c += 1

    current_label = _text(_cell(ws, title_row + 2, "AP")) or "Current"

    rows: list[dict] = []
    for r in range(title_row + 5, title_row + 40):
        label = _text(_cell(ws, r, label_col))
        if not label:
            continue
        rows.append(
            {
                "label": label,
                "mkt_cap": _num(_cell(ws, r, "AP")),
                "ntm_ni": _num(_cell(ws, r, "AR")),
                "ntm_pe": _num(_cell(ws, r, "AT")),
                "avg_since": [_num(_cell(ws, r, c)) for c in avg_cols],
                "delta_vs_avg": [_num(_cell(ws, r, c)) for c in delta_cols],
                "series": [_num(_cell(ws, r, c)) for c in series_cols],
                "is_total": label.lower().startswith(("total", "bloomberg")),
            }
        )
        if "bloomberg spx" in label.lower():
            break

    return {
        "title": "NTM P/E",
        "current_label": current_label,
        "avg_dates": avg_dates,
        "series_dates": series_dates,
        "rows": rows,
    }


# --------------------------------------------------------------------------- #
# Per-stock universe (the Data sheet) — powers the category drill-down pages
# --------------------------------------------------------------------------- #
# The `Data` sheet carries one row per S&P 500 constituent. The category rows
# on the `Output` sheet are sums of these per-stock rows, so we read the same
# metric blocks here (calendarized adj. net income, matching the Output tables)
# and key them by company name to attach to each category.
def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def _sub(a: float | None, b: float | None) -> float | None:
    return None if (a is None or b is None) else a - b


def _growth(a: float | None, b: float | None) -> float | None:
    """Change from b to a, as a fraction of |b| (YoY growth / revision)."""
    return None if (a is None or b is None or b == 0) else (a - b) / abs(b)


def _scaled(ws, row: int, col: str, div: float = 1.0) -> float | None:
    v = _num(_cell(ws, row, col))
    return None if v is None else v / div


def _series_cols(ws, start_letter: str) -> list[int]:
    """Walk a horizontal date-headed block (row 10 holds the dates, row 9 the
    block title only on the first column) and return its column indices."""
    cols: list[int] = []
    start = cidx(start_letter)
    c = start
    while True:
        d = ws.cell(row=10, column=c).value
        if not isinstance(d, (dt.datetime, dt.date)):
            break
        if c != start and ws.cell(row=9, column=c).value:
            break  # ran into the next block
        cols.append(c)
        c += 1
    return cols


def parse_stock_universe(ws) -> dict[str, dict]:
    """Read the Data sheet into {company name -> per-stock metrics}."""
    ni_cols = _series_cols(ws, "CT")    # NTM net income estimate history ($m)
    mkt_cols = _series_cols(ws, "DR")   # market cap history ($b), same dates
    n = min(len(ni_cols), len(mkt_cols))

    def _est(r: int, c0: str, c1: str, c2: str) -> dict:
        vv = [_scaled(ws, r, c, 1000) for c in (c0, c1, c2)]
        return {
            "values": vv,
            "delta_abs": [_sub(vv[2], vv[0]), _sub(vv[2], vv[1])],
            "delta_pct": [_growth(vv[2], vv[0]), _growth(vv[2], vv[1])],
        }

    universe: dict[str, dict] = {}
    for r in range(11, ws.max_row + 1):
        name = _text(_cell(ws, r, "C"))
        if not name:
            continue

        # Performance: market cap ($b) at 3 dates, $Δ (YTD/QTD), return % (YTD/QTD)
        perf = {
            "values": [_num(_cell(ws, r, c)) for c in ("AA", "AB", "AC")],
            "delta_abs": [_num(_cell(ws, r, c)) for c in ("AE", "AF")],
            "delta_pct": [_num(_cell(ws, r, c)) for c in ("AH", "AI")],
        }

        # Earnings growth: calendarized adj. net income ($b), 2024..2027 + YoY Δ
        ev = [_scaled(ws, r, c, 1000) for c in ("BO", "BP", "BT", "BX")]
        earnings = {
            "values": ev,
            "delta_abs": [_sub(ev[i + 1], ev[i]) for i in range(3)],
            "delta_pct": [_growth(ev[i + 1], ev[i]) for i in range(3)],
        }

        # NTM P/E: current + quarterly history (market cap / NTM net income)
        ni_hist = [_num(ws.cell(row=r, column=c).value) for c in ni_cols[:n]]
        mkt_hist = [_num(ws.cell(row=r, column=c).value) for c in mkt_cols[:n]]
        pe_series = [
            (mkt_hist[i] * 1000 / ni_hist[i])
            if (mkt_hist[i] is not None and ni_hist[i])
            else None
            for i in range(n)
        ]
        ntm_ni = ni_hist[0] if ni_hist else None

        universe[name] = {
            "name": name,
            "ticker": _text(_cell(ws, r, "B")),
            "performance": perf,
            "earnings": earnings,
            "est_2026": _est(r, "BR", "BS", "BT"),
            "est_2027": _est(r, "BV", "BW", "BX"),
            "pe": {
                "mkt_cap": perf["values"][2],
                "ntm_ni": None if ntm_ni is None else ntm_ni / 1000,
                "ntm_pe": pe_series[0] if pe_series else None,
                "series": pe_series,
            },
        }
    return universe


# --------------------------------------------------------------------------- #
# SPX Categories — the universe map
# --------------------------------------------------------------------------- #
KNOWN_CATEGORIES = {
    "digital semis",
    "analog/mcu",
    "semicap",
    "hardware/components",
    "electric/cooling",
    "power",
    "memory",
    "design",
    "construction",
    "application",
    "infrastructure",
    "big tech",
    "miscellaneous",
}

GROUP_HEADERS = {
    "ai capex beneficiaries",
    "software",
    "ai buildout funders",
    "other",
}

# group header -> the name columns that feed it
GROUP_NAME_COLS = {
    "AI Capex Beneficiaries": ["AB", "AD", "AF"],
    "Software": ["AJ"],
    "AI Buildout Funders": ["AJ"],
    "Other": ["AL"],
}


def parse_categories(ws, universe: dict | None = None) -> dict:
    pos = _find_title(ws, "AI Capex Beneficiaries", exact=True)
    if pos is None:
        raise ValueError("Could not find 'AI Capex Beneficiaries' map")
    top_row = pos[0]  # row 154

    # Walk every name-bearing column, grouping members under the most recent
    # category header seen in that column.
    name_cols = ["AB", "AD", "AF", "AJ", "AL"]
    categories: dict[str, list[str]] = {}
    order: list[str] = []

    for col in name_cols:
        current: str | None = None
        blanks = 0
        for r in range(top_row, top_row + 40):
            val = _text(_cell(ws, r, col))
            if not val:
                blanks += 1
                if blanks > 4 and current:
                    pass
                continue
            blanks = 0
            if val.lower() in GROUP_HEADERS:
                continue  # group-level header, not a category or a member
            if val.lower() in KNOWN_CATEGORIES:
                current = val
                if current not in categories:
                    categories[current] = []
                    order.append(current)
            elif current is not None:
                categories[current].append(val)

    # Map each category to its parent group for display grouping.
    parent = {
        "Digital Semis": "AI Capex Beneficiaries",
        "Memory": "AI Capex Beneficiaries",
        "Semicap": "AI Capex Beneficiaries",
        "Analog/MCU": "AI Capex Beneficiaries",
        "Power": "AI Capex Beneficiaries",
        "Electric/Cooling": "AI Capex Beneficiaries",
        "Hardware/Components": "AI Capex Beneficiaries",
        "Design": "AI Capex Beneficiaries",
        "Construction": "AI Capex Beneficiaries",
        "Application": "Software",
        "Infrastructure": "Software",
        "Big Tech": "AI Buildout Funders",
        "Miscellaneous": "Other",
    }

    # Names explicitly placed in a named category. Everything else in the Data
    # sheet universe falls into "Miscellaneous" (the rest of the S&P 500).
    assigned = {
        m
        for cat in order
        if cat.lower() != "miscellaneous"
        for m in categories[cat]
        if universe and m in universe
    }

    groups: dict[str, list[dict]] = {}
    for cat in order:
        g = parent.get(cat, "Other")
        if cat.lower() == "miscellaneous" and universe:
            # All remaining constituents, kept in Data-sheet order (largest first).
            members = [name for name in universe if name not in assigned]
        else:
            members = categories[cat]
        stocks = [universe[m] for m in members if universe and m in universe]
        groups.setdefault(g, []).append(
            {
                "category": cat,
                "slug": _slug(cat),
                "members": members,
                "stocks": stocks,
            }
        )

    group_order = ["AI Capex Beneficiaries", "Software", "AI Buildout Funders", "Other"]
    return {
        "title": "SPX Categories",
        "groups": [
            {"group": g, "categories": groups[g]} for g in group_order if g in groups
        ],
    }


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #
def parse_workbook(path: str, refreshed_date: str | None = None) -> dict:
    wb = openpyxl.load_workbook(path, data_only=True)
    if "Output" not in wb.sheetnames:
        raise ValueError("Workbook has no 'Output' sheet")
    ws = wb["Output"]
    universe = parse_stock_universe(wb["Data"]) if "Data" in wb.sheetnames else {}

    stock_perf = parse_three_date_table(
        ws, "YTD Stock Performance", "Market cap ($b)"
    )

    return {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        # The date the workbook was refreshed/emailed (ISO yyyy-mm-dd). The
        # caller supplies this (e.g. from the email's date); the Output sheet
        # itself only carries the data-column dates.
        "refreshed_date": refreshed_date,
        "latest_date": stock_perf["dates"][-1],
        "tables": {
            "stock_performance": stock_perf,
            "est_rev_2026": parse_three_date_table(
                ws, "2026 Estimates", "Consensus Adj. Net Income ($b)"
            ),
            "est_rev_2027": parse_three_date_table(
                ws, "2027 Estimates", "Consensus Adj. Net Income ($b)"
            ),
            "earnings_growth": parse_growth_table(ws),
            "ntm_pe": parse_ntm_pe(ws),
            "categories": parse_categories(ws, universe),
        },
    }


def main() -> int:
    if len(sys.argv) not in (3, 4):
        print(
            "usage: parse_excel.py <input.xlsx> <output.json> [refreshed_date]",
            file=sys.stderr,
        )
        return 2
    refreshed_date = sys.argv[3] if len(sys.argv) == 4 else None
    data = parse_workbook(sys.argv[1], refreshed_date)
    with open(sys.argv[2], "w") as f:
        json.dump(data, f, indent=2, default=str)
    print(f"Wrote {sys.argv[2]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
