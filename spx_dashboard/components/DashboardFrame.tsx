import Link from "next/link";
import { LogoutButton } from "@/components/LogoutButton";
import { Sidebar } from "@/components/Sidebar";
import { HowToBanner } from "@/components/HowToBanner";
import { getNavModel } from "@/lib/data";

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

  return (
    <div className="shell">
      <Sidebar nav={nav} />
      <div className="content">
        <header className="content-header">
          {heading}
          <div className="header-actions">
            <Link href="/" className="btn-back" title="Back to all views">
              ← All views
            </Link>
            <a
              href="/SPX_inputs.xlsx"
              download="SPX_inputs.xlsx"
              className="btn-export"
              title="Download the Excel file powering this site"
            >
              <span aria-hidden="true">↓</span> Export Excel
            </a>
            <LogoutButton />
          </div>
        </header>
        <HowToBanner />
        {children}
      </div>
    </div>
  );
}
