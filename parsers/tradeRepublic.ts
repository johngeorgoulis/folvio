import Papa from "papaparse";
import { lookupByISIN } from "@/services/etfDatabaseService";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ParsedTrade {
  isin: string;
  name: string;
  ticker: string;
  units: number;
  pricePerUnit: number;
  currency?: string;
  fxRate?: number;
  date: string;
  fee: number;
  type: "BUY" | "SELL";
  broker: string;
  transactionId: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function col(row: Record<string, string>, ...names: string[]): string {
  for (const name of names) {
    const key = Object.keys(row).find(
      (k) => k.trim().toLowerCase() === name.trim().toLowerCase()
    );
    if (key !== undefined && row[key] !== undefined) return row[key].trim();
  }
  return "";
}

function parseNum(s: string): number {
  if (!s) return 0;
  const cleaned = s.replace(/[^\d.,-]/g, "").replace(",", ".");
  return parseFloat(cleaned) || 0;
}

function normalizeDate(raw: string): string {
  if (!raw) return "";
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  const isoMatch = s.match(/^(\d{4}-\d{2}-\d{2})T/);
  if (isoMatch) return isoMatch[1];
  return s.substring(0, 10);
}

// ─── Parser ───────────────────────────────────────────────────────────────────

/**
 * Parse a Trade Republic transactions CSV into individual ParsedTrade records.
 * Call initETFDatabase() before this to get ticker/name enrichment from the local DB.
 */
export function parseTradeRepublicTrades(content: string): ParsedTrade[] {
  const result = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().replace(/^"|"$/g, ""),
  });

  const trades: ParsedTrade[] = [];

  for (const row of result.data) {
    const category = col(row, "category").toUpperCase();
    if (category !== "TRADING") continue;

    const type = col(row, "type").toUpperCase();
    if (type !== "BUY" && type !== "SELL") continue;

    const isin = col(row, "symbol");
    if (!isin) continue;

    const rawName = col(row, "name", "instrument_name", "asset_name", "instrumentName");
    const units = Math.abs(parseNum(col(row, "shares")));
    const pricePerUnit = Math.abs(parseNum(col(row, "price")));
    const fee = Math.abs(parseNum(col(row, "fee")));
    // TR uses "datetime" column; some exports also have a bare "date" column
    const date = normalizeDate(col(row, "date") || col(row, "datetime"));

    if (units <= 0) continue;

    const etfEntry = lookupByISIN(isin);
    const ticker = etfEntry?.ticker ?? "";
    const name = etfEntry?.name ?? rawName ?? isin;

    // Deterministic ID — stable across re-imports of the same CSV
    const transactionId = `TR|${isin}|${date}|${type}|${units}|${pricePerUnit}`;

    trades.push({
      isin,
      name,
      ticker,
      units,
      pricePerUnit,
      date,
      fee,
      type: type as "BUY" | "SELL",
      broker: "Trade Republic",
      transactionId,
    });
  }

  return trades;
}
