import Link from "next/link";
import { Sidebar } from "@/components/Sidebar";
import { HowToBanner } from "@/components/HowToBanner";
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
              <span className="crumb-sep">|</span> SPX Monitor
            </span>
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
        <HowToBanner />
        {children}
        <footer className="view-foot">
          <span>Bloomberg data as of {asOf}</span>
          <span>MERITAGE · INTERNAL</span>
        </footer>
      </div>
    </div>
  );
}
