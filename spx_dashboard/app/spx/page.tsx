import { Column, DataTable, TableRow } from "@/components/DataTable";
import { NtmPeTable } from "@/components/NtmPeTable";
import { DashboardFrame } from "@/components/DashboardFrame";
import { ViewHeading } from "@/components/ViewHeading";
import {
  MsAgg,
  MsGroup,
  MsLabels,
  MsTotal,
  SpxFilterButton,
  SpxMobile,
} from "@/components/SpxMobile";
import {
  AggregateTables,
  bloombergDateLabelOf,
  CategoriesTableData,
  getNavModel,
  GrowthTable,
  NavGroup,
  ThreeDateTable,
} from "@/lib/data";
import { loadSpxDashboard } from "@/lib/spxLive";
import { spxSection, TOOL_NAMES } from "@/lib/toolMeta";

// The tables overlay the daily Bloomberg push (when newer than the committed
// workbook snapshot), so this page must render per-request.
export const dynamic = "force-dynamic";

// --- column builders ------------------------------------------------------- //
function threeDateColumns(t: ThreeDateTable, digits: number): Column[] {
  return [
    ...t.dates.map((d, i) => ({
      key: `v${i}`,
      label: d,
      groupLabel: t.value_label,
      format: "money" as const,
      heat: "blue" as const,
      digits,
    })),
    {
      key: "da0",
      label: "YTD",
      groupLabel: "$ Δ",
      format: "signedMoney" as const,
      heat: "rg" as const,
      digits,
    },
    {
      key: "da1",
      label: "QTD",
      groupLabel: "$ Δ",
      format: "signedMoney" as const,
      heat: "rg" as const,
      digits,
    },
    {
      key: "dp0",
      label: "YTD",
      groupLabel: "% Δ",
      format: "pct" as const,
      heat: "rg" as const,
    },
    {
      key: "dp1",
      label: "QTD",
      groupLabel: "% Δ",
      format: "pct" as const,
      heat: "rg" as const,
    },
  ];
}

function threeDateRows(t: ThreeDateTable): TableRow[] {
  return t.rows.map((r) => ({
    label: r.label,
    isTotal: r.is_total,
    cells: [...r.values, ...r.delta_abs, ...r.delta_pct],
  }));
}

function growthColumns(t: GrowthTable): Column[] {
  return [
    ...t.years.map((y) => ({
      key: `y${y}`,
      label: y,
      groupLabel: t.value_label,
      format: "money" as const,
      heat: "blue" as const,
      digits: 1,
    })),
    ...t.delta_years.map((y) => ({
      key: `da${y}`,
      label: y,
      groupLabel: "$ Δ YoY",
      format: "signedMoney" as const,
      heat: "rg" as const,
      digits: 1,
    })),
    ...t.delta_years.map((y) => ({
      key: `dp${y}`,
      label: y,
      groupLabel: "% Δ YoY",
      format: "pct" as const,
      heat: "rg" as const,
    })),
  ];
}
function growthRows(t: GrowthTable): TableRow[] {
  return t.rows.map((r) => ({
    label: r.label,
    isTotal: r.is_total,
    cells: [...r.values, ...r.delta_abs, ...r.delta_pct],
  }));
}

// --- mobile model builders -------------------------------------------------- //
// The phone category cards/drill-down reuse the exact aggregate rows the
// desktop tables render. Aggregate row labels mostly match the nav category
// labels; the known divergences are covered by the candidate list below
// (e.g. nav "Application" → row "Application software", nav "Big Tech" →
// the single-category group row "AI Buildout Funders", "Miscellaneous" →
// the group row "Other").
function findRow<T extends { label: string }>(
  rows: T[],
  label: string,
  group: string,
): T | null {
  const candidates = [label, `${label} software`, group];
  for (const cand of candidates) {
    const hit = rows.find((r) => r.label === cand);
    if (hit) return hit;
  }
  return null;
}

const last = <T,>(arr: T[]): T | null =>
  arr.length ? (arr[arr.length - 1] ?? null) : null;

