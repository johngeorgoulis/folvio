import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  getAllTargets,
  upsertTarget as dbUpsertTarget,
  deleteTarget as dbDeleteTarget,
  hasAnyTargets,
  type TargetAllocationRow,
} from "@/services/db";

const DEFAULT_TARGETS: { ticker: string; target_pct: number }[] = [
  { ticker: "VWCE", target_pct: 30 },
  { ticker: "TDIV", target_pct: 25 },
  { ticker: "VHYL", target_pct: 15 },
  { ticker: "ERNE", target_pct: 10 },
  { ticker: "CSBGE7", target_pct: 7 },
  { ticker: "IEGE", target_pct: 6 },
  { ticker: "EGLN", target_pct: 7 },
];

const THRESHOLD_KEY = "folvio_rebalance_threshold";
export const THRESHOLD_OPTIONS = [3, 5, 10] as const;
export type ThresholdOption = (typeof THRESHOLD_OPTIONS)[number];

interface AllocationContextType {
  targets: TargetAllocationRow[];
  isLoadingTargets: boolean;
  rebalanceThreshold: ThresholdOption;
  setRebalanceThreshold: (n: ThresholdOption) => Promise<void>;
  upsertTarget: (ticker: string, targetPct: number) => Promise<void>;
  removeTarget: (ticker: string) => Promise<void>;
  reloadTargets: () => Promise<void>;
}

const AllocationContext = createContext<AllocationContextType | null>(null);

export function AllocationProvider({ children }: { children: React.ReactNode }) {
  const [targets, setTargets] = useState<TargetAllocationRow[]>([]);
  const [isLoadingTargets, setIsLoadingTargets] = useState(true);
  const [rebalanceThreshold, setThresholdState] = useState<ThresholdOption>(5);

  const reloadTargets = useCallback(async () => {
    try {
      const rows = await getAllTargets();
      setTargets(rows);
    } catch (e) {
      console.error("Failed to load targets", e);
    }
  }, []);

  useEffect(() => {
    async function init() {
      try {
        const [savedThreshold, alreadySeeded] = await Promise.all([
          AsyncStorage.getItem(THRESHOLD_KEY),
          hasAnyTargets(),
        ]);

        if (savedThreshold) {
          const parsed = parseInt(savedThreshold, 10);
          if (THRESHOLD_OPTIONS.includes(parsed as ThresholdOption)) {
            setThresholdState(parsed as ThresholdOption);
          }
        }

        if (!alreadySeeded) {
          for (const t of DEFAULT_TARGETS) {
            await dbUpsertTarget(t.ticker, t.target_pct);
          }
        }

        await reloadTargets();
      } catch (e) {
        console.error("AllocationContext init error", e);
      } finally {
        setIsLoadingTargets(false);
      }
    }
    init();
  }, [reloadTargets]);

  const upsertTarget = useCallback(
    async (ticker: string, targetPct: number) => {
      await dbUpsertTarget(ticker, targetPct);
      await reloadTargets();
    },
    [reloadTargets]
  );

  const removeTarget = useCallback(
    async (ticker: string) => {
      await dbDeleteTarget(ticker);
      await reloadTargets();
    },
    [reloadTargets]
  );

  const setRebalanceThreshold = useCallback(async (n: ThresholdOption) => {
    setThresholdState(n);
    await AsyncStorage.setItem(THRESHOLD_KEY, String(n));
  }, []);

  return (
    <AllocationContext.Provider
      value={{
        targets,
        isLoadingTargets,
        rebalanceThreshold,
        setRebalanceThreshold,
        upsertTarget,
        removeTarget,
        reloadTargets,
      }}
    >
      {children}
    </AllocationContext.Provider>
  );
}

export function useAllocation(): AllocationContextType {
  const ctx = useContext(AllocationContext);
  if (!ctx) throw new Error("useAllocation must be used inside AllocationProvider");
  return ctx;
}
