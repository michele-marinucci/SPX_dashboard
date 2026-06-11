import fs from "fs";
import path from "path";
import pptxgen from "pptxgenjs";

// Shared scaffolding for the "Export All to PPT" deck. The chrome follows the
// firm's internal template: navy titles and table bands (#000042), gray
// secondary text, a short accent-blue underline rule, Aptos type, the logo
// bottom-left and the page number bottom-right. Conditional formatting
// (heatmaps) is independent of these constants and stays untouched.

export const BRAND = "3730E6"; // logo blue (heatmap base lives in blueHeat)
export const NAVY = "000042"; // template titles & table header bands
export const ACCENT = "3230EC"; // template underline rule
export const INK = "1A1A22";
export const MUTED = "6B6B78"; // template secondary gray
export const LINE = "E4E4E6"; // template hairline
export const HEADER_TXT = "FFFFFF";
export const FONT = "Aptos"; // template typeface (Office falls back if absent)
export const CONFIDENTIAL = "Confidential and Proprietary";

export const PAGE_W = 13.33; // LAYOUT_WIDE inches
export const PAGE_H = 7.5;
export const MARGIN = 0.5;
export const CONTENT_W = PAGE_W - MARGIN * 2;
// Top of the footer band on content slides — tables must end above this.
export const FOOTER_Y = 7.06;

// ---- slide masters (the internal template) --------------------------------- //
// Content slides share a master: white page, the Meritage logo bottom-left
// and the page number bottom-right (as in the firm template). Dividers get a
// full-bleed navy background with the white logo.

export const MASTER_CONTENT = "MENDO_CONTENT";
export const MASTER_DIVIDER = "MENDO_DIVIDER";

const LOGO_AR = 365 / 2242; // meritage-logo.png height / width

// "As of" label shown top-right on content slides; set by defineMasters.
let deckDate = "";

export function logoFile(name: string): string | null {
  const p = path.join(process.cwd(), "public", name);
  return fs.existsSync(p) ? p : null;
}

export function defineMasters(pptx: pptxgen, dateLabel: string) {
  deckDate = dateLabel;
  const logo = logoFile("meritage-logo.png");
  const logoWhite = logoFile("meritage-logo-white.png");

  const content: NonNullable<pptxgen.SlideMasterProps["objects"]> = [];
  const logoW = 1.05;
  if (logo) {
    content.push({
      image: {
        x: MARGIN,
        y: FOOTER_Y + 0.115,
        w: logoW,
        h: logoW * LOGO_AR,
        path: logo,
      },
    });
  }
  pptx.defineSlideMaster({
    title: MASTER_CONTENT,
    background: { color: "FFFFFF" },
    objects: content,
    slideNumber: {
      x: PAGE_W - MARGIN - 0.6,
      y: FOOTER_Y + 0.08,
      w: 0.6,
      h: 0.26,
      fontFace: FONT,
      fontSize: 8,
      color: MUTED,
      align: "right",
    },
  });

  const divider: NonNullable<pptxgen.SlideMasterProps["objects"]> = [
    {
      text: {
        text: CONFIDENTIAL,
        options: {
          x: MARGIN,
          y: PAGE_H - 0.62,
          w: 4,
          h: 0.3,
          fontFace: FONT,
          fontSize: 8,
          color: "B9B9D6",
          charSpacing: 1,
        },
      },
    },
  ];
  const dlw = 2.2;
  if (logoWhite) {
    divider.push({ image: { x: MARGIN, y: 0.62, w: dlw, h: dlw * LOGO_AR, path: logoWhite } });
  }
  pptx.defineSlideMaster({
    title: MASTER_DIVIDER,
    background: { color: NAVY },
    objects: divider,
  });
}

export type Cell = string | { text: string; options?: pptxgen.TableCellProps };
export type Row = Cell[];

export function toCell(c: Cell): pptxgen.TableCell {
  return typeof c === "string" ? { text: c } : { text: c.text, options: c.options };
}

