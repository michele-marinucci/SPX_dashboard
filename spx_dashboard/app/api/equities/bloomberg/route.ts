// Bloomberg push endpoint, used by pipeline/bloomberg_push.py running on an
// analyst's terminal PC. Sits behind the same password gate as everything
// else — the script logs in with SITE_PASSWORD and reuses the session cookie.
//
// GET  → the universe the script should fetch: every non-removed name's
//        Bloomberg ID + Yahoo symbol, which forecast years the index BEst
//        P/E columns currently display, and the close date already cached
//        (`bloomberg_data_date`) so the script can skip redundant runs
//        without spending a single Bloomberg hit.
// POST → { quotes: [...], companies: [...], data_date }:
//        quotes    → upserted into eq_market (source "Bloomberg"; the
//                     freshest write wins over the Yahoo self-refresh)
//        companies → per-ticker patches for the Bloomberg-only fields the
//                     site can't get elsewhere: 1M/3M/6M perf fallback,
//                     3M ADV, and index BEst P/E by year.
import { NextRequest, NextResponse } from "next/server";
import { dbGetQuotes, dbUpdateCompany, dbUpsertQuotes, equitiesEnabled } from "@/lib/equitiesDb";
import { loadCompanies } from "@/lib/equities/load";
import { displayYears } from "@/lib/equities/calc";
import { Quote } from "@/lib/equities/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const { enabled, companies } = await loadCompanies();

  // Latest close date a previous Bloomberg push wrote (null if none yet).
  let bbgDataDate: string | null = null;
  if (enabled) {
    try {
      for (const q of await dbGetQuotes()) {
        if (q.source === "Bloomberg" && q.data_date) {
          if (!bbgDataDate || q.data_date > bbgDataDate) bbgDataDate = q.data_date;
        }
      }
    } catch {
      /* pre-upgrade table — script will just do a full run */
    }
  }

  return NextResponse.json({
    years: displayYears(new Date()),
    bloomberg_data_date: bbgDataDate,
    securities: companies
      .filter((c) => !c.removed)
      .map((c) => ({
        ticker: c.ticker,
        bbg: c.bbg,
        yahoo: c.yahoo,
        is_index: c.is_index,
      })),
  });
}

function asNum(v: unknown): number | null {
  return typeof v === "number" && isFinite(v) ? v : null;
}

export async function POST(req: NextRequest) {
  if (!equitiesEnabled()) {
    return NextResponse.json(
      { error: "Shared database not configured." },
      { status: 503 },
    );
  }
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  try {
    const now = new Date().toISOString();
    // The trading day the pushed values are as-of (prior close). The script
    // sends it; fall back to today's date if it's missing or malformed.
    const rawDate = String(body.data_date ?? "");
    const dataDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : now.slice(0, 10);
    let wroteQuotes = 0;
    let patched = 0;

    if (Array.isArray(body.quotes)) {
      const quotes: Quote[] = [];
      for (const q of body.quotes as Record<string, unknown>[]) {
        const symbol = String(q.symbol ?? "").trim();
        const price = asNum(q.price);
        if (!symbol || price == null) continue;
        quotes.push({
          symbol,
          price,
          m1: asNum(q.m1),
          m3: asNum(q.m3),
          m6: asNum(q.m6),
          source: "Bloomberg",
          data_date: dataDate,
          as_of: now,
        });
      }
      await dbUpsertQuotes(quotes);
      wroteQuotes = quotes.length;
    }

    if (Array.isArray(body.companies)) {
      const { enabled, companies } = await loadCompanies();
      if (enabled) {
        for (const u of body.companies as Record<string, unknown>[]) {
          const ticker = String(u.ticker ?? "").trim();
          const c = companies.find((x) => x.ticker === ticker);
          if (!c) continue;

          const patch: Record<string, unknown> = {};
          const perf = u.perf as Record<string, unknown> | undefined;
          if (perf) {
            patch.perf = {
              m1: asNum(perf.m1) ?? c.perf.m1,
              m3: asNum(perf.m3) ?? c.perf.m3,
              m6: asNum(perf.m6) ?? c.perf.m6,
            };
          }
          if (asNum(u.adv_3m) != null) patch.adv_3m = asNum(u.adv_3m);
          const bp = u.best_pe as Record<string, unknown> | undefined;
          if (bp && c.is_index) {
            const merged = { ...(c.best_pe ?? {}) };
            for (const [yr, v] of Object.entries(bp)) {
              if (/^\d{4}$/.test(yr) && asNum(v) != null) merged[yr] = asNum(v)!;
            }
            patch.best_pe = merged;
          }
          if (Object.keys(patch).length) {
            await dbUpdateCompany(ticker, patch);
            patched++;
          }
        }
      }
    }

    return NextResponse.json({ ok: true, quotes: wroteQuotes, companies: patched });
  } catch (e) {
    console.error("equities bloomberg POST failed", e);
    return NextResponse.json({ error: "Database error." }, { status: 502 });
  }
}
