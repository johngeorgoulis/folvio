import {
  getAllAssetClassOverrides,
  upsertAssetClassOverride,
  deleteAssetClassOverride,
} from "@/services/db";
import { lookupByTicker, lookupByISIN } from "@/services/etfDatabaseService";

export type AssetClass = "Equity" | "Bond" | "Commodity" | "Real Estate" | "Cash" | "Other";

export const ASSET_CLASS_OPTIONS: AssetClass[] = [
  "Equity",
  "Bond",
  "Commodity",
  "Real Estate",
  "Cash",
  "Other",
];

// ── Override cache (populated at startup, updated on every user save) ──────────
let _overrideCache = new Map<string, AssetClass>();

/** Load (or reload) all user overrides from SQLite into memory. */
export async function loadAssetClassOverrides(): Promise<void> {
  try {
    const rows = await getAllAssetClassOverrides();
    _overrideCache.clear();
    for (const row of rows) {
      _overrideCache.set(row.ticker.toUpperCase(), row.asset_class as AssetClass);
    }
  } catch {
    // Non-fatal — cache stays empty
  }
}

/** Save a user override for a specific ticker and update the in-memory cache. */
export async function saveAssetClassOverride(ticker: string, assetClass: AssetClass): Promise<void> {
  await upsertAssetClassOverride(ticker, assetClass);
  _overrideCache.set(ticker.toUpperCase(), assetClass);
}

/** Remove a user override (revert to automatic classification). */
export async function clearAssetClassOverride(ticker: string): Promise<void> {
  await deleteAssetClassOverride(ticker);
  _overrideCache.delete(ticker.toUpperCase());
}

// ── TER lookup ────────────────────────────────────────────────────────────────

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

// ── Known bond ETFs hardcoded as final safety net ─────────────────────────────
// These are confirmed fixed-income instruments regardless of DB data.
const KNOWN_BOND_TICKERS = new Set([
  "CSBGE7", "AGGH", "IEAG", "IBTM", "IBTS", "LQDE",
  "IHYG", "HYLD", "VGOV", "IBGX", "EUNA", "JPST",
  // iShares Ultra Short Bond (EM corporate bonds)
  "ERNE",
  // iShares Euro Government Bond 0-1yr
  "IEGE",
]);

const KNOWN_COMMODITY_TICKERS = new Set([
  "EGLN", "IGLN", "SGLN", "PHAU", "VZLD",
]);

const KNOWN_REAL_ESTATE_TICKERS = new Set([
  "IWDP", "IPRP", "TRET",
]);

// ── Main classification function (synchronous) ─────────────────────────────────

/**
 * Returns the asset class for a ticker.
 * Priority order:
 *  1. User override (SQLite, loaded into memory at startup)
 *  2. ETF database (justETF local DB, 671 ETFs)
 *  3. Known ticker lists (hardcoded safety net)
 *  4. Default → Equity
 */
export function getAssetClass(ticker: string, isin?: string): AssetClass {
  const upper = ticker.toUpperCase();

  // 1. User override takes highest priority
  if (_overrideCache.has(upper)) return _overrideCache.get(upper)!;

  // 2. ETF database (synchronous once initialized)
  const entry = lookupByTicker(upper) ?? (isin ? lookupByISIN(isin) : null);
  if (entry) {
    const ac = entry.assetClass;
    if (ac === "Bonds")        return "Bond";
    if (ac === "Commodities")  return "Commodity";
    if (ac === "Real Estate")  return "Real Estate";
    if (ac === "Money Market") return "Cash";
    if (ac === "Equity")       return "Equity";
    // If DB value is something else (e.g. unexpected), fall through
  }

  // 3. Hardcoded safety net
  if (KNOWN_BOND_TICKERS.has(upper))      return "Bond";
  if (KNOWN_COMMODITY_TICKERS.has(upper)) return "Commodity";
  if (KNOWN_REAL_ESTATE_TICKERS.has(upper)) return "Real Estate";

  return "Equity";
}

// ── Portfolio classification (uses getAssetClass, weights by market value) ─────

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
