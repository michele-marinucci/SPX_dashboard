"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavGroup } from "@/lib/data";
import { cx } from "@/lib/format";
import { useCompounders } from "./CompoundersContext";
import { useSidebarState } from "./SidebarStateContext";

// Left rail: a top-level switch between the SPX Monitor and the X Themes feed,
// then (in SPX Monitor mode) the aggregate/compounders toggle and each
// category's per-stock breakdown. Highlights whichever route is active.
// Collapsible — collapsed by default on mobile, expanded on the desktop site.
export function Sidebar({ nav }: { nav: NavGroup[] }) {
  const pathname = usePathname();
  const { on: compoundersOnly, set: setCompounders } = useCompounders();
  const { collapsed, setCollapsed, toggle: toggleSidebar } = useSidebarState();
  const [isMobile, setIsMobile] = useState(false);

  // Which top-level view we're in. Everything SPX-specific is hidden on the
  // themes feed so the two tools never bleed into each other.
  const isThemes = pathname?.startsWith("/themes") ?? false;

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

  // Auto-collapse whenever the route changes on mobile. Using a ref to track
  // the previous pathname means the initial mount never triggers a collapse.
  const prevPathname = useRef<string | null>(null);
  useEffect(() => {
    const mobile = window.matchMedia("(max-width: 820px)").matches;
    if (mobile && prevPathname.current !== null && prevPathname.current !== pathname) {
      setCollapsed(true);
    }
    prevPathname.current = pathname;
  }, [pathname, setCollapsed]);

  // Also collapse immediately on click so there's no lag waiting for the
  // navigation to complete and the pathname effect to fire.
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
        <Link
          href="/"
          className="sidebar-brand"
          onClick={(e) => {
            e.stopPropagation();
            handleSelect();
          }}
          title="Back to all views"
        >
          <span className="sidebar-brand-text">Mendo Monitor</span>
        </Link>
        <span className="sidebar-sys" aria-hidden="true">
          SPX
        </span>
        <span className="sidebar-hint" aria-hidden="true">
          Click to filter
        </span>
      </div>

      <Link href="/" className="rail-back" onClick={handleSelect}>
        ← All tools
      </Link>

      {/* SPX-specific controls: hidden on the themes feed. */}
      {!isThemes && (
        <>
          {/* Two mutually-exclusive blue toggles: show every SPX stock, or only
              the compounders. Both reflect the same global filter. */}
          <Link
            href="/spx"
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
        </>
      )}
    </aside>
  );
}
