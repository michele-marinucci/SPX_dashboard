"use client";

import { useEffect, useRef } from "react";

// Wraps a data table so it always fits the screen width on mobile — each table
// independently. We measure the table's natural width and apply CSS `zoom` so
// it fills the container exactly: wide tables shrink so every column is visible
// without scrolling, narrow tables grow so there's no empty space.
//
// `zoom` (not `transform: scale`) is used deliberately: zoom reflows layout, so
// the shrunk table's footprint shrinks too — no overflow to clip, no manual
// height bookkeeping. It's natively supported on iOS Safari. Applied
// imperatively via a ref so measuring (at zoom 1) and applying never fight the
// React render cycle or loop the ResizeObserver. No-op on desktop (>820px).
export function FitTable({ children }: { children: React.ReactNode }) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;

    let lastAvail = -1;

    const fit = (force = false) => {
      const mobile = window.matchMedia("(max-width: 820px)").matches;
      if (!mobile) {
        inner.style.zoom = "1";
        lastAvail = -1;
        return;
      }
      const avail = outer.clientWidth;
      // Skip when the available width hasn't changed (avoids ResizeObserver
      // feedback when zoom changes the inner's height). `force` overrides this
      // for font-load / orientation re-fits.
      if (!force && avail === lastAvail) return;
      // Measure the natural (unscaled) width first.
      inner.style.zoom = "1";
      const natural = inner.scrollWidth;
      if (!natural || !avail) {
        lastAvail = -1;
        return;
      }
      lastAvail = avail;
      inner.style.zoom = String(avail / natural);
    };

    fit(true);
    const ro = new ResizeObserver(() => fit());
    ro.observe(outer);
    const onReflow = () => fit(true);
    window.addEventListener("orientationchange", onReflow);
    window.addEventListener("resize", onReflow);
    // Web fonts change the natural width after first paint; re-fit when ready.
    if (document.fonts?.ready) document.fonts.ready.then(() => fit(true));

    return () => {
      ro.disconnect();
      window.removeEventListener("orientationchange", onReflow);
      window.removeEventListener("resize", onReflow);
    };
  }, []);

  return (
    <div ref={outerRef} className="table-wrap">
      <div ref={innerRef} className="fit-inner">
        {children}
      </div>
    </div>
  );
}
