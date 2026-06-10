import { MorningNewsClient } from "./MorningNewsClient";
import morningNewsRaw from "@/data/morning_news.json";

export interface NewsTheme {
  headline: string;
  detail: string;
  sources: string[];
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

export default function MorningNewsPage() {
  const notes = morningNewsRaw as MorningNote[];
  return <MorningNewsClient notes={notes} />;
}
