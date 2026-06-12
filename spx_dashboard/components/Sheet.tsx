"use client";

import { useEffect } from "react";

// Bottom-sheet primitive for the mobile experience: scrim + white panel pinned
// to the bottom with a grab handle, slide-up animation, internal scroll, and a
// close ×. Scrim tap and Escape both close. Every mobile pop-up (how-it-works,
// calendar, accounts, add/confirm, SPX filter & drill-down) renders through
// this so behavior stays consistent.
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    // Freeze the page behind the sheet.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="m-sheet-scrim"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === "string" ? title : undefined}
    >
      <div className="m-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="m-sheet-handle" aria-hidden="true" />
        <div className="m-sheet-head">
          {title && <h2 className="m-sheet-title">{title}</h2>}
          <button
            type="button"
            className="m-sheet-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="m-sheet-body">{children}</div>
        {footer && <div className="m-sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}
