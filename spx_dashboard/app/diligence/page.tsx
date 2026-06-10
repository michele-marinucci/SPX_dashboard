import { DiligenceApp } from "@/components/DiligenceApp";
import { getDiligenceLinks } from "@/lib/diligence";
import { getStockNameMap } from "@/lib/data";

export const dynamic = "force-dynamic";

// Diligence Tracker — one row per position linking to its Microsoft List. The
// committed JSON is the first paint; the client swaps in the shared DB list (and
// any team edits) on mount. Stock names auto-fill from the tracked S&P universe.
export default function DiligencePage() {
  return <DiligenceApp initialLinks={getDiligenceLinks()} names={getStockNameMap()} />;
}
