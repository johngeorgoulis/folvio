import Papa from "papaparse";
import { lookupByISIN } from "@/services/etfDatabaseService";
import { type ParsedTrade } from "./tradeRepublic";

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
  // Lightyear format: DD/MM/YYYY HH:MM:SS
  const ddmmyyyy = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (ddmmyyyy) return `${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}`;
  // ISO fallback
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  const isoMatch = s.match(/^(\d{4}-\d{2}-\d{2})T/);
  if (isoMatch) return isoMatch[1];
  return s.substring(0, 10);
}

// ─── Parser ───────────────────────────────────────────────────────────────────

/**
 * Parse a Lightyear transactions CSV into individual ParsedTrade records.
 * Call initETFDatabase() before this to get name enrichment from the local DB.
 */
export function parseLightyearTrades(content: string): ParsedTrade[] {
  const result = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().replace(/^"|"$/g, ""),
  });

  const trades: ParsedTrade[] = [];

  for (const row of result.data) {
    const type = col(row, "Type");
    if (type !== "Buy" && type !== "Sell") continue;

    const ticker = col(row, "Ticker");
    const isin = col(row, "ISIN");
    if (!ticker && !isin) continue;

    const units = Math.abs(parseNum(col(row, "Quantity")));
    if (units <= 0) continue;

    const pricePerUnit = Math.abs(parseNum(col(row, "Price/share")));
    const currency = col(row, "CCY") || "EUR";
    const fxRate = parseNum(col(row, "FX Rate")) || 1;
    const fee = Math.abs(parseNum(col(row, "Fee")));
    const date = normalizeDate(col(row, "Date"));
    const reference = col(row, "Reference");

    const etfEntry = lookupByISIN(isin);
    const resolvedTicker = etfEntry?.ticker ?? ticker;
    const name = etfEntry?.name ?? ticker ?? isin;

    // Prefer the Reference column as the stable transaction ID
    const transactionId = reference
      ? `LY|${reference}`
      : `LY|${isin}|${date}|${type}|${units}|${pricePerUnit}`;

    trades.push({
      isin,
      name,
      ticker: resolvedTicker,
      units,
      pricePerUnit,
      currency,
      fxRate: currency !== "EUR" ? fxRate : undefined,
      date,
      fee,
      type: type.toUpperCase() as "BUY" | "SELL",
      broker: "Lightyear",
      transactionId,
    });
  }

  return trades;
}
