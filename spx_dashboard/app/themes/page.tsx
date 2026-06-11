import { TwitterMonitor } from "@/components/TwitterMonitor";
import { getFollowedHandles, getTwitterData } from "@/lib/tweets";
import { getPortfolioPositions } from "@/lib/portfolio";

export default async function ThemesPage() {
  const positions = await getPortfolioPositions();
  const portfolioNames = Object.fromEntries(positions.map((p) => [p.ticker, p.name]));
  return (
    <TwitterMonitor
      data={getTwitterData()}
      canonicalFollowed={getFollowedHandles()}
      portfolioNames={portfolioNames}
    />
  );
}
