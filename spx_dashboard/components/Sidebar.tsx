"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavGroup } from "@/lib/data";
import { cx } from "@/lib/format";
import { useCompounders } from "./CompoundersContext";
import { useSidebarState } from "./SidebarStateContext";
import { TOOL_NAMES } from "@/lib/toolMeta";

// The five live tools, in the redesign's locked order/naming. This list is the
// global navigation rail shown on every view + the homepage.
export const TOOLS: { href: string; name: string; match: (p: string) => boolean }[] = [
  { href: "/dashboard", name: TOOL_NAMES.equities, match: (p) => p.startsWith("/dashboard") },
  { href: "/spx", name: TOOL_NAMES.spx, match: (p) => p.startsWith("/spx") || p.startsWith("/category") },
  { href: "/morning-news", name: TOOL_NAMES.morningNews, match: (p) => p.startsWith("/morning-news") },
  { href: "/themes", name: TOOL_NAMES.twitter, match: (p) => p.startsWith("/themes") },
  { href: "/diligence", name: TOOL_NAMES.diligence, match: (p) => p.startsWith("/diligence") },
];

// Global navigation rail, shown on every tool. Brand lockup at the top, then
// the five tools (current one highlighted, a live-dot by each). On the SPX
// Monitor it also carries the "SPX · Categories" controls — the
// Aggregate/Compounders toggle and the per-category breakdown — which is the
// only per-tool secondary control that lives in the rail. Collapsible.
export function Sidebar({ nav }: { nav?: NavGroup[] }) {
  const pathname = usePathname() ?? "";
  const { on: compoundersOnly, set: setCompounders } = useCompounders();
  const { collapsed, setCollapsed, toggle: toggleSidebar } = useSidebarState();
  const [isMobile, setIsMobile] = useState(false);

  // The SPX categories section only renders on the SPX Monitor (and its
  // per-category pages), and only when the page passed nav data.
  const isSpx = pathname.startsWith("/spx") || pathname.startsWith("/category");
  const showCats = isSpx && !!nav?.length;

  const totalStocks = (nav ?? []).reduce(
    (a, g) => a + g.items.reduce((b, i) => b + i.count, 0),
    0,
  );
  const totalCompounders = (nav ?? []).reduce(
    (a, g) => a + g.items.reduce((b, i) => b + i.compounderCount, 0),
    0,
  );

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 820px)");
    setIsMobile(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Auto-collapse on route change on mobile (ref guards the initial mount).
  const prevPathname = useRef<string | null>(null);
  useEffect(() => {
    const mobile = window.matchMedia("(max-width: 820px)").matches;
    if (mobile && prevPathname.current !== null && prevPathname.current !== pathname) {
      setCollapsed(true);
    }
    prevPathname.current = pathname;
  }, [pathname, setCollapsed]);

  const handleSelect = () => {
    if (window.matchMedia("(max-width: 820px)").matches) setCollapsed(true);
  };

  const activeSlug = pathname.startsWith("/category/")
    ? decodeURIComponent(pathname.slice("/category/".length))
    : null;

  return (
    <aside className={cx("sidebar", collapsed && "sidebar-collapsed")}>
      <div className="sidebar-head" onClick={isMobile ? toggleSidebar : undefined}>
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
          title="Back to Mendo Hub"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/meritage-logo.png" alt="Meritage" className="rail-logo" />
        </Link>
        <span className="sidebar-sys" aria-hidden="true">
          INTERNAL
        </span>
      </div>

      {/* Tools — global navigation */}
      <nav className="rail-tools">
        <div className="rail-tools-title">Tools</div>
        {TOOLS.map((t) => {
          const active = t.match(pathname);
          return (
            <Link
              key={t.href}
              href={t.href}
              onClick={handleSelect}
              className={cx("rail-tool", active && "rail-tool-active")}
              aria-current={active ? "page" : undefined}
            >
              <span className="rail-tool-dot" aria-hidden="true" />
              <span className="rail-tool-name">{t.name}</span>
            </Link>
          );
        })}
      </nav>

      {/* SPX · Categories — the only per-tool control kept in the rail. */}
      {showCats && (
        <div className="rail-cats">
          <div className="rail-tools-title">SPX · Categories</div>
          <Link
            href="/spx"
            onClick={() => {
              setCompounders(false);
              handleSelect();
            }}
            className={cx("seg-btn", !compoundersOnly && "seg-btn-on")}
            title="Show every stock in the tracked S&P 500 universe"
          >
            <span className="seg-label">Aggregate</span>
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
            <span className="seg-label">Compounders</span>
            <span className="seg-count">{totalCompounders}</span>
          </button>

          <nav className="sidebar-nav">
            {(nav ?? []).map((g) => (
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
        </div>
      )}
    </aside>
  );
}
