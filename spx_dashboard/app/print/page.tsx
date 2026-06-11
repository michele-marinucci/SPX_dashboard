"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

// Combined print view: every live tool stacked in same-origin iframes. Browsers
// fold same-origin iframes into the parent's print job, so this yields ONE print
// dialog covering all tools. Each frame is auto-sized to its content height (and
// re-measured as client data lands) so nothing is clipped to a scroll viewport.
const LIVE = [
  { route: "/spx", label: "SPX Monitor" },
  { route: "/themes", label: "Twitter Monitor" },
  { route: "/diligence", label: "Diligence Tracker" },
  { route: "/morning-news", label: "Morning News Summary" },
  { route: "/dashboard", label: "Equities Dashboard" },
];

export default function PrintPage() {
  const [ready, setReady] = useState(0);
  const printed = useRef(false);

  function sizeFrame(el: HTMLIFrameElement | null) {
    if (!el) return;
    try {
      const doc = el.contentDocument;
      if (!doc) return;
      const h = Math.max(
        doc.documentElement?.scrollHeight ?? 0,
        doc.body?.scrollHeight ?? 0,
      );
      if (h > 0) el.style.height = `${h}px`;
    } catch {
      /* same-origin only; ignore */
    }
  }

  function onFrameLoad(el: HTMLIFrameElement) {
    // Size immediately, then again as client components hydrate and fetch their
    // shared data so the final height reflects the fully-loaded page.
    sizeFrame(el);
    setTimeout(() => sizeFrame(el), 900);
    setTimeout(() => {
      sizeFrame(el);
      setReady((n) => n + 1);
    }, 2000);
  }

  useEffect(() => {
    if (ready >= LIVE.length && !printed.current) {
      printed.current = true;
      setTimeout(() => window.print(), 700);
    }
  }, [ready]);

  return (
    <div className="printpage">
      <div className="printpage-bar">
        <Link href="/" className="back-link">
          ← Mendo Hub
        </Link>
        <span className="printpage-status">
          {ready >= LIVE.length
            ? "Ready — opening print dialog…"
            : `Loading tools… (${ready}/${LIVE.length})`}
        </span>
        <button className="print-all-btn" onClick={() => window.print()}>
          Print
        </button>
      </div>

      {LIVE.map((t) => (
        <section key={t.route} className="printpage-frame">
          <iframe
            title={t.label}
            src={t.route}
            scrolling="no"
            onLoad={(e) => onFrameLoad(e.currentTarget)}
          />
        </section>
      ))}
    </div>
  );
}