function msAggFor(t: AggregateTables, label: string, group: string): MsAgg | null {
  const perf = findRow(t.stock_performance.rows, label, group);
  const growth = findRow(t.earnings_growth.rows, label, group);
  const r26 = findRow(t.est_rev_2026.rows, label, group);
  const r27 = findRow(t.est_rev_2027.rows, label, group);
  const pe = findRow(t.ntm_pe.rows, label, group);
  if (!perf && !growth && !pe) return null;

  // Headline growth year = second-to-last model year (e.g. '26), plus the
  // YoY % for it and the following year.
  const gy = t.earnings_growth;
  const niYear = gy.years[gy.years.length - 2];
  const d1 = gy.delta_years.indexOf(niYear);
  const d2 = gy.delta_years.indexOf(gy.years[gy.years.length - 1]);

  return {
    mktCap: perf ? last(perf.values) : null,
    perfYtd: perf?.delta_pct[0] ?? null,
    perfQtd: perf?.delta_pct[1] ?? null,
    ni: growth?.values[gy.years.indexOf(niYear)] ?? null,
    niYoy1: (d1 >= 0 ? growth?.delta_pct[d1] : null) ?? null,
    niYoy2: (d2 >= 0 ? growth?.delta_pct[d2] : null) ?? null,
    rev26Cur: r26 ? last(r26.values) : null,
    rev26Abs: r26?.delta_abs[0] ?? null,
    rev26Pct: r26?.delta_pct[0] ?? null,
    rev27Cur: r27 ? last(r27.values) : null,
    rev27Abs: r27?.delta_abs[0] ?? null,
    rev27Pct: r27?.delta_pct[0] ?? null,
    ntmPe: pe?.ntm_pe ?? null,
    peAvg: pe ? last(pe.avg_since) : null,
    peVsAvg: pe ? last(pe.delta_vs_avg) : null,
    peSeries: pe?.series ?? [],
  };
}

// A total row (e.g. "Total AI Capex Beneficiaries", "Total SPX") resolved the
// same way as a category, for both the aggregate and compounders tables.
// msAggFor's candidate list tries the exact label first, so total labels hit.
function msTotalFor(
  t: AggregateTables,
  tc: AggregateTables | null,
  label: string,
  counts: { count: number; compounderCount: number },
): MsTotal | null {
  const agg = msAggFor(t, label, "");
  if (!agg) return null;
  return {
    label,
    count: counts.count,
    compounderCount: counts.compounderCount,
    agg,
    comp: tc ? msAggFor(tc, label, "") : null,
  };
}

// Nav groups + per-category aggregates + compact member rows for the
// drill-down sheet (the same per-stock data the /category/[slug] page uses).
function msGroups(
  nav: NavGroup[],
  categories: CategoriesTableData,
  t: AggregateTables,
  tc: AggregateTables | null,
): MsGroup[] {
  const bySlug = new Map(
    categories.groups.flatMap((g) => g.categories.map((c) => [c.slug, c] as const)),
  );
  return nav.map((g) => ({
    group: g.group,
    // The workbook's per-group total row (e.g. "Total AI Capex Beneficiaries"),
    // shown as a tinted, non-tappable card after the group's categories.
    total: msTotalFor(t, tc, `Total ${g.group}`, {
      count: g.items.reduce((a, i) => a + i.count, 0),
      compounderCount: g.items.reduce((a, i) => a + i.compounderCount, 0),
    }),
    categories: g.items.map((item) => {
      const cat = bySlug.get(item.slug);
      return {
        slug: item.slug,
        label: item.label,
        count: item.count,
        compounderCount: item.compounderCount,
        agg: msAggFor(t, item.label, g.group),
        comp: tc ? msAggFor(tc, item.label, g.group) : null,
        stocks: (cat?.stocks ?? []).map((s) => ({
          ticker: (s.ticker || "").split(" ")[0].toUpperCase(),
          name: s.name,
          isCompounder: s.is_compounder ?? false,
          pe: s.pe.ntm_pe,
          ytd: s.performance.delta_pct[0] ?? null,
        })),
      };
    }),
  }));
}

// Year-dependent metric-chip labels (derived so nothing hardcodes a year).
function msLabels(t: AggregateTables): MsLabels {
  const gy = t.earnings_growth;
  const y1 = gy.years[gy.years.length - 2] ?? "";
  const y2 = gy.years[gy.years.length - 1] ?? "";
  const avg = last(t.ntm_pe.avg_dates) ?? "";
  return {
    ni: `'${y1.slice(2)} NI`,
    niYoy1: `YoY '${y1.slice(2)}`,
    niYoy2: `YoY '${y2.slice(2)}`,
    peAvg: `AVG '${avg.split("/").pop() ?? ""}`,
  };
}

