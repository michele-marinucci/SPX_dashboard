"use client";

import { useEffect } from "react";

// Blocks pinch- and double-tap zoom on touch devices — but ONLY on
// desktop-class viewports (≥769px), where the dashboard is a fixed-width
// layout that pinch-zoom would only knock askew. On phones and small tablets
// (≤768px) the dense data tables need pinch-zoom to stay readable, so the lock
// is relaxed and the browser's native zoom (re-enabled via the viewport) is
// left alone.
//
// iOS Safari ignores the viewport's user-scalable=no since iOS 10, so on
// desktop the only reliable way to suppress zoom is to cancel the relevant
// touch/gesture events ourselves. Runs in a client effect (not an inline
// <script>) so the listeners attach to `document` with passive:false —
// including during an in-progress scroll, when a second finger would otherwise
// start a pinch.
export function ZoomLock() {
  useEffect(() => {
    const opts: AddEventListenerOptions = { passive: false };
    // Desktop-class viewports only — mobile keeps native pinch-zoom.
    const mq = window.matchMedia("(min-width: 769px)");

    // iOS-specific pinch gesture events.
    const preventGesture = (e: Event) => e.preventDefault();
    // Any multi-touch (pinch) — fires even mid-scroll when a 2nd finger lands.
    const preventMultiTouch = (e: TouchEvent) => {
      if (e.touches.length > 1) e.preventDefault();
    };
    // Double-tap to zoom.
    let lastTouchEnd = 0;
    const preventDoubleTap = (e: TouchEvent) => {
      const now = Date.now();
      if (now - lastTouchEnd <= 300) e.preventDefault();
      lastTouchEnd = now;
    };

    const attach = () => {
      document.addEventListener("gesturestart", preventGesture, opts);
      document.addEventListener("gesturechange", preventGesture, opts);
      document.addEventListener("gestureend", preventGesture, opts);
      document.addEventListener("touchstart", preventMultiTouch, opts);
      document.addEventListener("touchmove", preventMultiTouch, opts);
      document.addEventListener("touchend", preventDoubleTap, opts);
    };
    const detach = () => {
      document.removeEventListener("gesturestart", preventGesture, opts);
      document.removeEventListener("gesturechange", preventGesture, opts);
      document.removeEventListener("gestureend", preventGesture, opts);
      document.removeEventListener("touchstart", preventMultiTouch, opts);
      document.removeEventListener("touchmove", preventMultiTouch, opts);
      document.removeEventListener("touchend", preventDoubleTap, opts);
    };

    // Lock on desktop, relax on mobile — and re-evaluate if the viewport
    // crosses the breakpoint (rotation, window resize).
    const sync = () => (mq.matches ? attach() : detach());
    sync();
    mq.addEventListener("change", sync);

    return () => {
      mq.removeEventListener("change", sync);
      detach();
    };
  }, []);

  return null;
}
