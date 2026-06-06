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
  const [isMobile, setIsMobile] = useState(false);

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

  const toggleSidebar = () => setCollapsed((c) => !c);
  // On mobile, picking a category collapses the overlay back to the top bar.
  const handleNavClick = () => {
    if (isMobile) setCollapsed(true);
  };

  // While the full-screen sidebar overlay is open on mobile, lock zooming so
  // the nav stays at a comfortable, legible size. Restore pinch-zoom (used to
  // read wide tables) whenever it's closed or we're on desktop.
  useEffect(() => {
    const meta = document.querySelector('meta[name="viewport"]');
    if (!meta) return;
    const zoomable =
      "width=device-width, initial-scale=1, minimum-scale=0.25, maximum-scale=5, user-scalable=yes";
    const locked =
      "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no";
    meta.setAttribute("content", isMobile && !collapsed ? locked : zoomable);
    return () => meta.setAttribute("content", zoomable);
  }, [isMobile, collapsed]);

  const activeSlug = pathname?.startsWith("/category/")
    ? decodeURIComponent(pathname.slice("/category/".length))
    : null;
  const aggregateActive = pathname === "/";

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

      <p className="sidebar-explain">
        Use the left sidebar to switch between Aggregate SPX, each category, and
        Other.
      </p>

      <Link
        href="/"
        onClick={handleNavClick}
        className={cx("aggregate-link", aggregateActive && "aggregate-link-on")}
      >
        Aggregate SPX
      </Link>

      <button
        type="button"
        onClick={toggle}
        aria-pressed={compoundersOnly}
        className={cx("compounder-btn", compoundersOnly && "compounder-btn-on")}
        title="Show only stocks flagged as compounders"
      >
        SPX Compounders only
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
                onClick={handleNavClick}
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
