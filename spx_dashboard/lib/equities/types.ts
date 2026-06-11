// Shared shapes for the Equities Dashboard (the team's "Detailed Dashboard"
// brought online). The editable model lives in Supabase as one row per
// company; every derived column (EV/GP, Mendo P/E, IRR, MoM, decomp) is
// recomputed from these inputs in lib/equities/calc.ts.

// Year-keyed series, e.g. { "2027": 11959.2 }. Keys are absolute years so the
// visible window can roll forward every January 1 with no migration.
export type YearMap = Record<string, number>;

export interface EquityModel {
  revs: YearMap;
  gm: YearMap; // gross margin as a fraction; GP is always gm × revs
  adj_eps: YearMap;
  mendo_eps: YearMap;
  target_mult: YearMap;
  ncps: YearMap; // net cash per share
  wadso: YearMap; // weighted avg diluted shares outstanding
  net_debt: YearMap;
  dps: YearMap;
  shares: number | null;
  cash: number | null; // negative = net cash holding, as in the sheet
  debt: number | null;
  min_int: number | null;
}

// How the year-end target price is built (mirrors the per-row Excel formulas):
//   pe     – target P/E × NTM Mendo EPS (+ net cash per share when flagged)
//   gp_ev  – (target EV/GP × NTM gross profit − net debt) / WADSO
//   gp_ps  – target EV/GP × NTM gross profit / NTM WADSO + net cash per share
//   rev_ps – target EV/Revs × NTM revenue / NTM WADSO + net cash per share
export type TargetVariant = "pe" | "gp_ev" | "gp_ps" | "rev_ps";

export interface Company {
  ticker: string;
  bbg: string;
  yahoo: string | null;
  currency: string;
  px_scale: number; // e.g. 0.01 for LSE symbols quoted in pence
  grp: string;
  grp_order: number;
  row_order: number;
  port: number | null; // 1 = owned (green), 2 = watch
  update_date: string | null;
  update_by: string | null;
  variant: TargetVariant;
  cash_in_target: boolean;
  div_yield_mode: "dps" | "cashbuild" | "none";
  // standard: EPS+Divs = mEPS CAGR + div yield, Multiple = Return − EPS+Divs.
  // mult_first: Multiple = CAGR from blended Mendo P/E to the target multiple,
  //             EPS+Divs = Return − Multiple. simple: Yield is a stored input,
  //             EPS+Divs = Revs CAGR + Yield. none: decomp left blank.
  decomp: "standard" | "mult_first" | "simple" | "none";
  yield_input: number | null; // hardcoded Yield for the simplified decomp
  adv_3m: number | null;
  perf: { m1: number | null; m3: number | null; m6: number | null };
  model: EquityModel;
  is_index: boolean;
  best_pe: YearMap | null; // index rows only (BEst P/E by year)
  // Soft delete: removed names stay in the database (model, history and edit
  // log intact) and can be restored from the "Removed names" modal.
  removed: boolean;
}

export interface Quote {
  symbol: string;
  price: number | null;
  m1: number | null;
  m3: number | null;
  m6: number | null;
  source?: string | null; // "Yahoo" | "Bloomberg" — freshest write wins
  data_date?: string | null; // trading date the values are as-of (prior close)
  as_of: string; // when the row was fetched/written (drives the once-a-day refresh)
}

export interface FieldChange {
  field: string; // dotted path, e.g. "revs.2027", "shares", "port"
  old: number | string | null;
  new: number | string | null;
}

export interface EditRecord {
  id: number;
  ticker: string;
  analyst: string;
  created_at: string;
  changes: FieldChange[];
}

export interface EquitiesPayload {
  enabled: boolean; // Supabase configured → edits shared & persistent
  companies: Company[];
  quotes: Record<string, Quote>; // keyed by yahoo symbol
  prices_as_of: string | null;
}

export function emptyModel(): EquityModel {
  return {
    revs: {},
    gm: {},
    adj_eps: {},
    mendo_eps: {},
    target_mult: {},
    ncps: {},
    wadso: {},
    net_debt: {},
    dps: {},
    shares: null,
    cash: null,
    debt: null,
    min_int: null,
  };
}
