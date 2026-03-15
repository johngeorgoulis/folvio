import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

export type ShareClass = "ACC" | "DIST";
export type HoldingType = "ETF" | "Stock";

export type Broker =
  | "Interactive Brokers"
  | "Trading 212"
  | "Trade Republic"
  | "DEGIRO"
  | "eToro"
  | "XTB"
  | "Lightyear"
  | "Scalable Capital"
  | "Freedom24"
  | "Saxo Bank"
  | "Other";

export const BROKERS: Broker[] = [
  "Interactive Brokers",
  "Trading 212",
  "Trade Republic",
  "DEGIRO",
  "eToro",
  "XTB",
  "Lightyear",
  "Scalable Capital",
  "Freedom24",
  "Saxo Bank",
  "Other",
];

export interface Holding {
  id: string;
  name: string;
  holdingType: HoldingType;
  isin: string;
  ticker: string;
  broker: Broker;
  units: number;
  avgPurchasePrice: number;
  currentPrice: number;
  currency: string;
  targetAllocationPct: number;
  shareClass: ShareClass;
}

export interface DcaContribution {
  id: string;
  holdingId: string;
  date: string;
  unitsPurchased: number;
  pricePerUnit: number;
  notes: string;
}

export interface Dividend {
  id: string;
  holdingId: string;
  date: string;
  amountReceived: number;
  currency: string;
  exDate: string;
  paymentDate: string;
}

export interface SurplusConfig {
  monthlyIncome: number;
  fixedCosts: { id: string; label: string; amount: number }[];
}

export interface ProjectionsConfig {
  conservativePct: number;
  basePct: number;
  optimisticPct: number;
  monthlyDca: number;
  escalationPct: number;
}

interface PortfolioContextType {
  holdings: Holding[];
  contributions: DcaContribution[];
  dividends: Dividend[];
  surplusConfig: SurplusConfig;
  projectionsConfig: ProjectionsConfig;
  addHolding: (h: Omit<Holding, "id">) => void;
  updateHolding: (id: string, h: Partial<Holding>) => void;
  deleteHolding: (id: string) => void;
  addContribution: (c: Omit<DcaContribution, "id">) => void;
  deleteContribution: (id: string) => void;
  addDividend: (d: Omit<Dividend, "id">) => void;
  deleteDividend: (id: string) => void;
  updateSurplusConfig: (s: Partial<SurplusConfig>) => void;
  updateProjectionsConfig: (p: Partial<ProjectionsConfig>) => void;
  totalPortfolioValue: number;
  totalInvested: number;
  totalGain: number;
  totalGainPct: number;
}

const PortfolioContext = createContext<PortfolioContextType | null>(null);

const STORAGE_KEYS = {
  holdings: "fortis_holdings",
  contributions: "fortis_contributions",
  dividends: "fortis_dividends",
  surplusConfig: "fortis_surplus",
  projectionsConfig: "fortis_projections",
};

const DEFAULT_SURPLUS: SurplusConfig = {
  monthlyIncome: 0,
  fixedCosts: [],
};

const DEFAULT_PROJECTIONS: ProjectionsConfig = {
  conservativePct: 4,
  basePct: 7,
  optimisticPct: 10,
  monthlyDca: 400,
  escalationPct: 2,
};

