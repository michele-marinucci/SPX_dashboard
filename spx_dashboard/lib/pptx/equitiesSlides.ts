import pptxgen from "pptxgenjs";

import { compute, Decomp, Derived, displayYears } from "@/lib/equities/calc";
import { loadCompanies, loadQuotes, latestDataDate } from "@/lib/equities/load";
import { Company, Quote } from "@/lib/equities/types";
import { CONTENT_W, FONT, FOOTER_Y, INK, MARGIN, MASTER_CONTENT, MUTED, NAVY } from "./common";

// Faithful PowerPoint of the Equities Dashboard — the two screens the web page
// shows (Valuation/IRR "Summary" and the "IRR Decomp"), same columns, same
// Excel-style heatmaps and owned-name shading, ordered by the 2028 IRR within
// each sector, priced off the prior-day closes the page itself uses.
//
// Deck-only deviations on the IRR Decomp (per the template spec): every
// percentage prints in black with no decimals (the web shows some columns in
// blue at 1dp), and the Return column carries the same yellow→green heat the
// Summary applies to its IRR column.
//
// Geometry note: every row gets an explicit height sized so the whole table
// fits the 7.5" slide — PowerPoint only honors row heights as minimums, so the
// font sizes are chosen to fit inside them.

// ---- heatmaps (ported 1:1 from components/EquitiesApp.tsx) ----------------- //
type RGB = [number, number, number];
const RED: RGB = [248, 105, 107];
const YELLOW: RGB = [255, 235, 132];
const GREEN: RGB = [99, 190, 123];
const WHITE: RGB = [255, 255, 255];
const OWNED = "D9EFDC"; // .eq-tick-own
const NA = "A6A6B2"; // .eq-na faint
const GRP_FILL = "F2F2F6";

