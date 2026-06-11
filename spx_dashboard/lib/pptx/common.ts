import pptxgen from "pptxgenjs";

// Shared scaffolding for the "Export All to PPT" deck.

export const BRAND = "3730E6";
export const INK = "1A1A22";
export const MUTED = "71717F";
export const LINE = "E2E2EA";
export const HEADER_TXT = "FFFFFF";

export const PAGE_W = 13.33; // LAYOUT_WIDE inches
export const PAGE_H = 7.5;
export const MARGIN = 0.5;
export const CONTENT_W = PAGE_W - MARGIN * 2;

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

// ---- number formatting ----------------------------------------------------- //
export function num(v: number | null | undefined, digits = 0): string {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
export function signed(v: number | null | undefined, digits = 0): string {
  if (v == null || Number.isNaN(v)) return "—";
  const s = num(Math.abs(v), digits);
  return v < 0 ? `(${s})` : v > 0 ? `+${s}` : s;
}
export function pct(v: number | null | undefined, digits = 1): string {
  if (v == null || Number.isNaN(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}%`;
}

// ---- slide scaffolding ----------------------------------------------------- //

// A content slide with a small tool title + subtitle and a brand spine.
export function sectionSlide(pptx: pptxgen, title: string, subtitle: string): pptxgen.Slide {
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
    y: 0.26,
    w: CONTENT_W - 1.2,
    h: 0.5,
    fontFace: "Arial",
    fontSize: 22,
    bold: true,
    color: INK,
  });
  slide.addText(subtitle, {
    x: MARGIN,
    y: 0.78,
    w: CONTENT_W - 1.2,
    h: 0.3,
    fontFace: "Arial",
    fontSize: 11,
    color: MUTED,
  });
  return slide;
}

// A full-bleed brand divider that introduces a section.
export function dividerSlide(pptx: pptxgen, title: string, subtitle: string) {
  const slide = pptx.addSlide();
  slide.background = { color: BRAND };
  slide.addText(title, {
    x: MARGIN,
    y: 2.7,
    w: CONTENT_W,
    h: 1.2,
    fontFace: "Arial",
    fontSize: 40,
    bold: true,
    color: "FFFFFF",
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: MARGIN + 0.04,
    y: 3.95,
    w: 1.8,
    h: 0.06,
    fill: { color: "FFFFFF" },
    line: { type: "none" },
  });
  if (subtitle) {
    slide.addText(subtitle, {
      x: MARGIN,
      y: 4.15,
      w: CONTENT_W,
      h: 0.5,
      fontFace: "Arial",
      fontSize: 15,
      color: "DAD8FB",
    });
  }
  return slide;
}

// Column widths: a fixed label column, the rest split evenly across CONTENT_W.
export function cols(labelW: number, n: number): number[] {
  const even = (CONTENT_W - labelW) / n;
  return [labelW, ...Array(n).fill(even)];
}

// Deterministic table with manual pagination (header repeated per page). One
// section slide per page; avoids pptxgenjs auto-pagination over-splitting.
export function paginatedTable(
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
