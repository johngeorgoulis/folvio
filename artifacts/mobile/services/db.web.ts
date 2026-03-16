import AsyncStorage from "@react-native-async-storage/async-storage";

export type HoldingRow = {
  id: string;
  ticker: string;
  isin: string;
  exchange: string;
  name: string;
  quantity: number;
  avg_cost_eur: number;
  purchase_date: string;
  created_at: string;
  updated_at: string;
};

export type PriceCacheRow = {
  ticker: string;
  price_eur: number;
  last_fetched: string;
  source: string;
};

export type TargetAllocationRow = {
  id: number;
  ticker: string;
  target_pct: number;
  created_at: string;
  updated_at: string;
};

const KEYS = {
  holdings: "fortis_v2_holdings",
  prices: "fortis_v2_prices",
  targets: "fortis_v2_targets",
};

async function readJSON<T>(key: string): Promise<T[]> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function writeJSON<T>(key: string, data: T[]): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(data));
}

export async function getAllHoldings(): Promise<HoldingRow[]> {
  return readJSON<HoldingRow>(KEYS.holdings);
}

export async function insertHolding(h: Omit<HoldingRow, "created_at" | "updated_at">): Promise<void> {
  const now = new Date().toISOString();
  const rows = await readJSON<HoldingRow>(KEYS.holdings);
  rows.push({ ...h, created_at: now, updated_at: now });
  await writeJSON(KEYS.holdings, rows);
}

export async function updateHolding(id: string, h: Partial<Omit<HoldingRow, "id" | "created_at">>): Promise<void> {
  const now = new Date().toISOString();
  const rows = await readJSON<HoldingRow>(KEYS.holdings);
  await writeJSON(KEYS.holdings, rows.map((r) => r.id === id ? { ...r, ...h, updated_at: now } : r));
}

export async function deleteHolding(id: string): Promise<void> {
  const rows = await readJSON<HoldingRow>(KEYS.holdings);
  await writeJSON(KEYS.holdings, rows.filter((r) => r.id !== id));
}

export async function upsertPrice(ticker: string, price_eur: number, source: string): Promise<void> {
  const now = new Date().toISOString();
  const rows = await readJSON<PriceCacheRow>(KEYS.prices);
  const idx = rows.findIndex((r) => r.ticker === ticker);
  const entry: PriceCacheRow = { ticker, price_eur, last_fetched: now, source };
  if (idx >= 0) rows[idx] = entry;
  else rows.push(entry);
  await writeJSON(KEYS.prices, rows);
}

export async function getAllPrices(): Promise<PriceCacheRow[]> {
  return readJSON<PriceCacheRow>(KEYS.prices);
}

export async function getPrice(ticker: string): Promise<PriceCacheRow | null> {
  const rows = await readJSON<PriceCacheRow>(KEYS.prices);
  return rows.find((r) => r.ticker === ticker) ?? null;
}

let _nextId = Date.now();

export async function getAllTargets(): Promise<TargetAllocationRow[]> {
  return readJSON<TargetAllocationRow>(KEYS.targets);
}

export async function upsertTarget(ticker: string, target_pct: number): Promise<void> {
  const now = new Date().toISOString();
  const rows = await readJSON<TargetAllocationRow>(KEYS.targets);
  const idx = rows.findIndex((r) => r.ticker === ticker);
  if (idx >= 0) {
    rows[idx] = { ...rows[idx], target_pct, updated_at: now };
  } else {
    rows.push({ id: _nextId++, ticker, target_pct, created_at: now, updated_at: now });
  }
  await writeJSON(KEYS.targets, rows);
}

export async function deleteTarget(ticker: string): Promise<void> {
  const rows = await readJSON<TargetAllocationRow>(KEYS.targets);
  await writeJSON(KEYS.targets, rows.filter((r) => r.ticker !== ticker));
}

export async function hasAnyTargets(): Promise<boolean> {
  const rows = await readJSON<TargetAllocationRow>(KEYS.targets);
  return rows.length > 0;
}
