"use client";

import { useEffect, useRef, useState } from "react";

// Wraps a data table so it always fills the screen width on mobile — no more,
// no less. Each table is measured and scaled independently to exactly fit its
// container: wide tables shrink so every column is visible, narrow tables grow
// so there's no empty space on the right. Re-fits on resize, rotation and
// after web fonts load (which change the natural width). On desktop (>820px)
// it's a no-op: tables keep their natural size and horizontal scroll.
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
      // scrollWidth/Height are unscaled layout dimensions (CSS transforms are
      // paint-only and don't feed back into them, so this can't loop).
      const natural = inner.scrollWidth;
      const avail = outer.clientWidth;
      if (natural <= 0 || avail <= 0) return;
      const s = avail / natural; // fill exactly: shrink if wide, grow if narrow
      setScale(s);
      setHeight(inner.scrollHeight * s);
    };

    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(outer);
    ro.observe(inner);
    window.addEventListener("orientationchange", fit);
    window.addEventListener("resize", fit);
    // Web fonts load after first paint and change the table's natural width;
    // re-fit once they're ready so we don't leave a gap or overflow.
    if (document.fonts?.ready) document.fonts.ready.then(fit);
    return () => {
      ro.disconnect();
      window.removeEventListener("orientationchange", fit);
      window.removeEventListener("resize", fit);
    };
  }, []);

  return (
    <div ref={outerRef} className="table-wrap" style={{ height }}>
      <div
        ref={innerRef}
        className="fit-inner"
        style={{ transform: scale !== 1 ? `scale(${scale})` : undefined }}
      >
        {children}
      </div>
    </div>
  );
}
