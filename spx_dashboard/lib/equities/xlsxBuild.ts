// A tiny, dependency-free .xlsx writer (built on JSZip, already a dependency)
// used by the Equities Dashboard "Export Excel". It builds a clean workbook
// from scratch so the download is exactly what the site shows: a formatted
// Summary tab plus an Edit-log tab, and nothing else.
//
// It is deliberately minimal: inline strings (no shared-string table), a fixed
// style palette (currency / percent / multiple / number / date + headers), and
// optional merged cells, column widths and a frozen header. That covers
// everything the two sheets need without pulling in a heavyweight library.

import JSZip from "jszip";

// 1-based column index → letter(s): 1→A, 27→AA.
export function colLetter(n: number): string {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Excel serial date (days since 1899-12-30), with the time of day as a
// fraction — so a full timestamp renders with the "date hh:mm" format.
export function excelDateTime(iso: string): number | null {
  const t = Date.parse(iso);
  if (!isFinite(t)) return null;
  return (t - Date.UTC(1899, 11, 30)) / 86_400_000;
}

// ---- style palette ---------------------------------------------------------
// Indices line up with the <cellXfs> order in STYLES_XML below. Keep in sync.
export const S = {
  DEFAULT: 0,
  TITLE: 1,
  SUBTITLE: 2,
  GROUP_HEAD: 3, // brand fill, white bold, centered (group band)
  COL_HEAD: 4, // dark fill, white bold, centered (column labels)
  SECTOR: 5, // light fill, bold, left (sector band)
  TICKER: 6, // bold, left, bottom rule
  TEXT: 7, // plain text, bottom rule
  CURRENCY_USD: 8, // "$"#,##0.00
  CURRENCY_EUR: 9, // "€"#,##0.00
  CURRENCY_GBP: 10, // "£"#,##0.00
  NUMBER2: 11, // #,##0.00 (currency fallback, no symbol)
  MULTIPLE: 12, // 0.0"x"
  PERCENT: 13, // 0.0%
  NUMBER: 14, // #,##0
  DATETIME: 15, // yyyy-mm-dd hh:mm
} as const;

export function currencyStyle(ccy: string): number {
  if (ccy === "€") return S.CURRENCY_EUR;
  if (ccy === "£") return S.CURRENCY_GBP;
  if (ccy === "$") return S.CURRENCY_USD;
  return S.NUMBER2;
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="7">
<numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00"/>
<numFmt numFmtId="165" formatCode="&quot;€&quot;#,##0.00"/>
<numFmt numFmtId="166" formatCode="&quot;£&quot;#,##0.00"/>
<numFmt numFmtId="167" formatCode="0.0&quot;x&quot;"/>
<numFmt numFmtId="168" formatCode="0.0%"/>
<numFmt numFmtId="169" formatCode="#,##0"/>
<numFmt numFmtId="170" formatCode="yyyy\\-mm\\-dd\\ hh:mm"/>
</numFmts>
<fonts count="5">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="15"/><color rgb="FF1F2937"/><name val="Calibri"/></font>
<font><sz val="10"/><color rgb="FF8A8A99"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FF1F2937"/><name val="Calibri"/></font>
</fonts>
<fills count="5">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF3730E6"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF1F2937"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFEEEEF6"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left/><right/><top/><bottom style="thin"><color rgb="FFE2E2EC"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="16">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="4" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
<xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="4" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="167" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="168" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="169" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="170" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

// ---- row builder -----------------------------------------------------------

export class Row {
  private cells: string[] = [];
  private col = 1;
  constructor(private r: number) {}

  num(v: number | null | undefined, style: number): this {
    const ref = colLetter(this.col++) + this.r;
    this.cells.push(
      v == null || !isFinite(v)
        ? `<c r="${ref}" s="${style}"/>`
        : `<c r="${ref}" s="${style}"><v>${v}</v></c>`,
    );
    return this;
  }
  str(v: string | null | undefined, style: number): this {
    const ref = colLetter(this.col++) + this.r;
    this.cells.push(
      v
        ? `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`
        : `<c r="${ref}" s="${style}"/>`,
    );
    return this;
  }
  skip(n = 1): this {
    this.col += n;
    return this;
  }
  xml(): string {
    return `<row r="${this.r}">${this.cells.join("")}</row>`;
  }
}

// ---- sheet + workbook ------------------------------------------------------

export function sheetXml(
  rows: string[],
  opts: {
    cols?: { min: number; max: number; width: number }[];
    merges?: string[];
    freezeRows?: number;
    freezeCols?: number;
  } = {},
): string {
  const { cols, merges, freezeRows = 0, freezeCols = 0 } = opts;
  let pane = "";
  if (freezeRows || freezeCols) {
    const top = `${colLetter(freezeCols + 1)}${freezeRows + 1}`;
    pane =
      `<pane${freezeCols ? ` xSplit="${freezeCols}"` : ""}${freezeRows ? ` ySplit="${freezeRows}"` : ""}` +
      ` topLeftCell="${top}" activePane="bottomRight" state="frozen"/>`;
  }
  const colsXml = cols?.length
    ? `<cols>${cols
        .map(
          (c) =>
            `<col min="${c.min}" max="${c.max}" width="${c.width}" customWidth="1"/>`,
        )
        .join("")}</cols>`
    : "";
  const mergeXml = merges?.length
    ? `<mergeCells count="${merges.length}">${merges
        .map((m) => `<mergeCell ref="${m}"/>`)
        .join("")}</mergeCells>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
${colsXml}<sheetData>${rows.join("")}</sheetData>${mergeXml}
</worksheet>`;
}

export async function buildWorkbook(
  sheets: { name: string; xml: string }[],
): Promise<Buffer> {
  const zip = new JSZip();

  const overrides = sheets
    .map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join("");
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${overrides}</Types>`,
  );

  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
  );

  const sheetTags = sheets
    .map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join("");
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheetTags}</sheets>
</workbook>`,
  );

  const sheetRels = sheets
    .map(
      (_, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
    )
    .join("");
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheetRels}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
  );

  zip.file("xl/styles.xml", STYLES_XML);
  sheets.forEach((s, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, s.xml));

  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}
