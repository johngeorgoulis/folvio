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

let db: SQLite.SQLiteDatabase | null = null;

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  db = await SQLite.openDatabaseAsync("fortis.db");
  await db.execAsync(`
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
  `);
  return db;
}

export async function getAllHoldings(): Promise<HoldingRow[]> {
  const database = await getDb();
  return database.getAllAsync<HoldingRow>("SELECT * FROM holdings ORDER BY created_at ASC");
}

export async function insertHolding(h: Omit<HoldingRow, "created_at" | "updated_at">): Promise<void> {
  const now = new Date().toISOString();
  const database = await getDb();
  await database.runAsync(
    `INSERT INTO holdings (id, ticker, isin, exchange, name, quantity, avg_cost_eur, purchase_date, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [h.id, h.ticker, h.isin, h.exchange, h.name, h.quantity, h.avg_cost_eur, h.purchase_date, now, now]
  );
}

export async function updateHolding(id: string, h: Partial<Omit<HoldingRow, "id" | "created_at">>): Promise<void> {
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
