import dashboard from "@/data/dashboard.json";

// ---- Types mirroring pipeline/parse_excel.py output ----------------------- //
export interface FinancialRow {
  label: string;
  values: (number | null)[];
  delta_abs: (number | null)[];
  delta_pct: (number | null)[];
  is_total: boolean;
}

export interface ThreeDateTable {
  title: string;
  value_label: string;
  dates: string[];
  dates_iso: (string | null)[];
  rows: FinancialRow[];
  pct_of_spx: FinancialRow[];
}

export interface GrowthTable {
  title: string;
  value_label: string;
  years: string[];
  delta_years: string[];
  rows: FinancialRow[];
  pct_of_spx: FinancialRow[];
}

export interface NtmPeRow {
  label: string;
  mkt_cap: number | null;
  ntm_ni: number | null;
  ntm_pe: number | null;
  avg_since: (number | null)[];
  delta_vs_avg: (number | null)[];
  series: (number | null)[];
  is_total: boolean;
}

export interface NtmPeTableData {
  title: string;
  current_label: string;
  avg_dates: string[];
  series_dates: (string | null)[];
  rows: NtmPeRow[];
}

// ---- Per-stock metrics (the Data sheet) ----------------------------------- //
export interface StockMetric {
  values: (number | null)[];
  delta_abs: (number | null)[];
  delta_pct: (number | null)[];
}
export interface StockPe {
  mkt_cap: number | null;
  ntm_ni: number | null;
  ntm_pe: number | null;
  series: (number | null)[];
}
export interface CategoryStock {
  name: string;
  ticker: string;
  is_compounder?: boolean;
  performance: StockMetric;
  earnings: StockMetric;
  est_2026: StockMetric;
  est_2027: StockMetric;
  pe: StockPe;
}

export interface CategoryEntry {
  category: string;
  slug: string;
  members: string[];
  stocks: CategoryStock[];
}
export interface CategoryGroup {
  group: string;
  categories: CategoryEntry[];
}
export interface CategoriesTableData {
  title: string;
  groups: CategoryGroup[];
}

// The aggregate tables, minus the per-stock categories map (which never has a
// compounder-only variant — those pages filter their own rows client-side).
export interface AggregateTables {
  stock_performance: ThreeDateTable;
  est_rev_2026: ThreeDateTable;
  est_rev_2027: ThreeDateTable;
  earnings_growth: GrowthTable;
  ntm_pe: NtmPeTableData;
}

export interface DashboardData {
  generated_at: string;
  // ISO yyyy-mm-dd date the workbook was refreshed/emailed (may be absent on
  // data produced before this field existed).
  refreshed_date?: string | null;
  // ISO yyyy-mm-dd date of the latest Bloomberg data (Data!AC10) — the value
  // quoted as "data as of" everywhere in the UI.
  bloomberg_date?: string | null;
  latest_date: string;
  tables: AggregateTables & {
    categories: CategoriesTableData;
  };
  // Compounders-only roll-ups of every aggregate table (Data!D="yes").
  tables_compounders?: AggregateTables;
}

export function getDashboard(): DashboardData {
  return dashboard as unknown as DashboardData;
}

// The compounder-only aggregate tables, if present in the data file.
export function getCompounderTables(): AggregateTables | null {
  return getDashboard().tables_compounders ?? null;
}

export interface ResolvedCategory {
  group: string;
  category: CategoryEntry;
}

export function getCategoryBySlug(slug: string): ResolvedCategory | null {
  const { groups } = getDashboard().tables.categories;
  for (const g of groups) {
    for (const c of g.categories) {
      if (c.slug === slug) return { group: g.group, category: c };
    }
  }
  return null;
}

// Slugs of categories that have per-stock detail (every category does now,
// including Miscellaneous = the rest of the S&P 500).
// Map of ticker symbol -> company name, drawn from the tracked S&P 500
// universe (tickers are stored Bloomberg-style, e.g. "NVDA US Equity").
export function getStockNameMap(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const g of getDashboard().tables.categories.groups) {
    for (const c of g.categories) {
      for (const s of c.stocks ?? []) {
        const sym = (s.ticker || "").split(" ")[0].toUpperCase();
        if (sym && s.name) out[sym] = s.name;
      }
    }
  }
  return out;
}

export function getCategorySlugs(): string[] {
  const { groups } = getDashboard().tables.categories;
  const slugs: string[] = [];
  for (const g of groups) {
    for (const c of g.categories) {
      if ((c.stocks?.length ?? 0) > 0) slugs.push(c.slug);
    }
  }
  return slugs;
}

// The "data as of" date shown once at the top of every view: the latest
// Bloomberg data date (Data!AC10), formatted M/D/YYYY with no time.
// Falls back to latest_date for older data without the field.
export function bloombergDateLabelOf(d: DashboardData): string {
  if (d.bloomberg_date) {
    const [y, m, day] = d.bloomberg_date.split("-").map(Number);
    if (y && m && day) return `${m}/${day}/${y}`;
  }
  return d.latest_date;
}

export function getBloombergDateLabel(): string {
  return bloombergDateLabelOf(getDashboard());
}

// ---- Sidebar navigation model -------------------------------------------- //
export interface NavItem {
  slug: string;
  label: string;
  count: number;
  // How many of the category's stocks are compounders (shown when the
  // "Compounders only" filter is active).
  compounderCount: number;
}
export interface NavGroup {
  group: string;
  items: NavItem[];
}

export function getNavModel(): NavGroup[] {
  const { groups } = getDashboard().tables.categories;
  return groups.map((g) => ({
    group: g.group,
    items: g.categories
      .filter((c) => (c.stocks?.length ?? 0) > 0)
      .map((c) => ({
        slug: c.slug,
        label: c.category,
        count: c.members.length,
        compounderCount: c.stocks.filter((s) => s.is_compounder).length,
      })),
  }));
}
