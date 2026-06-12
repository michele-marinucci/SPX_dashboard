// Equities Dashboard API. Sits behind the password gate (middleware).
//
// GET  → full state: companies (DB if configured, committed seed otherwise)
//        plus market quotes (prior-day closes). Quotes are cached in Supabase
//        and refreshed from Yahoo at most once a day (or on ?refresh=1), so
//        any visitor self-heals stale prices without a cron job.
// POST → analyst actions: update / add / remove / log. Every model change is
//        appended to the eq_edits log with old → new values.
import { NextRequest, NextResponse } from "next/server";
import {
  dbGetAllEdits,
  dbGetCompanies,
  dbGetEdits,
  dbInsertCompany,
  dbInsertEdit,
  dbSetRemoved,
  dbUpdateCompany,
  equitiesEnabled,
} from "@/lib/equitiesDb";
import { latestAsOf, latestDataDate, loadCompanies, loadQuotes } from "@/lib/equities/load";
import { Company, emptyModel, EquityModel, FieldChange } from "@/lib/equities/types";

export const dynamic = "force-dynamic";

const MODEL_SERIES = new Set([
  "revs",
  "gm",
  "adj_eps",
  "mendo_eps",
  "target_mult",
  "ncps",
  "wadso",
  "net_debt",
  "dps",
]);
const MODEL_SCALARS = new Set(["shares", "cash", "debt", "min_int"]);
const TOP_FIELDS = new Set(["port", "grp", "yield_input"]);

