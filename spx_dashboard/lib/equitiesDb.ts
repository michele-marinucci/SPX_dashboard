// Server-only: imported solely by the Equities API routes. Reads the
// service-role key from server env and is never bundled into client code.
// Mirrors lib/diligenceDb.ts; kept separate so features never share a file.
import { Company, EditRecord, FieldChange, Quote } from "@/lib/equities/types";

const URL = (process.env.SUPABASE_URL ?? "").trim().replace(/\/+$/, "") || undefined;
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

const COMPANY_COLS =
  "ticker,bbg,yahoo,currency,px_scale,grp,grp_order,row_order,port,update_date," +
  "update_by,variant,cash_in_target,div_yield_mode,decomp,yield_input,adv_3m," +
  "perf,model,is_index,best_pe";

export async function dbGetCompanies(): Promise<Company[]> {
  const res = await rest(
    `eq_companies?select=${COMPANY_COLS}&order=grp_order.asc,row_order.asc`,
  );
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

export async function dbRemoveCompany(ticker: string): Promise<void> {
  const res = await rest(`eq_companies?ticker=eq.${encodeURIComponent(ticker)}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
  if (!res.ok) throw new Error(`equities remove ${res.status}`);
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

// ---- Cached market quotes -------------------------------------------------- //

export async function dbGetQuotes(): Promise<Quote[]> {
  const res = await rest("eq_market?select=symbol,price,m1,m3,m6,as_of");
  if (!res.ok) throw new Error(`quotes read ${res.status}`);
  return (await res.json()) as Quote[];
}

export async function dbUpsertQuotes(quotes: Quote[]): Promise<void> {
  if (!quotes.length) return;
  const res = await rest("eq_market", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(quotes),
  });
  if (!res.ok) throw new Error(`quotes upsert ${res.status}`);
}
