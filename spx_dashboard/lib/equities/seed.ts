// First-paint data + one-time Supabase seed, parsed from the team's Excel by
// pipeline/parse_detailed_dashboard.py. After seeding, the database is the
// source of truth and this file is only the fallback when Supabase is not
// configured.
import seed from "@/data/equities_seed.json";
import { Company, emptyModel, EquityModel, TargetVariant } from "./types";

interface SeedCompany {
  ticker: string;
  bbg: string;
  yahoo: string | null;
  currency: string;
  px_scale: number;
  port: number | null;
  update_date: string | null;
  update_by: string | null;
  variant: string;
  cash_in_target: boolean;
  div_yield_mode: string;
  decomp: string;
  yield_input: number | null;
  adv_3m: number | null;
  perf: { m1: number | null; m3: number | null; m6: number | null };
  model: Record<string, unknown>;
}

function toCompany(c: SeedCompany, grp: string, grpOrder: number, rowOrder: number): Company {
  return {
    ticker: c.ticker,
    bbg: c.bbg,
    yahoo: c.yahoo,
    currency: c.currency,
    px_scale: c.px_scale,
    grp,
    grp_order: grpOrder,
    row_order: rowOrder,
    port: c.port,
    update_date: c.update_date,
    update_by: c.update_by,
    variant: c.variant as TargetVariant,
    cash_in_target: c.cash_in_target,
    div_yield_mode: c.div_yield_mode as Company["div_yield_mode"],
    decomp: c.decomp as Company["decomp"],
    yield_input: c.yield_input,
    adv_3m: c.adv_3m,
    perf: c.perf,
    model: { ...emptyModel(), ...(c.model as Partial<EquityModel>) },
    is_index: false,
    best_pe: null,
    removed: false,
  };
}

export function seedCompanies(): Company[] {
  const out: Company[] = [];
  (seed.groups as { name: string; companies: SeedCompany[] }[]).forEach((g, gi) => {
    g.companies.forEach((c, ri) => out.push(toCompany(c, g.name, gi, ri)));
  });
  (seed.indexes as {
    ticker: string;
    bbg: string;
    yahoo: string | null;
    best_pe: Record<string, number>;
    perf: { m1: number | null; m3: number | null; m6: number | null };
  }[]).forEach((ix, ri) => {
    out.push({
      ticker: ix.ticker,
      bbg: ix.bbg,
      yahoo: ix.yahoo,
      currency: "",
      px_scale: 1,
      grp: "Index",
      grp_order: 99,
      row_order: ri,
      port: null,
      update_date: null,
      update_by: null,
      variant: "pe",
      cash_in_target: false,
      div_yield_mode: "none",
      decomp: "standard",
      yield_input: null,
      adv_3m: null,
      perf: ix.perf,
      model: { ...emptyModel() },
      is_index: true,
      best_pe: ix.best_pe,
      removed: false,
    });
  });
  return out;
}
