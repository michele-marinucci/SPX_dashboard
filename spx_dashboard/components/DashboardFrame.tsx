import Link from "next/link";
import { Sidebar } from "@/components/Sidebar";
import { HowItWorks } from "@/components/HowItWorks";
import { MobileTabBar, MobileTopBar } from "@/components/MobileChrome";
import { getBloombergDateLabel, getNavModel } from "@/lib/data";

// The shared shell for every dashboard view: a left sidebar to switch views
// and a content area with a per-view heading. The "data as of" date is shown
// once, in the per-view heading subtitle.
export function DashboardFrame({
  heading,
  children,
  asOf: asOfProp,
  mobileTitle,
  mobileActions,
}: {
  heading: React.ReactNode;
  children: React.ReactNode;
  // Pages that overlay live Bloomberg data pass their own as-of date;
  // default is the committed workbook snapshot's date.
  asOf?: string;
  // The mobile top bar's title (defaults to the tool name; per-category pages
  // pass the category name since the desktop heading is CSS-hidden ≤768px).
  mobileTitle?: string;
  // Extra mobile-only top-bar action (the SPX Filter button), rendered before
  // the shared "?" how-it-works button.
  mobileActions?: React.ReactNode;
}) {
  const nav = getNavModel();
  const asOf = asOfProp ?? getBloombergDateLabel();

  // Shared explainer, rendered in the desktop header and the mobile top bar
  // (each instance keeps its own open/closed state).
  const howItWorks = (
    <HowItWorks title="How the SPX Monitor works">
      <p className="hiw-lead">
        An AI-beneficiary &amp; software tracker for the S&amp;P 500.
      </p>
      <ul className="hiw-list">
        <li>
          <b>Browse</b> — use the left sidebar to switch between Aggregate SPX,
          each category, and Other.
        </li>
        <li>
          <b>Sort</b> — click any column header to rank largest to smallest,
          ascending, then off. Totals stay pinned.
        </li>
        <li>
          <b>Compounders only</b> — the red sidebar toggle filters every table
          to stocks flagged as compounders.
        </li>
        <li>
          <b>Export</b> — the top-right button downloads the exact Excel file
          powering these tables.
        </li>
      </ul>
    </HowItWorks>
  );

  return (
    <div className="shell">
      <Sidebar nav={nav} />
      <MobileTopBar
        tool={mobileTitle ?? "SPX Monitor"}
        actions={
          <>
            {mobileActions}
            {howItWorks}
          </>
        }
      />
      <div className="content">
        <header className="content-header">
          <div className="header-lead">
            <div className="crumb">
              <Link href="/" className="crumb-home">
                Mendo Hub
              </Link>
              <span className="crumb-sep">/</span>
              <span className="crumb-here">SPX Monitor</span>
            </div>
            {heading}
          </div>
          <div className="header-actions">
            {howItWorks}
            <a
              href="/api/spx/export"
              download="SPX_inputs.xlsx"
              className="btn-primary"
              title="Download the Excel file powering this site"
            >
              <span className="glyph" aria-hidden="true">↓</span> Export Excel
            </a>
          </div>
        </header>
        {children}
        <footer className="view-foot">
          <span>Bloomberg data as of {asOf}</span>
          <span>MERITAGE · INTERNAL</span>
        </footer>
      </div>
      <MobileTabBar />
    </div>
  );
}
