import tweetsFile from "@/data/tweets.json";
import portfolioFile from "@/data/portfolio.json";

// ---- Types mirroring pipeline/fetch_tweets.py output ---------------------- //
export type Sentiment = "positive" | "negative" | "neutral";

export interface ThemeRef {
  key: string;
  label: string;
}

export interface Tweet {
  id: string;
  url: string;
  handle: string;
  author_name?: string;
  posted_at?: string;
  text: string;
  summary: string;
  sentiment: Sentiment;
  themes: string[];
  tickers: string[];
  // Portfolio display tickers (e.g. "LSEG LN") this tweet mentions.
  portfolio: string[];
  views: number | null;
  has_media: boolean;
  media_summary?: string;
  // Direct chart/image URLs (pbs.twimg.com / *.png|jpg|webp), for thumbnails.
  media_urls?: string[];
  first_seen: string;
  last_seen: string;
  seen_count: number;
}

export interface DailySummaryItem {
  theme: string;
  label: string;
  summary: string;
  tickers: string[];
  tweet_ids: string[];
}

export interface DailySummary {
  date: string | null;
  headline: string;
  items: DailySummaryItem[];
}

export interface RecurringTopic {
  topic: string;
  summary: string;
  days_seen: number;
  tickers: string[];
  tweet_ids: string[];
}

export interface TwitterData {
  generated_at: string | null;
  themes: ThemeRef[];
  followed_handles: string[];
  // Holdings, display form ("LSEG LN" = non-US listing).
  portfolio: string[];
  daily_summary: DailySummary;
  recurring: RecurringTopic[];
  // 1-week % move per ticker; null = unavailable (placeholder in the UI).
  ticker_moves: Record<string, number | null>;
  tweets: Tweet[];
}

// Company names for portfolio lines — sourced from the canonical data/portfolio.json.
export const PORTFOLIO_NAMES: Record<string, string> = Object.fromEntries(
  portfolioFile.positions.map((p) => [p.ticker, p.name])
);

// Fallback followed set if the data file predates the first pipeline run.
// Kept in sync with pipeline/themes_config.py FOLLOWED_HANDLES.
export const DEFAULT_FOLLOWED_HANDLES = [
  "edzitron", "wccftech", "firstadopter", "southernvalue95", "chatgptapp",
  "kimmonismus", "jukan05", "prismml", "claudeai", "austinsemis",
  "apoorv03", "julienbek", "citrini", "kobeissiletter", "atelicinvest",
  "nicbstme", "inflectionecon", "coatuemgmt", "wisemancap", "bgurley",
  "vikramskr", "contrariancurse", "insane_analyst", "alexeheath", "dnystedt",
  "mooremorrissemi", "the_ai_investor", "thehumanoidlab", "similarweb",
  "rihardjarc", "kevinweil", "tmtmoats", "macroedgeres", "fundaai",
  "altcap", "elerianm", "satyanadella", "dharmesh", "sama", "dylan522p",
  "techfundies", "modestproposal1", "benthompson", "deepseek_ai",
  "artificialanlys", "gavinsbaker",
];

export function getTwitterData(): TwitterData {
  return tweetsFile as unknown as TwitterData;
}

export function getFollowedHandles(): string[] {
  const fromData = getTwitterData().followed_handles;
  const list = fromData && fromData.length ? fromData : DEFAULT_FOLLOWED_HANDLES;
  return list.map((h) => h.toLowerCase().replace(/^@/, ""));
}

export function getTweetCount(): number {
  return getTwitterData().tweets.length;
}

// "As of" label for headers; null before the first successful run.
export function getGeneratedAtLabel(): string | null {
  const { generated_at } = getTwitterData();
  if (!generated_at) return null;
  const d = new Date(generated_at);
  if (Number.isNaN(d.getTime())) return null;
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}
