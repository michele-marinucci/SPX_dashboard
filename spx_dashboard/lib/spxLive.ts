// SPX Monitor live overlay: merges the daily Bloomberg push (spx_market,
// written by pipeline/bloomberg_push.py) onto the committed workbook snapshot
// (data/dashboard.json).
//
// The workbook snapshot stays the source of truth for everything historical —
// the 1/1 and quarter-start anchor columns, P/E averages and history series,
// past-year earnings. The overlay only replaces the "current" values (current
// market cap, current-year+ consensus NI, NTM NI), then recomputes every
// aggregate row from the per-stock values the same way the workbook does:
// category row = Σ member stocks, group totals = Σ categories, Total SPX =
// Σ all 500, % of SPX = row / Total SPX, NTM P/E = Σ mkt cap / Σ NTM NI.
//
// The overlay is applied only when the pushed data is strictly NEWER than the
// workbook snapshot, so re-parsing a fresh workbook always wins.
import {
  AggregateTables,
  CategoryStock,
  DashboardData,
  FinancialRow,
  getDashboard,
  GrowthTable,
  NtmPeTableData,
  StockMetric,
  ThreeDateTable,
} from "@/lib/data";
import { dbGetSpxQuotes, spxEnabled, SpxQuote } from "@/lib/spxDb";

