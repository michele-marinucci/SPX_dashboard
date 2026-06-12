"use client";

import { useEffect, useState } from "react";

// Single source of truth for the mobile breakpoint in client components.
// Matches the CSS mobile layer (@media max-width: 768px). Returns false on
// the server / first paint, so SSR markup stays the desktop variant; views
// that swap whole layouts should be tolerant of that one-frame switch.
export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    setMobile(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setMobile(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return mobile;
}
