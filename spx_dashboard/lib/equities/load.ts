// Server-side state loading shared by the Equities API route and the Excel
// export route: companies from Supabase (seeded on first use, committed-seed
// fallback) and Yahoo quotes cached in eq_market with a freshness TTL.
import {
  dbGetCompanies,
  dbGetQuotes,
  dbSeedCompanies,
  dbUpsertQuotes,
  equitiesEnabled,
} from "@/lib/equitiesDb";
import { seedCompanies } from "./seed";
import { fetchYahooQuotes } from "./yahoo";
import { Company, Quote } from "./types";

const QUOTE_TTL_MS = 4 * 60 * 60 * 1000;

export async function loadCompanies(): Promise<{ enabled: boolean; companies: Company[] }> {
  if (!equitiesEnabled()) return { enabled: false, companies: seedCompanies() };
  try {
    let companies = await dbGetCompanies();
    if (!companies.length) {
      await dbSeedCompanies(seedCompanies());
      companies = await dbGetCompanies();
    }
    return { enabled: true, companies };
  } catch {
    // Table missing or connection issue → read-only fallback to the seed.
    return { enabled: false, companies: seedCompanies() };
  }
}

export async function loadQuotes(
  companies: Company[],
  enabled: boolean,
  force: boolean,
): Promise<Record<string, Quote>> {
  const symbols = companies.map((c) => c.yahoo).filter((s): s is string => !!s);
  let cached: Quote[] = [];
  if (enabled) {
    try {
      cached = await dbGetQuotes();
    } catch {
      /* table missing → treat as empty cache */
    }
  }
  const by: Record<string, Quote> = {};
  for (const q of cached) by[q.symbol] = q;

  const now = Date.now();
  const stale = symbols.filter((s) => {
    const q = by[s];
    return !q || now - Date.parse(q.as_of) > QUOTE_TTL_MS;
  });

  if (force || stale.length) {
    const fresh = await fetchYahooQuotes(force ? symbols : stale);
    for (const q of fresh) by[q.symbol] = q;
    if (enabled && fresh.length) {
      try {
        await dbUpsertQuotes(fresh);
      } catch {
        /* cache write is best-effort */
      }
    }
  }
  return by;
}

export function latestAsOf(quotes: Record<string, Quote>): string | null {
  return (
    Object.values(quotes)
      .map((q) => q.as_of)
      .sort()
      .pop() ?? null
  );
}
