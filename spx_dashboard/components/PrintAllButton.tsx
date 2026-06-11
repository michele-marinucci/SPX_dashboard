"use client";

import { useState } from "react";

// Live tool routes, in the order they appear on the hub. "Print all" loads each
// in a hidden same-origin iframe and fires its print dialog in sequence, so one
// click walks you through printing every live tool.
const LIVE_ROUTES = ["/spx", "/themes", "/diligence", "/morning-news"];

export function PrintAllButton() {
  const [busy, setBusy] = useState(false);

  async function printAll() {
    if (busy) return;
    setBusy(true);
    try {
      for (const route of LIVE_ROUTES) {
        // eslint-disable-next-line no-await-in-loop
        await printRoute(route);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <button className="print-all-btn" onClick={printAll} disabled={busy}>
      {busy ? "Preparing…" : "Print all"}
    </button>
  );
}

function printRoute(route: string): Promise<void> {
  return new Promise((resolve) => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.src = route;

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      setTimeout(() => iframe.remove(), 1500);
      resolve();
    };

    iframe.onload = () => {
      const win = iframe.contentWindow;
      if (!win) {
        finish();
        return;
      }
      // Give client components a beat to hydrate and pull their data before the
      // print snapshot is taken. win.print() blocks until the dialog closes, so
      // the next route only loads once the user is done with this one.
      setTimeout(() => {
        try {
          win.focus();
          win.print();
        } catch {
          /* cross-origin or blocked print — skip and continue */
        }
        finish();
      }, 1400);
    };

    document.body.appendChild(iframe);
  });
}
