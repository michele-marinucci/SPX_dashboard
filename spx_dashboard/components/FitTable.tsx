"use client";

import { useEffect, useRef, useState } from "react";

// Wraps a wide data table so it always fits the screen width on mobile.
// On phones we can't pinch-zoom (disabled) and these tables have many columns,
// so we measure the table's natural width and scale it down by exactly the
// ratio needed to fit the viewport — the largest size that still shows every
// column. Re-fits on resize and orientation change. On desktop (>820px) it is
// a no-op: the table keeps its natural size and horizontal scroll.
export function FitTable({ children }: { children: React.ReactNode }) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState<number | undefined>(undefined);

  useEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;

    const fit = () => {
      const mobile = window.matchMedia("(max-width: 820px)").matches;
      if (!mobile) {
        setScale(1);
        setHeight(undefined);
        return;
      }
      // scrollWidth/Height are the unscaled layout dimensions (CSS transforms
      // are paint-only, so they don't feed back into these measurements).
      const natural = inner.scrollWidth;
      const avail = outer.clientWidth;
      const s = natural > avail ? avail / natural : 1;
      setScale(s);
      setHeight(s < 1 ? inner.scrollHeight * s : undefined);
    };

    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(outer);
    ro.observe(inner);
    window.addEventListener("orientationchange", fit);
    return () => {
      ro.disconnect();
      window.removeEventListener("orientationchange", fit);
    };
  }, []);

  return (
    <div ref={outerRef} className="table-wrap" style={{ height }}>
      <div
        ref={innerRef}
        className="fit-inner"
        style={{ transform: scale < 1 ? `scale(${scale})` : undefined }}
      >
        {children}
      </div>
    </div>
  );
}
