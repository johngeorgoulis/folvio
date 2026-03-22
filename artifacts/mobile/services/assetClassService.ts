export type AssetClass = "Equity" | "Bond" | "Commodity" | "Real Estate" | "Cash" | "Other";

const TICKER_CLASS_MAP: Record<string, AssetClass> = {
  // Equity ETFs
  "VWCE": "Equity", "VWRL": "Equity", "VHYL": "Equity", "TDIV": "Equity",
  "IWDA": "Equity", "SWRD": "Equity", "EQQQ": "Equity", "CSPX": "Equity",
  "CSP1": "Equity", "IUSA": "Equity", "IUES": "Equity", "IEEM": "Equity",
  "EMIM": "Equity", "VUAA": "Equity", "VUSA": "Equity", "VEUR": "Equity",
  "VFEM": "Equity", "VERX": "Equity", "VEVE": "Equity", "IDVY": "Equity",
  "XDWD": "Equity", "XDEW": "Equity", "XMAW": "Equity", "SPPW": "Equity",
  "SAWD": "Equity", "LCUW": "Equity", "PANX": "Equity", "MXWO": "Equity",
  "VFEA": "Equity", "LYP6": "Equity", "LYPE": "Equity", "AHYQ": "Equity",
  "QDVW": "Equity", "10AI": "Equity", "SPY5": "Equity",
  // Bond ETFs
  "ERNE": "Bond", "IEGE": "Bond", "CSBGE7": "Bond", "AGGH": "Bond",
  "IEAG": "Bond", "IBTM": "Bond", "IBTS": "Bond", "LQDE": "Bond",
  "IHYG": "Bond", "HYLD": "Bond", "VGOV": "Bond", "IBGX": "Bond",
  "EUNA": "Bond", "JPST": "Bond", "2B7S": "Bond",
  // Commodity
  "EGLN": "Commodity", "IGLN": "Commodity", "SGLN": "Commodity",
  "PHAU": "Commodity", "VZLD": "Commodity",
  // Real Estate
  "IWDP": "Real Estate", "IPRP": "Real Estate", "TRET": "Real Estate",
};

const ISIN_PREFIX_MAP: Record<string, AssetClass> = {};

const KNOWN_TER: Record<string, number> = {
  "VWCE": 0.19, "VWRL": 0.22, "VHYL": 0.29, "TDIV": 0.38,
  "IWDA": 0.20, "SWRD": 0.12, "EQQQ": 0.33, "CSPX": 0.07,
  "CSP1": 0.07, "IUSA": 0.07, "VUAA": 0.07, "VUSA": 0.07,
  "EGLN": 0.25, "IGLN": 0.25, "ERNE": 0.20, "IEGE": 0.07,
  "CSBGE7": 0.07, "AGGH": 0.10, "IEAG": 0.10, "IHYG": 0.50,
  "VEUR": 0.10, "VFEM": 0.22, "EMIM": 0.18, "IEEM": 0.18,
  "IDVY": 0.29, "SPPW": 0.05, "LCUW": 0.12, "PANX": 0.30,
  "XDWD": 0.19, "XDEW": 0.15,
};

export function getTER(ticker: string): number | null {
  return KNOWN_TER[ticker.toUpperCase()] ?? null;
}

export function getAssetClass(ticker: string, isin?: string): AssetClass {
  const upper = ticker.toUpperCase();
  if (TICKER_CLASS_MAP[upper]) return TICKER_CLASS_MAP[upper];

  // Heuristics from ticker name
  const t = upper;
  if (t.includes("BOND") || t.includes("GILT") || t.includes("TREA")) return "Bond";
  if (t.includes("GOLD") || t.includes("SILV") || t.includes("COMD")) return "Commodity";
  if (t.includes("REIT") || t.includes("PROP")) return "Real Estate";

  return "Equity"; // default assumption for unknown tickers
}

export function classifyPortfolio(
  holdings: { ticker: string; isin?: string; quantity: number; currentPrice: number; hasPrice: boolean }[]
): { class: AssetClass; valuePct: number; valueEUR: number }[] {
  const totalValue = holdings.reduce(
    (sum, h) => sum + (h.hasPrice ? h.quantity * h.currentPrice : 0), 0
  );
  if (totalValue === 0) return [];

  const classMap = new Map<AssetClass, number>();
  for (const h of holdings) {
    if (!h.hasPrice) continue;
    const cls = getAssetClass(h.ticker, h.isin);
    const val = h.quantity * h.currentPrice;
    classMap.set(cls, (classMap.get(cls) ?? 0) + val);
  }

  return Array.from(classMap.entries())
    .map(([cls, val]) => ({
      class: cls,
      valueEUR: val,
      valuePct: (val / totalValue) * 100,
    }))
    .sort((a, b) => b.valueEUR - a.valueEUR);
}
