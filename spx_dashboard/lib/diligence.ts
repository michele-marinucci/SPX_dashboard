import diligenceFile from "@/data/diligence.json";

// One row of the Diligence Tracker: a stock and the link to its Microsoft List.
// Client-safe (types + committed-JSON fallback only). The server-only Supabase
// access lives in lib/diligenceDb.ts, mirroring lib/themes.ts ↔ lib/supabase.ts.
export interface DiligenceLink {
  ticker: string; // uppercased symbol, e.g. "MSFT"
  name: string; // company name (may be empty)
  url: string; // Microsoft List URL
}

export interface DiligenceData {
  links: DiligenceLink[];
}

// Symbol only, uppercased — drops anything after the first space so a
// Bloomberg-style "MSFT US Equity" collapses to "MSFT".
export const normTicker = (t: string): string =>
  t.trim().toUpperCase().split(/\s+/)[0] ?? "";

export function getDiligenceData(): DiligenceData {
  return diligenceFile as DiligenceData;
}

// Committed fallback list, sorted by ticker. Used to render the first paint and
// to seed Supabase on first use.
export function getDiligenceLinks(): DiligenceLink[] {
  return [...(getDiligenceData().links ?? [])]
    .map((l) => ({ ...l, ticker: normTicker(l.ticker) }))
    .filter((l) => l.ticker && l.url)
    .sort((a, b) => a.ticker.localeCompare(b.ticker));
}

// Where stock logos come from. A ticker-keyed CDN; if it can't resolve a symbol
// the UI falls back to a monogram, so a blocked/missing logo never breaks the
// row. Swap this one function to change providers.
export function logoUrl(ticker: string): string {
  return `https://assets.parqet.com/logos/symbol/${encodeURIComponent(
    normTicker(ticker),
  )}?format=png&size=64`;
}
