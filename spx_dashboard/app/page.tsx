import { Column, DataTable, TableRow } from "@/components/DataTable";
import { NtmPeTable } from "@/components/NtmPeTable";
import { DashboardFrame } from "@/components/DashboardFrame";
import { getDashboard, GrowthTable, ThreeDateTable } from "@/lib/data";

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

function shareColumns(t: ThreeDateTable): Column[] {
  return [
    ...t.dates.map((d, i) => ({
      key: `s${i}`,
      label: d,
      groupLabel: "Share of S&P 500",
      format: "pct" as const,
      heat: "blue" as const,
    })),
    {
      key: "sd0",
      label: "YTD",
      groupLabel: "Δ share",
      format: "pct" as const,
      heat: "rg" as const,
    },
    {
      key: "sd1",
      label: "QTD",
      groupLabel: "Δ share",
      format: "pct" as const,
      heat: "rg" as const,
    },
  ];
}
function shareRows(t: ThreeDateTable): TableRow[] {
  return t.pct_of_spx.map((r) => ({
    label: r.label,
    isTotal: r.is_total,
    cells: [...r.values, ...r.delta_abs],
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

  return (
    <DashboardFrame
      title="Aggregate SPX"
      subtitle={`AI beneficiary & software tracker · data through ${d.latest_date}`}
    >
      <Section id="performance" title="Stock Performance">
        <DataTable
          columns={threeDateColumns(t.stock_performance, 0)}
          rows={threeDateRows(t.stock_performance)}
        />
        <h4 className="sub-title">Share of S&amp;P 500</h4>
        <DataTable
          columns={shareColumns(t.stock_performance)}
          rows={shareRows(t.stock_performance)}
        />
      </Section>

      <Section id="growth" title="Earnings Growth">
        <DataTable
          columns={growthColumns(t.earnings_growth)}
          rows={growthRows(t.earnings_growth)}
        />
        <h4 className="sub-title">Share of S&amp;P 500</h4>
        <DataTable
          columns={[
            ...t.earnings_growth.years.map((y) => ({
              key: `sy${y}`,
              label: y,
              groupLabel: "Share of S&P 500",
              format: "pct" as const,
              heat: "blue" as const,
            })),
            ...t.earnings_growth.delta_years.map((y) => ({
              key: `sd${y}`,
              label: y,
              groupLabel: "Δ share YoY",
              format: "pct" as const,
              heat: "rg" as const,
            })),
          ]}
          rows={t.earnings_growth.pct_of_spx.map((r) => ({
            label: r.label,
            isTotal: r.is_total,
            cells: [...r.values, ...r.delta_abs],
          }))}
        />
      </Section>

      <Section id="rev2026" title="Estimate Revisions 2026">
        <DataTable
          columns={threeDateColumns(t.est_rev_2026, 1)}
          rows={threeDateRows(t.est_rev_2026)}
        />
        <h4 className="sub-title">Share of S&amp;P 500</h4>
        <DataTable
          columns={shareColumns(t.est_rev_2026)}
          rows={shareRows(t.est_rev_2026)}
        />
      </Section>

      <Section id="rev2027" title="Estimate Revisions 2027">
        <DataTable
          columns={threeDateColumns(t.est_rev_2027, 1)}
          rows={threeDateRows(t.est_rev_2027)}
        />
        <h4 className="sub-title">Share of S&amp;P 500</h4>
        <DataTable
          columns={shareColumns(t.est_rev_2027)}
          rows={shareRows(t.est_rev_2027)}
        />
      </Section>

      <Section id="pe" title="NTM P/E">
        <NtmPeTable data={t.ntm_pe} />
      </Section>

      <footer className="page-footer">
        Generated {new Date(d.generated_at).toLocaleString("en-US")} · refreshed
        automatically when a new file arrives in the inbox.
      </footer>
    </DashboardFrame>
  );
}
