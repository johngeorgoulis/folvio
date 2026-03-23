import { lookupByTicker, lookupByISIN } from "@/services/etfDatabaseService";

export type AssetClass = "Equity" | "Bond" | "Commodity" | "Real Estate" | "Cash" | "Other";


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
  // 1. Check the live ETF database (synchronous once initialized)
  const entry = lookupByTicker(ticker) ?? (isin ? lookupByISIN(isin) : null);
  if (entry) {
    const ac = entry.assetClass;
    if (ac === "Bonds")       return "Bond";
    if (ac === "Commodities") return "Commodity";
    if (ac === "Real Estate") return "Real Estate";
    if (ac === "Money Market") return "Cash";
    if (ac === "Equity")      return "Equity";
  }

  // 2. Simple ticker fallback (user-specified)
  const upper = ticker.toUpperCase();
  if (upper === "CSBGE7" || upper === "AGGH" || upper === "IEAG" ||
      upper === "IBTM"   || upper === "IBTS" || upper === "LQDE" ||
      upper === "IHYG"   || upper === "HYLD" || upper === "VGOV" ||
      upper === "IBGX"   || upper === "EUNA" || upper === "JPST") return "Bond";
  if (upper === "EGLN" || upper === "IGLN" || upper === "SGLN" ||
      upper === "PHAU"  || upper === "VZLD") return "Commodity";
  if (upper === "IWDP" || upper === "IPRP" || upper === "TRET") return "Real Estate";

  return "Equity";
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
