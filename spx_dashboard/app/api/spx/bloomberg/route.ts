// SPX Monitor Bloomberg push endpoint, used by pipeline/bloomberg_push.py.
// Sits behind the same password gate as everything else.
//
// GET  → the S&P 500 universe (Bloomberg-style tickers from the committed
//        workbook snapshot), which consensus years to refresh, and the close
//        date already cached so the script can skip redundant runs.
// POST → { quotes: [{ ticker, mkt_cap, est_ni, ntm_ni }], data_date }:
//        upserted into spx_market ($ billions; the site overlays them onto
//        the workbook snapshot when newer — see lib/spxLive.ts).
import { NextRequest, NextResponse } from "next/server";
import { getDashboard } from "@/lib/data";
import { dbGetSpxQuotes, dbUpsertSpxQuotes, spxEnabled, SpxQuote } from "@/lib/spxDb";

export const dynamic = "force-dynamic";

export async function GET() {
  const d = getDashboard();
  const tickers: string[] = [];
  for (const g of d.tables.categories.groups)
    for (const c of g.categories)
      for (const s of c.stocks ?? []) if (s.ticker) tickers.push(s.ticker);

  // Refresh consensus for the snapshot's forecast years that are current or
  // future; past years are reported actuals and never change.
  const thisYear = new Date().getUTCFullYear();
  const years = d.tables.earnings_growth.years.filter((y) => Number(y) >= thisYear);

  let dataDate: string | null = null;
  if (spxEnabled()) {
    try {
      for (const q of await dbGetSpxQuotes()) {
        if (q.data_date && (!dataDate || q.data_date > dataDate)) dataDate = q.data_date;
      }
    } catch {
      /* table missing → script will just do a full run */
    }
  }

  return NextResponse.json({
    tickers,
    years,
    bloomberg_data_date: dataDate,
    snapshot_date: d.bloomberg_date ?? null,
  });
}

function asNum(v: unknown): number | null {
  return typeof v === "number" && isFinite(v) ? v : null;
}

export async function POST(req: NextRequest) {
  if (!spxEnabled()) {
    return NextResponse.json({ error: "Shared database not configured." }, { status: 503 });
  }
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  try {
    const now = new Date().toISOString();
    const rawDate = String(body.data_date ?? "");
    const dataDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : now.slice(0, 10);

    const rows: SpxQuote[] = [];
    for (const q of (Array.isArray(body.quotes) ? body.quotes : []) as Record<
      string,
      unknown
    >[]) {
      const ticker = String(q.ticker ?? "").trim();
      if (!ticker) continue;
      const est: Record<string, number> = {};
      for (const [y, v] of Object.entries((q.est_ni as object) ?? {})) {
        if (/^\d{4}$/.test(y) && asNum(v) != null) est[y] = asNum(v)!;
      }
      rows.push({
        ticker,
        mkt_cap: asNum(q.mkt_cap),
        est_ni: Object.keys(est).length ? est : null,
        ntm_ni: asNum(q.ntm_ni),
        data_date: dataDate,
        as_of: now,
      });
    }
    await dbUpsertSpxQuotes(rows);
    return NextResponse.json({ ok: true, quotes: rows.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Database error.";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
