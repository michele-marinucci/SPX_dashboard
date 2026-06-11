// Single source of truth for tool names and the SPX Monitor section headings.
// The hub homepage, the sidebar, each tool page, and the PPT export all read
// from here, so renaming a tool or a section on its page automatically flows
// into the exported deck (no more stale slide titles).

export const TOOL_NAMES = {
  hub: "Mendo Hub",
  equities: "Equities Dashboard",
  spx: "SPX Monitor",
  morningNews: "Morning Notes",
  twitter: "Twitter Themes",
  diligence: "Diligence Tracker",
} as const;

export interface SpxSection {
  id: string;
  num: string;
  title: string;
  note: string;
}

// Section order here is both the page order on /spx and the slide order in
// the exported deck.
export const SPX_SECTIONS: SpxSection[] = [
  {
    id: "performance",
    num: "01",
    title: "Stock Performance",
    note: "Market cap ($b) · diverging Δ heatmaps",
  },
  {
    id: "growth",
    num: "02",
    title: "Earnings Growth",
    note: "Adjusted net income ($b)",
  },
  {
    id: "rev2026",
    num: "03",
    title: "Estimate Revisions · 2026",
    note: "Consensus adj. NI ($b)",
  },
  {
    id: "rev2027",
    num: "04",
    title: "Estimate Revisions · 2027",
    note: "Consensus adj. NI ($b)",
  },
  {
    id: "pe",
    num: "05",
    title: "NTM P/E",
    note: "Current vs historical averages · P/E history",
  },
];

export function spxSection(id: string): SpxSection {
  const s = SPX_SECTIONS.find((x) => x.id === id);
  if (!s) throw new Error(`unknown SPX section: ${id}`);
  return s;
}
