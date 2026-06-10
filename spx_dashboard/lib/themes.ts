import themesFile from "@/data/themes.json";

// ---- Types mirroring pipeline/fetch_themes.py output ---------------------- //
export type Direction = "long" | "short" | "watch";
export type Tier = "priority" | "credible" | "discovery";
export type Conviction = "low" | "medium" | "high";

export interface ThemeRef {
  key: string;
  label: string;
}

export interface IdeaSource {
  handle: string;
  role: string;
  tier: Tier;
  url: string;
}

export interface IdeaPrices {
  currency: string;
  as_of: string;
  // YTD daily closes, newest-first (matches Sparkline.tsx's expectation).
  series: number[];
}

export interface ThemeIdea {
  ticker: string;
  direction: Direction;
  tier: Tier;
  thesis: string;
  catalyst: string;
  conviction: Conviction;
  score: number;
  // Active = recurred recently enough to stay in the main view. Inactive ideas
  // are kept in the file for recurrence math but hidden from the feed.
  active: boolean;
  on_watchlist: boolean;
  sources: IdeaSource[];
  citations: string[];
  theme_keys: string[];
  prices: IdeaPrices | null;
  first_seen: string;
  last_seen: string;
  // Distinct DAYS the (ticker, direction) idea has recurred across runs.
  seen_count: number;
}

export interface ThemesData {
  // ISO timestamp of the last successful run, or null before the first run.
  generated_at: string | null;
  themes: ThemeRef[];
  // Curated followed accounts (handles, no '@') seeding the UI's followed set.
  followed_handles?: string[];
  ideas: ThemeIdea[];
}

// Fallback followed set if the data file predates `followed_handles`. Kept in
// sync with pipeline/themes_config.py FOLLOWED_HANDLES.
export const DEFAULT_FOLLOWED_HANDLES = [
  "sama", "demishassabis", "darioamodei",
  "gavinsbaker", "bgurley", "billackman", "altcap", "modestproposal1",
  "patrick_oshag", "dwarkesh_sp",
  "dnystedt", "dylan522p", "beth_kindig", "p_ferragu",
  "datacenterhawk", "hhhypergrowth", "rihardjarc", "stockmarketnerd",
];

export function getFollowedHandles(): string[] {
  const fromData = getThemesData().followed_handles;
  const list = fromData && fromData.length ? fromData : DEFAULT_FOLLOWED_HANDLES;
  return list.map((h) => h.toLowerCase().replace(/^@/, ""));
}

export function getThemesData(): ThemesData {
  return themesFile as unknown as ThemesData;
}

// The configured themes, carried in the data so the UI stays dynamic.
export function getThemes(): ThemeRef[] {
  return getThemesData().themes ?? [];
}

export function getThemeLabel(key: string): string {
  return getThemes().find((t) => t.key === key)?.label ?? key;
}

// Ranked, bounded feed: active ideas only, sorted by score (recency as the
// tiebreaker). This is the order every section is sliced from.
export function getActiveIdeas(): ThemeIdea[] {
  return getThemesData()
    .ideas.filter((i) => i.active)
    .sort((a, b) => b.score - a.score || b.last_seen.localeCompare(a.last_seen));
}

export const TIER_ORDER: Tier[] = ["priority", "credible", "discovery"];

// Active ideas grouped into the three labeled sections, each already ranked.
export function getActiveIdeasByTier(): Record<Tier, ThemeIdea[]> {
  const out: Record<Tier, ThemeIdea[]> = {
    priority: [],
    credible: [],
    discovery: [],
  };
  for (const idea of getActiveIdeas()) out[idea.tier].push(idea);
  return out;
}

export function getActiveIdeasCount(): number {
  return getThemesData().ideas.reduce((n, i) => n + (i.active ? 1 : 0), 0);
}

// "As of" label for the feed header. Formats generated_at as a plain date;
// returns null before the first successful run so the UI can show a placeholder.
export function getGeneratedAtLabel(): string | null {
  const { generated_at } = getThemesData();
  if (!generated_at) return null;
  const d = new Date(generated_at);
  if (Number.isNaN(d.getTime())) return null;
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}
