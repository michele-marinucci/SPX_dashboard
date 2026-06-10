// "Download Excel" for the Equities Dashboard: builds a fresh workbook from
// the current shared state — the two Summary views recomputed with live
// prices, plus a Model Inputs sheet that is a complete, re-importable backup
// of every editable assumption.
import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { latestAsOf, loadCompanies, loadQuotes } from "@/lib/equities/load";
import { compute, displayYears } from "@/lib/equities/calc";
import { Company } from "@/lib/equities/types";

export const dynamic = "force-dynamic";

const X = '0.0"x"';
const PCT = "0.0%";
const MONEY = "#,##0.00";
const NUM = "#,##0.0";

const GREEN_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFC9EED2" },
};
const HEAD_FONT = { bold: true, size: 9 } as const;
const BASE_FONT = { size: 9 } as const;

function groupRows(companies: Company[]): [string, Company[]][] {
  const order: string[] = [];
  const by: Record<string, Company[]> = {};
  for (const c of companies) {
    if (!by[c.grp]) {
      by[c.grp] = [];
      order.push(c.grp);
    }
    by[c.grp].push(c);
  }
  return order.map((g) => [g, by[g]]);
}

export async function GET() {
  const { enabled, companies } = await loadCompanies();
  const quotes = await loadQuotes(companies, enabled, false);
  const today = new Date();
  const years = displayYears(today);
  const [y0, y1, y2, y3, y4] = years;

  const wb = new ExcelJS.Workbook();
  wb.created = today;

  // ---- Sheet 1: the valuation grid ---------------------------------------- //
  const s1 = wb.addWorksheet("Dashboard", { views: [{ state: "frozen", xSplit: 1, ySplit: 2 }] });
  const cols1: { h1: string; h2: string; fmt?: string; w?: number }[] = [
    { h1: "", h2: "Company", w: 14 },
    { h1: "", h2: "Px", fmt: MONEY, w: 10 },
    { h1: "EV / GP", h2: String(y0), fmt: X },
    { h1: "EV / GP", h2: String(y1), fmt: X },
    ...years.map((y) => ({ h1: "Mendo P/E", h2: String(y), fmt: X })),
    ...[y1, y2, y3].map((y) => ({ h1: "Target Mult", h2: String(y), fmt: X })),
    ...[y1, y2, y3].map((y) => ({ h1: "IRR", h2: String(y), fmt: PCT })),
    ...[y0, y1, y2, y3].map((y) => ({ h1: "MoM", h2: String(y), fmt: X })),
    { h1: "Recent Perf", h2: "1M", fmt: PCT },
    { h1: "Recent Perf", h2: "3M", fmt: PCT },
    { h1: "Recent Perf", h2: "6M", fmt: PCT },
  ];
  s1.columns = cols1.map((c) => ({ width: c.w ?? 8 }));
  s1.addRow(cols1.map((c) => c.h1));
  s1.addRow(cols1.map((c) => c.h2));

  // ---- Sheet 2: IRR decomposition ----------------------------------------- //
  const s2 = wb.addWorksheet("IRR Decomp", { views: [{ state: "frozen", xSplit: 1, ySplit: 2 }] });
  const decompCols = [
    "Company",
    "Px",
    "Revs",
    "Margin",
    "Mendo NI",
    "Yield",
    "EPS + Divs",
    "Multiple",
    "Return",
    "GP CAGR",
    "mEPS CAGR",
  ];
  s2.columns = decompCols.map((_, i) => ({ width: i === 0 ? 14 : 10 }));
  s2.addRow([`NTM – YE${String(y2).slice(2)} IRR Decomp`]);
  s2.addRow(decompCols);

  // ---- Sheet 3: every editable input -------------------------------------- //
  const s3 = wb.addWorksheet("Model Inputs");
  const seriesKeys = [
    ["revs", "Revs"],
    ["gm", "GM %"],
    ["adj_eps", "Adj EPS"],
    ["mendo_eps", "Mendo EPS"],
    ["dps", "DPS"],
    ["target_mult", "Target Mult"],
    ["ncps", "Net Cash/Sh"],
    ["wadso", "WADSO"],
    ["net_debt", "Net Debt"],
  ] as const;
  const allYears = Array.from({ length: 9 }, (_, i) => y0 - 4 + i);
  s3.columns = [
    { width: 12 },
    { width: 18 },
    { width: 14 },
    ...allYears.map(() => ({ width: 11 })),
    { width: 10 },
    { width: 12 },
    { width: 12 },
    { width: 10 },
    { width: 6 },
    { width: 12 },
    { width: 12 },
  ];
  s3.addRow([
    "Ticker",
    "Bloomberg",
    "Field",
    ...allYears.map(String),
    "Shares",
    "Cash",
    "Debt",
    "Min Int",
    "Port",
    "Updated",
    "By",
  ]);

  for (const [grp, rows] of groupRows(companies)) {
    const g1 = s1.addRow([grp]);
    g1.font = HEAD_FONT;
    const g2 = s2.addRow([grp]);
    g2.font = HEAD_FONT;

    for (const c of rows) {
      const q = c.yahoo ? quotes[c.yahoo] : undefined;
      const d = compute(c, q?.price ?? null, today);
      const perf = {
        m1: q?.m1 ?? c.perf.m1,
        m3: q?.m3 ?? c.perf.m3,
        m6: q?.m6 ?? c.perf.m6,
      };

      if (c.is_index) {
        const pe = (y: number) => c.best_pe?.[String(y)] ?? null;
        const r = s1.addRow([
          c.ticker,
          d.price,
          null,
          null,
          pe(y0),
          pe(y1),
          pe(y2),
          pe(y3),
          pe(y4),
          ...Array(10).fill(null),
          perf.m1,
          perf.m3,
          perf.m6,
        ]);
        r.font = BASE_FONT;
        continue;
      }

      const r1 = s1.addRow([
        c.ticker,
        d.price,
        d.evGp[y0],
        d.evGp[y1],
        ...years.map((y) => d.mendoPe[y]),
        ...[y1, y2, y3].map((y) => c.model.target_mult[String(y)] ?? null),
        ...[y1, y2, y3].map((y) => d.irr[y]),
        ...[y0, y1, y2, y3].map((y) => d.mom[y]),
        perf.m1,
        perf.m3,
        perf.m6,
      ]);
      r1.font = BASE_FONT;
      if (c.port === 1) r1.getCell(1).fill = GREEN_FILL;

      const r2 = s2.addRow([
        c.ticker,
        d.price,
        d.decomp.revs,
        d.decomp.margin,
        d.decomp.ni,
        d.decomp.yld,
        d.decomp.epsDivs,
        d.decomp.multiple,
        d.decomp.ret,
        d.gpCagr,
        d.mepsCagr,
      ]);
      r2.font = BASE_FONT;
      if (c.port === 1) r2.getCell(1).fill = GREEN_FILL;

      seriesKeys.forEach(([key, label], i) => {
        const series = c.model[key];
        const row = s3.addRow([
          i === 0 ? c.ticker : null,
          i === 0 ? c.bbg : null,
          label,
          ...allYears.map((y) => series[String(y)] ?? null),
          ...(i === 0
            ? [c.model.shares, c.model.cash, c.model.debt, c.model.min_int, c.port, c.update_date, c.update_by]
            : []),
        ]);
        row.font = BASE_FONT;
        const fmt = key === "gm" ? "0.0%" : key === "target_mult" ? X : NUM;
        for (let j = 0; j < allYears.length; j++) row.getCell(4 + j).numFmt = fmt;
      });
    }
    s1.addRow([]);
    s2.addRow([]);
  }

  // Column formats + header styling for sheets 1 and 2.
  cols1.forEach((c, i) => {
    if (c.fmt) s1.getColumn(i + 1).numFmt = c.fmt;
  });
  for (let i = 2; i <= decompCols.length; i++) {
    s2.getColumn(i).numFmt = i === 2 ? MONEY : PCT;
  }
  s2.getColumn(2).numFmt = MONEY;
  [s1, s2, s3].forEach((s) => {
    s.getRow(1).font = HEAD_FONT;
    s.getRow(2).font = HEAD_FONT;
  });

  const asOf = latestAsOf(quotes);
  s1.addRow([]);
  s1.addRow([
    `Generated ${today.toISOString().slice(0, 10)} · prices as of ${asOf ?? "n/a"} (Yahoo Finance)`,
  ]).font = { size: 8, italic: true };

  const buf = await wb.xlsx.writeBuffer();
  const stamp = today.toISOString().slice(0, 10).replace(/-/g, "");
  return new NextResponse(Buffer.from(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${stamp}_Detailed_Dashboard.xlsx"`,
    },
  });
}