function hex(c: RGB): string {
  return c.map((x) => Math.round(x).toString(16).padStart(2, "0")).join("").toUpperCase();
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
function fp0(v: number | null | undefined): string {
  return v == null ? "n/a" : `${(v * 100).toFixed(0)}%`;
}
function fpx(v: number | null | undefined, ccy: string): string {
  if (v == null) return "n/a";
  const s = v.toLocaleString("en-US", {
    minimumFractionDigits: v >= 1000 ? 0 : 2,
    maximumFractionDigits: v >= 1000 ? 0 : 2,
  });
  return `${ccy}${s}`;
}

// A very compact slide header, leaving maximum room for the table.
function eqSlide(pptx: pptxgen, title: string, subtitle: string): pptxgen.Slide {
  const slide = pptx.addSlide({ masterName: MASTER_CONTENT });
  slide.addText(title, {
    x: MARGIN,
    y: 0.1,
    w: 7.5,
    h: 0.34,
    fontFace: FONT,
    fontSize: 16,
    bold: true,
    color: NAVY,
  });
  slide.addText(subtitle, {
    x: 8.1,
    y: 0.14,
    w: PAGE_W_SAFE - 8.1,
    h: 0.3,
    fontFace: FONT,
    fontSize: 8.5,
    color: MUTED,
    align: "right",
  });
  return slide;
}
const PAGE_W_SAFE = 13.33 - 0.25;

type TCell = pptxgen.TableCell;

function cell(text: string, opts: pptxgen.TableCellProps = {}): TCell {
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
  const retStats = stats(stocks.map((c) => derived.get(c.ticker)?.decomp.ret ?? null));
  const heatRet = (v: number | null) =>
    v != null && retStats ? scale3(v, retStats.lo, retStats.mid, retStats.hi, [YELLOW, YELLOW, GREEN]) : undefined;
  const heatPerf = (v: number | null) =>
    v == null ? undefined : scale3(v, -0.3, 0, 0.3, [RED, WHITE, GREEN]);

  const dataDate = latestDataDate(quotes);
  const sources = Array.from(
    new Set(
      Object.values(quotes)
        .map((q) => q.source)
        .filter((s): s is string => !!s),
    ),
  ).sort();
  const srcLabel = sources.length ? sources.join(" + ") : "";
  const priceNote = `${srcLabel ? `${srcLabel} · ` : ""}${
    dataDate ? `prices as of prior close ${dataDate}` : "prices as of prior close"
  }`;

  buildValSlide();
  buildDecompSlide();

  // ---- Summary (Valuation / IRR) screen ------------------------------------ //
  function buildValSlide() {
    const slide = eqSlide(
      pptx,
      "Equities Dashboard — Summary",
      `${stocks.length} names · ${stocks.filter((c) => c.port === 1).length} owned · ${priceNote}`,
    );

    const h1Opts: pptxgen.TableCellProps = {
      bold: true,
      color: "FFFFFF",
      fill: { color: NAVY },
      align: "center",
      valign: "middle",
      fontSize: 6.5,
    };
    const h1: TCell[] = [
      cell("", h1Opts),
      cell("", h1Opts),
      cell("EV / GP", { ...h1Opts, colspan: 2 }),
      cell("Mendo P/E", { ...h1Opts, colspan: 5 }),
      cell("Target Mult (GP or P/E)", { ...h1Opts, colspan: 3 }),
      cell("IRR", { ...h1Opts, colspan: 3 }),
      cell("MoM", { ...h1Opts, colspan: 4 }),
      cell("Recent Performance", { ...h1Opts, colspan: 3 }),
    ];
    const h2Opts: pptxgen.TableCellProps = {
      bold: true,
      color: "FFFFFF",
      fill: { color: NAVY },
      align: "right",
      valign: "middle",
      fontSize: 6.5,
    };
    const h2: TCell[] = [
      cell("Company", { ...h2Opts, align: "left" }),
      cell("Px", h2Opts),
      ...[y0, y1].map((y) => cell(String(y), h2Opts)),
      ...[y0, y1, y2, y3, y4].map((y) => cell(String(y), h2Opts)),
      ...[y1, y2, y3].map((y) => cell(String(y), h2Opts)),
      ...[y1, y2, y3].map((y) => cell(String(y), h2Opts)),
      ...[y0, y1, y2, y3].map((y) => cell(String(y), h2Opts)),
      cell("1M", h2Opts),
      cell("3M", h2Opts),
      cell("6M", h2Opts),
    ];

    const rows: pptxgen.TableRow[] = [h1, h2];

    const grpRow = (label: string): TCell[] => [
      cell(label, { colspan: 22, bold: true, color: INK, align: "left", fill: { color: GRP_FILL }, fontSize: 6.5 }),
    ];

    const valRow = (c: Company): TCell[] => {
      const d = derived.get(c.ticker)!;
      const pf = perfOf(c);
      const out: TCell[] = [
        cell(c.ticker, {
          align: "left",
          bold: true,
          fill: c.port === 1 ? { color: OWNED } : undefined,
        }),
      ];
      const px = fpx(d.price, c.currency);
      out.push(cell(px, naIf(px, {})));
      [y0, y1].forEach((y) => {
        const s = fx(d.evGp[y]);
        out.push(cell(s, naIf(s, {})));
      });
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
      [y0, y1, y2, y3].forEach((y) => {
        const s = fx(d.mom[y]);
        out.push(cell(s, naIf(s, {})));
      });
      ([pf.m1, pf.m3, pf.m6] as (number | null)[]).forEach((v) => {
        const s = fp(v);
        const bg = heatPerf(v);
        out.push(cell(s, naIf(s, bg ? { fill: { color: bg } } : {})));
      });
      return out;
    };

    order.forEach((g) => {
      rows.push(grpRow(g));
      byGrp[g].forEach((c) => rows.push(valRow(c)));
    });
    if (indexRows.length) {
      rows.push(grpRow("Index"));
      indexRows.forEach((c) => {
        const d = derived.get(c.ticker)!;
        const pf = perfOf(c);
        const out: TCell[] = [cell(c.ticker, { align: "left", bold: true })];
        const px = fpx(d.price, c.currency);
        out.push(cell(px, naIf(px, {})));
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

    // Fit: title strip is 0.52" tall; size every row so the table ends above
    // the footer band. 46 rows → ~0.14" each; 6.5pt text + 1pt margins fits.
    const tableTop = 0.52;
    const rowH = Math.floor(((FOOTER_Y - tableTop - 0.05) / rows.length) * 1000) / 1000;
    const numW = (CONTENT_W - 1.0 - 0.62) / 20;
    slide.addTable(rows, {
      x: MARGIN,
      y: tableTop,
      w: CONTENT_W,
      colW: [1.0, 0.62, ...Array(20).fill(numW)],
      rowH,
      fontFace: FONT,
      fontSize: 6.5,
      color: INK,
      align: "right",
      valign: "middle",
      border: { type: "solid", color: "EFEFF3", pt: 0.25 },
      margin: [1, 2, 1, 2],
    });
  }

  // ---- IRR Decomp screen --------------------------------------------------- //
  function buildDecompSlide() {
    const yy = (y: number) => String(y).slice(2);
    const slide = eqSlide(
      pptx,
      "Equities Dashboard — IRR Decomp",
      `NTM – YE${yy(y2)} IRR decomposition · '${yy(y0)}–'${yy(y3)} CAGR · ${priceNote}`,
    );

    const h1Opts: pptxgen.TableCellProps = {
      bold: true,
      color: "FFFFFF",
      fill: { color: NAVY },
      align: "center",
      valign: "middle",
      fontSize: 8,
    };
    const h1: TCell[] = [
      cell("", h1Opts),
      cell("", h1Opts),
      cell(`NTM – YE${yy(y2)} IRR Decomp`, { ...h1Opts, colspan: 7 }),
      cell(`'${yy(y0)}–'${yy(y3)} CAGR`, { ...h1Opts, colspan: 2 }),
    ];
    const h2Opts: pptxgen.TableCellProps = {
      bold: true,
      color: "FFFFFF",
      fill: { color: NAVY },
      align: "right",
      valign: "middle",
      fontSize: 8,
    };
    const h2: TCell[] = [
      cell("Company", { ...h2Opts, align: "left" }),
      ...["Px", "Revs", "Margin", "Mendo NI", "Yield", "EPS + Divs", "Multiple", "Return", "GP", "mEPS"].map(
        (l) => cell(l, h2Opts),
      ),
    ];

    const rows: pptxgen.TableRow[] = [h1, h2];

    const grpRow = (label: string): TCell[] => [
      cell(label, { colspan: 11, bold: true, color: INK, align: "left", fill: { color: GRP_FILL }, fontSize: 8 }),
    ];

    const decompRow = (c: Company): TCell[] => {
      const d = derived.get(c.ticker)!;
      const dc: Decomp = d.decomp;
      const px = fpx(d.price, c.currency);
      const pct = (v: number | null, opts: pptxgen.TableCellProps = {}): TCell =>
        cell(fp0(v), naIf(fp0(v), opts));
      const retBg = heatRet(dc.ret);
      return [
        cell(c.ticker, {
          align: "left",
          bold: true,
          fill: c.port === 1 ? { color: OWNED } : undefined,
        }),
        cell(px, naIf(px, {})),
        pct(dc.revs),
        pct(dc.margin),
        pct(dc.ni),
        pct(dc.yld),
        pct(dc.epsDivs),
        pct(dc.multiple),
        pct(dc.ret, retBg ? { fill: { color: retBg } } : {}),
        pct(d.gpCagr),
        pct(d.mepsCagr),
      ];
    };

    order.forEach((g) => {
      rows.push(grpRow(g));
      byGrp[g].forEach((c) => rows.push(decompRow(c)));
    });

    const tableTop = 0.52;
    const rowH = Math.floor(((FOOTER_Y - tableTop - 0.05) / rows.length) * 1000) / 1000;
    const numW = (CONTENT_W - 1.5 - 0.85) / 9;
    slide.addTable(rows, {
      x: MARGIN,
      y: tableTop,
      w: CONTENT_W,
      colW: [1.5, 0.85, ...Array(9).fill(numW)],
      rowH,
      fontFace: FONT,
      fontSize: 8,
      color: INK,
      align: "right",
      valign: "middle",
      border: { type: "solid", color: "EFEFF3", pt: 0.25 },
      margin: [1, 2, 1, 2],
    });
  }
}
