import fs from "fs";
import path from "path";
import pptxgen from "pptxgenjs";

import { getDashboard, ThreeDateTable, GrowthTable, NtmPeTableData } from "@/lib/data";
import { getTwitterData } from "@/lib/tweets";
import { getDiligenceLinks } from "@/lib/diligence";
import { seedCompanies } from "@/lib/equities/seed";
import type { MorningNote } from "@/app/morning-news/page";
import morningNewsRaw from "@/data/morning_news.json";

// ---------------------------------------------------------------------------
// Deterministic "Export All to PPT": one PowerPoint built straight from the
// committed data of every live tool. No LLM — the same inputs always produce
// the same deck.
// ---------------------------------------------------------------------------

const BRAND = "3730E6";
const INK = "1A1A22";
const MUTED = "71717F";
const LINE = "E2E2EA";
const HEADER_TXT = "FFFFFF";

// ---- number formatting ----------------------------------------------------- //
function num(v: number | null | undefined, digits = 0): string {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
function signed(v: number | null | undefined, digits = 0): string {
  if (v == null || Number.isNaN(v)) return "—";
  const s = num(Math.abs(v), digits);
  return v < 0 ? `(${s})` : v > 0 ? `+${s}` : s;
}
function pct(v: number | null | undefined, digits = 1): string {
  if (v == null || Number.isNaN(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}%`;
}
function latestYearVal(map: Record<string, number> | undefined): number | null {
  if (!map) return null;
  const years = Object.keys(map)
    .map(Number)
    .filter((n) => !Number.isNaN(n))
    .sort((a, b) => a - b);
  if (!years.length) return null;
  const v = map[String(years[years.length - 1])];
  return typeof v === "number" ? v : null;
}

type Cell = string | { text: string; options?: pptxgen.TableCellProps };
type Row = Cell[];

// ---------------------------------------------------------------------------
// Slide scaffolding
// ---------------------------------------------------------------------------
const PAGE_W = 13.33; // LAYOUT_WIDE inches
const MARGIN = 0.5;
const CONTENT_W = PAGE_W - MARGIN * 2;

function sectionSlide(
  pptx: pptxgen,
  title: string,
  subtitle: string,
): pptxgen.Slide {
  const slide = pptx.addSlide();
  slide.background = { color: "FFFFFF" };
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: 0.18,
    h: 7.5,
    fill: { color: BRAND },
    line: { type: "none" },
  });
  slide.addText(title, {
    x: MARGIN,
    y: 0.32,
    w: CONTENT_W - 1.2,
    h: 0.55,
    fontFace: "Arial",
    fontSize: 24,
    bold: true,
    color: INK,
  });
  slide.addText(subtitle, {
    x: MARGIN,
    y: 0.86,
    w: CONTENT_W - 1.2,
    h: 0.3,
    fontFace: "Arial",
    fontSize: 11,
    color: MUTED,
  });
  return slide;
}

function toCell(c: Cell): pptxgen.TableCell {
  return typeof c === "string" ? { text: c } : { text: c.text, options: c.options };
}

function chunk<T>(arr: T[], size: number): T[][] {
  if (arr.length === 0) return [[]];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Deterministic table rendering with manual pagination: rows are split into
// fixed-size pages (header repeated on each) so we never rely on pptxgenjs's
// auto-pagination, which over-splits. One section slide per page.
function paginatedTable(
  pptx: pptxgen,
  title: string,
  subtitle: string,
  header: string[],
  body: Row[],
  opts: { colW?: number[]; rowsPerPage?: number; fontSize?: number } = {},
) {
  const { colW, rowsPerPage = 20, fontSize = 9 } = opts;
  const pages = chunk(body, rowsPerPage);
  const headRow: Row = header.map((h) => ({
    text: h,
    options: {
      bold: true,
      color: HEADER_TXT,
      fill: { color: BRAND },
      align: "center" as const,
      valign: "middle" as const,
    },
  }));
  pages.forEach((rows, i) => {
    const sub = pages.length > 1 ? `${subtitle}  (${i + 1}/${pages.length})` : subtitle;
    const slide = sectionSlide(pptx, title, sub);
    const trows: pptxgen.TableRow[] = [headRow, ...rows].map((r) => r.map(toCell));
    slide.addTable(trows, {
      x: MARGIN,
      y: 1.3,
      w: CONTENT_W,
      colW,
      fontFace: "Arial",
      fontSize,
      color: INK,
      border: { type: "solid", color: LINE, pt: 0.5 },
      align: "right",
      valign: "middle",
      margin: [2, 4, 2, 4],
    });
  });
}

// Column widths: a fixed label column, the rest split evenly across CONTENT_W.
function cols(labelW: number, n: number): number[] {
  const even = (CONTENT_W - labelW) / n;
  return [labelW, ...Array(n).fill(even)];
}

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

// ---------------------------------------------------------------------------
// Tool sections
// ---------------------------------------------------------------------------
function rowFill(cells: Row, r: { is_total: boolean }) {
  if (r.is_total)
    cells.forEach(
      (c) =>
        typeof c === "object" &&
        (c.options = { ...c.options, fill: { color: "EFEFF3" }, bold: true }),
    );
}

function threeDateTableSlide(pptx: pptxgen, t: ThreeDateTable, title: string, digits: number) {
  const header = [
    "",
    ...t.dates.map((d) => `${d}`),
    "$Δ YTD",
    "$Δ QTD",
    "%Δ YTD",
    "%Δ QTD",
  ];
  const body: Row[] = t.rows.map((r) => {
    const cells: Row = [
      { text: r.label, options: { align: "left", bold: r.is_total } },
    ];
    r.values.forEach((v) => cells.push(num(v, digits)));
    cells.push(signed(r.delta_abs[0], digits));
    cells.push(signed(r.delta_abs[1], digits));
    cells.push(pct(r.delta_pct[0]));
    cells.push(pct(r.delta_pct[1]));
    rowFill(cells, r);
    return cells;
  });
  paginatedTable(pptx, "SPX Monitor", title, header, body, {
    colW: cols(3.0, header.length - 1),
  });
}

function growthTableSlide(pptx: pptxgen, t: GrowthTable) {
  const header = ["", ...t.years, ...t.delta_years.map((y) => `%Δ ${y}`)];
  const body: Row[] = t.rows.map((r) => {
    const cells: Row = [{ text: r.label, options: { align: "left", bold: r.is_total } }];
    r.values.forEach((v) => cells.push(num(v, 1)));
    r.delta_pct.forEach((v) => cells.push(pct(v)));
    rowFill(cells, r);
    return cells;
  });
  paginatedTable(pptx, "SPX Monitor", `Earnings Growth · ${t.value_label}`, header, body, {
    colW: cols(3.0, header.length - 1),
  });
}

function ntmPeSlide(pptx: pptxgen, t: NtmPeTableData) {
  const header = ["", "Mkt Cap", "NTM NI", "NTM P/E", ...t.avg_dates.map((d) => `Avg ${d}`)];
  const body: Row[] = t.rows.map((r) => {
    const cells: Row = [{ text: r.label, options: { align: "left", bold: r.is_total } }];
    cells.push(num(r.mkt_cap, 0));
    cells.push(num(r.ntm_ni, 1));
    cells.push(num(r.ntm_pe, 1));
    r.avg_since.forEach((v) => cells.push(num(v, 1)));
    rowFill(cells, r);
    return cells;
  });
  paginatedTable(pptx, "SPX Monitor", t.title || "NTM P/E", header, body, {
    colW: cols(3.0, header.length - 1),
  });
}

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

function diligenceSection(pptx: pptxgen) {
  const links = getDiligenceLinks();
  const header = ["Ticker", "Name", "Microsoft List"];
  const body: Row[] = links.map((l) => [
    { text: l.ticker, options: { align: "left", bold: true } },
    { text: l.name || "—", options: { align: "left" } },
    { text: l.url, options: { align: "left", color: BRAND, fontSize: 8, hyperlink: { url: l.url } } },
  ]);
  paginatedTable(
    pptx,
    "Diligence Tracker",
    `${links.length} position${links.length === 1 ? "" : "s"} · Microsoft Lists`,
    header,
    body,
    { colW: [1.4, 3.4, CONTENT_W - 4.8], rowsPerPage: 18 },
  );
}

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

  if (latest.positions?.length) {
    const header = ["Ticker", "Name", "Notes"];
    const body: Row[] = latest.positions.map((p) => [
      { text: p.ticker, options: { align: "left", bold: true } },
      { text: p.name || "—", options: { align: "left" } },
      { text: p.notes, options: { align: "left", fontSize: 9 } },
    ]);
    paginatedTable(pptx, "Morning News Summary", "Positions in focus", header, body, {
      colW: [1.4, 2.6, CONTENT_W - 4.0],
      rowsPerPage: 10,
    });
  }
}

function equitiesSection(pptx: pptxgen) {
  const companies = seedCompanies().filter((c) => !c.removed && !c.is_index);
  if (!companies.length) return;
  const header = ["Ticker", "Name", "Group", "Status", "Variant", "Tgt Mult"];
  const status = (p: number | null) => (p === 1 ? "Owned" : p === 2 ? "Watch" : "—");
  const sorted = [...companies].sort(
    (a, b) => a.grp_order - b.grp_order || a.row_order - b.row_order,
  );
  const body: Row[] = sorted.map((c) => [
    { text: c.ticker, options: { align: "left", bold: true } },
    { text: c.bbg || "—", options: { align: "left" } },
    { text: c.grp || "—", options: { align: "left" } },
    { text: status(c.port), options: { align: "left" } },
    { text: c.variant.toUpperCase(), options: { align: "left" } },
    num(latestYearVal(c.model.target_mult), 1),
  ]);
  paginatedTable(
    pptx,
    "Equities Dashboard",
    `${companies.length} names · model snapshot`,
    header,
    body,
    { colW: [1.5, 3.2, 3.0, 1.3, 1.3, CONTENT_W - 10.3], rowsPerPage: 20 },
  );
}

// ---------------------------------------------------------------------------
// Title slide + assembly
// ---------------------------------------------------------------------------
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

  // SPX Monitor — aggregate tables.
  const t = getDashboard().tables;
  threeDateTableSlide(pptx, t.stock_performance, "Stock Performance · Market cap ($b)", 0);
  growthTableSlide(pptx, t.earnings_growth);
  threeDateTableSlide(pptx, t.est_rev_2026, "Estimate Revisions · 2026 ($b)", 1);
  threeDateTableSlide(pptx, t.est_rev_2027, "Estimate Revisions · 2027 ($b)", 1);
  ntmPeSlide(pptx, t.ntm_pe);

  twitterSection(pptx);
  diligenceSection(pptx);
  morningNewsSection(pptx);
  equitiesSection(pptx);

  const out = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  return out;
}
