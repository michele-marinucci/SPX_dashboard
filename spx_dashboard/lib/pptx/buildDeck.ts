import fs from "fs";
import path from "path";
import pptxgen from "pptxgenjs";

import { getDashboard, ThreeDateTable, GrowthTable, NtmPeTableData } from "@/lib/data";
import { getTwitterData } from "@/lib/tweets";
import type { MorningNote } from "@/app/morning-news/page";
import morningNewsRaw from "@/data/morning_news.json";
import { addEquitiesSlides } from "./equitiesSlides";
import {
  BRAND,
  CONTENT_W,
  INK,
  MARGIN,
  MUTED,
  Row,
  blueHeat,
  computeScale,
  dividerSlide,
  fmtMoney,
  fmtNum,
  fmtPct,
  fmtSignedMoney,
  paginatedTable,
  rgHeat,
  sectionSlide,
} from "./common";

// ---------------------------------------------------------------------------
// Deterministic "Export All to PPT": one PowerPoint built straight from the
// committed data of every live tool (Equities priced off prior-day closes).
// No LLM — the same inputs always produce the same deck. A brand divider
// introduces each section. The Diligence Tracker is intentionally skipped.
// ---------------------------------------------------------------------------

// ---- shared bullet block --------------------------------------------------- //
function bullets(slide: pptxgen.Slide, items: { title?: string; body: string }[]) {
  const runs: pptxgen.TextProps[] = [];
  items.forEach((it) => {
    if (it.title) {
      runs.push({
        text: it.title,
        options: { bold: true, color: INK, bullet: { code: "2022" }, breakLine: true },
      });
      runs.push({
        text: it.body,
        options: { color: MUTED, indentLevel: 1, paraSpaceAfter: 10, breakLine: true },
      });
    } else {
      runs.push({
        text: it.body,
        options: { color: INK, bullet: { code: "2022" }, paraSpaceAfter: 8, breakLine: true },
      });
    }
  });
  slide.addText(runs, {
    x: MARGIN,
    y: 1.3,
    w: CONTENT_W,
    h: 5.6,
    fontFace: "Arial",
    fontSize: 11,
    valign: "top",
  });
}

// ---- SPX Monitor (Aggregate S&P 500, mirroring components/DataTable.tsx) --- //
//
// Cells reproduce the web tables 1:1: same number formats (lib/format.ts) and
// the same conditional formatting (lib/heatmap.ts) — sequential brand-blue on
// levels, diverging red/green on deltas, with per-column scales computed from
// the category rows only (totals excluded) and totals left unshaded.

const SPX = "SPX Monitor · Aggregate S&P 500";

type HeatKind = "blue" | "rg" | "none";

interface SpxCol {
  label: string;
  group: string;
  fmt: (v: number | null) => string;
  heat: HeatKind;
}

function spxTable(
  pptx: pptxgen,
  subtitle: string,
  cols: SpxCol[],
  rows: { label: string; isTotal: boolean; cells: (number | null)[] }[],
) {
  const scales = cols.map((_, ci) =>
    computeScale(rows.filter((r) => !r.isTotal).map((r) => r.cells[ci] ?? null)),
  );

  // Grouped header band (like the web's group-row) + per-column label row.
  const groupHeader: Row = [{ text: "", options: {} }];
  let i = 0;
  while (i < cols.length) {
    let span = 1;
    while (i + span < cols.length && cols[i + span].group === cols[i].group) span += 1;
    groupHeader.push({ text: cols[i].group, options: { colspan: span } });
    i += span;
  }
  const header: Row = ["", ...cols.map((c) => c.label)];

  const body: Row[] = rows.map((r) => {
    const out: Row = [
      {
        text: r.label,
        options: {
          align: "left",
          bold: r.isTotal,
          fill: r.isTotal ? { color: "EFEFF3" } : undefined,
        },
      },
    ];
    r.cells.forEach((v, ci) => {
      const col = cols[ci];
      const text = col.fmt(v);
      if (r.isTotal) {
        out.push({ text, options: { bold: true, fill: { color: "EFEFF3" } } });
        return;
      }
      if (col.heat === "blue") {
        const h = blueHeat(v, scales[ci]);
        out.push({
          text,
          options: {
            fill: h.fill ? { color: h.fill } : undefined,
            color: h.color,
          },
        });
      } else if (col.heat === "rg") {
        const h = rgHeat(v, scales[ci]);
        out.push({ text, options: { fill: h.fill ? { color: h.fill } : undefined } });
      } else {
        out.push({ text, options: {} });
      }
    });
    return out;
  });

  const labelW = 2.6;
  const numW = (CONTENT_W - labelW) / cols.length;
  paginatedTable(pptx, SPX, subtitle, header, body, {
    colW: [labelW, ...Array(cols.length).fill(numW)],
    rowsPerPage: 20,
    fontSize: 9,
    groupHeader,
  });
}

