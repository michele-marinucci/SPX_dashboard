// Tests for the hand-rolled xlsx writer, focused on the security-relevant
// path: every user-influenced string (cell text, formulas, sheet names) must
// be XML-escaped, and strings must be emitted as inline strings — never as
// values Excel could interpret as formulas.
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { buildWorkbook, colLetter, excelDateTime, Row, S, sheetXml } from "./xlsxBuild";

describe("colLetter", () => {
  it("maps 1→A, 26→Z, 27→AA, 52→AZ, 703→AAA", () => {
    expect(colLetter(1)).toBe("A");
    expect(colLetter(26)).toBe("Z");
    expect(colLetter(27)).toBe("AA");
    expect(colLetter(52)).toBe("AZ");
    expect(colLetter(703)).toBe("AAA");
  });
});

describe("Row escaping", () => {
  it("escapes &, <, >, \" in string cells", () => {
    const xml = new Row(1).str(`<img src="x"> & 'quotes'`, S.TEXT).xml();
    expect(xml).toContain("&lt;img src=&quot;x&quot;&gt; &amp; 'quotes'");
    expect(xml).not.toMatch(/<img/);
  });

  it("emits strings as inline strings, not formulas (formula-injection guard)", () => {
    const xml = new Row(1).str("=CMD|'/c calc'!A1", S.TEXT).xml();
    expect(xml).toContain('t="inlineStr"');
    expect(xml).not.toContain("<f>");
  });

  it("escapes formula text, including quotes inside BDP tickers", () => {
    const xml = new Row(2).formula('BDP("NVDA US Equity","PX_LAST")', S.NUMBER2, 100).xml();
    expect(xml).toContain("<f>BDP(&quot;NVDA US Equity&quot;,&quot;PX_LAST&quot;)</f>");
    expect(xml).toContain("<v>100</v>");
  });

  it("omits the cached value when it is null or non-finite", () => {
    expect(new Row(2).formula("A1+1", S.NUMBER2, null).xml()).not.toContain("<v>");
    expect(new Row(2).formula("A1+1", S.NUMBER2, NaN).xml()).not.toContain("<v>");
  });

  it("writes empty cells for null/non-finite numbers and advances columns", () => {
    const xml = new Row(3).num(null, S.NUMBER2).num(Infinity, S.NUMBER2).num(7, S.NUMBER2).xml();
    expect(xml).toContain('<c r="A3" s=');
    expect(xml).toContain('<c r="C3" s=');
    expect(xml).toContain("<v>7</v>");
    expect(xml.match(/<v>/g)).toHaveLength(1);
  });

  it("skip() leaves a column gap", () => {
    const xml = new Row(1).str("a", S.TEXT).skip(2).str("b", S.TEXT).xml();
    expect(xml).toContain('r="A1"');
    expect(xml).toContain('r="D1"');
  });
});

describe("excelDateTime", () => {
  it("converts ISO timestamps to Excel serial days since 1899-12-30", () => {
    // 1900-01-01T00:00Z is serial 2 in Excel's (bug-compatible) epoch math.
    expect(excelDateTime("1900-01-01T00:00:00Z")).toBe(2);
    expect(excelDateTime("1900-01-01T12:00:00Z")).toBe(2.5);
    expect(excelDateTime("not a date")).toBeNull();
  });
});

describe("buildWorkbook", () => {
  it("produces a valid zip with escaped sheet names and content", async () => {
    const rows = [new Row(1).str(`A&B <"co">`, S.TEXT).xml()];
    const buf = await buildWorkbook([
      { name: 'R&D "x" <1>', xml: sheetXml(rows) },
      { name: "Plain", xml: sheetXml([]) },
    ]);
    const zip = await JSZip.loadAsync(buf);
    const wb = await zip.file("xl/workbook.xml")!.async("string");
    expect(wb).toContain("R&amp;D &quot;x&quot; &lt;1&gt;");
    const sheet1 = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
    expect(sheet1).toContain("A&amp;B &lt;&quot;co&quot;&gt;");
    // Both sheets are wired into the package.
    expect(zip.file("xl/worksheets/sheet2.xml")).not.toBeNull();
    expect(zip.file("[Content_Types].xml")).not.toBeNull();
  });
});
