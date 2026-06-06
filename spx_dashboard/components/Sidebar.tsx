"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavGroup } from "@/lib/data";
import { cx } from "@/lib/format";
import { useCompounders } from "./CompoundersContext";

// Left rail: toggle between the aggregate SPX view and each category's
// per-stock breakdown. Highlights whichever route is active. Collapsible —
// collapsed by default on mobile, expanded by default on the desktop site.
export function Sidebar({ nav }: { nav: NavGroup[] }) {
  const pathname = usePathname();
  const { on: compoundersOnly, toggle } = useCompounders();
  const [collapsed, setCollapsed] = useState(false);

  // Default state follows the viewport: collapsed on mobile, open on desktop.
  // Re-applies when the viewport crosses the breakpoint.
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 820px)");
    setCollapsed(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setCollapsed(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const activeSlug = pathname?.startsWith("/category/")
    ? decodeURIComponent(pathname.slice("/category/".length))
    : null;
  const aggregateActive = pathname === "/";

  return (
    <aside className={cx("sidebar", collapsed && "sidebar-collapsed")}>
      <div className="sidebar-head">
        <button
          type="button"
          className="sidebar-toggle"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <span className="hamburger" aria-hidden="true" />
        </button>
        <span className="sidebar-brand">
          <span className="sidebar-brand-text">Mendo Monitor</span>
        </span>
      </div>

      <button
        type="button"
        onClick={toggle}
        aria-pressed={compoundersOnly}
        className={cx("compounder-btn", compoundersOnly && "compounder-btn-on")}
        title="Show only stocks flagged as compounders"
      >
        Compounders only
      </button>

      <nav className="sidebar-nav">
        <Link
          href="/"
          className={cx("nav-link", "nav-link-top", aggregateActive && "nav-link-active")}
        >
          Aggregate SPX
        </Link>

        {nav.map((g) => (
          <div key={g.group} className="nav-group">
            <div className="nav-group-title">{g.group}</div>
            {g.items.map((it) => (
              <Link
                key={it.slug}
                href={`/category/${it.slug}`}
                prefetch={false}
                className={cx("nav-link", activeSlug === it.slug && "nav-link-active")}
              >
                <span className="nav-link-label">{it.label}</span>
                <span className="nav-count">{it.count}</span>
              </Link>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}