function threeDateTableSlide(pptx: pptxgen, t: ThreeDateTable, title: string, digits: number) {
  const cols: SpxCol[] = [
    ...t.dates.map((d) => ({
      label: d,
      group: t.value_label,
      fmt: (v: number | null) => fmtMoney(v, digits),
      heat: "blue" as const,
    })),
    { label: "YTD", group: "$ Δ", fmt: (v) => fmtSignedMoney(v, digits), heat: "rg" },
    { label: "QTD", group: "$ Δ", fmt: (v) => fmtSignedMoney(v, digits), heat: "rg" },
    { label: "YTD", group: "% Δ", fmt: (v) => fmtPct(v, 1), heat: "rg" },
    { label: "QTD", group: "% Δ", fmt: (v) => fmtPct(v, 1), heat: "rg" },
  ];
  const rows = t.rows.map((r) => ({
    label: r.label,
    isTotal: r.is_total,
    cells: [...r.values, ...r.delta_abs, ...r.delta_pct],
  }));
  spxTable(pptx, title, cols, rows);
}

function growthTableSlide(pptx: pptxgen, t: GrowthTable) {
  const cols: SpxCol[] = [
    ...t.years.map((y) => ({
      label: y,
      group: t.value_label,
      fmt: (v: number | null) => fmtMoney(v, 1),
      heat: "blue" as const,
    })),
    ...t.delta_years.map((y) => ({
      label: y,
      group: "$ Δ YoY",
      fmt: (v: number | null) => fmtSignedMoney(v, 1),
      heat: "rg" as const,
    })),
    ...t.delta_years.map((y) => ({
      label: y,
      group: "% Δ YoY",
      fmt: (v: number | null) => fmtPct(v, 1),
      heat: "rg" as const,
    })),
  ];
  const rows = t.rows.map((r) => ({
    label: r.label,
    isTotal: r.is_total,
    cells: [...r.values, ...r.delta_abs, ...r.delta_pct],
  }));
  spxTable(pptx, `Earnings Growth · ${t.value_label}`, cols, rows);
}

function ntmPeSlide(pptx: pptxgen, t: NtmPeTableData) {
  const cols: SpxCol[] = [
    { label: "$b", group: "Mkt cap", fmt: (v) => fmtMoney(v, 0), heat: "none" },
    { label: "$b", group: "NTM NI", fmt: (v) => fmtNum(v, 1), heat: "none" },
    {
      label: t.current_label.replace(/[()]/g, ""),
      group: "NTM P/E",
      fmt: (v) => fmtNum(v, 1),
      heat: "blue",
    },
    ...t.avg_dates.map((d) => ({
      label: d,
      group: "Avg P/E since",
      fmt: (v: number | null) => fmtNum(v, 1),
      heat: "blue" as const,
    })),
    ...t.avg_dates.map((d) => ({
      label: d,
      group: "Current vs avg since",
      fmt: (v: number | null) => fmtPct(v, 1),
      heat: "rg" as const,
    })),
  ];
  const rows = t.rows.map((r) => ({
    label: r.label,
    isTotal: r.is_total,
    cells: [r.mkt_cap, r.ntm_ni, r.ntm_pe, ...r.avg_since, ...r.delta_vs_avg],
  }));
  spxTable(pptx, t.title || "NTM P/E", cols, rows);
}

// ---- Twitter Monitor ------------------------------------------------------- //
function twitterSection(pptx: pptxgen) {
  const d = getTwitterData();
  const when = d.generated_at ? new Date(d.generated_at).toLocaleDateString("en-US") : "";
  const s1 = sectionSlide(pptx, "Twitter Monitor", d.daily_summary.headline || `Daily summary ${when}`);
  bullets(
    s1,
    (d.daily_summary.items || []).map((it) => ({
      title: `${it.label}${it.tickers?.length ? `  [${it.tickers.join(", ")}]` : ""}`,
      body: it.summary,
    })),
  );
  if (d.recurring?.length) {
    const s2 = sectionSlide(pptx, "Twitter Monitor", "Recurring topics");
    bullets(
      s2,
      d.recurring.map((r) => ({
        title: `${r.topic} · seen ${r.days_seen}d${r.tickers?.length ? `  [${r.tickers.join(", ")}]` : ""}`,
        body: r.summary,
      })),
    );
  }
}

