import { MorningNewsClient } from "./MorningNewsClient";
import morningNewsRaw from "@/data/morning_news.json";

export interface JargonNote {
  term: string;
  definition: string;
}

export interface ThemePoint {
  text: string;
  // Lettered supporting sub-bullets under the key takeaway.
  details?: string[];
  // Legacy: older notes carried term/definition pairs here instead.
  jargon?: JargonNote[];
}

export interface ChartSeriesPoint {
  label: string;
  value: number;
}

export interface ThemeChart {
  type: "bar" | "line";
  title: string;
  unit?: string;
  series: ChartSeriesPoint[];
}

export interface NewsTheme {
  headline: string;
  points: ThemePoint[];
  sources: string[];
  chart?: ThemeChart | null;
  // Legacy field — older notes stored a single prose paragraph.
  detail?: string;
}

export interface NewsPosition {
  ticker: string;
  name?: string;
  notes: string;
  // Our analytical read on what the news means for the (long) position.
  claude_take?: string;
}

export interface MorningNote {
  date: string; // YYYY-MM-DD
  top_themes: NewsTheme[];
  positions: NewsPosition[];
  one_liner: string;
}

export default function MorningNewsPage() {
  const notes = morningNewsRaw as MorningNote[];
  return <MorningNewsClient notes={notes} />;
}
