import {
  hasTodaySnapshot,
  insertSnapshot,
  getSnapshotsByRange,
  pruneSnapshots,
  type SnapshotRow,
} from "@/services/db";

export type { SnapshotRow };

export interface PortfolioSnapshot {
  id: number;
  snapshotDate: string;
  totalValueEUR: number;
  totalInvestedEUR: number;
  createdAt: string;
}

const RANGE_DAYS: Record<string, number> = {
  "1W": 7,
  "1M": 30,
  "3M": 90,
  "1Y": 365,
  "All": 99999,
};

function rowToSnapshot(row: SnapshotRow): PortfolioSnapshot {
  return {
    id: row.id,
    snapshotDate: row.snapshot_date,
    totalValueEUR: row.total_value_eur,
    totalInvestedEUR: row.total_invested_eur,
    createdAt: row.created_at,
  };
}

export async function takeSnapshot(
  totalValueEUR: number,
  totalInvestedEUR: number
): Promise<void> {
  try {
    if (totalValueEUR <= 0) return;
    if (await hasTodaySnapshot()) return;

    const today = new Date().toISOString().split("T")[0];
    await insertSnapshot(today, totalValueEUR, totalInvestedEUR);
    await pruneSnapshots(365);
  } catch (err) {
    console.warn("[snapshotService] takeSnapshot failed:", err);
  }
}

export async function getSnapshots(range: string): Promise<PortfolioSnapshot[]> {
  try {
    const days = RANGE_DAYS[range] ?? 30;
    const rows = await getSnapshotsByRange(days);
    return rows.map(rowToSnapshot);
  } catch (err) {
    console.warn("[snapshotService] getSnapshots failed:", err);
    return [];
  }
}