// ---- Morning News Summary (positions first, then themes) ------------------- //
function morningNewsSection(pptx: pptxgen) {
  const notes = morningNewsRaw as MorningNote[];
  if (!notes?.length) return;
  const latest = [...notes].sort((a, b) => (b.date || "").localeCompare(a.date || ""))[0];
  const dateLabel = latest.date
    ? new Date(latest.date + "T12:00:00").toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "";

  if (latest.positions?.length) {
    const header: Row = [
      { text: "Ticker", options: { align: "left" } },
      { text: "Name", options: { align: "left" } },
      { text: "Notes", options: { align: "left" } },
    ];
    const body: Row[] = latest.positions.map((p) => [
      { text: p.ticker, options: { align: "left", bold: true } },
      { text: p.name || "—", options: { align: "left" } },
      { text: p.notes, options: { align: "left", fontSize: 9 } },
    ]);
    paginatedTable(pptx, "Morning News Summary", `Positions in focus · ${dateLabel}`, header, body, {
      colW: [1.4, 2.6, CONTENT_W - 4.0],
      rowsPerPage: 10,
    });
  }

  const s1 = sectionSlide(pptx, "Morning News Summary", dateLabel);
  const runs: pptxgen.TextProps[] = [];
  if (latest.one_liner) {
    runs.push({
      text: latest.one_liner,
      options: { italic: true, color: INK, fontSize: 12, paraSpaceAfter: 12, breakLine: true },
    });
  }
  (latest.top_themes || []).forEach((th) => {
    runs.push({
      text: th.headline,
      options: { bold: true, color: INK, bullet: { code: "2022" }, breakLine: true },
    });
    runs.push({
      text: th.detail,
      options: { color: MUTED, indentLevel: 1, fontSize: 10, paraSpaceAfter: 10, breakLine: true },
    });
  });
  s1.addText(runs, {
    x: MARGIN,
    y: 1.3,
    w: CONTENT_W,
    h: 5.6,
    fontFace: "Arial",
    fontSize: 11,
    valign: "top",
  });
}

// ---- title ----------------------------------------------------------------- //
function titleSlide(pptx: pptxgen) {
  const slide = pptx.addSlide();
  slide.background = { color: "FFFFFF" };
  const logo = path.join(process.cwd(), "public", "meritage-logo.png");
  if (fs.existsSync(logo)) {
    slide.addImage({ path: logo, x: MARGIN, y: 0.6, w: 3.6, h: 0.586 });
  }
  slide.addText("Mendo Hub", {
    x: MARGIN,
    y: 2.6,
    w: CONTENT_W,
    h: 1,
    fontFace: "Arial",
    fontSize: 44,
    bold: true,
    color: INK,
  });
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  slide.addText(`All live tools · ${today}`, {
    x: MARGIN,
    y: 3.7,
    w: CONTENT_W,
    h: 0.5,
    fontFace: "Arial",
    fontSize: 16,
    color: MUTED,
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: MARGIN,
    y: 4.4,
    w: 2.2,
    h: 0.06,
    fill: { color: BRAND },
    line: { type: "none" },
  });
}

export async function buildHubDeck(): Promise<Buffer> {
  const pptx = new pptxgen();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Mendo Hub";
  pptx.company = "Meritage";
  pptx.title = "Mendo Hub — All live tools";

  titleSlide(pptx);

  // 1) Equities Dashboard — most important, up front. Two screens.
  dividerSlide(pptx, "Equities Dashboard", "Valuation, IRRs & decomposition · prior-day closes");
  await addEquitiesSlides(pptx, new Date());

  // 2) SPX Monitor — Aggregate S&P 500 only.
  dividerSlide(pptx, "SPX Monitor", "Aggregate S&P 500");
  const t = getDashboard().tables;
  threeDateTableSlide(pptx, t.stock_performance, "Stock Performance · Market cap ($b)", 0);
  growthTableSlide(pptx, t.earnings_growth);
  threeDateTableSlide(pptx, t.est_rev_2026, "Estimate Revisions · 2026 ($b)", 1);
  threeDateTableSlide(pptx, t.est_rev_2027, "Estimate Revisions · 2027 ($b)", 1);
  ntmPeSlide(pptx, t.ntm_pe);

  // 3) Twitter Monitor.
  dividerSlide(pptx, "Twitter Monitor", "Daily summary & recurring topics");
  twitterSection(pptx);

  // 4) Morning News Summary.
  dividerSlide(pptx, "Morning News Summary", "Pre-market digest");
  morningNewsSection(pptx);

  const out = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  return out;
}
