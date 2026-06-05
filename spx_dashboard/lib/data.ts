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

export interface DashboardData {
  generated_at: string;
  latest_date: string;
  tables: {
    stock_performance: ThreeDateTable;
    est_rev_2026: ThreeDateTable;
    est_rev_2027: ThreeDateTable;
    earnings_growth: GrowthTable;
    ntm_pe: NtmPeTableData;
    categories: CategoriesTableData;
  };
}

export function getDashboard(): DashboardData {
  return dashboard as unknown as DashboardData;
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

// Slugs of categories that actually have per-stock detail (skip placeholders
// like "Miscellaneous → All remaining 428 stocks").
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
