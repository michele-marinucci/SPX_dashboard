import pptxgen from "pptxgenjs";

import { DashboardData, ThreeDateTable, GrowthTable, NtmPeTableData } from "@/lib/data";
import { loadSpxDashboard } from "@/lib/spxLive";
import { getTwitterData } from "@/lib/tweets";
import { spxSection, TOOL_NAMES } from "@/lib/toolMeta";
import type { MorningNote } from "@/app/morning-news/page";
import morningNewsRaw from "@/data/morning_news.json";
import { addEquitiesSlides } from "./equitiesSlides";
import {
  ACCENT,
  CONFIDENTIAL,
  CONTENT_W,
  FONT,
  FOOTER_Y,
  INK,
  MARGIN,
  MUTED,
  NAVY,
  PAGE_H,
  PAGE_W,
  Row,
  blueHeat,
  computeScale,
  defineMasters,
  dividerSlide,
  fmtMoney,
  fmtNum,
  fmtPct,
  fmtSignedMoney,
  logoFile,
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
      // Title + body live in ONE bulleted paragraph: the body is a soft line
      // break (softBreakBefore), so it inherits the bullet's hanging indent and
      // sits under the title. A plain `indentLevel` run with no bullet gets no
      // left margin from PowerPoint and renders flush-left — the old bug.
      runs.push({
        text: it.title,
        options: {
          bold: true,
          color: INK,
          bullet: { code: "2022" },
          paraSpaceBefore: 6,
          paraSpaceAfter: 8,
        },
      });
      runs.push({
        text: it.body,
        options: { color: MUTED, fontSize: 10, softBreakBefore: true, breakLine: true },
      });
    } else {
      runs.push({
        text: it.body,
        options: { color: INK, bullet: { code: "2022" }, paraSpaceAfter: 6, breakLine: true },
      });
    }
  });
  slide.addText(runs, {
    x: MARGIN,
    y: 1.3,
    w: CONTENT_W,
    h: 5.6,
    fontFace: FONT,
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

const SPX = TOOL_NAMES.spx;

type HeatKind = "blue" | "rg" | "none";

// Within the AI-capex-beneficiary categories only — the rows above the first
// subtotal ("Total AI Capex Beneficiaries") — each SPX page is ordered by its
// own headline column, descending (nulls last). Everything from that subtotal
// down keeps the workbook order. Returns a new array; never mutates the
// dashboard data.
function sortAiCapex<R extends { isTotal: boolean }>(
  rows: R[],
  key: (r: R) => number | null,
): R[] {
  const cut = rows.findIndex((r) => r.isTotal);
  if (cut <= 0) return rows;
  const head = [...rows.slice(0, cut)].sort(
    (a, b) =>
      (key(b) ?? Number.NEGATIVE_INFINITY) - (key(a) ?? Number.NEGATIVE_INFINITY),
  );
  return [...head, ...rows.slice(cut)];
}

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
  // Blue (level) shading is reserved for the AI-beneficiary categories — the
  // rows above the first subtotal ("Total AI Capex Beneficiaries"). Everything
  // from that subtotal down (funders, software, Other, SPX total) stays plain.
  const firstTotalIdx = rows.findIndex((r) => r.isTotal);
  const blueCutoff = firstTotalIdx === -1 ? rows.length : firstTotalIdx;
  const blueRows = rows.slice(0, blueCutoff);
  const scales = cols.map((col, ci) => {
    const pool = col.heat === "blue" ? blueRows : rows.filter((r) => !r.isTotal);
    return computeScale(pool.map((r) => r.cells[ci] ?? null));
  });

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

  const body: Row[] = rows.map((r, ri) => {
    const out: Row = [
      {
        text: r.label,
        options: {
          align: "left",
          bold: r.isTotal,
          fill: r.isTotal ? { color: "F7F7F7" } : undefined,
        },
      },
    ];
    r.cells.forEach((v, ci) => {
      const col = cols[ci];
      const text = col.fmt(v);
      if (r.isTotal) {
        out.push({ text, options: { bold: true, fill: { color: "F7F7F7" } } });
        return;
      }
      if (col.heat === "blue" && ri < blueCutoff) {
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

function threeDateTableSlide(
  pptx: pptxgen,
  t: ThreeDateTable,
  title: string,
  digits: number,
  sortBy: "absYtd" | "pctYtd",
) {
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
  const rows = sortAiCapex(
    t.rows.map((r) => ({
      label: r.label,
      isTotal: r.is_total,
      cells: [...r.values, ...r.delta_abs, ...r.delta_pct],
    })),
    (r) => (sortBy === "absYtd" ? r.cells[t.dates.length] : r.cells[t.dates.length + 2]),
  );
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
  // Sorted by the 2026 $ earnings growth ($ Δ YoY 2026 vs 2025).
  const idx2026 = t.delta_years.indexOf("2026");
  const rows = sortAiCapex(
    t.rows.map((r) => ({
      label: r.label,
      isTotal: r.is_total,
      cells: [...r.values, ...r.delta_abs, ...r.delta_pct],
    })),
    (r) => (idx2026 === -1 ? null : r.cells[t.years.length + idx2026]),
  );
  spxTable(pptx, `${spxSection("growth").title} · ${spxSection("growth").note}`, cols, rows);
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
  // Sorted by market cap.
  const rows = sortAiCapex(
    t.rows.map((r) => ({
      label: r.label,
      isTotal: r.is_total,
      cells: [r.mkt_cap, r.ntm_ni, r.ntm_pe, ...r.avg_since, ...r.delta_vs_avg],
    })),
    (r) => r.cells[0],
  );
  spxTable(pptx, spxSection("pe").title, cols, rows);
}

// ---- AI beneficiaries: each category with its member companies ------------- //
function aiCategoriesSlide(pptx: pptxgen, d: DashboardData) {
  const grp =
    d.tables.categories.groups.find((g) => g.group === "AI Capex Beneficiaries") ??
    d.tables.categories.groups[0];
  if (!grp) return;
  const cats = grp.categories.filter((c) => c.members.length > 0);
  if (!cats.length) return;
  const slide = sectionSlide(pptx, SPX, `${grp.group} · categories & constituents`);
  const nCols = Math.min(5, Math.max(1, Math.ceil(cats.length / 2)));
  const nRows = Math.ceil(cats.length / nCols);
  const top = 1.25;
  const cellW = CONTENT_W / nCols;
  const cellH = (FOOTER_Y - top - 0.1) / nRows;
  cats.forEach((c, i) => {
    const runs: pptxgen.TextProps[] = [
      {
        text: c.category,
        options: { bold: true, color: NAVY, fontSize: 10.5, paraSpaceAfter: 4, breakLine: true },
      },
      ...c.members.map((m) => ({
        text: m,
        options: { color: INK, fontSize: 8.5, paraSpaceAfter: 2, breakLine: true },
      })),
    ];
    slide.addText(runs, {
      x: MARGIN + (i % nCols) * cellW,
      y: top + Math.floor(i / nCols) * cellH,
      w: cellW - 0.2,
      h: cellH,
      fontFace: FONT,
      valign: "top",
    });
  });
}

// ---- Twitter Themes --------------------------------------------------------- //
function twitterSection(pptx: pptxgen) {
  const d = getTwitterData();
  const when = d.generated_at ? new Date(d.generated_at).toLocaleDateString("en-US") : "";
  const s1 = sectionSlide(pptx, TOOL_NAMES.twitter, d.daily_summary.headline || `Daily summary ${when}`);
  bullets(
    s1,
    (d.daily_summary.items || []).map((it) => ({
      title: `${it.label}${it.tickers?.length ? `  [${it.tickers.join(", ")}]` : ""}`,
      body: it.summary || (it.points ?? []).map((p) => p.text).join("  "),
    })),
  );
  if (d.recurring?.length) {
    const s2 = sectionSlide(pptx, TOOL_NAMES.twitter, "Recurring topics");
    bullets(
      s2,
      d.recurring.map((r) => ({
        title: `${r.topic} · seen ${r.days_seen}d${r.tickers?.length ? `  [${r.tickers.join(", ")}]` : ""}`,
        body: r.summary,
      })),
    );
  }
}

// ---- Morning Notes --------------------------------------------------------- //
//
// Every weekday note (Mon–Fri) of the week the latest note belongs to, each
// rendered with the same depth the web page shows — headline + key points +
// sub-details — and split across as many slides as the content needs so it is
// never clipped off the bottom of a slide.

// Monday (UTC) of the week containing the given YYYY-MM-DD date.
function mondayOf(iso: string): Date {
  const d = new Date(iso + "T12:00:00Z");
  const back = (d.getUTCDay() + 6) % 7; // days since Monday (Sun→6)
  d.setUTCDate(d.getUTCDate() - back);
  return d;
}

function morningNewsSection(pptx: pptxgen) {
  const notes = morningNewsRaw as MorningNote[];
  if (!notes?.length) return;
  const sorted = [...notes].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const latest = sorted[sorted.length - 1];
  if (!latest?.date) return;

  const monday = mondayOf(latest.date);
  const weekIso = Array.from({ length: 5 }, (_, i) => {
    const d = new Date(monday);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
  const byDate = new Map(sorted.map((n) => [n.date, n]));
  const week = weekIso.map((iso) => byDate.get(iso)).filter((n): n is MorningNote => !!n);
  (week.length ? week : [latest]).forEach((note) => addMorningNoteSlides(pptx, note));
}

function addMorningNoteSlides(pptx: pptxgen, note: MorningNote) {
  const dateLabel = note.date
    ? new Date(note.date + "T12:00:00").toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "";

  // Positions in focus — one paginated table per day.
  if (note.positions?.length) {
    const header: Row = [
      { text: "Ticker", options: { align: "left" } },
      { text: "Name", options: { align: "left" } },
      { text: "Notes", options: { align: "left" } },
    ];
    const body: Row[] = note.positions.map((p) => [
      { text: p.ticker, options: { align: "left", bold: true } },
      { text: p.name || "—", options: { align: "left" } },
      { text: p.notes, options: { align: "left", fontSize: 9 } },
    ]);
    paginatedTable(pptx, TOOL_NAMES.morningNews, `Positions in focus · ${dateLabel}`, header, body, {
      colW: [1.4, 2.6, CONTENT_W - 4.0],
      rowsPerPage: 10,
    });
  }

  // Themes — nested bullets: headline · key points · sub-details. Each level is
  // a real bullet so PowerPoint applies the hanging indent (a plain indentLevel
  // run with no bullet gets no left margin and floats flush-left). Spacing is
  // tight so a day's note stays dense — usually one slide — instead of sprawling
  // with whitespace.
  const estLines = (s: string, perLine = 100) => Math.max(1, Math.ceil((s?.length || 0) / perLine));
  const blocks: { runs: pptxgen.TextProps[]; lines: number }[] = [];

  if (note.one_liner) {
    blocks.push({
      runs: [
        {
          text: note.one_liner,
          options: { italic: true, color: INK, fontSize: 11.5, paraSpaceAfter: 8, breakLine: true },
        },
      ],
      lines: estLines(note.one_liner) + 1,
    });
  }

  (note.top_themes || []).forEach((th) => {
    const runs: pptxgen.TextProps[] = [
      {
        text: th.headline,
        options: {
          bold: true,
          color: INK,
          bullet: { code: "2022" },
          fontSize: 11.5,
          paraSpaceBefore: 8,
          paraSpaceAfter: 2,
          breakLine: true,
        },
      },
    ];
    let lines = estLines(th.headline) + 1;
    // Prefer the structured points (what the web page renders); fall back to
    // the legacy single-paragraph `detail` for older notes.
    const points = th.points?.length
      ? th.points
      : th.detail
      ? [{ text: th.detail, details: [] as string[] }]
      : [];
    points.forEach((pt) => {
      runs.push({
        text: pt.text,
        options: {
          color: INK,
          bullet: { code: "2013" },
          indentLevel: 1,
          fontSize: 10,
          paraSpaceAfter: 2,
          breakLine: true,
        },
      });
      lines += estLines(pt.text);
      (pt.details || []).forEach((sub) => {
        runs.push({
          text: sub,
          options: {
            color: MUTED,
            bullet: { code: "00B7" },
            indentLevel: 2,
            fontSize: 9,
            paraSpaceAfter: 1,
            breakLine: true,
          },
        });
        lines += estLines(sub);
      });
    });
    blocks.push({ runs, lines: lines + 1 });
  });

  const BUDGET = 32; // ~lines that fit the 5.6" content box at these sizes
  let cur: pptxgen.TextProps[] = [];
  let used = 0;
  const flush = () => {
    if (!cur.length) return;
    const s = sectionSlide(pptx, TOOL_NAMES.morningNews, dateLabel);
    s.addText(cur, { x: MARGIN, y: 1.3, w: CONTENT_W, h: 5.6, fontFace: FONT, fontSize: 11, valign: "top" });
    cur = [];
    used = 0;
  };
  blocks.forEach((b) => {
    if (used > 0 && used + b.lines > BUDGET) flush();
    cur.push(...b.runs);
    used += b.lines;
  });
  flush();

  // Keep the week complete even for a day with no themes.
  if (!blocks.length) {
    const s = sectionSlide(pptx, TOOL_NAMES.morningNews, dateLabel);
    s.addText("No themes for this day.", {
      x: MARGIN,
      y: 1.3,
      w: CONTENT_W,
      h: 1,
      fontFace: FONT,
      fontSize: 11,
      color: MUTED,
    });
  }
}

// ---- title ----------------------------------------------------------------- //
function titleSlide(pptx: pptxgen, dateLabel: string) {
  const slide = pptx.addSlide();
  slide.background = { color: "FFFFFF" };
  const logo = logoFile("meritage-logo.png");
  if (logo) {
    slide.addImage({ path: logo, x: MARGIN, y: 0.6, w: 3.6, h: 0.586 });
  }
  slide.addText(
    [
      { text: CONFIDENTIAL, options: { breakLine: true } },
      { text: `As of ${dateLabel}`, options: {} },
    ],
    {
      x: PAGE_W - MARGIN - 3.4,
      y: 0.6,
      w: 3.4,
      h: 0.5,
      fontFace: FONT,
      fontSize: 10,
      color: MUTED,
      align: "right",
      valign: "top",
    },
  );
  slide.addText(TOOL_NAMES.hub, {
    x: MARGIN,
    y: 2.6,
    w: CONTENT_W,
    h: 1,
    fontFace: FONT,
    fontSize: 44,
    bold: true,
    color: NAVY,
  });
  slide.addText(dateLabel, {
    x: MARGIN,
    y: 3.7,
    w: CONTENT_W,
    h: 0.5,
    fontFace: FONT,
    fontSize: 16,
    color: MUTED,
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: MARGIN + 0.02,
    y: 4.4,
    w: 1.1,
    h: 0.05,
    fill: { color: ACCENT },
    line: { type: "none" },
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: PAGE_H - 0.18,
    w: PAGE_W,
    h: 0.18,
    fill: { color: NAVY },
    line: { type: "none" },
  });
}

export async function buildHubDeck(): Promise<Buffer> {
  const pptx = new pptxgen();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = TOOL_NAMES.hub;
  pptx.company = "Meritage";
  pptx.title = TOOL_NAMES.hub;

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  defineMasters(pptx, today);

  titleSlide(pptx, today);

  // 1) Equities Dashboard — most important, up front. Two screens.
  dividerSlide(pptx, TOOL_NAMES.equities, "Valuation, IRRs & decomposition · prior-day closes");
  await addEquitiesSlides(pptx, new Date());

  // 2) SPX Monitor (live-overlaid like the web page). Page order mirrors /spx
  // (lib/toolMeta.ts), then the AI-beneficiary categories with their members.
  dividerSlide(pptx, TOOL_NAMES.spx, "AI beneficiary & software tracker");
  const spxData = await loadSpxDashboard();
  const t = spxData.tables;
  const sec = (id: string) => {
    const s = spxSection(id);
    return `${s.title} · ${s.note}`;
  };
  threeDateTableSlide(pptx, t.stock_performance, sec("performance"), 0, "absYtd");
  growthTableSlide(pptx, t.earnings_growth);
  threeDateTableSlide(pptx, t.est_rev_2026, sec("rev2026"), 1, "pctYtd");
  threeDateTableSlide(pptx, t.est_rev_2027, sec("rev2027"), 1, "pctYtd");
  ntmPeSlide(pptx, t.ntm_pe);
  aiCategoriesSlide(pptx, spxData);

  // 3) Twitter Themes.
  dividerSlide(pptx, TOOL_NAMES.twitter, "Daily summary & recurring topics");
  twitterSection(pptx);

  // 4) Morning Notes.
  dividerSlide(pptx, TOOL_NAMES.morningNews, "Pre-market digest");
  morningNewsSection(pptx);

  const out = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  return out;
}
