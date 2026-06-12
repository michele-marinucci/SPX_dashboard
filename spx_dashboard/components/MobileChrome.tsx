"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/lib/format";
import { TOOLS } from "@/components/Sidebar";

// Mobile chrome (≤768px): a sticky top app bar and the persistent frosted
// bottom tab bar. Both are hidden on desktop, where the rail + content header
// remain the navigation. The Hub is reached via the brand mark in the top bar
// (not a tab), per the mobile IA.

// Short tab labels for the five TOOLS, keyed by href.
const TAB_LABELS: Record<string, string> = {
  "/dashboard": "Equities",
  "/spx": "SPX",
  "/morning-news": "Notes",
  "/themes": "Themes",
  "/diligence": "Diligence",
};

// Minimal 20px stroke icons, one per tool.
function TabIcon({ href }: { href: string }) {
  const common = {
    width: 21,
    height: 21,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (href) {
    case "/dashboard": // bar chart
      return (
        <svg {...common}>
          <path d="M5 20V10M12 20V4M19 20v-7" />
        </svg>
      );
    case "/spx": // trend line
      return (
        <svg {...common}>
          <path d="M3 17l5.5-6 4 3.5L21 7" />
          <path d="M15.5 7H21v5.5" />
        </svg>
      );
    case "/morning-news": // document
      return (
        <svg {...common}>
          <path d="M7 3h7l4 4v14H7z" />
          <path d="M14 3v4h4M10 12h6M10 16h6" />
        </svg>
      );
    case "/themes": // speech bubble
      return (
        <svg {...common}>
          <path d="M21 12a8 8 0 0 1-8 8H4l2.2-2.6A8 8 0 1 1 21 12z" />
        </svg>
      );
    case "/diligence": // checklist
      return (
        <svg {...common}>
          <path d="M4 6.5l1.5 1.5L8 5.5M4 12.5l1.5 1.5L8 11.5M4 18.5l1.5 1.5L8 17.5" />
          <path d="M11 6.5h9M11 12.5h9M11 18.5h9" />
        </svg>
      );
    default:
      return null;
  }
}

export function MobileTabBar() {
  const pathname = usePathname() ?? "";
  return (
    <nav className="m-tabbar" aria-label="Tools">
      {TOOLS.map((t) => {
        const active = t.match(pathname);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cx("m-tab", active && "m-tab-active")}
            aria-current={active ? "page" : undefined}
          >
            <TabIcon href={t.href} />
            <span className="m-tab-label">{TAB_LABELS[t.href] ?? t.name}</span>
          </Link>
        );
      })}
    </nav>
  );
}

// Sticky top app bar: brand mark (tap → Hub) + tool title over a mono crumb,
// with one contextual action slot on the right (per-tool action + "?" help).
export function MobileTopBar({
  tool,
  actions,
}: {
  tool: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="m-appbar">
      <Link href="/" className="m-appbar-brand" title="Back to Mendo Hub">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/meritage-logo.png" alt="Mendo Hub" />
      </Link>
      <div className="m-appbar-lead">
        <div className="m-appbar-title">{tool}</div>
        <div className="m-appbar-crumb mono">
          MENDO HUB / {tool.toUpperCase()}
        </div>
      </div>
      {actions && <div className="m-appbar-actions">{actions}</div>}
    </header>
  );
}
