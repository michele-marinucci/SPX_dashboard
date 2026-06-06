import { LogoutButton } from "@/components/LogoutButton";
import { Sidebar } from "@/components/Sidebar";
import { getNavModel, getRefreshedLabel } from "@/lib/data";

// The shared shell for every dashboard view: a left sidebar to switch views
// and a content area with a per-view title. The "refreshed" date is the file's
// actual refresh date (not the last data column).
export function DashboardFrame({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
}) {
  const nav = getNavModel();
  const refreshed = getRefreshedLabel();

  return (
    <div className="shell">
      <Sidebar nav={nav} />
      <div className="content">
        <header className="content-header">
          <div>
            <h1>{title}</h1>
            {subtitle && <p className="subtitle">{subtitle}</p>}
            <p className="subtitle">
              Data refreshed <strong>{refreshed}</strong>
            </p>
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <a
              href="/api/download-xlsx"
              download="SPX_inputs.xlsx"
              className="logout-btn"
              style={{ textDecoration: "none" }}
            >
              Export Excel
            </a>
            <LogoutButton />
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
