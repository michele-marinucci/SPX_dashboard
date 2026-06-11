import pptxgen from "pptxgenjs";

import { compute, Decomp, Derived, displayYears } from "@/lib/equities/calc";
import { loadCompanies, loadQuotes, latestDataDate } from "@/lib/equities/load";
import { Company, Quote } from "@/lib/equities/types";
import {
  BRAND,
  CONTENT_W,
  INK,
  MARGIN,
  MUTED,
  PAGE_H,
  Row,
  toCell,
} from "./common";

// Faithful PowerPoint of the Equities Dashboard — the two screens the web page
// shows (Valuation/IRR "Summary" and the "IRR Decomp"), same columns, same
// Excel-style heatmaps and owned-name shading, ordered by the 2028 IRR within
// each sector, priced off the prior-day closes the page itself uses.

// ---- heatmaps (ported 1:1 from components/EquitiesApp.tsx) ----------------- //
type RGB = [number, number, number];
const RED: RGB = [248, 105, 107];
const YELLOW: RGB = [255, 235, 132];
const GREEN: RGB = [99, 190, 123];
const WHITE: RGB = [255, 255, 255];
const OWNED = "D9EFDC"; // .eq-tick-own
const BLUE = "1D4ED8"; // .eq-blue
const NA = "A6A6B2"; // .eq-na faint

function hex(c: RGB): string {
  return c.map((x) => Math.round(x).toString(16).padStart(2, "0")).join("");
}
function mix(a: RGB, b: RGB, t: number): RGB {
  const u = Math.max(0, Math.min(1, t));
  return a.map((x, i) => x + (b[i] - x) * u) as RGB;
}
function scale3(v: number, lo: number, mid: number, hi: number, c: [RGB, RGB, RGB]): string {
  const rgb =
    v <= mid
      ? mix(c[0], c[1], mid === lo ? 1 : (v - lo) / (mid - lo))
      : mix(c[1], c[2], hi === mid ? 0 : (v - mid) / (hi - mid));
  return hex(rgb);
}
function stats(values: (number | null)[]): { lo: number; mid: number; hi: number } | null {
  const xs = values.filter((v): v is number => v != null && isFinite(v)).sort((a, b) => a - b);
  if (xs.length < 3) return null;
  return { lo: xs[0], mid: xs[Math.floor(xs.length / 2)], hi: xs[xs.length - 1] };
}

// ---- value formatters (match EquitiesApp fx/fp/fpx) ------------------------ //
function fx(v: number | null | undefined): string {
  return v == null ? "n/a" : `${v.toFixed(1)}x`;
}
function fp(v: number | null | undefined): string {
  return v == null ? "n/a" : `${(v * 100).toFixed(1)}%`;
}
function fpx(v: number | null | undefined, ccy: string): string {
  if (v == null) return "n/a";
  const s = v.toLocaleString("en-US", {
    minimumFractionDigits: v >= 1000 ? 0 : 2,
    maximumFractionDigits: v >= 1000 ? 0 : 2,
  });
  return `${ccy}${s}`;
}

// A compact slide header (title + subtitle) leaving the most room for a table.
function eqSlide(pptx: pptxgen, title: string, subtitle: string): pptxgen.Slide {
  const slide = pptx.addSlide();
  slide.background = { color: "FFFFFF" };
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: 0.18,
    h: PAGE_H,
    fill: { color: BRAND },
    line: { type: "none" },
  });
  slide.addText(title, {
    x: MARGIN,
    y: 0.16,
    w: CONTENT_W,
    h: 0.42,
    fontFace: "Arial",
    fontSize: 20,
    bold: true,
    color: INK,
  });
  slide.addText(subtitle, {
    x: MARGIN,
    y: 0.58,
    w: CONTENT_W,
    h: 0.3,
    fontFace: "Arial",
    fontSize: 10,
    color: MUTED,
  });
  return slide;
}

