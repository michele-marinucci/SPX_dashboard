// Server-side helper: returns the team's live portfolio positions (port=1)
// from the equities DB (Supabase), with a seed-file fallback.
// This is the single source of truth — driven by the portfolio checkbox in
// the Equities Dashboard edit panel, not by a static JSON file.

import { loadCompanies } from "@/lib/equities/load";
import domainData from "@/data/portfolio.json";

export interface PortfolioPosition {
  ticker: string;
  name: string;
  domain?: string;
}

// Static metadata hints (display name + logo domain). Not authoritative for membership.
const META_BY_TICKER: Record<string, { name: string; domain?: string }> = Object.fromEntries(
  domainData.positions.map((p) => [p.ticker, { name: p.name, domain: p.domain ?? undefined }])
);

export async function getPortfolioPositions(): Promise<PortfolioPosition[]> {
  const { companies } = await loadCompanies();
  return companies
    .filter((c) => c.port === 1 && !c.removed)
    .map((c) => ({
      ticker: c.ticker,
      name: META_BY_TICKER[c.ticker]?.name ?? c.ticker,
      domain: META_BY_TICKER[c.ticker]?.domain,
    }));
}
