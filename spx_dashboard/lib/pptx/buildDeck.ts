import fs from "fs";
import path from "path";
import pptxgen from "pptxgenjs";

import { ThreeDateTable, GrowthTable, NtmPeTableData } from "@/lib/data";
import { loadSpxDashboard } from "@/lib/spxLive";
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
  cols,
  dividerSlide,
  num,
  paginatedTable,
  pct,
  sectionSlide,
  signed,
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

// ---- SPX Monitor (Aggregate S&P 500 only) ---------------------------------- //
function rowFill(cells: Row, r: { is_total: boolean }) {
  if (r.is_total)
    cells.forEach(
      (c) =>
        typeof c === "object" &&
        (c.options = { ...c.options, fill: { color: "EFEFF3" }, bold: true }),
    );
}

function threeDateTableSlide(pptx: pptxgen, t: ThreeDateTable, title: string, digits: number) {
  const header = ["", ...t.dates.map((d) => `${d}`), "$Δ YTD", "$Δ QTD", "%Δ YTD", "%Δ QTD"];
  const body: Row[] = t.rows.map((r) => {
    const cells: Row = [{ text: r.label, options: { align: "left", bold: r.is_total } }];
    r.values.forEach((v) => cells.push(num(v, digits)));
    cells.push(signed(r.delta_abs[0], digits));
    cells.push(signed(r.delta_abs[1], digits));
    cells.push(pct(r.delta_pct[0]));
    cells.push(pct(r.delta_pct[1]));
    rowFill(cells, r);
    return cells;
  });
  paginatedTable(pptx, "SPX Monitor · Aggregate S&P 500", title, header, body, {
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
  paginatedTable(pptx, "SPX Monitor · Aggregate S&P 500", `Earnings Growth · ${t.value_label}`, header, body, {
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
  paginatedTable(pptx, "SPX Monitor · Aggregate S&P 500", t.title || "NTM P/E", header, body, {
    colW: cols(3.0, header.length - 1),
  });
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

// ---- Morning News Summary -------------------------------------------------- //
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

  // 2) SPX Monitor — Aggregate S&P 500 only (live-overlaid like the web page).
  dividerSlide(pptx, "SPX Monitor", "Aggregate S&P 500");
  const t = (await loadSpxDashboard()).tables;
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
