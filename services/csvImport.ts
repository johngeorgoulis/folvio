import Papa from "papaparse";
import { parseTradeRepublicTrades } from "../parsers/tradeRepublic";
import { parseLightyearTrades } from "../parsers/lightyear";
import { parseDegiro } from "../parsers/degiro";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ParsedHolding {
  ticker: string;
  isin?: string;
  quantity: number;
  avgCostEUR: number;
  purchaseDate: string;
  currency: string;
  needsTickerConfirmation: boolean;
  instrumentName?: string;
  warning?: string;
}

interface RawTransaction {
  ticker: string;
  isin?: string;
  qty: number;
  price: number;
  currency: string;
  date: string;
  isBuy: boolean;
  instrumentName?: string;
  needsTickerConfirmation?: boolean;
}

export interface BrokerConfig {
  key: string;
  name: string;
  emoji: string;
  label: string;
  instructions: string[];
  parse: (content: string) => ParsedHolding[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseRows(content: string): Record<string, string>[] {
  const result = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().replace(/^"|"$/g, ""),
  });
  return result.data;
}

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
  const cleaned = s.replace(/[^\d.,\-]/g, "").replace(",", ".");
  return parseFloat(cleaned) || 0;
}

function normalizeDate(raw: string): string {
  if (!raw) return "";
  const s = raw.trim();
  // Try ISO: 2024-01-15
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  // Try DD/MM/YYYY or DD.MM.YYYY
  const ddmm = s.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})/);
  if (ddmm) return `${ddmm[3]}-${ddmm[2].padStart(2, "0")}-${ddmm[1].padStart(2, "0")}`;
  // Try MM/DD/YYYY
  const mmdd = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mmdd) return `${mmdd[3]}-${mmdd[1].padStart(2, "0")}-${mmdd[2].padStart(2, "0")}`;
  // Try "2024-01-15T..." (ISO with time)
  const isot = s.match(/^(\d{4}-\d{2}-\d{2})T/);
  if (isot) return isot[1];
  return s.substring(0, 10);
}

function aggregate(txs: RawTransaction[]): ParsedHolding[] {
  interface Bucket {
    buyQty: number;
    buyWeightedSum: number;
    sellQty: number;
    firstDate: string;
    isin?: string;
    currency: string;
    needsConfirmation: boolean;
    instrumentName?: string;
  }

  const map = new Map<string, Bucket>();

  for (const tx of txs) {
    const key = tx.ticker || tx.isin || "UNKNOWN";
    let b = map.get(key);
    if (!b) {
      b = {
        buyQty: 0,
        buyWeightedSum: 0,
        sellQty: 0,
        firstDate: tx.date,
        isin: tx.isin,
        currency: tx.currency,
        needsConfirmation: tx.needsTickerConfirmation ?? false,
        instrumentName: tx.instrumentName,
      };
      map.set(key, b);
    }

    if (tx.isBuy) {
      b.buyWeightedSum += tx.qty * tx.price;
      b.buyQty += tx.qty;
      if (tx.date && (!b.firstDate || tx.date < b.firstDate)) b.firstDate = tx.date;
    } else {
      b.sellQty += tx.qty;
    }
  }

  const results: ParsedHolding[] = [];
  for (const [ticker, b] of map.entries()) {
    const netQty = b.buyQty - b.sellQty;
    if (netQty <= 0.0001) continue;
    const avgCost = b.buyQty > 0 ? b.buyWeightedSum / b.buyQty : 0;
    results.push({
      ticker,
      isin: b.isin,
      quantity: Math.round(netQty * 10000) / 10000,
      avgCostEUR: Math.round(avgCost * 100) / 100,
      purchaseDate: b.firstDate,
      currency: b.currency,
      needsTickerConfirmation: b.needsConfirmation,
      instrumentName: b.instrumentName,
      warning:
        b.currency && b.currency !== "EUR"
          ? `Non-EUR price (${b.currency}) — please verify avg cost`
          : undefined,
    });
  }
  return results;
}

// ─── Broker Parsers ────────────────────────────────────────────────────────────

