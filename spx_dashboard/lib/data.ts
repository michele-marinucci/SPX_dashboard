import dashboard from "@/data/dashboard.json";
import commentary from "@/data/commentary.json";

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

export interface CategoryEntry {
  category: string;
  members: string[];
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
    appendix: { present: boolean; note: string };
  };
}

export function getDashboard(): DashboardData {
  return dashboard as unknown as DashboardData;
}

export type CommentaryMap = Record<string, string[]>;

export function getCommentary(key: string): string[] {
  const map = commentary as unknown as CommentaryMap;
  const v = map[key];
  return Array.isArray(v) ? v : [];
}
