// "Export Excel" for the Equities Dashboard.
//
// Builds a clean, self-contained workbook of exactly what the site shows right
// now — every analyst edit included, recomputed against the latest prices —
// with just two tabs:
//   1. "Summary"  — the Summary-view table, sector-grouped and number-formatted
//                   ($, %, multiples, thousands separators).
//   2. "Edit Log" — every change ever made, newest first, one row per field.
// No Bloomberg formulas, no helper columns, no other tabs: it's a snapshot for
// sharing, not the live model. (The live model still lives in the team's
// original workbook.)
import { NextResponse } from "next/server";
import { compute, displayYears } from "@/lib/equities/calc";
import { fieldLabel, fmtEditValue } from "@/lib/equities/editLog";
import { latestAsOf, latestDataDate, loadCompanies, loadQuotes } from "@/lib/equities/load";
import { Company, EditRecord } from "@/lib/equities/types";
import {
  buildWorkbook,
  currencyStyle,
  excelDateTime,
  Row,
  S,
  sheetXml,
} from "@/lib/equities/xlsxBuild";
import { dbGetAllEdits, equitiesEnabled } from "@/lib/equitiesDb";

export const dynamic = "force-dynamic";

// Columns A..V, mirroring the on-screen Summary view.
const N_COLS = 22;
const LAST = "V";

function summarySheet(
  companies: Company[],
  quotes: Awaited<ReturnType<typeof loadQuotes>>,
  today: Date,
  asOfNote: string,
): string {
  const years = displayYears(today);
  const [y0, y1, y2, y3, y4] = years;
  const yr = (y: number) => String(y).slice(2); // "27"
  const rows: string[] = [];
  const merges: string[] = [`A1:${LAST}1`, `A2:${LAST}2`];

  // Title + subtitle band.
  rows.push(new Row(1).str("Equities Dashboard — Summary", S.TITLE).xml());
  rows.push(new Row(2).str(asOfNote, S.SUBTITLE).xml());
  rows.push(new Row(3).xml()); // spacer

  // Group header (row 4) + column header (row 5).
  const gh = new Row(4)
    .str("Company", S.GROUP_HEAD)
    .str("Price", S.GROUP_HEAD)
    .str("EV / GP", S.GROUP_HEAD).skip(1)
    .str("Mendo P/E", S.GROUP_HEAD).skip(4)
    .str("Target Mult", S.GROUP_HEAD).skip(2)
    .str("IRR", S.GROUP_HEAD).skip(2)
    .str("MoM", S.GROUP_HEAD).skip(3)
    .str("Recent Perf", S.GROUP_HEAD).skip(2);
  rows.push(gh.xml());
  merges.push(
    "A4:A5", "B4:B5", "C4:D4", "E4:I4", "J4:L4", "M4:O4", "P4:S4", "T4:V4",
  );

  const ch = new Row(5)
    .skip(2) // A/B covered by the merged group header
    .str(`'${yr(y0)}`, S.COL_HEAD).str(`'${yr(y1)}`, S.COL_HEAD) // EV/GP
    .str(`'${yr(y0)}`, S.COL_HEAD).str(`'${yr(y1)}`, S.COL_HEAD).str(`'${yr(y2)}`, S.COL_HEAD)
    .str(`'${yr(y3)}`, S.COL_HEAD).str(`'${yr(y4)}`, S.COL_HEAD) // Mendo P/E
    .str(`'${yr(y1)}`, S.COL_HEAD).str(`'${yr(y2)}`, S.COL_HEAD).str(`'${yr(y3)}`, S.COL_HEAD) // Target
    .str(`'${yr(y1)}`, S.COL_HEAD).str(`'${yr(y2)}`, S.COL_HEAD).str(`'${yr(y3)}`, S.COL_HEAD) // IRR
    .str(`'${yr(y0)}`, S.COL_HEAD).str(`'${yr(y1)}`, S.COL_HEAD).str(`'${yr(y2)}`, S.COL_HEAD)
    .str(`'${yr(y3)}`, S.COL_HEAD) // MoM
    .str("1M", S.COL_HEAD).str("3M", S.COL_HEAD).str("6M", S.COL_HEAD);
  rows.push(ch.xml());

  let r = 6;
  const sectorBand = (label: string) => {
    rows.push(new Row(r).str(label, S.SECTOR).xml());
    // Fill the band across the row so the sector fill carries the full width.
    merges.push(`A${r}:${LAST}${r}`);
    r++;
  };

  const perfOf = (c: Company) => {
    const q = c.yahoo ? quotes[c.yahoo] : undefined;
    return { m1: q?.m1 ?? c.perf.m1, m3: q?.m3 ?? c.perf.m3, m6: q?.m6 ?? c.perf.m6 };
  };

  const companyRow = (c: Company) => {
    const q = c.yahoo ? quotes[c.yahoo] : undefined;
    const d = compute(c, q?.price ?? null, today);
    const pf = perfOf(c);
    const row = new Row(r)
      .str(c.ticker + (c.port === 1 ? " ◆" : ""), S.TICKER)
      .num(d.price, currencyStyle(c.currency))
      .num(d.evGp[y0], S.MULTIPLE).num(d.evGp[y1], S.MULTIPLE)
      .num(d.mendoPe[y0], S.MULTIPLE).num(d.mendoPe[y1], S.MULTIPLE)
      .num(d.mendoPe[y2], S.MULTIPLE).num(d.mendoPe[y3], S.MULTIPLE).num(d.mendoPe[y4], S.MULTIPLE)
      .num(c.model.target_mult[String(y1)] ?? null, S.MULTIPLE)
      .num(c.model.target_mult[String(y2)] ?? null, S.MULTIPLE)
      .num(c.model.target_mult[String(y3)] ?? null, S.MULTIPLE)
      .num(d.irr[y1], S.PERCENT).num(d.irr[y2], S.PERCENT).num(d.irr[y3], S.PERCENT)
      .num(d.mom[y0], S.MULTIPLE).num(d.mom[y1], S.MULTIPLE)
      .num(d.mom[y2], S.MULTIPLE).num(d.mom[y3], S.MULTIPLE)
      .num(pf.m1, S.PERCENT).num(pf.m3, S.PERCENT).num(pf.m6, S.PERCENT);
    rows.push(row.xml());
    r++;
  };

  // Sector groups (same ordering the API returns: grp_order, row_order).
  const seen = new Set<string>();
  const order: string[] = [];
  for (const c of companies) {
    if (c.is_index || c.removed) continue;
    if (!seen.has(c.grp)) {
      seen.add(c.grp);
      order.push(c.grp);
    }
  }
  for (const grp of order) {
    sectorBand(grp);
    for (const c of companies) {
      if (!c.is_index && !c.removed && c.grp === grp) companyRow(c);
    }
  }

  // Index rows (Px + P/E only).
  const indexRows = companies.filter((c) => c.is_index && !c.removed);
  if (indexRows.length) {
    sectorBand("Index");
    for (const c of indexRows) {
      const q = c.yahoo ? quotes[c.yahoo] : undefined;
      const d = compute(c, q?.price ?? null, today);
      const pf = perfOf(c);
      const row = new Row(r)
        .str(c.ticker, S.TICKER)
        .num(d.price, currencyStyle(c.currency))
        .skip(2); // no EV/GP
      for (const y of years) row.num(c.best_pe?.[String(y)] ?? null, S.MULTIPLE);
      row.skip(10); // no target / IRR / MoM
      row.num(pf.m1, S.PERCENT).num(pf.m3, S.PERCENT).num(pf.m6, S.PERCENT);
      rows.push(row.xml());
      r++;
    }
  }

  const cols = [
    { min: 1, max: 1, width: 16 },
    { min: 2, max: 2, width: 11 },
    { min: 3, max: N_COLS, width: 8.5 },
  ];
  return sheetXml(rows, { cols, merges, freezeRows: 5, freezeCols: 1 });
}

