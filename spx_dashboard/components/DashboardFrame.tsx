import Link from "next/link";
import { Sidebar } from "@/components/Sidebar";
import { HowItWorks } from "@/components/HowItWorks";
import { getBloombergDateLabel, getNavModel } from "@/lib/data";

// The shared shell for every dashboard view: a left sidebar to switch views
// and a content area with a per-view heading. The "data as of" date is shown
// once, in the per-view heading subtitle.
export function DashboardFrame({
  heading,
  children,
}: {
  heading: React.ReactNode;
  children: React.ReactNode;
}) {
  const nav = getNavModel();
  const asOf = getBloombergDateLabel();

  return (
    <div className="shell">
      <Sidebar nav={nav} />
      <div className="content">
        <header className="content-header">
          {heading}
          <div className="header-actions">
            <span className="crumb">
              <Link href="/" className="crumb-home">
                Mendo Hub
              </Link>
              <span className="crumb-sep">/</span>
              <span className="crumb-here">SPX Monitor</span>
            </span>
            <HowItWorks title="How the SPX Monitor works">
              <p className="hiw-lead">
                An AI-beneficiary &amp; software tracker for the S&amp;P 500.
              </p>
              <ul className="hiw-list">
                <li>
                  <b>Browse</b> — use the left sidebar to switch between Aggregate
                  SPX, each category, and Other.
                </li>
                <li>
                  <b>Sort</b> — click any column header to rank largest to
                  smallest, ascending, then off. Totals stay pinned.
                </li>
                <li>
                  <b>Compounders only</b> — the red sidebar toggle filters every
                  table to stocks flagged as compounders.
                </li>
                <li>
                  <b>Export</b> — the top-right button downloads the exact Excel
                  file powering these tables.
                </li>
              </ul>
            </HowItWorks>
            <a
              href="/SPX_inputs.xlsx"
              download="SPX_inputs.xlsx"
              className="btn-export"
              title="Download the Excel file powering this site"
            >
              <span aria-hidden="true">↓</span> Export Excel
            </a>
          </div>
        </header>
        {children}
        <footer className="view-foot">
          <span>Bloomberg data as of {asOf}</span>
          <span>MERITAGE · INTERNAL</span>
        </footer>
      </div>
    </div>
  );
}
