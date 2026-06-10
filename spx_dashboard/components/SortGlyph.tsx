import { SortState } from "@/lib/sort";

// Ledger sort indicator: an always-present ▲ that goes idle (faint) when the
// column isn't the active sort, and brand-colored ▲/▼ when it is.
export function SortGlyph({ sort, sortKey }: { sort: SortState; sortKey: string }) {
  const active = sort.key === sortKey;
  return (
    <span className={active ? "sort-glyph" : "sort-glyph idle"}>
      {active ? (sort.dir === "desc" ? "▼" : "▲") : "▲"}
    </span>
  );
}
