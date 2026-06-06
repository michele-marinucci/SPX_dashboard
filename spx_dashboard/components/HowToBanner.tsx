"use client";

import { useEffect, useState } from "react";

// A compact, dismissible explainer pinned at the top of every view. Once
// dismissed it collapses to a small "How it works" pill that reopens it.
const KEY = "mendo:howto-dismissed";

const CARDS = [
  {
    icon: "▦",
    title: "Browse",
    body: "Use the left sidebar to switch between Aggregate SPX, each category, and Other.",
  },
  {
    icon: "↕",
    title: "Sort",
    body: "Click any column header to rank largest→smallest→ascending→off. Totals stay pinned.",
  },
  {
    icon: "◉",
    title: "Compounders only",
    body: "The red toggle filters every table to stocks flagged as compounders.",
    danger: true,
  },
  {
    icon: "↓",
    title: "Export",
    body: "Top-right button downloads the exact Excel file powering these tables.",
  },
];

export function HowToBanner({ refreshed }: { refreshed: string }) {
  // Default to shown; reconcile with localStorage after mount to avoid an
  // SSR/client hydration mismatch.
  const [dismissed, setDismissed] = useState(false);
  const [ready, setReady] = useState(false);

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
        groups within the S&amp;P 500. Data refreshed <strong>{refreshed}</strong>.
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
