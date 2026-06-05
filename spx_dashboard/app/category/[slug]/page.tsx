import Link from "next/link";
import { notFound } from "next/navigation";
import { Column, DataTable } from "@/components/DataTable";
import { Sparkline } from "@/components/Sparkline";
import { LogoutButton } from "@/components/LogoutButton";
import { cellStyle, computeScale } from "@/lib/heatmap";
import { fmtMoney, fmtNum } from "@/lib/format";
import {
  CategoryStock,
  getCategoryBySlug,
  getCategorySlugs,
  getDashboard,
  StockMetric,
} from "@/lib/data";

export function generateStaticParams() {
  return getCategorySlugs().map((slug) => ({ slug }));
}

// --- column builders (mirror the main page, but with stocks as rows) ------- //
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
    return { label: s.name, cells: [...m.values, ...m.delta_abs, ...m.delta_pct] };
  });
}

// Per-stock NTM P/E table (current level + quarterly history sparkline).
function StockPeTable({ stocks }: { stocks: CategoryStock[] }) {
  const peScale = computeScale(stocks.map((s) => s.pe.ntm_pe));
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th className="row-head" />
            <th className="num-th">Mkt cap ($b)</th>
            <th className="num-th">NTM NI ($b)</th>
            <th className="num-th">NTM P/E</th>
            <th className="num-th">History since &apos;20</th>
          </tr>
        </thead>
        <tbody>
          {stocks.map((s) => (
            <tr key={s.name}>
              <th scope="row" className="row-head">
                {s.name}
              </th>
              <td className="num-td">{fmtMoney(s.pe.mkt_cap, 0)}</td>
              <td className="num-td">{fmtNum(s.pe.ntm_ni, 1)}</td>
              <td className="num-td" style={cellStyle(s.pe.ntm_pe, "blue", peScale)}>
                {fmtNum(s.pe.ntm_pe, 1)}
              </td>
              <td className="num-td spark-td">
                <Sparkline values={s.pe.series} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function CategoryPage({ params }: { params: { slug: string } }) {
  const resolved = getCategoryBySlug(params.slug);
  if (!resolved || (resolved.category.stocks?.length ?? 0) === 0) notFound();

  const { group, category } = resolved;
  const d = getDashboard();
  const t = d.tables;
  const stocks = category.stocks;

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <Link href="/" className="back-link">
            ← All categories
          </Link>
          <h1>{category.category}</h1>
          <p className="subtitle">
            {group} · {stocks.length} stocks · data as of{" "}
            <strong>{d.latest_date}</strong>
          </p>
        </div>
        <LogoutButton />
      </header>

      <section className="section">
        <h2 className="section-title">Stock Performance</h2>
        <DataTable
          columns={perfColumns(t.stock_performance.dates)}
          rows={metricRows(stocks, (s) => s.performance)}
        />
      </section>

      <section className="section">
        <h2 className="section-title">Earnings Growth</h2>
        <DataTable
          columns={earnColumns(t.earnings_growth.years, t.earnings_growth.delta_years)}
          rows={metricRows(stocks, (s) => s.earnings)}
        />
      </section>

      <section className="section">
        <h2 className="section-title">Estimate Revisions 2026</h2>
        <DataTable
          columns={estColumns(t.est_rev_2026.dates, "Consensus Adj. NI ($b)")}
          rows={metricRows(stocks, (s) => s.est_2026)}
        />
      </section>

      <section className="section">
        <h2 className="section-title">Estimate Revisions 2027</h2>
        <DataTable
          columns={estColumns(t.est_rev_2027.dates, "Consensus Adj. NI ($b)")}
          rows={metricRows(stocks, (s) => s.est_2027)}
        />
      </section>

      <section className="section">
        <h2 className="section-title">NTM P/E</h2>
        <StockPeTable stocks={stocks} />
      </section>

      <footer className="page-footer">
        Generated {new Date(d.generated_at).toLocaleString("en-US")} · refreshed
        automatically when a new file arrives in the inbox.
      </footer>
    </main>
  );
}
