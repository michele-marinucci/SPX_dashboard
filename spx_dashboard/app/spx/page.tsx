import { Column, DataTable, TableRow } from "@/components/DataTable";
import { NtmPeTable } from "@/components/NtmPeTable";
import { DashboardFrame } from "@/components/DashboardFrame";
import { ViewHeading } from "@/components/ViewHeading";
import { bloombergDateLabelOf, getNavModel, GrowthTable, ThreeDateTable } from "@/lib/data";
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

  return (
    <DashboardFrame
      asOf={asOf}
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
    </DashboardFrame>
  );
}