function editLogSheet(edits: EditRecord[]): string {
  const rows: string[] = [];
  const merges = ["A1:F1", "A2:F2"];
  rows.push(new Row(1).str("Equities Dashboard — Edit Log", S.TITLE).xml());
  rows.push(
    new Row(2)
      .str("Every change, most recent first. Times are UTC.", S.SUBTITLE)
      .xml(),
  );
  rows.push(new Row(3).xml());

  rows.push(
    new Row(4)
      .str("When", S.COL_HEAD)
      .str("Ticker", S.COL_HEAD)
      .str("Analyst", S.COL_HEAD)
      .str("Field", S.COL_HEAD)
      .str("Old", S.COL_HEAD)
      .str("New", S.COL_HEAD)
      .xml(),
  );

  let r = 5;
  for (const e of edits) {
    const when = excelDateTime(e.created_at);
    for (const ch of e.changes) {
      rows.push(
        new Row(r)
          .num(when, S.DATETIME)
          .str(e.ticker, S.TEXT)
          .str(e.analyst, S.TEXT)
          .str(fieldLabel(ch.field), S.TEXT)
          .str(fmtEditValue(ch.old, ch.field), S.TEXT)
          .str(fmtEditValue(ch.new, ch.field), S.TEXT)
          .xml(),
      );
      r++;
    }
  }
  if (r === 5) {
    rows.push(new Row(5).str("No changes logged yet.", S.TEXT).xml());
  }

  const cols = [
    { min: 1, max: 1, width: 17 },
    { min: 2, max: 2, width: 10 },
    { min: 3, max: 3, width: 12 },
    { min: 4, max: 4, width: 18 },
    { min: 5, max: 6, width: 16 },
  ];
  return sheetXml(rows, { cols, merges, freezeRows: 4 });
}

export async function GET() {
  const { enabled, companies } = await loadCompanies();
  const quotes = await loadQuotes(companies, enabled, false);
  const today = new Date();

  let edits: EditRecord[] = [];
  if (equitiesEnabled()) {
    try {
      edits = await dbGetAllEdits();
    } catch {
      /* log read is best-effort — still export the Summary */
    }
  }

  const dataDate = latestDataDate(quotes);
  const stocks = companies.filter((c) => !c.is_index && !c.removed);
  const asOfNote =
    `${stocks.length} names · prices as of ` +
    (dataDate
      ? `${new Date(`${dataDate}T12:00:00`).toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
        })} (prior close)`
      : "n/a") +
    ` · exported ${today.toISOString().slice(0, 10)}`;

  const buf = await buildWorkbook([
    { name: "Summary", xml: summarySheet(companies, quotes, today, asOfNote) },
    { name: "Edit Log", xml: editLogSheet(edits) },
  ]);

  const stamp = today.toISOString().slice(0, 10).replace(/-/g, "");
  const asOf = latestAsOf(quotes);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${stamp}_Equities_Dashboard.xlsx"`,
      "X-Prices-As-Of": asOf ?? "none",
    },
  });
}
