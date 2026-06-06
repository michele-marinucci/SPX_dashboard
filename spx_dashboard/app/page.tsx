import { Column, DataTable, TableRow } from "@/components/DataTable";
import { NtmPeTable } from "@/components/NtmPeTable";
import { DashboardFrame } from "@/components/DashboardFrame";
import {
  getCompounderTables,
  getDashboard,
  GrowthTable,
  ThreeDateTable,
} from "@/lib/data";

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

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="section">
      <h2 className="section-title">{title}</h2>
      {children}
    </section>
  );
}

export default function DashboardPage() {
  const d = getDashboard();
  const t = d.tables;
  const tc = getCompounderTables();

  return (
    <DashboardFrame
      title="Aggregate SPX"
      subtitle={`AI beneficiary & software tracker · data through ${d.latest_date}`}
    >
      <Section id="performance" title="Stock Performance">
        <DataTable
          columns={threeDateColumns(t.stock_performance, 0)}
          rows={threeDateRows(t.stock_performance)}
          altRows={tc ? threeDateRows(tc.stock_performance) : undefined}
        />
      </Section>

      <Section id="growth" title="Earnings Growth">
        <DataTable
          columns={growthColumns(t.earnings_growth)}
          rows={growthRows(t.earnings_growth)}
          altRows={tc ? growthRows(tc.earnings_growth) : undefined}
        />
      </Section>

      <Section id="rev2026" title="Estimate Revisions 2026">
        <DataTable
          columns={threeDateColumns(t.est_rev_2026, 1)}
          rows={threeDateRows(t.est_rev_2026)}
          altRows={tc ? threeDateRows(tc.est_rev_2026) : undefined}
        />
      </Section>

      <Section id="rev2027" title="Estimate Revisions 2027">
        <DataTable
          columns={threeDateColumns(t.est_rev_2027, 1)}
          rows={threeDateRows(t.est_rev_2027)}
          altRows={tc ? threeDateRows(tc.est_rev_2027) : undefined}
        />
      </Section>

      <Section id="pe" title="NTM P/E">
        <NtmPeTable data={t.ntm_pe} altData={tc?.ntm_pe} />
      </Section>

      <footer className="page-footer">
        Generated {new Date(d.generated_at).toLocaleString("en-US")} · refreshed
        automatically when a new file arrives in the inbox.
      </footer>
    </DashboardFrame>
  );
}
