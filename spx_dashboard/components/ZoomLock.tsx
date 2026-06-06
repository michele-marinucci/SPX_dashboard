"use client";

import { useEffect } from "react";

// Blocks pinch- and double-tap zoom on touch devices. iOS Safari ignores the
// viewport's user-scalable=no since iOS 10, so the only reliable way is to
// cancel the relevant touch/gesture events ourselves. Runs in a client effect
// (not an inline <script>) so the listeners attach reliably to `document` with
// passive:false — including during an in-progress scroll, when a second finger
// would otherwise start a pinch.
export function ZoomLock() {
  useEffect(() => {
    const opts: AddEventListenerOptions = { passive: false };

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

    document.addEventListener("gesturestart", preventGesture, opts);
    document.addEventListener("gesturechange", preventGesture, opts);
    document.addEventListener("gestureend", preventGesture, opts);
    document.addEventListener("touchstart", preventMultiTouch, opts);
    document.addEventListener("touchmove", preventMultiTouch, opts);
    document.addEventListener("touchend", preventDoubleTap, opts);

    return () => {
      document.removeEventListener("gesturestart", preventGesture, opts);
      document.removeEventListener("gesturechange", preventGesture, opts);
      document.removeEventListener("gestureend", preventGesture, opts);
      document.removeEventListener("touchstart", preventMultiTouch, opts);
      document.removeEventListener("touchmove", preventMultiTouch, opts);
      document.removeEventListener("touchend", preventDoubleTap, opts);
    };
  }, []);

  return null;
}
