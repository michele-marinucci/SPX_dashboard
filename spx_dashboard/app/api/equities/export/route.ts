// "Export Excel" for the Equities Dashboard.
//
// Builds a clean, self-contained workbook of exactly what the site shows right
// now — every analyst edit included — across two tabs:
//   1. "Live Model" — the full editable model laid out as cells, with the price
//                     pulled live from Bloomberg (=BDP) and every derived column
//                     (EV, EV/GP, Mendo P/E, target price, IRR, MoM) written as
//                     a live Excel formula off those inputs. Opens showing the
//                     same numbers as the site (cached); recalculates on a
//                     Bloomberg terminal.
//   2. "Edit Log"   — every change ever made, newest first, one row per field.
import { NextResponse } from "next/server";
import { compute, displayYears } from "@/lib/equities/calc";
import { fieldLabel, fmtEditValue } from "@/lib/equities/editLog";
import { latestAsOf, latestDataDate, loadCompanies, loadQuotes } from "@/lib/equities/load";
import { Company, EditRecord } from "@/lib/equities/types";
import {
  buildWorkbook,
  colLetter,
  currencyStyle,
  excelDateTime,
  Row,
  S,
  sheetXml,
} from "@/lib/equities/xlsxBuild";
import { dbGetAllEdits, equitiesEnabled } from "@/lib/equitiesDb";

export const dynamic = "force-dynamic";

function editLogSheet(edits: EditRecord[]): string {
  const rows: string[] = [];
  rows.push(new Row(1).span("Equities Dashboard — Edit Log", S.TITLE_BAND, 6).xml());
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
  return sheetXml(rows, { cols, freezeRows: 4 });
}

// The year-end target-price formula for a company, mirroring lib/equities
// calc.ts targetPrice() per variant, expressed against the row's input cells.
// `PR(key)` resolves a model field to its cell reference on this row.
function targetFormula(c: Company, y: number, PR: (k: string) => string): string {
  const tm = PR(`tm_${y}`);
  const ncps = PR(`ncps_${y}`);
  const k1 = y + 1; // NTM-of-year inputs sit one column-year to the right
  switch (c.variant) {
    case "pe":
      return `IF(OR(${tm}="",${PR(`meps_${k1}`)}=""),"",${tm}*${PR(`meps_${k1}`)}${
        c.cash_in_target ? `+${ncps}` : ""
      })`;
    case "gp_ev":
      return `IF(OR(${tm}="",${PR(`wadso_${y}`)}=0),"",(${tm}*${PR(`gm_${k1}`)}*${PR(
        `revs_${k1}`,
      )}-${PR(`ndebt_${y}`)})/${PR(`wadso_${y}`)})`;
    case "gp_ps":
      return `IF(OR(${tm}="",${PR(`wadso_${k1}`)}=0),"",${tm}*${PR(`gm_${k1}`)}*${PR(
        `revs_${k1}`,
      )}/${PR(`wadso_${k1}`)}+${ncps})`;
    case "rev_ps":
      return `IF(OR(${tm}="",${PR(`wadso_${k1}`)}=0),"",${tm}*${PR(`revs_${k1}`)}/${PR(
        `wadso_${k1}`,
      )}+${ncps})`;
  }
}

