// Server-only: imported by the SPX API route and the SPX page loader. Reads
// the service-role key from server env and is never bundled into client code.
// Mirrors lib/equitiesDb.ts; kept separate so features never share a file.

const URL = (process.env.SUPABASE_URL ?? "").trim().replace(/\/+$/, "") || undefined;
const KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim() || undefined;

export function spxEnabled(): boolean {
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

// One row per S&P 500 member, written by pipeline/bloomberg_push.py.
// All money values in $ billions; est_ni keyed by calendar year ("2026").
export interface SpxQuote {
  ticker: string;
  mkt_cap: number | null;
  est_ni: Record<string, number> | null;
  ntm_ni: number | null;
  data_date: string | null;
  as_of: string;
}

export async function dbGetSpxQuotes(): Promise<SpxQuote[]> {
  const res = await rest("spx_market?select=ticker,mkt_cap,est_ni,ntm_ni,data_date,as_of");
  if (!res.ok) throw new Error(`spx_market read ${res.status} — run supabase/spx.sql`);
  return (await res.json()) as SpxQuote[];
}

export async function dbUpsertSpxQuotes(rows: SpxQuote[]): Promise<void> {
  if (!rows.length) return;
  const res = await rest("spx_market?on_conflict=ticker", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`spx_market upsert ${res.status} — run supabase/spx.sql`);
}
