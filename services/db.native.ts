import * as SQLite from "expo-sqlite";

export type HoldingRow = {
  id: string;
  ticker: string;
  isin: string;
  exchange: string;
  name: string;
  quantity: number;
  avg_cost_eur: number;
  purchase_date: string;
  yield_pct: number | null;
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

export type SnapshotRow = {
  id: number;
  snapshot_date: string;
  total_value_eur: number;
  total_invested_eur: number;
  created_at: string;
};

export type EtfPriceRow = {
  ticker: string;
  date: string;
  close_eur: number;
};

export type PortfolioHistoryRow = {
  date: string;
  total_value_eur: number;
  total_invested_eur: number;
  created_at: string;
};

// ── Singleton init promise ─────────────────────────────────────────────────
// Using a shared promise prevents the race condition where PortfolioProvider
// and AllocationProvider both call getDb() concurrently on first mount. All
// callers await the same promise — the database is opened exactly once.
let _dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function openAndInit(): Promise<SQLite.SQLiteDatabase> {
  const database = await SQLite.openDatabaseAsync("folvio.db");
  await database.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS holdings (
      id TEXT PRIMARY KEY,
      ticker TEXT NOT NULL,
      isin TEXT NOT NULL DEFAULT '',
      exchange TEXT NOT NULL DEFAULT 'XETRA',
      name TEXT NOT NULL DEFAULT '',
      quantity REAL NOT NULL DEFAULT 0,
      avg_cost_eur REAL NOT NULL DEFAULT 0,
      purchase_date TEXT NOT NULL DEFAULT '',
      yield_pct REAL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS prices_cache (
      ticker TEXT PRIMARY KEY,
      price_eur REAL NOT NULL,
      last_fetched TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual'
    );
    CREATE TABLE IF NOT EXISTS target_allocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT UNIQUE NOT NULL,
      target_pct REAL NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS portfolio_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_date TEXT UNIQUE NOT NULL,
      total_value_eur REAL NOT NULL,
      total_invested_eur REAL NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS etf_price_history (
      ticker TEXT NOT NULL,
      date TEXT NOT NULL,
      close_eur REAL NOT NULL,
      PRIMARY KEY (ticker, date)
    );
    CREATE TABLE IF NOT EXISTS portfolio_history (
      date TEXT PRIMARY KEY,
      total_value_eur REAL NOT NULL,
      total_invested_eur REAL NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS holding_asset_class_overrides (
      ticker TEXT PRIMARY KEY,
      asset_class TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  // Migration: add yield_pct column to existing databases (safe to ignore if already exists)
  try {
    await database.runAsync("ALTER TABLE holdings ADD COLUMN yield_pct REAL");
  } catch {
    // Column already exists — safe to ignore
  }
  return database;
}

function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!_dbPromise) {
    _dbPromise = openAndInit().catch((err) => {
      // Reset so the next caller can retry
      _dbPromise = null;
      throw err;
    });
  }
  return _dbPromise;
}

/** Call once at app startup to warm the database before contexts mount. */
export async function initDb(): Promise<void> {
  await getDb();
}

// ─── Holdings ────────────────────────────────────────────────────────────────

export async function getAllHoldings(): Promise<HoldingRow[]> {
  const database = await getDb();
  return database.getAllAsync<HoldingRow>("SELECT * FROM holdings ORDER BY created_at ASC");
}

export async function insertHolding(
  h: Omit<HoldingRow, "created_at" | "updated_at">
): Promise<void> {
  const now = new Date().toISOString();
  const database = await getDb();
  await database.runAsync(
    `INSERT INTO holdings (id, ticker, isin, exchange, name, quantity, avg_cost_eur, purchase_date, yield_pct, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [h.id, h.ticker, h.isin, h.exchange, h.name, h.quantity, h.avg_cost_eur, h.purchase_date, h.yield_pct ?? null, now, now]
  );
}

export async function updateHolding(
  id: string,
  h: Partial<Omit<HoldingRow, "id" | "created_at">>
): Promise<void> {
  const now = new Date().toISOString();
  const database = await getDb();
  const fields = Object.entries(h).map(([k]) => `${k} = ?`).join(", ");
  const values = [...Object.values(h), now, id];
  await database.runAsync(`UPDATE holdings SET ${fields}, updated_at = ? WHERE id = ?`, values);
}

export async function deleteHolding(id: string): Promise<void> {
  const database = await getDb();
  await database.runAsync("DELETE FROM holdings WHERE id = ?", [id]);
}

// ─── Prices ──────────────────────────────────────────────────────────────────

export async function upsertPrice(ticker: string, price_eur: number, source: string): Promise<void> {
  const now = new Date().toISOString();
  const database = await getDb();
  await database.runAsync(
    `INSERT INTO prices_cache (ticker, price_eur, last_fetched, source)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(ticker) DO UPDATE SET price_eur = excluded.price_eur, last_fetched = excluded.last_fetched, source = excluded.source`,
    [ticker, price_eur, now, source]
  );
}

export async function getAllPrices(): Promise<PriceCacheRow[]> {
  const database = await getDb();
  return database.getAllAsync<PriceCacheRow>("SELECT * FROM prices_cache");
}

export async function getPrice(ticker: string): Promise<PriceCacheRow | null> {
  const database = await getDb();
  return database.getFirstAsync<PriceCacheRow>(
    "SELECT * FROM prices_cache WHERE ticker = ?",
    [ticker]
  );
}

export async function clearPriceCache(): Promise<void> {
  const database = await getDb();
  await database.runAsync("DELETE FROM prices_cache");
}

// ─── Target Allocations ───────────────────────────────────────────────────────

export async function getAllTargets(): Promise<TargetAllocationRow[]> {
  const database = await getDb();
  return database.getAllAsync<TargetAllocationRow>(
    "SELECT * FROM target_allocations ORDER BY ticker ASC"
  );
}

export async function upsertTarget(ticker: string, target_pct: number): Promise<void> {
  const now = new Date().toISOString();
  const database = await getDb();
  await database.runAsync(
    `INSERT INTO target_allocations (ticker, target_pct, created_at, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(ticker) DO UPDATE SET target_pct = excluded.target_pct, updated_at = excluded.updated_at`,
    [ticker, target_pct, now, now]
  );
}

export async function deleteTarget(ticker: string): Promise<void> {
  const database = await getDb();
  await database.runAsync("DELETE FROM target_allocations WHERE ticker = ?", [ticker]);
}

export async function hasAnyTargets(): Promise<boolean> {
  const database = await getDb();
  const row = await database.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM target_allocations"
  );
  return (row?.count ?? 0) > 0;
}

// ─── Portfolio Snapshots ──────────────────────────────────────────────────────

export async function hasTodaySnapshot(): Promise<boolean> {
  const database = await getDb();
  const today = new Date().toISOString().split("T")[0];
  const row = await database.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM portfolio_snapshots WHERE snapshot_date = ?",
    [today]
  );
  return (row?.count ?? 0) > 0;
}

export async function insertSnapshot(
  snapshot_date: string,
  total_value_eur: number,
  total_invested_eur: number
): Promise<void> {
  const database = await getDb();
  const now = new Date().toISOString();
  await database.runAsync(
    `INSERT OR IGNORE INTO portfolio_snapshots (snapshot_date, total_value_eur, total_invested_eur, created_at)
     VALUES (?, ?, ?, ?)`,
    [snapshot_date, total_value_eur, total_invested_eur, now]
  );
}

export async function getSnapshotsByRange(days: number): Promise<SnapshotRow[]> {
  const database = await getDb();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];
  return database.getAllAsync<SnapshotRow>(
    "SELECT * FROM portfolio_snapshots WHERE snapshot_date >= ? ORDER BY snapshot_date ASC",
    [cutoff]
  );
}

export async function pruneSnapshots(maxCount: number): Promise<void> {
  const database = await getDb();
  await database.runAsync(
    `DELETE FROM portfolio_snapshots WHERE id NOT IN (
      SELECT id FROM portfolio_snapshots ORDER BY snapshot_date DESC LIMIT ?
    )`,
    [maxCount]
  );
}

// ─── ETF Price History ────────────────────────────────────────────────────────

export async function upsertEtfPrices(
  ticker: string,
  prices: { date: string; closeEur: number }[]
): Promise<void> {
  if (prices.length === 0) return;
  const database = await getDb();
  await database.withTransactionAsync(async () => {
    for (const { date, closeEur } of prices) {
      await database.runAsync(
        `INSERT OR REPLACE INTO etf_price_history (ticker, date, close_eur) VALUES (?, ?, ?)`,
        [ticker, date, closeEur]
      );
    }
  });
}

export async function getEtfPricesForTicker(ticker: string): Promise<EtfPriceRow[]> {
  const database = await getDb();
  return database.getAllAsync<EtfPriceRow>(
    "SELECT ticker, date, close_eur FROM etf_price_history WHERE ticker = ? ORDER BY date ASC",
    [ticker]
  );
}

export async function getLatestEtfPriceDate(ticker: string): Promise<string | null> {
  const database = await getDb();
  const row = await database.getFirstAsync<{ date: string }>(
    "SELECT date FROM etf_price_history WHERE ticker = ? ORDER BY date DESC LIMIT 1",
    [ticker]
  );
  return row?.date ?? null;
}

// ─── Asset Class Overrides ────────────────────────────────────────────────────

export type AssetClassOverrideRow = {
  ticker: string;
  asset_class: string;
  updated_at: string;
};

export async function getAllAssetClassOverrides(): Promise<AssetClassOverrideRow[]> {
  const database = await getDb();
  return database.getAllAsync<AssetClassOverrideRow>(
    "SELECT * FROM holding_asset_class_overrides"
  );
}

export async function upsertAssetClassOverride(ticker: string, assetClass: string): Promise<void> {
  const now = new Date().toISOString();
  const database = await getDb();
  await database.runAsync(
    `INSERT INTO holding_asset_class_overrides (ticker, asset_class, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(ticker) DO UPDATE SET asset_class = excluded.asset_class, updated_at = excluded.updated_at`,
    [ticker.toUpperCase(), assetClass, now]
  );
}

export async function deleteAssetClassOverride(ticker: string): Promise<void> {
  const database = await getDb();
  await database.runAsync(
    "DELETE FROM holding_asset_class_overrides WHERE ticker = ?",
    [ticker.toUpperCase()]
  );
}

// ─── Portfolio History ────────────────────────────────────────────────────────

export async function upsertPortfolioHistory(
  rows: { date: string; totalValueEur: number; totalInvestedEur: number }[]
): Promise<void> {
  if (rows.length === 0) return;
  const database = await getDb();
  const now = new Date().toISOString();
  await database.withTransactionAsync(async () => {
    for (const { date, totalValueEur, totalInvestedEur } of rows) {
      await database.runAsync(
        `INSERT OR REPLACE INTO portfolio_history (date, total_value_eur, total_invested_eur, created_at)
         VALUES (?, ?, ?, ?)`,
        [date, totalValueEur, totalInvestedEur, now]
      );
    }
  });
}

export async function getPortfolioHistoryByRange(days: number): Promise<PortfolioHistoryRow[]> {
  const database = await getDb();
  const cutoff = days >= 36000
    ? "1900-01-01"
    : new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  return database.getAllAsync<PortfolioHistoryRow>(
    "SELECT date, total_value_eur, total_invested_eur, created_at FROM portfolio_history WHERE date >= ? ORDER BY date ASC",
    [cutoff]
  );
}