// "Live Model": one row per company. Inputs are written as raw cells; price is
// a Bloomberg =BDP formula; every derived column is an Excel formula off those
// cells, so the workbook recalculates on a Bloomberg terminal. Cached values
// (the same numbers compute() feeds the site) are stored so it also opens
// readable without the add-in.
function modelSheet(
  companies: Company[],
  quotes: Awaited<ReturnType<typeof loadQuotes>>,
  today: Date,
  asOfNote: string,
): string {
  const years = displayYears(today);
  const [y0, y1, y2, y3] = years;
  const yy = (y: number) => `'${String(y).slice(2)}`;

  // Column plan (left→right): identity, the editable input series by year,
  // target multiple, balance-sheet scalars, then the formula-driven outputs.
  const SERIES = ["revs", "gm", "meps", "dps", "ncps", "wadso", "ndebt"] as const;
  const keys: string[] = ["ticker", "bbg", "price"];
  for (const s of SERIES) for (const y of years) keys.push(`${s}_${y}`);
  for (const y of years) keys.push(`tm_${y}`);
  keys.push("shares", "cash", "debt", "minint");
  keys.push("ev", `evgp_${y0}`, `evgp_${y1}`);
  for (const y of years) keys.push(`pe_${y}`);
  for (const y of [y0, y1, y2, y3]) keys.push(`tpx_${y}`);
  for (const y of [y1, y2, y3]) keys.push(`irr_${y}`);
  for (const y of [y0, y1, y2, y3]) keys.push(`mom_${y}`);
  const colOf = new Map(keys.map((k, i) => [k, colLetter(i + 1)]));
  const L = (k: string) => colOf.get(k)!;
  const NCOLS = keys.length;

  const groupOf: Record<string, string> = {
    revs: "Revenue ($M)", gm: "Gross margin", meps: "Mendo EPS ($)",
    dps: "DPS ($)", ncps: "Net cash/sh ($)", wadso: "WADSO (M)",
    ndebt: "Net debt ($M)", tm: "Target mult (×)", evgp: "EV / GP (×)",
    pe: "Mendo P/E (×)", tpx: "Target price", irr: "IRR", mom: "MoM (×)",
  };
  const describe = (key: string): { group: string; head: string } => {
    if (key === "ticker") return { group: "", head: "Company" };
    if (key === "bbg") return { group: "", head: "BBG ticker" };
    if (key === "price") return { group: "", head: "Price (BDP)" };
    const m = key.match(/^([a-z]+)_(\d{4})$/);
    if (m) return { group: groupOf[m[1]] ?? m[1], head: yy(Number(m[2])) };
    const scal: Record<string, string> = {
      shares: "Shares (M)", cash: "Cash (−)", debt: "Debt ($M)", minint: "Min int", ev: "EV ($M)",
    };
    return { group: key === "ev" ? "Derived" : "Balance sheet", head: scal[key] ?? key };
  };

  const rows: string[] = [];
  rows.push(new Row(1).span("Equities Dashboard — Live Model", S.TITLE_BAND, NCOLS).xml());
  rows.push(
    new Row(2)
      .str(`${asOfNote} · price = Bloomberg BDP · derived columns are live formulas`, S.SUBTITLE)
      .xml(),
  );
  rows.push(new Row(3).xml());

  // Group band (row 4) — each label is centered across its group's columns
  // (Center Across Selection), so the brand highlight spans the group like a
  // merged header without any merged cells. Per-column header on row 5.
  const gh = new Row(4);
  let ci = 0;
  while (ci < keys.length) {
    const g = describe(keys[ci]).group;
    let span = 1;
    while (ci + span < keys.length && g !== "" && describe(keys[ci + span]).group === g) span++;
    if (g) {
      gh.span(g, S.GROUP_HEAD, span);
    } else {
      gh.skip(span);
    }
    ci += span;
  }
  rows.push(gh.xml());
  const colHead = new Row(5);
  for (const k of keys) colHead.str(describe(k).head, S.COL_HEAD);
  rows.push(colHead.xml());

  const mnum = (m: Record<string, number>, y: number): number | null => {
    const v = m[String(y)];
    return typeof v === "number" && isFinite(v) ? v : null;
  };

  const stocks = companies.filter((c) => !c.is_index && !c.removed);
  const seen = new Set<string>();
  const order: string[] = [];
  for (const c of stocks) if (!seen.has(c.grp)) { seen.add(c.grp); order.push(c.grp); }

  let r = 6;
  for (const grp of order) {
    rows.push(new Row(r).str(grp, S.SECTOR).xml());
    r++;
    for (const c of stocks) {
      if (c.grp !== grp) continue;
      const q = c.yahoo ? quotes[c.yahoo] : undefined;
      const d = compute(c, q?.price ?? null, today);
      const m = c.model;
      const row = new Row(r);
      const PR = (k: string) => L(k) + r;
      const bdp = `BDP("${c.bbg}","PX_LAST")`;
      const priceF = c.px_scale && c.px_scale !== 1 ? `${bdp}*${c.px_scale}` : bdp;

      for (const key of keys) {
        if (key === "ticker") { row.str(c.ticker, c.port === 1 ? S.TICKER_OWN : S.TICKER); continue; }
        if (key === "bbg") { row.str(c.bbg, S.TEXT); continue; }
        if (key === "price") { row.formula(priceF, currencyStyle(c.currency), d.price); continue; }
        const mm = key.match(/^([a-z]+)_(\d{4})$/);
        if (mm) {
          const s = mm[1];
          const y = Number(mm[2]);
          switch (s) {
            case "revs": row.num(mnum(m.revs, y), S.NUMBER); break;
            case "gm": row.num(mnum(m.gm, y), S.PERCENT); break;
            case "meps": row.num(mnum(m.mendo_eps, y), S.NUMBER2); break;
            case "dps": row.num(mnum(m.dps, y), S.NUMBER2); break;
            case "ncps": row.num(mnum(m.ncps, y), S.NUMBER2); break;
            case "wadso": row.num(mnum(m.wadso, y), S.NUMBER); break;
            case "ndebt": row.num(mnum(m.net_debt, y), S.NUMBER); break;
            case "tm": row.num(mnum(m.target_mult, y), S.MULTIPLE); break;
            case "evgp":
              row.formula(
                `IF(OR(${PR("ev")}="",${PR(`gm_${y}`)}*${PR(`revs_${y}`)}=0),"",${PR("ev")}/(${PR(
                  `gm_${y}`,
                )}*${PR(`revs_${y}`)}))`,
                S.MULTIPLE, d.evGp[y],
              );
              break;
            case "pe":
              row.formula(
                `IF(${PR(`meps_${y}`)}<=0,"",${PR("price")}/${PR(`meps_${y}`)})`,
                S.MULTIPLE, d.mendoPe[y],
              );
              break;
            case "tpx":
              row.formula(targetFormula(c, y, PR) ?? "", currencyStyle(c.currency), d.targetPx[y]);
              break;
            case "irr": {
              const k = y - y0;
              const n0 = `((DATE(${y0},12,31)-TODAY())/365)`;
              let divs = `${PR(`dps_${y0}`)}*${n0}`;
              for (let j = 1; j <= k; j++) divs += `+${PR(`dps_${y0 + j}`)}`;
              // RRI is a post-2007 function, so it MUST be stored with the
              // "_xlfn." prefix — otherwise Excel reads it as an unknown name,
              // renders it as "@RRI", and errors. (That broken "@" formula, not
              // IFERROR, was the real problem.) With the prefix it resolves, so
              // we can safely wrap it: a genuine RRI error (e.g. a non-positive
              // price while BDP is still loading) shows blank, not #NUM!.
              row.formula(
                `IFERROR(_xlfn.RRI((DATE(${y},12,31)-TODAY())/365,${PR("price")},${PR(`tpx_${y}`)}+${divs}),"")`,
                S.PERCENT, d.irr[y],
              );
              break;
            }
            case "mom": {
              const k = y - y0;
              let divs = `${PR(`dps_${y0}`)}`;
              for (let j = 1; j <= k; j++) divs += `+${PR(`dps_${y0 + j}`)}`;
              row.formula(
                `IF(${PR("price")}=0,"",(${PR(`tpx_${y}`)}+${divs})/${PR("price")})`,
                S.MULTIPLE, d.mom[y],
              );
              break;
            }
            default: row.num(null, S.NUMBER);
          }
          continue;
        }
        switch (key) {
          case "shares": row.num(m.shares, S.NUMBER); break;
          case "cash": row.num(m.cash, S.NUMBER); break;
          case "debt": row.num(m.debt, S.NUMBER); break;
          case "minint": row.num(m.min_int, S.NUMBER); break;
          case "ev":
            row.formula(
              `IF(${PR("shares")}="","",${PR("shares")}*${PR("price")}+${PR("cash")}+${PR("debt")}+${PR("minint")})`,
              S.NUMBER, d.ev,
            );
            break;
          default: row.num(null, S.NUMBER);
        }
      }
      rows.push(row.xml());
      r++;
    }
  }

  const cols = [
    { min: 1, max: 1, width: 14 },
    { min: 2, max: 3, width: 15 },
    { min: 4, max: NCOLS, width: 8.5 },
  ];
  return sheetXml(rows, { cols, freezeRows: 5, freezeCols: 1 });
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
    { name: "Live Model", xml: modelSheet(companies, quotes, today, asOfNote) },
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
