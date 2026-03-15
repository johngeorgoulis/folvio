import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  getAllHoldings,
  insertHolding,
  updateHolding as dbUpdateHolding,
  deleteHolding as dbDeleteHolding,
  upsertPrice,
  getAllPrices,
  type HoldingRow,
  type PriceCacheRow,
} from "@/services/db";

export const EXCHANGES = ["XETRA", "LSE", "Euronext", "SIX", "Borsa Italiana", "Other"] as const;
export type Exchange = (typeof EXCHANGES)[number];

export const FREE_TIER_LIMIT = 10;

export interface Holding extends HoldingRow {
  currentPrice: number;
  priceSource: string;
}

interface PortfolioContextType {
  holdings: Holding[];
  isLoading: boolean;
  holdingCount: number;
  isAtLimit: boolean;
  addHolding: (h: { ticker: string; isin: string; exchange: string; name: string; quantity: number; avg_cost_eur: number; purchase_date: string }, manualPrice: number) => Promise<void>;
  updateHolding: (id: string, h: Partial<Omit<HoldingRow, "id" | "created_at">>, newPrice?: number) => Promise<void>;
  deleteHolding: (id: string) => Promise<void>;
  refreshPrices: () => Promise<void>;
  totalPortfolioValue: number;
  totalInvested: number;
  totalGain: number;
  totalGainPct: number;
}

const PortfolioContext = createContext<PortfolioContextType | null>(null);

function generateId() {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

function mergeHoldingsWithPrices(rows: HoldingRow[], prices: PriceCacheRow[]): Holding[] {
  const priceMap = new Map(prices.map((p) => [p.ticker, p]));
  return rows.map((row) => {
    const cached = priceMap.get(row.ticker);
    return {
      ...row,
      currentPrice: cached?.price_eur ?? row.avg_cost_eur,
      priceSource: cached?.source ?? "manual",
    };
  });
}

export function PortfolioProvider({ children }: { children: React.ReactNode }) {
  const [holdingRows, setHoldingRows] = useState<HoldingRow[]>([]);
  const [prices, setPrices] = useState<PriceCacheRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const [rows, priceRows] = await Promise.all([getAllHoldings(), getAllPrices()]);
      setHoldingRows(rows);
      setPrices(priceRows);
    } catch (e) {
      console.error("Failed to load portfolio data", e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const addHolding = useCallback(
    async (
      h: { ticker: string; isin: string; exchange: string; name: string; quantity: number; avg_cost_eur: number; purchase_date: string },
      manualPrice: number
    ) => {
      const id = generateId();
      await insertHolding({ id, ...h });
      await upsertPrice(h.ticker, manualPrice, "manual");
      await loadData();
    },
    [loadData]
  );

  const updateHolding = useCallback(
    async (id: string, h: Partial<Omit<HoldingRow, "id" | "created_at">>, newPrice?: number) => {
      await dbUpdateHolding(id, h);
      if (newPrice !== undefined && h.ticker) {
        await upsertPrice(h.ticker, newPrice, "manual");
      }
      await loadData();
    },
    [loadData]
  );

  const deleteHolding = useCallback(
    async (id: string) => {
      await dbDeleteHolding(id);
      await loadData();
    },
    [loadData]
  );

  const refreshPrices = useCallback(async () => {
    await loadData();
  }, [loadData]);

  const holdings = mergeHoldingsWithPrices(holdingRows, prices);

  const totalPortfolioValue = holdings.reduce(
    (sum, h) => sum + h.quantity * h.currentPrice,
    0
  );

  const totalInvested = holdings.reduce(
    (sum, h) => sum + h.quantity * h.avg_cost_eur,
    0
  );

  const totalGain = totalPortfolioValue - totalInvested;
  const totalGainPct =
    totalInvested > 0 ? (totalGain / totalInvested) * 100 : 0;

  const holdingCount = holdings.length;
  const isAtLimit = holdingCount >= FREE_TIER_LIMIT;

  return (
    <PortfolioContext.Provider
      value={{
        holdings,
        isLoading,
        holdingCount,
        isAtLimit,
        addHolding,
        updateHolding,
        deleteHolding,
        refreshPrices,
        totalPortfolioValue,
        totalInvested,
        totalGain,
        totalGainPct,
      }}
    >
      {children}
    </PortfolioContext.Provider>
  );
}

export function usePortfolio(): PortfolioContextType {
  const ctx = useContext(PortfolioContext);
  if (!ctx) throw new Error("usePortfolio must be used inside PortfolioProvider");
  return ctx;
}