function parseTrading212(content: string): ParsedHolding[] {
  const rows = parseRows(content);
  const BUY_ACTIONS = ["market buy", "limit buy", "buy"];
  const SELL_ACTIONS = ["market sell", "limit sell", "sell"];
  const txs: RawTransaction[] = [];
  for (const row of rows) {
    const action = col(row, "action", "Action").toLowerCase();
    const isBuy = BUY_ACTIONS.some((a) => action.includes(a));
    const isSell = SELL_ACTIONS.some((a) => action.includes(a));
    if (!isBuy && !isSell) continue;
    const ticker = col(row, "Ticker", "ticker");
    const qty = parseNum(col(row, "No. of shares", "Shares", "Quantity"));
    const price = parseNum(col(row, "Price / share", "Price/share", "Price per share"));
    const currency = col(row, "Currency (Price / share)", "Currency");
    const date = normalizeDate(col(row, "Time", "Date"));
    if (!ticker || qty <= 0) continue;
    txs.push({ ticker, qty, price, currency: currency || "EUR", date, isBuy, isin: col(row, "ISIN") });
  }
  return aggregate(txs);
}

function parseIBKR(content: string): ParsedHolding[] {
  const txs: RawTransaction[] = [];

  // IBKR Activity Statement — multi-section CSV, no single header row.
  // Actual column layout (verified from real export):
  //   col[0] = section   ("Trades")
  //   col[1] = row type  ("Data" | "SubTotal" | "Total" | "Header")
  //   col[2] = DataDiscriminator ("Order")
  //   col[3] = Asset Category   ("Stocks" | "Forex")
  //   col[4] = Currency         ("EUR")
  //   col[5] = Symbol           ("VWCE", "TDIV", …)
  //   col[6] = Date/Time        ("2025-10-06, 07:20:52")  ← quoted by PapaParse
  //   col[7] = Quantity         (positive = buy, negative = sell)
  //   col[8] = T. Price
  const parsed = Papa.parse<string[]>(content, {
    header: false,
    skipEmptyLines: true,
  });

  const rows = parsed.data as string[][];

  // Extract ISINs from the Financial Instrument Information section:
  //   col[0]="Financial Instrument Information", col[1]="Data",
  //   col[2]="Stocks", col[3]=symbol, col[6]=ISIN
  const isinMap: Record<string, string> = {};
  for (const row of rows) {
    if (
      row[0]?.trim() === "Financial Instrument Information" &&
      row[1]?.trim() === "Data" &&
      row[2]?.trim() === "Stocks"
    ) {
      const sym  = row[3]?.trim();
      const isin = row[6]?.trim();
      if (sym && isin) isinMap[sym] = isin;
    }
  }

  for (const row of rows) {
    // Only process Trades Data rows for Stocks (not Forex, SubTotal, Total, Header)
    if (
      row[0]?.trim() !== "Trades" ||
      row[1]?.trim() !== "Data"   ||
      row[3]?.trim() !== "Stocks"
    ) continue;

    const currency = row[4]?.trim() || "EUR";
    const symbol   = row[5]?.trim();
    // Date/Time field is "YYYY-MM-DD, HH:MM:SS" — normalizeDate extracts the date
    const date     = normalizeDate(row[6]?.trim() || "");
    const qty      = parseNum(row[7]?.trim() || "0");
    const price    = parseNum(row[8]?.trim() || "0");

    if (!symbol || qty === 0) continue;

    txs.push({
      ticker: symbol,
      isin:   isinMap[symbol],
      qty:    Math.abs(qty),
      price,
      currency,
      date,
      isBuy: qty > 0,
    });
  }

  return aggregate(txs);
}

function parseRevolut(content: string): ParsedHolding[] {
  console.log("[REVOLUT PARSER v2] content length:", content.length);
  const rows = parseRows(content);
  const txs: RawTransaction[] = [];
  for (const row of rows) {
    const type = col(row, "Type", "type", "Transaction Type").toUpperCase();
    const isBuy = type.includes("BUY");
    const isSell = type.includes("SELL");
    if (!isBuy && !isSell) continue;
    const ticker = col(row, "Ticker", "ticker", "Symbol").trim();
    if (!ticker) continue;
    const qty = parseNum(col(row, "Quantity", "quantity", "Shares"));
    // Price per share has format "EUR 109.38" — strip currency prefix
    const priceRaw = col(row, "Price per share", "Price/share", "Price");
    const price = parseNum(priceRaw.replace(/^[A-Z]+\s*/i, ""));
    // Currency from the price field or Currency column
    const currencyMatch = priceRaw.match(/^([A-Z]+)\s/i);
    const currency = currencyMatch ? currencyMatch[1].toUpperCase() : (col(row, "Currency", "currency") || "EUR");
    const date = normalizeDate(col(row, "Date", "date", "Completed Date"));
    const isin = col(row, "ISIN", "isin").trim();
    if (qty <= 0) continue;
    txs.push({ ticker, isin, qty, price, currency, date, isBuy });
  }
  return aggregate(txs);
}

