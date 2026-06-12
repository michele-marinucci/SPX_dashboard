// "Export Excel" for the SPX Monitor.
//
// Serves the committed workbook (public/SPX_inputs.xlsx) but first patches the
// Bloomberg data date in Data!AC10 — the single cell every formula in the model
// keys off — so the downloaded file's date matches the date shown on the page.
// The static snapshot can lag the live Bloomberg push; this keeps them in sync
// without regenerating the workbook.
import { readFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { loadSpxDashboard } from "@/lib/spxLive";

// Node runtime: reads from the filesystem and rezips with JSZip.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The cell holding the as-of date that all model formulas depend on.
const DATE_SHEET = "Data";
const DATE_CELL = "AC10";

// Excel serial date: whole days since 1899-12-30 (Excel's epoch, which already
// bakes in the phantom 1900 leap day for any date after 1900-03-01).
function excelSerial(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30);
  return Math.round(ms / 86_400_000);
}

// Resolve the worksheet XML path for a sheet name via workbook.xml + its rels,
// rather than assuming sheetN.xml ordering.
function resolveSheetPath(workbookXml: string, relsXml: string, name: string): string | null {
  const sheet = new RegExp(`<sheet[^>]*name="${name}"[^>]*r:id="([^"]+)"`).exec(workbookXml);
  if (!sheet) return null;
  const rel = new RegExp(`<Relationship[^>]*Id="${sheet[1]}"[^>]*Target="([^"]+)"`).exec(relsXml);
  if (!rel) return null;
  return `xl/${rel[1].replace(/^\/?xl\//, "")}`;
}

// Replace the cached <v> of a single cell, leaving its style/type untouched.
function patchCellValue(sheetXml: string, cell: string, value: number): string {
  const re = new RegExp(`(<c r="${cell}"[^>]*>)\\s*(?:<v>[^<]*</v>)?\\s*(</c>)`);
  return sheetXml.replace(re, `$1<v>${value}</v>$2`);
}

export async function GET() {
  const filePath = path.join(process.cwd(), "public", "SPX_inputs.xlsx");
  const buf = await readFile(filePath);

  let out: Buffer = buf;
  try {
    const d = await loadSpxDashboard();
    const iso = d.bloomberg_date;
    if (iso) {
      const zip = await JSZip.loadAsync(buf);
      const workbookXml = await zip.file("xl/workbook.xml")!.async("string");
      const relsXml = await zip.file("xl/_rels/workbook.xml.rels")!.async("string");
      const sheetPath = resolveSheetPath(workbookXml, relsXml, DATE_SHEET);
      const sheetFile = sheetPath ? zip.file(sheetPath) : null;
      if (sheetFile) {
        const sheetXml = await sheetFile.async("string");
        const patched = patchCellValue(sheetXml, DATE_CELL, excelSerial(iso));
        zip.file(sheetPath!, patched);
        // DEFLATE keeps the rezipped file close to the original size (JSZip's
        // default STORE would balloon it ~5×).
        out = await zip.generateAsync({
          type: "nodebuffer",
          compression: "DEFLATE",
        });
      }
    }
  } catch {
    // On any failure fall back to the committed file unchanged — a download
    // with a stale date beats no download.
    out = buf;
  }

  return new Response(new Uint8Array(out), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="SPX_inputs.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