// Headings come from lib/toolMeta.ts (shared with the PPT export) so a rename
// here automatically propagates to the exported deck.
function Section({ id, children }: { id: string; children: React.ReactNode }) {
  const { num, title, note } = spxSection(id);
  return (
    <section id={id} className="section">
      <div className="section-head">
        <span className="section-num">{num}</span>
        <h2 className="section-title">{title}</h2>
        {note && <span className="section-note">{note}</span>}
      </div>
      {children}
    </section>
  );
}

export default async function SpxMonitorPage() {
  const d = await loadSpxDashboard();
  const t = d.tables;
  const tc = d.tables_compounders ?? null;
  const asOf = bloombergDateLabelOf(d);
  const nav = getNavModel();
  const totalStocks = nav.reduce(
    (a, g) => a + g.items.reduce((b, i) => b + i.count, 0),
    0,
  );
  const totalCompounders = nav.reduce(
    (a, g) => a + g.items.reduce((b, i) => b + i.compounderCount, 0),
    0,
  );

  // Serializable column/row props per section so the mobile full-table
  // overlay renders the exact desktop tables (heatmaps, sorting, grouping).
  const mobileSections = {
    performance: {
      columns: threeDateColumns(t.stock_performance, 0),
      rows: threeDateRows(t.stock_performance),
      altRows: tc ? threeDateRows(tc.stock_performance) : undefined,
    },
    growth: {
      columns: growthColumns(t.earnings_growth),
      rows: growthRows(t.earnings_growth),
      altRows: tc ? growthRows(tc.earnings_growth) : undefined,
    },
    rev2026: {
      columns: threeDateColumns(t.est_rev_2026, 1),
      rows: threeDateRows(t.est_rev_2026),
      altRows: tc ? threeDateRows(tc.est_rev_2026) : undefined,
    },
    rev2027: {
      columns: threeDateColumns(t.est_rev_2027, 1),
      rows: threeDateRows(t.est_rev_2027),
      altRows: tc ? threeDateRows(tc.est_rev_2027) : undefined,
    },
  };

  return (
    <DashboardFrame
      asOf={asOf}
      mobileActions={<SpxFilterButton nav={nav} />}
      heading={
        <ViewHeading
          title={TOOL_NAMES.spx}
          meta="AI beneficiary & software tracker"
          stockCount={totalStocks}
          compounderCount={totalCompounders}
          trailing={`Bloomberg as of ${asOf}`}
        />
      }
    >
      <SpxMobile
        asOf={asOf}
        groups={msGroups(nav, d.tables.categories, t, tc)}
        grandTotal={msTotalFor(t, tc, "Total SPX", {
          count: totalStocks,
          compounderCount: totalCompounders,
        })}
        totalStocks={totalStocks}
        totalCompounders={totalCompounders}
        labels={msLabels(t)}
        sections={mobileSections}
        peTable={{ data: t.ntm_pe, altData: tc?.ntm_pe }}
      />

      <div className="ms-desktop">
      <Section id="performance">
        <DataTable
          columns={threeDateColumns(t.stock_performance, 0)}
          rows={threeDateRows(t.stock_performance)}
          altRows={tc ? threeDateRows(tc.stock_performance) : undefined}
        />
      </Section>

      <Section id="growth">
        <DataTable
          columns={growthColumns(t.earnings_growth)}
          rows={growthRows(t.earnings_growth)}
          altRows={tc ? growthRows(tc.earnings_growth) : undefined}
        />
      </Section>

      <Section id="rev2026">
        <DataTable
          columns={threeDateColumns(t.est_rev_2026, 1)}
          rows={threeDateRows(t.est_rev_2026)}
          altRows={tc ? threeDateRows(tc.est_rev_2026) : undefined}
        />
      </Section>

      <Section id="rev2027">
        <DataTable
          columns={threeDateColumns(t.est_rev_2027, 1)}
          rows={threeDateRows(t.est_rev_2027)}
          altRows={tc ? threeDateRows(tc.est_rev_2027) : undefined}
        />
      </Section>

      <Section id="pe">
        <NtmPeTable data={t.ntm_pe} altData={tc?.ntm_pe} />
      </Section>
      </div>
    </DashboardFrame>
  );
}
