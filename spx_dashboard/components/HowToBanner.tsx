"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

// A compact, dismissible explainer pinned at the top of every view. Once
// dismissed it collapses to a small "How it works" pill that reopens it.
const KEY = "mendo:howto-dismissed";

// 16px line icons, sized/contained by .howto-ic so nothing spills out.
const I = {
  browse: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="18" rx="1.5" />
      <rect x="14" y="3" width="7" height="18" rx="1.5" />
    </svg>
  ),
  sort: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 4v16M8 20l-3-3M8 4l3 3" />
      <path d="M16 20V4M16 4l3 3M16 20l-3-3" />
    </svg>
  ),
  filter: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 5h18l-7 8v6l-4-2v-4z" />
    </svg>
  ),
  download: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 4v11M12 15l4-4M12 15l-4-4" />
      <path d="M4 19h16" />
    </svg>
  ),
};

const CARDS = [
  {
    icon: I.browse,
    title: "Browse",
    body: "Use the left sidebar to switch between Aggregate SPX, each category, and Other.",
  },
  {
    icon: I.sort,
    title: "Sort",
    body: "Click any column header to rank largest to smallest, ascending, then off. Totals stay pinned.",
  },
  {
    icon: I.filter,
    title: "Compounders only",
    body: "The red toggle filters every table to stocks flagged as compounders.",
    danger: true,
  },
  {
    icon: I.download,
    title: "Export",
    body: "The top-right button downloads the exact Excel file powering these tables.",
  },
];

export function HowToBanner() {
  // Default to shown; reconcile with localStorage after mount to avoid an
  // SSR/client hydration mismatch.
  const [dismissed, setDismissed] = useState(false);
  const [ready, setReady] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(KEY) === "1");
    } catch {
      /* ignore */
    }
    setReady(true);
  }, []);

  const close = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(KEY, "1");
    } catch {
      /* ignore */
    }
  };
  const open = () => {
    setDismissed(false);
    try {
      window.localStorage.setItem(KEY, "0");
    } catch {
      /* ignore */
    }
  };

  // SPX-specific helper: never show it on the X Themes feed.
  if (pathname?.startsWith("/themes")) return null;

  // Before hydration we render the full banner (matches SSR markup).
  if (ready && dismissed) {
    return (
      <button className="howto-reopen" onClick={open} type="button">
        ⓘ How it works
      </button>
    );
  }

  return (
    <section className="howto" aria-label="How this dashboard works">
      <p className="howto-lead">
        <strong>Mendo Monitor</strong> tracks AI-beneficiary &amp; software
        groups within the S&amp;P 500.
      </p>
      <div className="howto-grid">
        {CARDS.map((c) => (
          <div
            key={c.title}
            className={c.danger ? "howto-card is-danger" : "howto-card"}
          >
            <div className="howto-ic">{c.icon}</div>
            <div className="howto-ct">
              <b>{c.title}</b>
              <span>{c.body}</span>
            </div>
          </div>
        ))}
      </div>
      <button
        className="howto-close"
        onClick={close}
        type="button"
        aria-label="Dismiss"
        title="Dismiss"
      >
        ×
      </button>
    </section>
  );
}
