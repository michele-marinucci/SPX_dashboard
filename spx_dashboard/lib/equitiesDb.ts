// Server-only: imported solely by the Equities API routes. Reads the
// service-role key from server env and is never bundled into client code.
// Mirrors lib/diligenceDb.ts; kept separate so features never share a file.
import { Company, EditRecord, FieldChange, Quote } from "@/lib/equities/types";

// Normalize away a stray "/rest/v1" suffix some setups include in the env var
// (the REST prefix is appended below) — same fix as lib/supabase.ts.
const URL =
  (process.env.SUPABASE_URL ?? "")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/rest\/v1$/i, "")
    .replace(/\/+$/, "") || undefined;
const KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim() || undefined;

export function equitiesEnabled(): boolean {
  return !!(URL && KEY);
}

async function rest(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: KEY as string,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    cache: "no-store",
  });
}

const BASE_COLS =
  "ticker,bbg,yahoo,currency,px_scale,grp,grp_order,row_order,port,update_date," +
  "update_by,variant,cash_in_target,div_yield_mode,decomp,yield_input,adv_3m," +
  "perf,model,is_index,best_pe";
const COMPANY_COLS = `${BASE_COLS},removed`;

export async function dbGetCompanies(): Promise<Company[]> {
  let res = await rest(
    `eq_companies?select=${COMPANY_COLS}&order=grp_order.asc,row_order.asc`,
  );
  if (res.status === 400) {
    // Table created before soft-delete existed (no `removed` column yet) —
    // stay functional read-wise; the equities.sql upgrade adds the column.
    res = await rest(`eq_companies?select=${BASE_COLS}&order=grp_order.asc,row_order.asc`);
    if (!res.ok) throw new Error(`equities read ${res.status}`);
    const rows = (await res.json()) as Omit<Company, "removed">[];
    return rows.map((r) => ({ ...r, removed: false }));
  }
  if (!res.ok) throw new Error(`equities read ${res.status}`);
  return (await res.json()) as Company[];
}

// Seed the table from the committed workbook parse on first use (empty table).
export async function dbSeedCompanies(rows: Company[]): Promise<void> {
  if (!rows.length) return;
  const res = await rest("eq_companies", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`equities seed ${res.status}: ${await res.text()}`);
}

export async function dbUpdateCompany(
  ticker: string,
  patch: Partial<Company>,
): Promise<void> {
  const res = await rest(`eq_companies?ticker=eq.${encodeURIComponent(ticker)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`equities update ${res.status}: ${await res.text()}`);
}

export async function dbInsertCompany(row: Company): Promise<void> {
  const res = await rest("eq_companies", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`equities insert ${res.status}: ${await res.text()}`);
}

// Soft delete / restore: rows are never dropped, so a removed name keeps its
// model and edit history and can be brought back from the "Removed names" UI.
export async function dbSetRemoved(
  ticker: string,
  removed: boolean,
  analyst: string,
): Promise<void> {
  await dbUpdateCompany(ticker, {
    removed,
    update_date: new Date().toISOString().slice(0, 10),
    update_by: analyst,
  });
}

// ---- Edits log (append-only) ---------------------------------------------- //

export async function dbInsertEdit(
  ticker: string,
  analyst: string,
  changes: FieldChange[],
): Promise<void> {
  const res = await rest("eq_edits", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ ticker, analyst, changes }),
  });
  if (!res.ok) throw new Error(`edit log write ${res.status}`);
}

export async function dbGetEdits(ticker: string): Promise<EditRecord[]> {
  const res = await rest(
    `eq_edits?ticker=eq.${encodeURIComponent(ticker)}&select=id,ticker,analyst,created_at,changes&order=created_at.desc&limit=200`,
  );
  if (!res.ok) throw new Error(`edit log read ${res.status}`);
  return (await res.json()) as EditRecord[];
}

// The whole dashboard's edit history, newest first — powers the aggregate
// "Activity log" popup and the Edit-log tab of the Excel export.
export async function dbGetAllEdits(limit = 2000): Promise<EditRecord[]> {
  const res = await rest(
    `eq_edits?select=id,ticker,analyst,created_at,changes&order=created_at.desc&limit=${limit}`,
  );
  if (!res.ok) throw new Error(`edit log read ${res.status}`);
  return (await res.json()) as EditRecord[];
}

// ---- Cached market quotes -------------------------------------------------- //

export async function dbGetQuotes(): Promise<Quote[]> {
  let res = await rest("eq_market?select=symbol,price,m1,m3,m6,source,data_date,as_of");
  if (res.status === 400) {
    // Table predates the source/data_date columns (equities.sql upgrades it).
    res = await rest("eq_market?select=symbol,price,m1,m3,m6,as_of");
  }
  if (!res.ok) throw new Error(`quotes read ${res.status}`);
  return (await res.json()) as Quote[];
}

export async function dbUpsertQuotes(quotes: Quote[]): Promise<void> {
  if (!quotes.length) return;
  let res = await rest("eq_market", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(quotes),
  });
  if (res.status === 400) {
    // Legacy table without source/data_date — retry with just the base cols.
    res = await rest("eq_market", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(
        quotes.map(({ source: _source, data_date: _dataDate, ...q }) => q),
      ),
    });
  }
  if (!res.ok) throw new Error(`quotes upsert ${res.status}`);
}
