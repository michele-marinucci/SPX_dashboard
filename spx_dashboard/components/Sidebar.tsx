"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavGroup } from "@/lib/data";
import { cx } from "@/lib/format";
import { useCompounders } from "./CompoundersContext";

// Left rail: toggle between the aggregate SPX view and each category's
// per-stock breakdown. Highlights whichever route is active.
export function Sidebar({ nav }: { nav: NavGroup[] }) {
  const pathname = usePathname();
  const { on: compoundersOnly, toggle } = useCompounders();
  const activeSlug = pathname?.startsWith("/category/")
    ? decodeURIComponent(pathname.slice("/category/".length))
    : null;
  const aggregateActive = pathname === "/";

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">Mendo Monitor</div>

      <button
        type="button"
        onClick={toggle}
        aria-pressed={compoundersOnly}
        className={cx("compounder-btn", compoundersOnly && "compounder-btn-on")}
        title="Show only stocks flagged as compounders"
      >
        {compoundersOnly ? "✓ Compounders only" : "Compounders only"}
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
