"use client";

import Link from "next/link";
import { Sidebar } from "@/components/Sidebar";

// The unified shell for the client-rendered tools (Equities, Twitter Themes,
// Diligence Tracker, Morning Notes). Mirrors the server DashboardFrame used by
// SPX Monitor: the global rail + a content area with one header anatomy
// (breadcrumb · H1 · subtitle · right-aligned action cluster) and one footer.
export function AppShell({
  tool,
  title,
  subtitle,
  actions,
  footerLeft,
  children,
}: {
  tool: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  footerLeft?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="shell">
      <Sidebar />
      <div className="content">
        <header className="content-header">
          <div className="header-lead">
            <div className="crumb">
              <Link href="/" className="crumb-home">
                Mendo Hub
              </Link>
              <span className="crumb-sep">/</span>
              <span className="crumb-here">{tool}</span>
            </div>
            <h1>{title}</h1>
            {subtitle && <p className="subtitle">{subtitle}</p>}
          </div>
          {actions && <div className="header-actions">{actions}</div>}
        </header>
        {children}
        <footer className="view-foot">
          <span>{footerLeft}</span>
          <span>MERITAGE · INTERNAL</span>
        </footer>
      </div>
    </div>
  );
}
