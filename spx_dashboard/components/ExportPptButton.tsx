"use client";

import { useState } from "react";

// Downloads a deterministic PowerPoint of every live tool, built server-side
// from the committed data (no LLM). See /api/export-pptx.
export function ExportPptButton() {
  const [busy, setBusy] = useState(false);

  async function exportDeck() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/export-pptx");
      if (!res.ok) throw new Error(`export failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const today = new Date().toISOString().slice(0, 10);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Mendo-Hub-${today}.pptx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      alert("Couldn't build the PowerPoint. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button className="export-ppt-btn" onClick={exportDeck} disabled={busy}>
      <span className="glyph" aria-hidden="true">↓</span>{" "}
      {busy ? "Generating…" : "Export deck"}
    </button>
  );
}
