import { notFound } from "next/navigation";
import { Column, DataTable } from "@/components/DataTable";
import { DashboardFrame } from "@/components/DashboardFrame";
import { ViewHeading } from "@/components/ViewHeading";
import { StockPeTable } from "@/components/StockPeTable";
import { bloombergDateLabelOf, CategoryStock, StockMetric } from "@/lib/data";
import { loadSpxDashboard } from "@/lib/spxLive";

// Per-stock tables overlay the daily Bloomberg push (when newer than the
// committed workbook snapshot), so these pages must render per-request —
// no generateStaticParams, or Next would freeze them at build time.
export const dynamic = "force-dynamic";

// --- column builders (mirror the aggregate view, but with stocks as rows) --- //
function perfColumns(dates: string[]): Column[] {
  return [
    ...dates.map((d, i) => ({
      key: `v${i}`,
      label: d,
      groupLabel: "Market cap ($b)",
      format: "money" as const,
      heat: "blue" as const,
      digits: 0,
    })),
    { key: "da0", label: "YTD", groupLabel: "$ Δ", format: "signedMoney" as const, heat: "rg" as const, digits: 0 },
    { key: "da1", label: "QTD", groupLabel: "$ Δ", format: "signedMoney" as const, heat: "rg" as const, digits: 0 },
    { key: "dp0", label: "YTD", groupLabel: "Return %", format: "pct" as const, heat: "rg" as const },
    { key: "dp1", label: "QTD", groupLabel: "Return %", format: "pct" as const, heat: "rg" as const },
  ];
}

function earnColumns(years: string[], deltaYears: string[]): Column[] {
  return [
    ...years.map((y) => ({
      key: `y${y}`,
      label: y,
      groupLabel: "Adj. Net Income ($b)",
      format: "money" as const,
      heat: "blue" as const,
      digits: 1,
    })),
    ...deltaYears.map((y) => ({ key: `da${y}`, label: y, groupLabel: "$ Δ YoY", format: "signedMoney" as const, heat: "rg" as const, digits: 1 })),
    ...deltaYears.map((y) => ({ key: `dp${y}`, label: y, groupLabel: "% Δ YoY", format: "pct" as const, heat: "rg" as const })),
  ];
}

function estColumns(dates: string[], valueLabel: string): Column[] {
  return [
    ...dates.map((d, i) => ({
      key: `v${i}`,
      label: d,
      groupLabel: valueLabel,
      format: "money" as const,
      heat: "blue" as const,
      digits: 1,
    })),
    { key: "da0", label: "YTD", groupLabel: "$ Δ", format: "signedMoney" as const, heat: "rg" as const, digits: 1 },
    { key: "da1", label: "QTD", groupLabel: "$ Δ", format: "signedMoney" as const, heat: "rg" as const, digits: 1 },
    { key: "dp0", label: "YTD", groupLabel: "% Δ", format: "pct" as const, heat: "rg" as const },
    { key: "dp1", label: "QTD", groupLabel: "% Δ", format: "pct" as const, heat: "rg" as const },
  ];
}

function metricRows(stocks: CategoryStock[], pick: (s: CategoryStock) => StockMetric) {
  return stocks.map((s) => {
    const m = pick(s);
    return {
      label: s.name,
      isCompounder: s.is_compounder ?? false,
      cells: [...m.values, ...m.delta_abs, ...m.delta_pct],
    };
  });
}

export default async function CategoryPage({ params }: { params: { slug: string } }) {
  const d = await loadSpxDashboard();
  let resolved: { group: string; category: (typeof d.tables.categories.groups)[0]["categories"][0] } | null =
    null;
  for (const g of d.tables.categories.groups)
    for (const c of g.categories)
      if (c.slug === params.slug) resolved = { group: g.group, category: c };
  if (!resolved || (resolved.category.stocks?.length ?? 0) === 0) notFound();

  const { group, category } = resolved;
  const asOf = bloombergDateLabelOf(d);
  const t = d.tables;
  const stocks = category.stocks;
  // Compounder-only subset for the "Compounders only" filter (per-stock pages
  // simply hide the non-compounder rows).
  const comp = stocks.filter((s) => s.is_compounder);
  // P/E for the catch-all "Other" bucket is intentionally omitted for now.
  const showPe = category.slug !== "miscellaneous";

  return (
    <DashboardFrame
      asOf={asOf}
      mobileTitle={category.category}
      heading={
        <ViewHeading
          title={category.category}
          meta={group}
          stockCount={stocks.length}
          compounderCount={comp.length}
          trailing={`Bloomberg data as of ${asOf}`}
        />
      }
    >
      <section className="section">
        <div className="section-head">
          <span className="section-num">01</span>
          <h2 className="section-title">Stock Performance</h2>
          <span className="section-note">Market cap ($b) · diverging Δ heatmaps</span>
        </div>
        <DataTable
          columns={perfColumns(t.stock_performance.dates)}
          rows={metricRows(stocks, (s) => s.performance)}
          altRows={metricRows(comp, (s) => s.performance)}
        />
      </section>

      <section className="section">
        <div className="section-head">
          <span className="section-num">02</span>
          <h2 className="section-title">Earnings Growth</h2>
          <span className="section-note">Adjusted net income ($b)</span>
        </div>
        <DataTable
          columns={earnColumns(t.earnings_growth.years, t.earnings_growth.delta_years)}
          rows={metricRows(stocks, (s) => s.earnings)}
          altRows={metricRows(comp, (s) => s.earnings)}
        />
      </section>

      <section className="section">
        <div className="section-head">
          <span className="section-num">03</span>
          <h2 className="section-title">Estimate Revisions · 2026</h2>
          <span className="section-note">Consensus adj. NI ($b)</span>
        </div>
        <DataTable
          columns={estColumns(t.est_rev_2026.dates, "Consensus Adj. NI ($b)")}
          rows={metricRows(stocks, (s) => s.est_2026)}
          altRows={metricRows(comp, (s) => s.est_2026)}
        />
      </section>

      <section className="section">
        <div className="section-head">
          <span className="section-num">04</span>
          <h2 className="section-title">Estimate Revisions · 2027</h2>
          <span className="section-note">Consensus adj. NI ($b)</span>
        </div>
        <DataTable
          columns={estColumns(t.est_rev_2027.dates, "Consensus Adj. NI ($b)")}
          rows={metricRows(stocks, (s) => s.est_2027)}
          altRows={metricRows(comp, (s) => s.est_2027)}
        />
      </section>

      {showPe && (
        <section className="section">
          <div className="section-head">
            <span className="section-num">05</span>
            <h2 className="section-title">NTM P/E</h2>
            <span className="section-note">Current vs historical averages · P/E history</span>
          </div>
          <StockPeTable stocks={stocks} />
        </section>
      )}
    </DashboardFrame>
  );
}
