// Server-only Yahoo Finance quotes (free, unofficial; fine for an internal
// team dashboard). One chart call per symbol returns the live price plus six
// months of daily closes, from which 1M/3M/6M performance is computed — the
// replacement for the workbook's Bloomberg CHG_PCT fields.
import { Quote } from "./types";

const DAY = 86_400_000;

interface ChartResult {
  meta?: { regularMarketPrice?: number };
  timestamp?: number[];
  indicators?: { quote?: { close?: (number | null)[] }[] };
}

// Last close on or before `target`. Ratios are unaffected by pence/points
// scaling, so raw quotes are fine here; px_scale is applied at display time.
function closeAt(ts: number[], closes: (number | null)[], target: number): number | null {
  let best: number | null = null;
  for (let i = 0; i < ts.length; i++) {
    const c = closes[i];
    if (ts[i] * 1000 <= target && c != null && isFinite(c)) best = c;
  }
  return best;
}

async function fetchOne(symbol: string): Promise<Quote | null> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?range=7mo&interval=1d`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (internal dashboard)" },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { chart?: { result?: ChartResult[] } };
  const r = data.chart?.result?.[0];
  const ts = r?.timestamp ?? [];
  const closes = r?.indicators?.quote?.[0]?.close ?? [];
  const price =
    r?.meta?.regularMarketPrice ?? closeAt(ts, closes, Date.now()) ?? null;
  if (price == null) return null;

  const perf = (days: number): number | null => {
    const base = closeAt(ts, closes, Date.now() - days * DAY);
    return base != null && base !== 0 ? price / base - 1 : null;
  };

  return {
    symbol,
    price,
    m1: perf(30),
    m3: perf(91),
    m6: perf(182),
    as_of: new Date().toISOString(),
  };
}

export async function fetchYahooQuotes(symbols: string[]): Promise<Quote[]> {
  const unique = Array.from(new Set(symbols.filter(Boolean)));
  const results = await Promise.allSettled(unique.map((s) => fetchOne(s)));
  const out: Quote[] = [];
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) out.push(r.value);
  }
  return out;
}
