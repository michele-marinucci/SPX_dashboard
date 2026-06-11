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

// The most recent weekday strictly before `isoDay` — i.e. the date of the
// newest close that can possibly exist (ignoring market holidays).
export function lastWeekdayBefore(isoDay: string): string {
  const d = new Date(`${isoDay}T00:00:00Z`);
  do {
    d.setUTCDate(d.getUTCDate() - 1);
  } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

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

  // Prices are prior-day closes, so a refresh is only worth anything when a
  // NEW weekday close exists that the cache doesn't have. A symbol is
  // refetched only if (a) it has no quote, or (b) its cached close predates
  // the latest weekday close AND we haven't already tried today. So: no
  // same-day re-pulls, nothing on Sundays/Mondays (Friday's close is already
  // the latest), and a Bloomberg push that already ran is left untouched.
  const todayUtc = new Date().toISOString().slice(0, 10);
  const expected = lastWeekdayBefore(todayUtc);
  const stale = symbols.filter((s) => {
    const q = by[s];
    if (!q) return true;
    const dataDay = q.data_date ?? (q.as_of ?? "").slice(0, 10);
    if (dataDay >= expected) return false; // latest close already cached
    return (q.as_of ?? "").slice(0, 10) !== todayUtc; // retry at most once a day
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

// The trading date the displayed prices are as-of (prior close). All quotes
// on a given day share it; the latest wins if a refresh straddles midnight.
export function latestDataDate(quotes: Record<string, Quote>): string | null {
  return (
    Object.values(quotes)
      .map((q) => q.data_date)
      .filter((d): d is string => !!d)
      .sort()
      .pop() ?? null
  );
}