// ---- helpers --------------------------------------------------------------- //
function labelOf(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${m}/${d}/${String(y).slice(-2)}`;
}

// Recompute a 3-date metric's Δ columns after values[2] changed.
function redelta3(m: StockMetric | FinancialRow): void {
  const v = m.values;
  m.delta_abs = [0, 1].map((i) =>
    v[2] != null && v[i] != null ? v[2]! - v[i]! : null,
  );
  m.delta_pct = [0, 1].map((i) =>
    v[2] != null && v[i] ? v[2]! / v[i]! - 1 : null,
  );
}

// Recompute YoY Δ columns for a growth metric (years[1:] vs prior year).
function redeltaYoY(m: StockMetric | FinancialRow): void {
  const v = m.values;
  m.delta_abs = v.slice(1).map((x, i) => (x != null && v[i] != null ? x - v[i]! : null));
  m.delta_pct = v.slice(1).map((x, i) => (x != null && v[i] ? x / v[i]! - 1 : null));
}

// ---- per-stock patching ----------------------------------------------------- //
function patchStock(s: CategoryStock, q: SpxQuote, yearIdx: Record<string, number>): void {
  if (q.mkt_cap != null) {
    s.performance.values[2] = q.mkt_cap;
    redelta3(s.performance);
    s.pe.mkt_cap = q.mkt_cap;
  }
  for (const [year, ni] of Object.entries(q.est_ni ?? {})) {
    if (typeof ni !== "number" || !isFinite(ni)) continue;
    const est = year === "2026" ? s.est_2026 : year === "2027" ? s.est_2027 : null;
    // est_2026/est_2027 are fixed table keys; the earnings table is keyed by
    // the years array so it rolls with the workbook.
    const generic = (s as unknown as Record<string, StockMetric | undefined>)[`est_${year}`];
    const target = est ?? generic;
    if (target) {
      target.values[2] = ni;
      redelta3(target);
    }
    const yi = yearIdx[year];
    if (yi != null) s.earnings.values[yi] = ni;
  }
  redeltaYoY(s.earnings);
  if (q.ntm_ni != null && isFinite(q.ntm_ni)) s.pe.ntm_ni = q.ntm_ni;
  if (s.pe.mkt_cap != null && s.pe.ntm_ni) s.pe.ntm_pe = s.pe.mkt_cap / s.pe.ntm_ni;
}

// ---- aggregate recompute ----------------------------------------------------- //
type StockPick = (s: CategoryStock) => number | null;

interface Sum {
  v: number;
  n: number; // stocks contributing — 0 means "no members" → keep workbook null
}

interface Sums {
  byCategory: Map<string, Sum>; // category name → Σ
  byGroup: Map<string, Sum>; // group name → Σ
  all: Sum;
  any: boolean;
}

function sumStocks(d: DashboardData, pick: StockPick, compoundersOnly: boolean): Sums {
  const byCategory = new Map<string, Sum>();
  const byGroup = new Map<string, Sum>();
  const all: Sum = { v: 0, n: 0 };
  let any = false;
  const add = (m: Map<string, Sum>, key: string, v: number) => {
    const e = m.get(key) ?? { v: 0, n: 0 };
    e.v += v;
    e.n += 1;
    m.set(key, e);
  };
  for (const g of d.tables.categories.groups) {
    for (const c of g.categories) {
      if (!byCategory.has(c.category)) byCategory.set(c.category, { v: 0, n: 0 });
      if (!byGroup.has(g.group)) byGroup.set(g.group, { v: 0, n: 0 });
      for (const st of c.stocks ?? []) {
        if (compoundersOnly && !st.is_compounder) continue;
        const v = pick(st);
        if (v != null && isFinite(v)) {
          add(byCategory, c.category, v);
          add(byGroup, g.group, v);
          all.v += v;
          all.n += 1;
          any = true;
        }
      }
    }
  }
  return { byCategory, byGroup, all, any };
}

// Aggregate-row label → its constituent sum. Labels that can't be resolved
// (workbook-only analytic rows like "Other AI capex beneficiaries") and
// constituencies with no contributing stocks (e.g. a category with no
// compounders) return null and are left exactly as the workbook computed.
function resolveRow(label: string, sums: Sums): number | null {
  const pickSum = (s: Sum | undefined): number | null =>
    s && s.n > 0 ? s.v : null;
  if (label === "Total SPX" || label === "S&P 500") return pickSum(sums.all);
  if (sums.byCategory.has(label)) return pickSum(sums.byCategory.get(label));
  const total = label.match(/^Total (.+)$/);
  if (total && sums.byGroup.has(total[1])) return pickSum(sums.byGroup.get(total[1]));
  if (sums.byGroup.has(label)) return pickSum(sums.byGroup.get(label));
  // Workbook display names that differ from the category names.
  const alias: Record<string, string> = {
    "Infrastructure software": "Infrastructure",
    "Application software": "Application",
    Other: "Miscellaneous",
  };
  const a = alias[label];
  if (a && sums.byCategory.has(a)) return pickSum(sums.byCategory.get(a));
  return null;
}

function rebuildThreeDate(t: ThreeDateTable, sums: Sums, label: string, iso: string): void {
  if (!sums.any) return;
  for (const r of t.rows) {
    const v = resolveRow(r.label, sums);
    if (v == null) continue;
    r.values[2] = v;
    redelta3(r);
  }
  for (const r of t.pct_of_spx) {
    const v = resolveRow(r.label, sums);
    if (v == null || !sums.all.n || !sums.all.v) continue;
    r.values[2] = v / sums.all.v;
    redelta3(r);
  }
  t.dates[2] = label;
  if (t.dates_iso) t.dates_iso[2] = iso;
}

function rebuildGrowth(t: GrowthTable, sumsByYear: Map<string, Sums>): void {
  for (const r of t.rows) {
    t.years.forEach((y, i) => {
      const sums = sumsByYear.get(y);
      if (!sums?.any) return;
      const v = resolveRow(r.label, sums);
      if (v != null) r.values[i] = v;
    });
    redeltaYoY(r);
  }
  for (const r of t.pct_of_spx) {
    t.years.forEach((y, i) => {
      const sums = sumsByYear.get(y);
      if (!sums?.any || !sums.all.n || !sums.all.v) return;
      const v = resolveRow(r.label, sums);
      if (v != null) r.values[i] = v / sums.all.v;
    });
    redeltaYoY(r);
  }
}

function rebuildNtmPe(t: NtmPeTableData, mc: Sums, ni: Sums, label: string): void {
  if (!mc.any || !ni.any) return;
  for (const r of t.rows) {
    const m = resolveRow(r.label, mc);
    const n = resolveRow(r.label, ni);
    if (m == null || n == null || !n) continue;
    r.mkt_cap = m;
    r.ntm_ni = n;
    r.ntm_pe = m / n;
    r.delta_vs_avg = r.avg_since.map((a) => (a ? r.ntm_pe! / a - 1 : null));
  }
  t.current_label = `Current (${label})`;
}

// ---- public API -------------------------------------------------------------- //
// Pure: returns a deep copy of `base` with the quotes overlaid. Exported for
// tests; the site uses loadSpxDashboard() below.
export function applySpxOverlay(
  base: DashboardData,
  quotes: SpxQuote[],
  dataDate: string,
): DashboardData {
  const d = structuredClone(base) as DashboardData;
  const label = labelOf(dataDate);
  const byTicker = new Map(quotes.map((q) => [q.ticker, q]));
  const yearIdx: Record<string, number> = {};
  d.tables.earnings_growth.years.forEach((y, i) => (yearIdx[y] = i));

  for (const g of d.tables.categories.groups)
    for (const c of g.categories)
      for (const s of c.stocks ?? []) {
        const q = byTicker.get(s.ticker);
        if (q) patchStock(s, q, yearIdx);
      }

  const estYears = new Set(quotes.flatMap((q) => Object.keys(q.est_ni ?? {})));
  for (const compounders of [false, true]) {
    const tables: AggregateTables | undefined = compounders
      ? d.tables_compounders
      : d.tables;
    if (!tables) continue;
    const mc = sumStocks(d, (s) => s.performance.values[2], compounders);
    rebuildThreeDate(tables.stock_performance, mc, label, dataDate);
    for (const [key, year] of [
      ["est_rev_2026", "2026"],
      ["est_rev_2027", "2027"],
    ] as const) {
      if (!estYears.has(year)) continue;
      const sums = sumStocks(
        d,
        (s) => (year === "2026" ? s.est_2026 : s.est_2027).values[2],
        compounders,
      );
      rebuildThreeDate(tables[key], sums, label, dataDate);
    }
    const sumsByYear = new Map<string, Sums>();
    for (const y of d.tables.earnings_growth.years) {
      if (!estYears.has(y)) continue;
      sumsByYear.set(y, sumStocks(d, (s) => s.earnings.values[yearIdx[y]], compounders));
    }
    rebuildGrowth(tables.earnings_growth, sumsByYear);
    const ntm = sumStocks(d, (s) => s.pe.ntm_ni, compounders);
    const peMc = sumStocks(d, (s) => s.pe.mkt_cap, compounders);
    rebuildNtmPe(tables.ntm_pe, peMc, ntm, label);
  }

  d.bloomberg_date = dataDate;
  d.latest_date = label;
  return d;
}

// The dashboard the SPX pages should render: the workbook snapshot, overlaid
// with the daily Bloomberg push when (and only when) the push is newer.
// Any failure falls back to the committed snapshot — the page never breaks.
export async function loadSpxDashboard(): Promise<DashboardData> {
  const base = getDashboard();
  if (!spxEnabled()) return base;
  try {
    const quotes = await dbGetSpxQuotes();
    const dataDate = quotes
      .map((q) => q.data_date)
      .filter((x): x is string => !!x)
      .sort()
      .pop();
    if (!dataDate) return base;
    if (base.bloomberg_date && dataDate <= base.bloomberg_date) return base;
    return applySpxOverlay(base, quotes, dataDate);
  } catch {
    return base;
  }
}