function parseLightyear(content: string): ParsedHolding[] {
  const rows = parseRows(content);
  const txs: RawTransaction[] = [];
  for (const row of rows) {
    const type = col(row, "Type", "type").toUpperCase();
    const isBuy = type === "BUY" || type.includes("BUY");
    const isSell = type === "SELL" || type.includes("SELL");
    if (!isBuy && !isSell) continue;
    const ticker = col(row, "Ticker", "ticker").trim();
    if (!ticker) continue;
    const isin = col(row, "ISIN", "isin").trim();
    const qty = parseNum(col(row, "Quantity", "quantity"));
    const price = parseNum(col(row, "Price", "price"));
    const currency = (col(row, "Currency", "currency") || "EUR").toUpperCase();
    const fxRate = parseNum(col(row, "FX Rate", "fx rate", "FX_Rate", "FxRate")) || 1;
    const amountRaw = col(row, "Amount", "amount");
    const amount = Math.abs(parseNum(amountRaw));
    const date = normalizeDate(col(row, "Date", "date"));
    if (qty <= 0) continue;

    // Prefer Amount/Quantity for EUR avg cost (Amount is always in account currency EUR).
    // Fall back to Price * FX Rate for non-EUR instruments, then raw Price.
    let priceEUR: number;
    if (amount > 0 && qty > 0) {
      priceEUR = amount / qty;
    } else if (currency !== "EUR" && fxRate !== 1) {
      priceEUR = price * fxRate;
    } else {
      priceEUR = price;
    }

    txs.push({ ticker, isin, qty, price: priceEUR, currency: "EUR", date, isBuy });
  }
  return aggregate(txs);
}

function parseGeneric(content: string): ParsedHolding[] {
  const rows = parseRows(content);
  const results: ParsedHolding[] = [];
  for (const row of rows) {
    const ticker = col(row, "Ticker", "ticker", "Symbol", "symbol").toUpperCase();
    const isin = col(row, "ISIN", "isin");
    const qty = parseNum(col(row, "Quantity", "quantity", "Shares", "shares"));
    const price = parseNum(col(row, "Avg Cost", "avg_cost", "Avg Cost (EUR)", "Price", "price", "Average Price"));
    const date = normalizeDate(col(row, "Purchase Date", "date", "Date", "purchase_date"));
    if (!ticker || qty <= 0) continue;
    results.push({
      ticker,
      isin: isin || undefined,
      quantity: Math.round(qty * 10000) / 10000,
      avgCostEUR: Math.round(price * 100) / 100,
      purchaseDate: date,
      currency: "EUR",
      needsTickerConfirmation: false,
    });
  }
  return results;
}

function parseLightyearAsHoldings(content: string): ParsedHolding[] {
  const trades = parseLightyearTrades(content);
  const txs: RawTransaction[] = trades.map((t) => ({
    ticker: t.ticker || t.isin,
    isin: t.isin,
    qty: t.units,
    price: t.pricePerUnit,
    currency: t.currency ?? "EUR",
    date: t.date,
    isBuy: t.type === "BUY",
    instrumentName: t.name,
    needsTickerConfirmation: false,
  }));
  return aggregate(txs);
}

function parseTRAsHoldings(content: string): ParsedHolding[] {
  const trades = parseTradeRepublicTrades(content);
  const txs: RawTransaction[] = trades.map((t) => ({
    ticker: t.ticker || t.isin,
    isin: t.isin,
    qty: t.units,
    price: t.pricePerUnit,
    currency: "EUR",
    date: t.date,
    isBuy: t.type === "BUY",
    instrumentName: t.name,
    needsTickerConfirmation: !t.ticker,
  }));
  return aggregate(txs);
}

// ─── Broker Configs ────────────────────────────────────────────────────────────

