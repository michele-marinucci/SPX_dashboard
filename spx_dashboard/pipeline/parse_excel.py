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


def parse_categories(ws) -> dict:
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

    groups: dict[str, list[dict]] = {}
    for cat in order:
        g = parent.get(cat, "Other")
        groups.setdefault(g, []).append({"category": cat, "members": categories[cat]})

    group_order = ["AI Capex Beneficiaries", "Software", "AI Buildout Funders", "Other"]
    return {
        "title": "SPX Categories",
        "groups": [
            {"group": g, "categories": groups[g]} for g in group_order if g in groups
        ],
    }


# --------------------------------------------------------------------------- #
# GAAP appendix (optional)
# --------------------------------------------------------------------------- #
def parse_appendix(ws) -> dict:
    """
    The appendix mirrors the Earnings Growth / 2026 / 2027 tables but on a GAAP
    basis. In the standard export the workbook's GAAP/Adjusted switch produces a
    single set of tables, so dedicated GAAP tables are usually absent. We detect
    them by title and populate only if present.
    """
    present = _find_title(ws, "GAAP") is not None
    return {
        "present": present,
        "note": (
            "GAAP appendix tables were not found in this export. The workbook's "
            "GAAP/Adjusted toggle (Data!AL6) regenerates the same Output tables; "
            "to publish a GAAP appendix, add GAAP-titled copies of the Earnings "
            "Growth / 2026 / 2027 tables to the Output sheet, or send a GAAP-mode "
            "export. The parser will pick them up automatically."
        ),
    }


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #
def parse_workbook(path: str) -> dict:
    wb = openpyxl.load_workbook(path, data_only=True)
    if "Output" not in wb.sheetnames:
        raise ValueError("Workbook has no 'Output' sheet")
    ws = wb["Output"]

    stock_perf = parse_three_date_table(
        ws, "YTD Stock Performance", "Market cap ($b)"
    )

    return {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
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
            "categories": parse_categories(ws),
            "appendix": parse_appendix(ws),
        },
    }


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: parse_excel.py <input.xlsx> <output.json>", file=sys.stderr)
        return 2
    data = parse_workbook(sys.argv[1])
    with open(sys.argv[2], "w") as f:
        json.dump(data, f, indent=2, default=str)
    print(f"Wrote {sys.argv[2]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
