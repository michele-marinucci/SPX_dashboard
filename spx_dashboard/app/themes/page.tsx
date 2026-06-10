import { ThemesApp } from "@/components/ThemesApp";
import { getStockNameMap } from "@/lib/data";
import {
  getActiveIdeas,
  getFollowedHandles,
  getGeneratedAtLabel,
  getThemes,
} from "@/lib/themes";

export default function ThemesPage() {
  const ideas = getActiveIdeas();

  // Company names only for the tickers actually shown, to keep the payload small.
  const allNames = getStockNameMap();
  const names: Record<string, string> = {};
  for (const i of ideas) {
    if (allNames[i.ticker]) names[i.ticker] = allNames[i.ticker];
  }

  return (
    <ThemesApp
      ideas={ideas}
      canonicalFollowed={getFollowedHandles()}
      names={names}
      themes={getThemes()}
      asOf={getGeneratedAtLabel()}
    />
  );
}
