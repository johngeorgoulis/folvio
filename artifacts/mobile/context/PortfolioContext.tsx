import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppState, AppStateStatus } from "react-native";
import {
  getAllHoldings,
  insertHolding,
  updateHolding as dbUpdateHolding,
  deleteHolding as dbDeleteHolding,
  upsertPrice,
  getAllPrices,
  clearPriceCache,
  type HoldingRow,
  type PriceCacheRow,
} from "@/services/db";
import { refreshAllPrices } from "@/services/priceService";
import { takeSnapshot } from "@/services/snapshotService";

export const EXCHANGES = [
  "XETRA",
  "EURONEXT_AMS",
  "EURONEXT_PAR",
  "LSE",
  "BORSA_IT",
  "SIX",
  "Euronext Paris",
  "Euronext Amsterdam",
  "Borsa Italiana",
  "SIX Swiss",
  "Other",
] as const;
export type Exchange = (typeof EXCHANGES)[number];

export const FREE_TIER_LIMIT = 10;

export interface Holding extends HoldingRow {
  currentPrice: number;
  priceSource: "api" | "manual";
  priceLastFetched: string;
  priceIsStale: boolean;
  hasPrice: boolean;
}

interface PortfolioContextType {
  holdings: Holding[];
  isLoading: boolean;
  isRefreshingPrices: boolean;
  holdingCount: number;
  isAtLimit: boolean;
  addHolding: (
    h: {
      ticker: string;
      isin: string;
      exchange: string;
      name: string;
      quantity: number;
      avg_cost_eur: number;
      purchase_date: string;
      yield_pct?: number | null;
    },
    manualPrice: number
  ) => Promise<void>;
  updateHolding: (
    id: string,
    h: Partial<Omit<HoldingRow, "id" | "created_at">>,
    newPrice?: number
  ) => Promise<void>;
  deleteHolding: (id: string) => Promise<void>;
  refreshPrices: () => Promise<void>;
  clearPrices: () => Promise<void>;
  totalPortfolioValue: number;
  totalInvested: number;
  totalGain: number;
  totalGainPct: number;
}

const PortfolioContext = createContext<PortfolioContextType | null>(null);

const CACHE_TTL_MS = 15 * 60 * 1000;

function generateId() {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

function mergeHoldingsWithPrices(
  rows: HoldingRow[],
  prices: PriceCacheRow[]
): Holding[] {
  const priceMap = new Map(prices.map((p) => [p.ticker, p]));
  return rows.map((row) => {
    const cached = priceMap.get(row.ticker);
    const age = cached
      ? Date.now() - new Date(cached.last_fetched).getTime()
      : Infinity;
    const isStale = cached?.source !== "manual" && age > CACHE_TTL_MS;
    return {
      ...row,
      currentPrice: cached?.price_eur ?? row.avg_cost_eur,
      priceSource: (cached?.source as "api" | "manual") ?? "manual",
      priceLastFetched: cached?.last_fetched ?? "",
      priceIsStale: isStale,
      hasPrice: !!cached,
    };
  });
}

export function PortfolioProvider({ children }: { children: React.ReactNode }) {
  const [holdingRows, setHoldingRows] = useState<HoldingRow[]>([]);
  const [prices, setPrices] = useState<PriceCacheRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshingPrices, setIsRefreshingPrices] = useState(false);
  const holdingRowsRef = useRef<HoldingRow[]>([]);

  const loadData = useCallback(async () => {
    try {
      const [rows, priceRows] = await Promise.all([
        getAllHoldings(),
        getAllPrices(),
      ]);
      setHoldingRows(rows);
      holdingRowsRef.current = rows;
      setPrices(priceRows);
    } catch (e) {
      console.error("Failed to load portfolio data", e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const doRefreshPrices = useCallback(async (rows: HoldingRow[]) => {
    if (rows.length === 0) return;
    setIsRefreshingPrices(true);
    try {
      await refreshAllPrices(rows);
      const priceRows = await getAllPrices();
      setPrices(priceRows);

      // Take daily snapshot after a successful price refresh
      const merged = mergeHoldingsWithPrices(rows, priceRows);
      const totalValue = merged.reduce(
        (sum, h) => (h.hasPrice ? sum + h.quantity * h.currentPrice : sum),
        0
      );
      const totalInvested = merged.reduce(
        (sum, h) => sum + h.quantity * h.avg_cost_eur,
        0
      );
      if (totalValue > 0) {
        await takeSnapshot(totalValue, totalInvested);
      }
    } catch (e) {
      console.error("Price refresh error", e);
    } finally {
      setIsRefreshingPrices(false);
    }
  }, []);

  useEffect(() => {
    loadData().then(() => {
      doRefreshPrices(holdingRowsRef.current);
    });
  }, [loadData, doRefreshPrices]);

  useEffect(() => {
    const sub = AppState.addEventListener(
      "change",
      (nextState: AppStateStatus) => {
        if (nextState === "active") {
          doRefreshPrices(holdingRowsRef.current);
        }
      }
    );
    return () => sub.remove();
  }, [doRefreshPrices]);

  const addHolding = useCallback(
    async (
      h: {
        ticker: string;
        isin: string;
        exchange: string;
        name: string;
        quantity: number;
        avg_cost_eur: number;
        purchase_date: string;
        yield_pct?: number | null;
      },
      manualPrice: number
    ) => {
      const id = generateId();
      await insertHolding({ id, ...h, yield_pct: h.yield_pct ?? null });
      await upsertPrice(h.ticker, manualPrice, "manual");
      await loadData();
      doRefreshPrices(holdingRowsRef.current);
    },
    [loadData, doRefreshPrices]
  );

  const updateHolding = useCallback(
    async (
      id: string,
      h: Partial<Omit<HoldingRow, "id" | "created_at">>,
      newPrice?: number
    ) => {
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
    await doRefreshPrices(holdingRowsRef.current);
  }, [doRefreshPrices]);

  const clearPrices = useCallback(async () => {
    await clearPriceCache();
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
        isRefreshingPrices,
        holdingCount,
        isAtLimit,
        addHolding,
        updateHolding,
        deleteHolding,
        refreshPrices,
        clearPrices,
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
  if (!ctx)
    throw new Error("usePortfolio must be used inside PortfolioProvider");
  return ctx;
}
