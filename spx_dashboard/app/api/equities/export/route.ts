// "Download Excel" for the Equities Dashboard.
//
// Returns the team's ORIGINAL workbook (committed as
// data/detailed_dashboard_template.xlsx) with only the analyst model-input
// cells overwritten by the current shared values — every Bloomberg formula,
// derived formula, format, and the other tabs survive untouched, so the file
// recalculates normally the next time it's opened on a terminal.
//
// Two kinds of patches, driven by the xl_row/xl_patch metadata the parser
// recorded for each row:
//   1. literal input cells (revs, GM%, EPS, DPS, multiples, …) → new <v>,
//      plus the Port flag (E), update date (F) and analyst (G);
//   2. Bloomberg price/performance cells (H, EB–ED) keep their <f> formula
//      but get the current Yahoo value written into the cached <v>, so the
//      file shows live-ish numbers even when opened off-terminal.
// Companies added on the site (no template row) can't be patched in;
// removed companies keep their last template values.
import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import JSZip from "jszip";
import seedJson from "@/data/equities_seed.json";
import { latestAsOf, loadCompanies, loadQuotes } from "@/lib/equities/load";
import { Company } from "@/lib/equities/types";
import { dateSerial, numCell, setCachedValue, setCell, strCell } from "@/lib/equities/xlsxPatch";

export const dynamic = "force-dynamic";

const SHEET_PATH = "xl/worksheets/sheet1.xml"; // "Summary" in the template

interface XlMeta {
  row: number;
  patch: Record<string, string>; // column letter → dotted model path
  isIndex: boolean;
}

function xlMeta(): Map<string, XlMeta> {
  const map = new Map<string, XlMeta>();
  for (const g of seedJson.groups as {
    companies: { ticker: string; xl_row: number; xl_patch: Record<string, string> }[];
  }[]) {
    for (const c of g.companies) {
      map.set(c.ticker, { row: c.xl_row, patch: c.xl_patch, isIndex: false });
    }
  }
  for (const ix of seedJson.indexes as { ticker: string; xl_row: number }[]) {
    map.set(ix.ticker, { row: ix.xl_row, patch: {}, isIndex: true });
  }
  return map;
}

// Resolve a dotted path ("revs.2027", "gp.2028", "shares") against the model.
function resolve(c: Company, pathStr: string): number | null {
  const [head, year] = pathStr.split(".");
  if (!year) {
    const v = c.model[head as "shares" | "cash" | "debt" | "min_int"];
    return typeof v === "number" ? v : null;
  }
  if (head === "gp") {
    const gm = c.model.gm[year];
    const revs = c.model.revs[year];
    return gm != null && revs != null ? gm * revs : null;
  }
  const series = c.model[head as "revs"] as Record<string, number> | undefined;
  const v = series?.[year];
  return typeof v === "number" ? v : null;
}

export async function GET() {
  const { enabled, companies } = await loadCompanies();
  const quotes = await loadQuotes(companies, enabled, false);
  const today = new Date();

  const template = await fs.readFile(
    path.join(process.cwd(), "data", "detailed_dashboard_template.xlsx"),
  );
  const zip = await JSZip.loadAsync(template);
  let xml = await zip.file(SHEET_PATH)!.async("string");

  const meta = xlMeta();
  for (const c of companies) {
    if (c.removed) continue; // keep the template row's last values as-is
    const m = meta.get(c.ticker);
    if (!m) continue; // added on the site — no template row to patch

    if (!m.isIndex) {
      for (const [col, pathStr] of Object.entries(m.patch)) {
        xml = setCell(xml, `${col}${m.row}`, numCell(`${col}${m.row}`, resolve(c, pathStr)));
      }
      xml = setCell(xml, `E${m.row}`, numCell(`E${m.row}`, c.port));
      xml = setCell(
        xml,
        `F${m.row}`,
        numCell(`F${m.row}`, c.update_date ? dateSerial(c.update_date) : null),
      );
      xml = setCell(xml, `G${m.row}`, strCell(`G${m.row}`, c.update_by));
    }

    // Refresh the cached values of the Bloomberg price/perf cells so the
    // file is current even before a terminal recalculates it.
    const q = c.yahoo ? quotes[c.yahoo] : undefined;
    if (q) {
      xml = setCachedValue(xml, `H${m.row}`, q.price != null ? q.price * c.px_scale : null);
      xml = setCachedValue(xml, `EB${m.row}`, q.m1);
      xml = setCachedValue(xml, `EC${m.row}`, q.m3);
      xml = setCachedValue(xml, `ED${m.row}`, q.m6);
    }
  }

  zip.file(SHEET_PATH, xml);
  const buf = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  const stamp = today.toISOString().slice(0, 10).replace(/-/g, "");
  const asOf = latestAsOf(quotes);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${stamp}_Detailed_Dashboard.xlsx"`,
      "X-Prices-As-Of": asOf ?? "none",
    },
  });
}
