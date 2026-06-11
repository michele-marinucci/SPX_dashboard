"use client";

import { useEffect, useState } from "react";

// A small "How it works" button that opens a centered modal popup. Shared by
// every tool so the explainer is consistent (SPX Monitor, Twitter Monitor,
// Diligence Tracker). Pass the explanation as children.
export function HowItWorks({
  title = "How it works",
  label = "How it works",
  children,
}: {
  title?: string;
  label?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button type="button" className="hiw-btn" onClick={() => setOpen(true)}>
        <span aria-hidden="true">ⓘ</span> {label}
      </button>
      {open && (
        <div
          className="hiw-overlay"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label={title}
        >
          <div className="hiw-modal" onClick={(e) => e.stopPropagation()}>
            <div className="hiw-head">
              <h2 className="hiw-title">{title}</h2>
              <button
                type="button"
                className="hiw-close"
                onClick={() => setOpen(false)}
                aria-label="Close"
                title="Close"
              >
                ×
              </button>
            </div>
            <div className="hiw-body">{children}</div>
          </div>
        </div>
      )}
    </>
  );
}
