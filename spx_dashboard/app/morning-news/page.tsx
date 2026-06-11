import { MorningNewsClient } from "./MorningNewsClient";
import morningNewsRaw from "@/data/morning_news.json";
import { getPortfolioPositions } from "@/lib/portfolio";

export interface JargonNote {
  term: string;
  definition: string;
}

export interface ThemePoint {
  text: string;
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
}

export interface MorningNote {
  date: string; // YYYY-MM-DD
  top_themes: NewsTheme[];
  positions: NewsPosition[];
  one_liner: string;
}

export default async function MorningNewsPage() {
  const notes = morningNewsRaw as MorningNote[];
  const positions = await getPortfolioPositions();
  const tickerDomain: Record<string, string> = Object.fromEntries(
    positions
      .filter((p) => p.domain)
      .map((p) => [p.ticker, p.domain!])
  );
  return <MorningNewsClient notes={notes} tickerDomain={tickerDomain} />;
}
