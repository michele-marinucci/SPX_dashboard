import diligenceFile from "@/data/diligence.json";

// One row of the Diligence Tracker: a stock and the link to its Microsoft List.
// Client-safe (types + committed-JSON fallback only). The server-only Supabase
// access lives in lib/diligenceDb.ts, mirroring lib/themes.ts ↔ lib/supabase.ts.
export interface DiligenceLink {
  ticker: string; // uppercased symbol, e.g. "MSFT"
  name: string; // company name (may be empty)
  url: string; // Microsoft List URL
}

export interface DiligenceData {
  links: DiligenceLink[];
}

// Symbol only, uppercased — drops anything after the first space so a
// Bloomberg-style "MSFT US Equity" collapses to "MSFT".
export const normTicker = (t: string): string =>
  t.trim().toUpperCase().split(/\s+/)[0] ?? "";

export function getDiligenceData(): DiligenceData {
  return diligenceFile as DiligenceData;
}

// Committed fallback list, sorted by ticker. Used to render the first paint and
// to seed Supabase on first use.
export function getDiligenceLinks(): DiligenceLink[] {
  return [...(getDiligenceData().links ?? [])]
    .map((l) => ({ ...l, ticker: normTicker(l.ticker) }))
    .filter((l) => l.ticker && l.url)
    .sort((a, b) => a.ticker.localeCompare(b.ticker));
}

// Curated ticker → company-domain overrides. The symbol-keyed logo CDN
// (Parqet) is ambiguous for some symbols — it resolves "META" to MetLife's
// logo and "AMZN" to Agilent's, and misses many non-US listings entirely.
// When a ticker is listed here we look the logo up by the company's real
// domain instead, which is unambiguous and works across exchanges. Add a row
// here whenever a logo comes back wrong or blank. Keys are normalized tickers
// (exchange suffix stripped, uppercased).
export const TICKER_DOMAIN: Record<string, string> = {
  // US names that the symbol CDN gets wrong or confuses with a similar symbol.
  META: "meta.com",
  AMZN: "amazon.com",
  AAPL: "apple.com",
  MSFT: "microsoft.com",
  GOOGL: "abc.xyz",
  GOOG: "abc.xyz",
  NVDA: "nvidia.com",
  TSLA: "tesla.com",
  "BRK/B": "berkshirehathaway.com",
  "BRK/A": "berkshirehathaway.com",
  BRK: "berkshirehathaway.com",
  JPM: "jpmorganchase.com",
  V: "visa.com",
  MA: "mastercard.com",
  UNH: "unitedhealthgroup.com",
  HD: "homedepot.com",
  PG: "pg.com",
  JNJ: "jnj.com",
  COST: "costco.com",
  ABBV: "abbvie.com",
  AVGO: "broadcom.com",
  XOM: "exxonmobil.com",
  CVX: "chevron.com",
  LLY: "lilly.com",
  KO: "coca-cola.com",
  PEP: "pepsico.com",
  MRK: "merck.com",
  WMT: "walmart.com",
  BAC: "bankofamerica.com",
  NFLX: "netflix.com",
  DIS: "thewaltdisneycompany.com",
  ADBE: "adobe.com",
  CRM: "salesforce.com",
  ORCL: "oracle.com",
  AMD: "amd.com",
  INTC: "intel.com",
  QCOM: "qualcomm.com",
  TXN: "ti.com",
  NKE: "nike.com",
  MCD: "mcdonalds.com",
  CSCO: "cisco.com",
  ACN: "accenture.com",
  LIN: "linde.com",
  PM: "pmi.com",
  TMO: "thermofisher.com",
  ABT: "abbott.com",
  DHR: "danaher.com",
  WFC: "wellsfargo.com",
  GE: "ge.com",
  CAT: "caterpillar.com",
  IBM: "ibm.com",
  NOW: "servicenow.com",
  UBER: "uber.com",
  BKNG: "bookingholdings.com",
  // Symbols whose correct owner is easily confused with the above.
  MET: "metlife.com", // MetLife — keep it from being mistaken for META
  A: "agilent.com", // Agilent
  // Non-US / European listings the symbol CDN frequently misses. Includes the
  // US-listed (ADR) symbols, since the diligence tracker stores the bare root.
  ASML: "asml.com",
  SAP: "sap.com",
  SHEL: "shell.com",
  BP: "bp.com",
  AZN: "astrazeneca.com",
  NVO: "novonordisk.com",
  NVS: "novartis.com",
  UL: "unilever.com",
  TTE: "totalenergies.com",
  SNY: "sanofi.com",
  RIO: "riotinto.com",
  BHP: "bhp.com",
  HSBC: "hsbc.com",
  TM: "toyota.com",
  SONY: "sony.com",
  NESN: "nestle.com",
  ROG: "roche.com",
  NOVN: "novartis.com",
  MC: "lvmh.com",
  OR: "loreal.com",
  SIE: "siemens.com",
  AIR: "airbus.com",
  ALV: "allianz.com",
  BAS: "basf.com",
  BAYN: "bayer.com",
  BMW: "bmwgroup.com",
  ADS: "adidas.com",
  ENEL: "enel.com",
  ABI: "ab-inbev.com",
  KER: "kering.com",
  RMS: "hermes.com",
  EL: "essilorluxottica.com",
  CFR: "richemont.com",
  ULVR: "unilever.com",
  DGE: "diageo.com",
  GSK: "gsk.com",
  PRX: "prosus.com",
  INGA: "ing.com",
  UBSG: "ubs.com",
  ZURN: "zurich.com",
  SU: "se.com",
  AI: "airliquide.com",
  DTE: "telekom.com",
};

// Logo for a domain. Uses a domain-keyed service (unambiguous: a real company
// website maps to exactly one brand), falling back through the chain in
// logoCandidates if it can't render.
function domainLogo(domain: string): string {
  return `https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`;
}

// The symbol-keyed CDN. Good quality for most US symbols; ambiguous/blank for
// the cases handled by TICKER_DOMAIN above.
function symbolLogo(ticker: string): string {
  return `https://assets.parqet.com/logos/symbol/${encodeURIComponent(
    normTicker(ticker),
  )}?format=png&size=64`;
}

// Ordered list of logo URLs to try for a ticker. The UI walks the list on each
// image error and shows a monogram only after every source fails. When a domain
// override exists we try it FIRST — the symbol CDN can return a *wrong* logo
// that still loads (so onError never fires), which is exactly the META→MetLife
// bug; the domain source is unambiguous and wins.
export function logoCandidates(ticker: string): string[] {
  const domain = TICKER_DOMAIN[normTicker(ticker)];
  return domain ? [domainLogo(domain), symbolLogo(ticker)] : [symbolLogo(ticker)];
}

// Back-compat single-URL accessor (first candidate).
export function logoUrl(ticker: string): string {
  return logoCandidates(ticker)[0];
}