export const BROKER_CONFIGS: BrokerConfig[] = [
  {
    key: "trading212",
    name: "Trading 212",
    emoji: "🟢",
    label: "Orders CSV",
    instructions: [
      "Open Trading 212 (web or app)",
      "Go to the History tab",
      "Tap the export icon (top right)",
      "Select your date range → Export",
      "Upload the downloaded CSV below",
    ],
    parse: parseTrading212,
  },
  {
    key: "ibkr",
    name: "Interactive Brokers",
    emoji: "🔵",
    label: "Activity CSV",
    instructions: [
      "Login to IBKR Client Portal or TWS",
      "Go to Reports → Activity → Flex Query",
      "Create a Trade Confirmation flex query",
      "Export as CSV",
      "Upload the downloaded CSV below",
    ],
    parse: parseIBKR,
  },
  {
    key: "revolut",
    name: "Revolut",
    emoji: "⚪",
    label: "Statements CSV",
    instructions: [
      "Open the Revolut app",
      "Go to Stocks → Statements",
      "Select your date range → Export CSV",
      "Upload the downloaded CSV below",
    ],
    parse: parseRevolut,
  },
  {
    key: "lightyear_tx",
    name: "Lightyear",
    emoji: "🟡",
    label: "Transactions CSV",
    instructions: [
      "Open the Lightyear app",
      "Go to Account → Activity",
      "Tap the export icon and select your date range",
      "Download the CSV and upload it below",
    ],
    parse: parseLightyearAsHoldings,
  },
  {
    key: "trade_republic",
    name: "Trade Republic",
    emoji: "🟣",
    label: "Transactions CSV",
    instructions: [
      "Open the Trade Republic app",
      "Go to Profile → Documents",
      "Tap 'Export transactions' and select your date range",
      "Download the CSV and upload it below",
    ],
    parse: parseTRAsHoldings,
  },
  {
    key: "degiro",
    name: "DEGIRO",
    emoji: "🟠",
    label: "Transactions CSV",
    instructions: [
      "Log in to DEGIRO (web)",
      "Go to Activity → Transactions",
      "Click Export → CSV",
      "Upload the downloaded CSV below",
    ],
    parse: parseDegiro,
  },
];

export function parseCSV(brokerKey: string, content: string): ParsedHolding[] {
  const broker = BROKER_CONFIGS.find((b) => b.key === brokerKey);
  if (!broker) throw new Error(`Unknown broker: ${brokerKey}`);
  if (!content.trim()) throw new Error("EMPTY_FILE");
  const holdings = broker.parse(content);
  if (holdings.length === 0) throw new Error("NO_BUYS");
  return holdings;
}

/**
 * Inspect the CSV content and return the matching BrokerConfig, or null
 * if the format cannot be determined automatically.
 *
 * Detection order (most-specific first to avoid false positives):
 *   1. IBKR           — multi-section Activity Statement ("Trades,Data," anywhere)
 *                       or Flex Query header ("ActivityDescription" / "TradeDate")
 *   2. Trade Republic — full set of 10 required headers (incl. "symbol", "shares")
 *   3. Lightyear TX   — full set of 13 required headers (incl. "reference", "ccy")
 *   4. Lightyear (legacy portfolio) — "FX Rate" header only
 *   5. Revolut        — "State" (unique) or "Quantity" fallback
 *   6. Trading 212    — "Action" or "Ticker"
 */
const TR_REQUIRED_HEADERS = [
  "datetime", "account_type", "category", "type",
  "asset_class", "symbol", "shares", "price", "amount", "fee",
];

const LIGHTYEAR_TX_REQUIRED_HEADERS = [
  "date", "reference", "ticker", "isin", "type", "quantity",
  "ccy", "price/share", "gross amount", "fx rate", "fee", "net amt.", "tax amt.",
];

export function detectBroker(content: string): BrokerConfig | null {
  // IBKR Activity Statement: multi-section rows starting with "Trades,Data,"
  if (/^Trades,Data,/m.test(content)) {
    return BROKER_CONFIGS.find((b) => b.key === "ibkr") ?? null;
  }

  const firstLine = content.trim().split(/\r?\n/)[0];
  const parsed = Papa.parse<string[]>(firstLine, { header: false });
  const headers = new Set(
    ((parsed.data[0] as unknown as string[]) ?? []).map((h) => h.trim().toLowerCase())
  );

  // IBKR Flex Query format (standard CSV with headers)
  if (headers.has("activitydescription") || headers.has("tradedate")) {
    return BROKER_CONFIGS.find((b) => b.key === "ibkr") ?? null;
  }
  // Trade Republic — check before Revolut/Lightyear as headers overlap
  if (TR_REQUIRED_HEADERS.every((h) => headers.has(h))) {
    return BROKER_CONFIGS.find((b) => b.key === "trade_republic") ?? null;
  }
  // Lightyear transaction CSV — specific set including "reference"; must come before old fx rate check
  if (LIGHTYEAR_TX_REQUIRED_HEADERS.every((h) => headers.has(h))) {
    return BROKER_CONFIGS.find((b) => b.key === "lightyear_tx") ?? null;
  }
  if (headers.has("state") || headers.has("quantity")) {
    return BROKER_CONFIGS.find((b) => b.key === "revolut") ?? null;
  }
  if (headers.has("action") || headers.has("ticker")) {
    return BROKER_CONFIGS.find((b) => b.key === "trading212") ?? null;
  }
  return null;
}
