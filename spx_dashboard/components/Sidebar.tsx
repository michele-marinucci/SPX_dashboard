"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavGroup } from "@/lib/data";
import { cx } from "@/lib/format";
import { useCompounders } from "./CompoundersContext";
import { useSidebarState } from "./SidebarStateContext";

// Left rail: toggle between the aggregate SPX view and each category's
// per-stock breakdown. Highlights whichever route is active. Collapsible —
// collapsed by default on mobile, expanded by default on the desktop site.
export function Sidebar({ nav }: { nav: NavGroup[] }) {
  const pathname = usePathname();
  const { on: compoundersOnly, set: setCompounders } = useCompounders();
  const { collapsed, setCollapsed, toggle: toggleSidebar } = useSidebarState();
  const [isMobile, setIsMobile] = useState(false);

  // Totals for the two top buttons, summed from the same per-category counts
  // shown below so the figures always reconcile.
  const totalStocks = nav.reduce(
    (a, g) => a + g.items.reduce((b, i) => b + i.count, 0),
    0,
  );
  const totalCompounders = nav.reduce(
    (a, g) => a + g.items.reduce((b, i) => b + i.compounderCount, 0),
    0,
  );

  // Track the viewport so mobile-only behaviours (full-screen overlay, tap the
  // blue bar to open, collapse after picking a category) can branch off it.
  // The sidebar defaults to open on first load on every device.
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 820px)");
    setIsMobile(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Read the media query directly at click time so we never act on stale state.
  const handleSelect = () => {
    if (window.matchMedia("(max-width: 820px)").matches) setCollapsed(true);
  };

  const activeSlug = pathname?.startsWith("/category/")
    ? decodeURIComponent(pathname.slice("/category/".length))
    : null;

  return (
    <aside className={cx("sidebar", collapsed && "sidebar-collapsed")}>
      <div
        className="sidebar-head"
        onClick={isMobile ? toggleSidebar : undefined}
      >
        <button
          type="button"
          className="sidebar-toggle"
          onClick={(e) => {
            e.stopPropagation();
            toggleSidebar();
          }}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <span className="hamburger" aria-hidden="true" />
        </button>
        <span className="sidebar-brand">
          <span className="sidebar-brand-text">Mendo Monitor</span>
        </span>
        <span className="sidebar-hint" aria-hidden="true">
          Click to filter
        </span>
      </div>

      {/* Two mutually-exclusive blue toggles: show every SPX stock, or only the
          compounders. Both reflect the same global filter, so exactly one is on. */}
      <Link
        href="/"
        onClick={() => {
          setCompounders(false);
          handleSelect();
        }}
        className={cx("seg-btn", !compoundersOnly && "seg-btn-on")}
        title="Show every stock in the tracked S&P 500 universe"
      >
        <span className="seg-label">Aggregate SPX</span>
        <span className="seg-count">{totalStocks}</span>
      </Link>

      <button
        type="button"
        onClick={() => {
          setCompounders(true);
          handleSelect();
        }}
        aria-pressed={compoundersOnly}
        className={cx("seg-btn", compoundersOnly && "seg-btn-on")}
        title="Show only stocks flagged as compounders"
      >
        <span className="seg-label">SPX Compounders</span>
        <span className="seg-count">{totalCompounders}</span>
      </button>

      <nav className="sidebar-nav">
        {nav.map((g) => (
          <div key={g.group} className="nav-group">
            <div className="nav-group-title">{g.group}</div>
            {g.items.map((it) => (
              <Link
                key={it.slug}
                href={`/category/${it.slug}`}
                prefetch={false}
                onClick={handleSelect}
                className={cx("nav-link", activeSlug === it.slug && "nav-link-active")}
              >
                <span className="nav-link-label">{it.label}</span>
                <span
                  className={cx("nav-count", compoundersOnly && "nav-count-c")}
                  title={
                    compoundersOnly
                      ? `${it.compounderCount} compounders`
                      : `${it.count} stocks`
                  }
                >
                  {compoundersOnly ? it.compounderCount : it.count}
                </span>
              </Link>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}
