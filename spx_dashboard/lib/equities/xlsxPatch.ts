// Minimal, surgical patching of a worksheet's XML (xl/worksheets/sheetN.xml):
// overwrite or insert individual cells by reference while leaving everything
// else — formulas (incl. Bloomberg add-in calls), styles, the rest of the
// sheet — byte-for-byte intact. Used by the Equities Dashboard Excel export.

export function colIndex(col: string): number {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

// Days since 1899-12-30 (Excel's date system).
export function dateSerial(iso: string): number {
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000);
}

function escXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const cellRe = (ref: string) =>
  new RegExp(`<c r="${ref}"(?: [^>]*?)?/>|<c r="${ref}"(?: [^>]*?)?>[\\s\\S]*?</c>`);

// Replace (or insert, keeping column order) a whole cell. `build` receives
// the existing cell's style id so formatting is preserved.
export function setCell(
  xml: string,
  ref: string,
  build: (s: string | undefined) => string,
): string {
  const m = xml.match(cellRe(ref));
  if (m) {
    const s = / s="(\d+)"/.exec(m[0])?.[1];
    return xml.replace(m[0], build(s));
  }
  const rowNum = /\d+/.exec(ref)![0];
  const rowTag = new RegExp(`<row r="${rowNum}"(?: [^>]*?)?>`).exec(xml);
  if (!rowTag) return xml; // row absent from the template — nothing to patch
  const start = rowTag.index + rowTag[0].length;
  const end = xml.indexOf("</row>", start);
  const target = colIndex(/^[A-Z]+/.exec(ref)![0]);
  let insertAt = end;
  for (const cm of xml.slice(start, end).matchAll(/<c r="([A-Z]+)\d+"/g)) {
    if (colIndex(cm[1]) > target) {
      insertAt = start + (cm.index as number);
      break;
    }
  }
  return xml.slice(0, insertAt) + build(undefined) + xml.slice(insertAt);
}

export function numCell(ref: string, v: number | null) {
  return (s: string | undefined) => {
    const sAttr = s ? ` s="${s}"` : "";
    return v == null ? `<c r="${ref}"${sAttr}/>` : `<c r="${ref}"${sAttr}><v>${v}</v></c>`;
  };
}

export function strCell(ref: string, v: string | null) {
  return (s: string | undefined) => {
    const sAttr = s ? ` s="${s}"` : "";
    return v
      ? `<c r="${ref}"${sAttr} t="inlineStr"><is><t>${escXml(v)}</t></is></c>`
      : `<c r="${ref}"${sAttr}/>`;
  };
}

// Overwrite only the cached <v> of a formula cell (dropping any t= type
// attribute so a cached error/string becomes a number); the formula itself
// is left untouched and will recalculate on a Bloomberg terminal.
export function setCachedValue(xml: string, ref: string, v: number | null): string {
  if (v == null) return xml;
  const m = xml.match(cellRe(ref));
  if (!m || !m[0].includes("<f")) return xml;
  const open = /^<c [^>]*?>/.exec(m[0]);
  if (!open) return xml;
  const newOpen = open[0].replace(/ t="[^"]*"/, "");
  const formula = /<f[\s\S]*?<\/f>|<f[^>]*\/>/.exec(m[0]);
  if (!formula) return xml;
  return xml.replace(m[0], `${newOpen}${formula[0]}<v>${v}</v></c>`);
}
