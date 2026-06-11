// Human-readable labels + value formatting for the equities edit log. Shared
// by the on-screen log popups (per-company and the aggregate Activity log) and
// the Edit-log tab of the Excel export, so all three read identically.

const FIELD_LABELS: Record<string, string> = {
  revs: "Revenue",
  gm: "GM %",
  adj_eps: "Adj EPS",
  mendo_eps: "Mendo EPS",
  dps: "DPS",
  target_mult: "Target mult",
  ncps: "Net cash/sh",
  wadso: "WADSO",
  net_debt: "Net debt",
  best_pe: "BEst P/E",
  shares: "Shares",
  cash: "Cash",
  debt: "Debt",
  min_int: "Min interest",
  port: "Portfolio flag",
  grp: "Sector group",
  yield_input: "Yield input",
};

export function fieldLabel(field: string): string {
  if (field === "__added__") return "Added to dashboard";
  if (field === "__removed__") return "Removed from dashboard";
  if (field === "__restored__") return "Restored to dashboard";
  const [head, year] = field.split(".");
  return `${FIELD_LABELS[head] ?? head}${year ? ` ${year}` : ""}`;
}

export function fmtEditValue(v: number | string | null, field: string): string {
  if (v == null) return "—";
  if (typeof v === "string") return v;
  if (field.startsWith("gm.")) return `${(v * 100).toFixed(2)}%`;
  return v.toLocaleString("en-US", { maximumFractionDigits: 4 });
}