function generateId() {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

export function PortfolioProvider({ children }: { children: React.ReactNode }) {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [contributions, setContributions] = useState<DcaContribution[]>([]);
  const [dividends, setDividends] = useState<Dividend[]>([]);
  const [surplusConfig, setSurplusConfig] =
    useState<SurplusConfig>(DEFAULT_SURPLUS);
  const [projectionsConfig, setProjectionsConfig] =
    useState<ProjectionsConfig>(DEFAULT_PROJECTIONS);

  useEffect(() => {
    const load = async () => {
      try {
        const [h, c, d, s, p] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEYS.holdings),
          AsyncStorage.getItem(STORAGE_KEYS.contributions),
          AsyncStorage.getItem(STORAGE_KEYS.dividends),
          AsyncStorage.getItem(STORAGE_KEYS.surplusConfig),
          AsyncStorage.getItem(STORAGE_KEYS.projectionsConfig),
        ]);
        if (h) setHoldings(JSON.parse(h));
        if (c) setContributions(JSON.parse(c));
        if (d) setDividends(JSON.parse(d));
        if (s) setSurplusConfig(JSON.parse(s));
        if (p) setProjectionsConfig(JSON.parse(p));
      } catch (e) {
        console.error("Failed to load data", e);
      }
    };
    load();
  }, []);

  const persist = useCallback(
    async (
      key: keyof typeof STORAGE_KEYS,
      data: Holding[] | DcaContribution[] | Dividend[] | SurplusConfig | ProjectionsConfig,
    ) => {
      try {
        await AsyncStorage.setItem(STORAGE_KEYS[key], JSON.stringify(data));
      } catch (e) {
        console.error("Failed to persist", key, e);
      }
    },
    [],
  );

  const addHolding = useCallback(
    (h: Omit<Holding, "id">) => {
      const newH: Holding = { ...h, id: generateId() };
      setHoldings((prev) => {
        const updated = [...prev, newH];
        persist("holdings", updated);
        return updated;
      });
    },
    [persist],
  );

  const updateHolding = useCallback(
    (id: string, h: Partial<Holding>) => {
      setHoldings((prev) => {
        const updated = prev.map((x) => (x.id === id ? { ...x, ...h } : x));
        persist("holdings", updated);
        return updated;
      });
    },
    [persist],
  );

  const deleteHolding = useCallback(
    (id: string) => {
      setHoldings((prev) => {
        const updated = prev.filter((x) => x.id !== id);
        persist("holdings", updated);
        return updated;
      });
    },
    [persist],
  );

  const addContribution = useCallback(
    (c: Omit<DcaContribution, "id">) => {
      const newC: DcaContribution = { ...c, id: generateId() };
      setContributions((prev) => {
        const updated = [...prev, newC];
        persist("contributions", updated);
        return updated;
      });
    },
    [persist],
  );

  const deleteContribution = useCallback(
    (id: string) => {
      setContributions((prev) => {
        const updated = prev.filter((x) => x.id !== id);
        persist("contributions", updated);
        return updated;
      });
    },
    [persist],
  );

  const addDividend = useCallback(
    (d: Omit<Dividend, "id">) => {
      const newD: Dividend = { ...d, id: generateId() };
      setDividends((prev) => {
        const updated = [...prev, newD];
        persist("dividends", updated);
        return updated;
      });
    },
    [persist],
  );

  const deleteDividend = useCallback(
    (id: string) => {
      setDividends((prev) => {
        const updated = prev.filter((x) => x.id !== id);
        persist("dividends", updated);
        return updated;
      });
    },
    [persist],
  );

  const updateSurplusConfig = useCallback(
    (s: Partial<SurplusConfig>) => {
      setSurplusConfig((prev) => {
        const updated = { ...prev, ...s };
        persist("surplusConfig", updated);
        return updated;
      });
    },
    [persist],
  );

  const updateProjectionsConfig = useCallback(
    (p: Partial<ProjectionsConfig>) => {
      setProjectionsConfig((prev) => {
        const updated = { ...prev, ...p };
        persist("projectionsConfig", updated);
        return updated;
      });
    },
    [persist],
  );

  const totalPortfolioValue = holdings.reduce(
    (sum, h) => sum + h.units * h.currentPrice,
    0,
  );

  const totalInvested = holdings.reduce(
    (sum, h) => sum + h.units * h.avgPurchasePrice,
    0,
  );

  const totalGain = totalPortfolioValue - totalInvested;
  const totalGainPct =
    totalInvested > 0 ? (totalGain / totalInvested) * 100 : 0;

  return (
    <PortfolioContext.Provider
      value={{
        holdings,
        contributions,
        dividends,
        surplusConfig,
        projectionsConfig,
        addHolding,
        updateHolding,
        deleteHolding,
        addContribution,
        deleteContribution,
        addDividend,
        deleteDividend,
        updateSurplusConfig,
        updateProjectionsConfig,
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
