// Shared click-to-sort helpers for the data tables.
//
// A column is identified by a string key. Clicking cycles:
//   unsorted → descending (largest first) → ascending → unsorted.
// Nulls always sort last, regardless of direction.

export type SortDir = "asc" | "desc";

export interface SortState {
  key: string | null;
  dir: SortDir;
}

export const NO_SORT: SortState = { key: null, dir: "desc" };

export function nextSort(prev: SortState, key: string): SortState {
  if (prev.key !== key) return { key, dir: "desc" };
  if (prev.dir === "desc") return { key, dir: "asc" };
  return NO_SORT;
}

type Cell = number | string | null | undefined;

function isBlank(v: Cell): boolean {
  return v === null || v === undefined || (typeof v === "number" && Number.isNaN(v));
}

export function compareCells(a: Cell, b: Cell, dir: SortDir): number {
  const ab = isBlank(a);
  const bb = isBlank(b);
  if (ab && bb) return 0;
  if (ab) return 1; // blanks last
  if (bb) return -1;

  let r: number;
  if (typeof a === "string" || typeof b === "string") {
    r = String(a).localeCompare(String(b));
  } else {
    r = (a as number) - (b as number);
  }
  return dir === "asc" ? r : -r;
}

// Stable sort of `items` by a key accessor, honoring the sort state. When no
// column is active the original order is preserved.
export function sortRows<T>(
  items: T[],
  state: SortState,
  accessor: (item: T, key: string) => Cell,
): T[] {
  if (!state.key) return items;
  const key = state.key;
  return items
    .map((item, i) => ({ item, i }))
    .sort((x, y) => {
      const c = compareCells(accessor(x.item, key), accessor(y.item, key), state.dir);
      return c !== 0 ? c : x.i - y.i;
    })
    .map((w) => w.item);
}

// The glyph shown next to a column header for the active sort.
export function sortGlyph(state: SortState, key: string): string {
  if (state.key !== key) return "";
  return state.dir === "desc" ? " ▼" : " ▲";
}
