// Server-only Yahoo Finance quotes (free, unofficial; fine for an internal
// team dashboard). One chart call per symbol returns ~eight months of daily
// closes. We deliberately use the PRIOR trading day's close (never the live
// intraday price), so the dashboard shows a stable as-of date and we never
// need to poll more than once a day — the replacement for the workbook's
// Bloomberg PX_LAST / CHG_PCT fields.
import { Quote } from "./types";

const DAY = 86_400_000;

interface ChartResult {
  timestamp?: number[];
  indicators?: { quote?: { close?: (number | null)[] }[] };
}

// The last daily bar on or before `target`: its close plus the trading date.
// Ratios are unaffected by pence/points scaling, so raw quotes are fine here;
// px_scale is applied at display time.
function barAt(
  ts: number[],
  closes: (number | null)[],
  target: number,
): { close: number; date: string } | null {
  let best: { close: number; date: string } | null = null;
  for (let i = 0; i < ts.length; i++) {
    const c = closes[i];
    if (ts[i] * 1000 <= target && c != null && isFinite(c)) {
      best = { close: c, date: new Date(ts[i] * 1000).toISOString().slice(0, 10) };
    }
  }
  return best;
}

async function fetchOne(symbol: string): Promise<Quote | null> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?range=8mo&interval=1d`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (internal dashboard)" },
    cache: "no-store",
    // Yahoo occasionally hangs; without a deadline this stalls the whole
    // quote refresh (callers handle the rejection via Promise.allSettled).
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { chart?: { result?: ChartResult[] } };
  const r = data.chart?.result?.[0];
  const ts = r?.timestamp ?? [];
  const closes = r?.indicators?.quote?.[0]?.close ?? [];

  // Endpoint = the most recent close strictly before today (UTC), i.e. the
  // prior trading day. Today's still-forming bar is excluded.
  const startOfToday = Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate(),
  );
  const endpoint = barAt(ts, closes, startOfToday);
  if (endpoint == null) return null;

  // Performance windows are measured back from the endpoint's date.
  const anchor = Date.parse(`${endpoint.date}T12:00:00Z`);
  const perf = (days: number): number | null => {
    const base = barAt(ts, closes, anchor - days * DAY);
    return base != null && base.close !== 0 ? endpoint.close / base.close - 1 : null;
  };

  return {
    symbol,
    price: endpoint.close,
    m1: perf(30),
    m3: perf(91),
    m6: perf(182),
    source: "Yahoo",
    data_date: endpoint.date,
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