// Free-text fields end up inside Excel formulas (bbg → =BDP("…")) and XML, so
// strip quote/angle characters and cap the length before they reach the DB.
function cleanStr(v: unknown, max: number): string {
  return String(v ?? "").replace(/["<>]/g, "").trim().slice(0, max);
}

export async function GET(req: NextRequest) {
  const { enabled, companies } = await loadCompanies();
  const force = req.nextUrl.searchParams.get("refresh") === "1";
  const quotes = await loadQuotes(companies, enabled, force);
  return NextResponse.json({
    enabled,
    companies,
    quotes,
    prices_as_of: latestAsOf(quotes),
    prices_data_date: latestDataDate(quotes),
  });
}

// Apply one dotted-path change ("revs.2027", "shares", "port", "best_pe.2026")
// to a company row; returns the old value, or undefined for an invalid path.
function applyChange(
  c: Company,
  path: string,
  value: number | string | null,
): number | string | null | undefined {
  const [head, year] = path.split(".");
  if (MODEL_SERIES.has(head) && year && /^\d{4}$/.test(year)) {
    const series = c.model[head as keyof EquityModel] as Record<string, number>;
    const old = series[year] ?? null;
    if (value == null) delete series[year];
    else if (typeof value === "number" && isFinite(value)) series[year] = value;
    else return undefined;
    return old;
  }
  if (MODEL_SCALARS.has(head) && !year) {
    const key = head as "shares" | "cash" | "debt" | "min_int";
    const old = c.model[key];
    if (value !== null && typeof value !== "number") return undefined;
    c.model[key] = value;
    return old;
  }
  if (head === "best_pe" && year && /^\d{4}$/.test(year)) {
    if (!c.best_pe) c.best_pe = {};
    const old = c.best_pe[year] ?? null;
    if (value == null) delete c.best_pe[year];
    else if (typeof value === "number" && isFinite(value)) c.best_pe[year] = value;
    else return undefined;
    return old;
  }
  if (TOP_FIELDS.has(head) && !year) {
    const old = c[head as "port" | "grp" | "yield_input"] as number | string | null;
    if (head === "grp") {
      if (typeof value !== "string" || !cleanStr(value, 60)) return undefined;
      c.grp = cleanStr(value, 60);
    } else if (head === "port") {
      if (value !== null && value !== 1 && value !== 2) return undefined;
      c.port = value;
    } else {
      if (value !== null && typeof value !== "number") return undefined;
      c.yield_input = value;
    }
    return old;
  }
  return undefined;
}

export async function POST(req: NextRequest) {
  if (!equitiesEnabled()) {
    return NextResponse.json(
      { error: "Shared database not configured — edits are disabled." },
      { status: 503 },
    );
  }
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const action = String(body.action ?? "");
  const analyst = String(body.analyst ?? "").trim();
  const ticker = String(body.ticker ?? "").trim();

  // Aggregate activity log spans every company, so it has no ticker.
  if (action === "logAll") {
    try {
      const edits = await dbGetAllEdits();
      return NextResponse.json({ ok: true, edits });
    } catch (e) {
      console.error("equities logAll failed", e);
      return NextResponse.json({ error: "Database error." }, { status: 502 });
    }
  }

  if (!ticker) return NextResponse.json({ error: "Ticker is required." }, { status: 400 });

  try {
    if (action === "log") {
      const edits = await dbGetEdits(ticker);
      return NextResponse.json({ ok: true, edits });
    }

    if (!analyst) {
      return NextResponse.json({ error: "Analyst is required." }, { status: 400 });
    }

    if (action === "update") {
      const companies = await dbGetCompanies();
      const c = companies.find((x) => x.ticker === ticker);
      if (!c) return NextResponse.json({ error: "Unknown ticker." }, { status: 404 });

      const changes: FieldChange[] = [];
      const requested = (body.changes ?? {}) as Record<string, number | string | null>;
      for (const [path, value] of Object.entries(requested)) {
        const old = applyChange(c, path, value);
        if (old === undefined) {
          return NextResponse.json({ error: `Invalid field: ${path}` }, { status: 400 });
        }
        if (old !== value) changes.push({ field: path, old, new: value });
      }
      if (!changes.length) {
        return NextResponse.json({ ok: true, company: c, changes: [] });
      }
      const today = new Date().toISOString().slice(0, 10);
      await dbUpdateCompany(ticker, {
        model: c.model,
        best_pe: c.best_pe,
        port: c.port,
        grp: c.grp,
        yield_input: c.yield_input,
        update_date: today,
        update_by: analyst,
      });
      await dbInsertEdit(ticker, analyst, changes);
      c.update_date = today;
      c.update_by = analyst;
      return NextResponse.json({ ok: true, company: c, changes });
    }

    if (action === "add") {
      const companies = await dbGetCompanies();
      const existing = companies.find((x) => x.ticker === ticker);
      if (existing?.removed) {
        // Re-adding a removed name restores it with its old model intact.
        await dbSetRemoved(ticker, false, analyst);
        await dbInsertEdit(ticker, analyst, [{ field: "__restored__", old: null, new: ticker }]);
        existing.removed = false;
        return NextResponse.json({ ok: true, company: existing, restored: true });
      }
      if (existing) {
        return NextResponse.json({ error: "Ticker already exists." }, { status: 409 });
      }
      const grp = cleanStr(body.grp, 60) || "Other sectors";
      const inGroup = companies.filter((x) => x.grp === grp);
      const grpOrder = inGroup.length
        ? inGroup[0].grp_order
        : Math.max(0, ...companies.filter((x) => !x.is_index).map((x) => x.grp_order)) + 1;
      const row: Company = {
        ticker,
        bbg: cleanStr(body.bbg, 40) || `${ticker} US EQUITY`,
        yahoo: cleanStr(body.yahoo, 24) || ticker,
        currency: cleanStr(body.currency, 6) || "$",
        px_scale: 1,
        grp,
        grp_order: grpOrder,
        row_order: Math.max(-1, ...inGroup.map((x) => x.row_order)) + 1,
        port: body.port === 1 || body.port === 2 ? (body.port as number) : null,
        update_date: new Date().toISOString().slice(0, 10),
        update_by: analyst,
        variant: "pe",
        cash_in_target: false,
        div_yield_mode: "dps",
        decomp: "standard",
        yield_input: null,
        adv_3m: null,
        perf: { m1: null, m3: null, m6: null },
        model: emptyModel(),
        is_index: false,
        best_pe: null,
        removed: false,
      };
      await dbInsertCompany(row);
      await dbInsertEdit(ticker, analyst, [{ field: "__added__", old: null, new: ticker }]);
      return NextResponse.json({ ok: true, company: row });
    }

    if (action === "remove" || action === "restore") {
      const removed = action === "remove";
      await dbSetRemoved(ticker, removed, analyst);
      await dbInsertEdit(ticker, analyst, [
        removed
          ? { field: "__removed__", old: ticker, new: null }
          : { field: "__restored__", old: null, new: ticker },
      ]);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    console.error("equities POST failed", e);
    return NextResponse.json({ error: "Database error." }, { status: 502 });
  }
}
