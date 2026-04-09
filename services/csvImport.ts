import Papa from "papaparse";

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
  const rows = parseRows(content);
  const txs: RawTransaction[] = [];
  for (const row of rows) {
    const action = col(row, "Action", "action", "TransactionType", "Type").toLowerCase();
    const isBuy = action.includes("buy");
    const isSell = action.includes("sell");
    if (!isBuy && !isSell) continue;
    const ticker = col(row, "Symbol", "symbol", "Ticker", "ticker").trim();
    const isin = col(row, "ISIN", "isin").trim();
    const qty = Math.abs(parseNum(col(row, "Quantity", "quantity", "Qty")));
    const price = parseNum(col(row, "TradePrice", "Price", "price", "T. Price"));
    const currency = col(row, "CurrencyPrimary", "Currency", "currency") || "EUR";
    const date = normalizeDate(col(row, "TradeDate", "Date", "date", "SettleDate"));
    if (!ticker || qty <= 0) continue;
    txs.push({ ticker, isin, qty, price, currency, date, isBuy });
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
    key: "generic",
    name: "Generic CSV",
    emoji: "📄",
    label: "Any broker",
    instructions: [
      "Prepare a CSV with these columns:",
      "  Ticker, ISIN (optional), Quantity, Avg Cost (EUR), Purchase Date (YYYY-MM-DD)",
      "Example row:",
      "  VWCE,,10,130.50,2024-01-15",
    ],
    parse: parseGeneric,
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