export function chunk<T>(arr: T[], size: number): T[][] {
  if (arr.length === 0) return [[]];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ---- number formatting (identical to lib/format.ts, so the deck reads like
// the web tables: "—" for nulls, parentheses for negative $, pct ×100) ------- //
export function fmtMoney(v: number | null | undefined, digits = 0): string {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
export function fmtSignedMoney(v: number | null | undefined, digits = 0): string {
  if (v == null || Number.isNaN(v)) return "—";
  const s = fmtMoney(Math.abs(v), digits);
  return v < 0 ? `(${s})` : s;
}
export function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null || Number.isNaN(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}
export function fmtNum(v: number | null | undefined, digits = 1): string {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

// ---- conditional formatting (ported from lib/heatmap.ts; rgba blends are
// flattened onto white since PPTX fills have no alpha) ----------------------- //
export interface ColScale {
  min: number;
  max: number;
  maxAbs: number;
}
export function computeScale(values: (number | null)[]): ColScale {
  const nums = values.filter((v): v is number => v !== null && !Number.isNaN(v));
  if (nums.length === 0) return { min: 0, max: 0, maxAbs: 0 };
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  return { min, max, maxAbs: Math.max(Math.abs(min), Math.abs(max)) || 1 };
}

function onWhite(rgb: [number, number, number], alpha: number): string {
  return rgb
    .map((c) => Math.round(255 + (c - 255) * alpha).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

// Diverging red/green for deltas — rgba(22,163,74,a) / rgba(220,38,38,a).
export function rgHeat(v: number | null, scale: ColScale): { fill?: string } {
  if (v == null || Number.isNaN(v) || v === 0) return {};
  const t = Math.min(1, Math.abs(v) / (scale.maxAbs || 1));
  const alpha = 0.12 + 0.6 * t;
  return { fill: onWhite(v > 0 ? [22, 163, 74] : [220, 38, 38], alpha) };
}

// Sequential brand-indigo for levels — rgba(55,48,230,a), white text when dark.
export function blueHeat(v: number | null, scale: ColScale): { fill?: string; color?: string } {
  if (v == null || Number.isNaN(v)) return {};
  const range = scale.max - scale.min || 1;
  const t = Math.min(1, Math.max(0, (v - scale.min) / range));
  const alpha = 0.08 + 0.62 * t;
  const out: { fill?: string; color?: string } = { fill: onWhite([55, 48, 230], alpha) };
  if (alpha > 0.5) out.color = "F4F4FF";
  return out;
}

// ---- slide scaffolding ----------------------------------------------------- //

// A content slide in the template's header style: big navy title, gray
// subtitle, a short accent underline, and the confidential/as-of block
// top-right.
export function sectionSlide(pptx: pptxgen, title: string, subtitle: string): pptxgen.Slide {
  const slide = pptx.addSlide({ masterName: MASTER_CONTENT });
  slide.addText(title, {
    x: MARGIN,
    y: 0.24,
    w: CONTENT_W - 3.2,
    h: 0.46,
    fontFace: FONT,
    fontSize: 21,
    bold: true,
    color: NAVY,
  });
  slide.addText(subtitle, {
    x: MARGIN,
    y: 0.7,
    w: CONTENT_W - 3.2,
    h: 0.28,
    fontFace: FONT,
    fontSize: 11.5,
    color: MUTED,
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: MARGIN + 0.02,
    y: 1.06,
    w: 0.42,
    h: 0.035,
    fill: { color: ACCENT },
    line: { type: "none" },
  });
  slide.addText(
    [
      { text: CONFIDENTIAL, options: { breakLine: true } },
      { text: deckDate ? `As of ${deckDate}` : "", options: {} },
    ],
    {
      x: PAGE_W - MARGIN - 3.4,
      y: 0.24,
      w: 3.4,
      h: 0.45,
      fontFace: FONT,
      fontSize: 9,
      color: MUTED,
      align: "right",
      valign: "top",
    },
  );
  return slide;
}

// A full-bleed navy divider that introduces a section.
export function dividerSlide(pptx: pptxgen, title: string, subtitle: string) {
  const slide = pptx.addSlide({ masterName: MASTER_DIVIDER });
  slide.addText(title, {
    x: MARGIN,
    y: 2.7,
    w: CONTENT_W,
    h: 1.2,
    fontFace: FONT,
    fontSize: 40,
    bold: true,
    color: "FFFFFF",
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: MARGIN + 0.04,
    y: 3.95,
    w: 1.8,
    h: 0.06,
    fill: { color: ACCENT },
    line: { type: "none" },
  });
  if (subtitle) {
    slide.addText(subtitle, {
      x: MARGIN,
      y: 4.15,
      w: CONTENT_W,
      h: 0.5,
      fontFace: FONT,
      fontSize: 15,
      color: "C9C9E4",
    });
  }
  return slide;
}

// Column widths: a fixed label column, the rest split evenly across CONTENT_W.
export function cols(labelW: number, n: number): number[] {
  const even = (CONTENT_W - labelW) / n;
  return [labelW, ...Array(n).fill(even)];
}

// Deterministic table with manual pagination (headers repeated per page). One
// section slide per page; avoids pptxgenjs auto-pagination over-splitting.
// `groupHeader` is an optional extra top row (e.g. grouped column bands).
export function paginatedTable(
  pptx: pptxgen,
  title: string,
  subtitle: string,
  header: Row,
  body: Row[],
  opts: {
    colW?: number[];
    rowsPerPage?: number;
    fontSize?: number;
    groupHeader?: Row;
    rowH?: number;
  } = {},
) {
  const { colW, rowsPerPage = 20, fontSize = 9, groupHeader, rowH } = opts;
  const pages = chunk(body, rowsPerPage);
  const hdrOpts: pptxgen.TableCellProps = {
    bold: true,
    color: HEADER_TXT,
    fill: { color: NAVY },
    align: "center",
    valign: "middle",
  };
  const headRows: Row[] = [];
  if (groupHeader) {
    headRows.push(
      groupHeader.map((c) =>
        typeof c === "string"
          ? { text: c, options: hdrOpts }
          : { text: c.text, options: { ...hdrOpts, ...c.options } },
      ),
    );
  }
  headRows.push(
    header.map((c) =>
      typeof c === "string"
        ? { text: c, options: hdrOpts }
        : { text: c.text, options: { ...hdrOpts, ...c.options } },
    ),
  );
  pages.forEach((rows, i) => {
    const sub = pages.length > 1 ? `${subtitle}  (${i + 1}/${pages.length})` : subtitle;
    const slide = sectionSlide(pptx, title, sub);
    const trows: pptxgen.TableRow[] = [...headRows, ...rows].map((r) => r.map(toCell));
    slide.addTable(trows, {
      x: MARGIN,
      y: 1.3,
      w: CONTENT_W,
      colW,
      rowH,
      fontFace: FONT,
      fontSize,
      color: INK,
      border: { type: "solid", color: LINE, pt: 0.5 },
      align: "right",
      valign: "middle",
      margin: [2, 4, 2, 4],
    });
  });
}