function cell(text: string, opts: pptxgen.TableCellProps = {}): { text: string; options: pptxgen.TableCellProps } {
  return { text, options: opts };
}
function naIf(s: string, base: pptxgen.TableCellProps): pptxgen.TableCellProps {
  return s === "n/a" ? { ...base, color: NA } : base;
}

export async function addEquitiesSlides(pptx: pptxgen, today: Date) {
  const { enabled, companies } = await loadCompanies();
  let quotes: Record<string, Quote> = {};
  try {
    quotes = await loadQuotes(companies, enabled, false);
  } catch {
    quotes = {};
  }

  const years = displayYears(today);
  const [y0, y1, y2, y3, y4] = years;

  const derived = new Map<string, Derived>();
  for (const c of companies) {
    const q = c.yahoo ? quotes[c.yahoo] : undefined;
    derived.set(c.ticker, compute(c, q?.price ?? null, today));
  }
  const perfOf = (c: Company) => {
    const q = c.yahoo ? quotes[c.yahoo] : undefined;
    return { m1: q?.m1 ?? c.perf.m1, m3: q?.m3 ?? c.perf.m3, m6: q?.m6 ?? c.perf.m6 };
  };

  const stocks = companies.filter((c) => !c.is_index && !c.removed);
  const indexRows = companies.filter((c) => c.is_index && !c.removed);

  // Sector groups in their natural order; rows within a sector ordered by the
  // 2028 (y0+2) IRR, descending (n/a last) — the deck's required ordering.
  const order: string[] = [];
  const byGrp: Record<string, Company[]> = {};
  for (const c of stocks) {
    if (!byGrp[c.grp]) {
      byGrp[c.grp] = [];
      order.push(c.grp);
    }
    byGrp[c.grp].push(c);
  }
  const irr2028 = (c: Company) => derived.get(c.ticker)?.irr[y2] ?? null;
  order.forEach((g) =>
    byGrp[g].sort((a, b) => {
      const av = irr2028(a);
      const bv = irr2028(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return bv - av;
    }),
  );

  // Column-wide heat scales, computed across all stocks (as in the web app).
  const peStats = stats(stocks.map((c) => derived.get(c.ticker)?.mendoPe[y1] ?? null));
  const irrStats = stats(stocks.map((c) => derived.get(c.ticker)?.irr[y2] ?? null));
  const heatPe = (v: number | null) =>
    v != null && peStats ? scale3(v, peStats.lo, peStats.mid, peStats.hi, [GREEN, YELLOW, RED]) : undefined;
  const heatIrr = (v: number | null) =>
    v != null && irrStats ? scale3(v, irrStats.lo, irrStats.mid, irrStats.hi, [YELLOW, YELLOW, GREEN]) : undefined;
  const heatPerf = (v: number | null) =>
    v == null ? undefined : scale3(v, -0.3, 0, 0.3, [RED, WHITE, GREEN]);

  const dataDate = latestDataDate(quotes);
  const priceNote = dataDate
    ? `Prices as of prior close ${dataDate}`
    : enabled
      ? "Prices as of prior close"
      : "Read-only snapshot · live prices shown in the app";

  buildValSlide();
  buildDecompSlide();

  // ---- Summary (Valuation / IRR) screen ------------------------------------ //
  function buildValSlide() {
    const COLS = 22;
    const slide = eqSlide(
      pptx,
      "Equities Dashboard — Summary",
      `${stocks.length} names · ${stocks.filter((c) => c.port === 1).length} owned · ${priceNote}`,
    );

    const grpHdr = (label: string): pptxgen.TableCell =>
      ({ text: label, options: { colspan: COLS, bold: true, color: INK, align: "left", fill: { color: "F2F2F6" }, fontSize: 7 } });

    const h1: pptxgen.TableCell[] = [
      hCell(""),
      hCell(""),
      hCell("EV / GP", 2),
      hCell("Mendo P/E", 5),
      hCell("Target Mult (GP or P/E)", 3),
      hCell("IRR", 3),
      hCell("MoM", 4),
      hCell("Recent Performance", 3),
    ];
    const h2: pptxgen.TableCell[] = [
      hCell("Company"),
      hCell("Px"),
      ...[y0, y1].map((y) => hCell(String(y))),
      ...[y0, y1, y2, y3, y4].map((y) => hCell(String(y))),
      ...[y1, y2, y3].map((y) => hCell(String(y))),
      ...[y1, y2, y3].map((y) => hCell(String(y))),
      ...[y0, y1, y2, y3].map((y) => hCell(String(y))),
      hCell("1M"),
      hCell("3M"),
      hCell("6M"),
    ];

    const rows: pptxgen.TableRow[] = [h1, h2];

    const valRow = (c: Company): pptxgen.TableCell[] => {
      const d = derived.get(c.ticker)!;
      const pf = perfOf(c);
      const tickOpts: pptxgen.TableCellProps = {
        align: "left",
        bold: true,
        fill: c.port === 1 ? { color: OWNED } : undefined,
      };
      const out: pptxgen.TableCell[] = [cell(c.ticker, tickOpts)];
      out.push(cell(fpx(d.price, c.currency), naIf(fpx(d.price, c.currency), {})));
      [y0, y1].forEach((y) => out.push(cell(fx(d.evGp[y]), naIf(fx(d.evGp[y]), {}))));
      [y0, y1, y2, y3, y4].forEach((y) => {
        const s = fx(d.mendoPe[y]);
        const bg = y === y1 ? heatPe(d.mendoPe[y]) : undefined;
        out.push(cell(s, naIf(s, bg ? { fill: { color: bg } } : {})));
      });
      [y1, y2, y3].forEach((y) => {
        const s = fx(c.model.target_mult[String(y)] ?? null);
        out.push(cell(s, naIf(s, {})));
      });
      [y1, y2, y3].forEach((y) => {
        const s = fp(d.irr[y]);
        const bg = y === y2 ? heatIrr(d.irr[y]) : undefined;
        out.push(cell(s, naIf(s, bg ? { fill: { color: bg } } : {})));
      });
      [y0, y1, y2, y3].forEach((y) => out.push(cell(fx(d.mom[y]), naIf(fx(d.mom[y]), {}))));
      ([pf.m1, pf.m3, pf.m6] as (number | null)[]).forEach((v) => {
        const s = fp(v);
        const bg = heatPerf(v);
        out.push(cell(s, naIf(s, bg ? { fill: { color: bg } } : {})));
      });
      return out;
    };

    order.forEach((g) => {
      rows.push([grpHdr(g)]);
      byGrp[g].forEach((c) => rows.push(valRow(c)));
    });
    if (indexRows.length) {
      rows.push([grpHdr("Index")]);
      indexRows.forEach((c) => {
        const d = derived.get(c.ticker)!;
        const pf = perfOf(c);
        const out: pptxgen.TableCell[] = [cell(c.ticker, { align: "left", bold: true })];
        out.push(cell(fpx(d.price, c.currency), naIf(fpx(d.price, c.currency), {})));
        out.push(cell(""), cell(""));
        [y0, y1, y2, y3, y4].forEach((y) => {
          const v = c.best_pe?.[String(y)];
          out.push(cell(v != null ? fx(v) : ""));
        });
        for (let i = 0; i < 10; i++) out.push(cell(""));
        ([pf.m1, pf.m3, pf.m6] as (number | null)[]).forEach((v) => {
          const s = fp(v);
          const bg = heatPerf(v);
          out.push(cell(s, naIf(s, bg ? { fill: { color: bg } } : {})));
        });
        rows.push(out);
      });
    }

    const cw = colWidths(1.05, 0.6, 20);
    slide.addTable(rows, tableOpts(cw, 6));
  }

  // ---- IRR Decomp screen --------------------------------------------------- //
  function buildDecompSlide() {
    const COLS = 11;
    const yy = (y: number) => String(y).slice(2);
    const slide = eqSlide(
      pptx,
      "Equities Dashboard — IRR Decomp",
      `NTM – YE${yy(y2)} IRR decomposition · '${yy(y0)}–'${yy(y3)} CAGR · ${priceNote}`,
    );

    const grpHdr = (label: string): pptxgen.TableCell =>
      ({ text: label, options: { colspan: COLS, bold: true, color: INK, align: "left", fill: { color: "F2F2F6" }, fontSize: 8 } });

    const h1: pptxgen.TableCell[] = [
      hCell(""),
      hCell(""),
      hCell(`NTM – YE${yy(y2)} IRR Decomp`, 7),
      hCell(`'${yy(y0)}–'${yy(y3)} CAGR`, 2),
    ];
    const h2: pptxgen.TableCell[] = [
      "Company",
      "Px",
      "Revs",
      "Margin",
      "Mendo NI",
      "Yield",
      "EPS + Divs",
      "Multiple",
      "Return",
      "GP",
      "mEPS",
    ].map((l) => hCell(l));

    const rows: pptxgen.TableRow[] = [h1, h2];
    const blueIf = (s: string): pptxgen.TableCellProps => (s === "n/a" ? { color: NA } : { color: BLUE });

    const decompRow = (c: Company): pptxgen.TableCell[] => {
      const d = derived.get(c.ticker)!;
      const dc: Decomp = d.decomp;
      return [
        cell(c.ticker, { align: "left", bold: true, fill: c.port === 1 ? { color: OWNED } : undefined }),
        cell(fpx(d.price, c.currency), naIf(fpx(d.price, c.currency), {})),
        cell(fp(dc.revs), blueIf(fp(dc.revs))),
        cell(fp(dc.margin), naIf(fp(dc.margin), {})),
        cell(fp(dc.ni), blueIf(fp(dc.ni))),
        cell(fp(dc.yld), naIf(fp(dc.yld), {})),
        cell(fp(dc.epsDivs), blueIf(fp(dc.epsDivs))),
        cell(fp(dc.multiple), naIf(fp(dc.multiple), {})),
        cell(fp(dc.ret), naIf(fp(dc.ret), {})),
        cell(fp(d.gpCagr), naIf(fp(d.gpCagr), {})),
        cell(fp(d.mepsCagr), naIf(fp(d.mepsCagr), {})),
      ];
    };

    order.forEach((g) => {
      rows.push([grpHdr(g)]);
      byGrp[g].forEach((c) => rows.push(decompRow(c)));
    });

    const cw = colWidths(1.5, 0.85, 9);
    slide.addTable(rows, tableOpts(cw, 9));
  }
}

// ---- table plumbing -------------------------------------------------------- //
function hCell(text: string, colspan = 1): pptxgen.TableCell {
  return {
    text,
    options: {
      colspan,
      bold: true,
      color: "FFFFFF",
      fill: { color: BRAND },
      align: colspan > 1 || text === "" ? "center" : "right",
      valign: "middle",
      fontSize: colspan > 1 ? 7 : 6.5,
    },
  };
}

function colWidths(labelW: number, pxW: number, numCols: number): number[] {
  const rest = (CONTENT_W - labelW - pxW) / numCols;
  return [labelW, pxW, ...Array(numCols).fill(rest)];
}

function tableOpts(colW: number[], fontSize: number): pptxgen.TableProps {
  return {
    x: MARGIN,
    y: 0.95,
    w: CONTENT_W,
    colW,
    fontFace: "Arial",
    fontSize,
    color: INK,
    align: "right",
    valign: "middle",
    border: { type: "solid", color: "EFEFF3", pt: 0.25 },
    margin: [0, 2, 0, 2],
  };
}

// re-export so the Row type stays available if needed by callers
export type { Row };
