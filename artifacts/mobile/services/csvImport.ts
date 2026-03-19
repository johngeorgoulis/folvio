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

function guessTickerFromName(name: string, isin?: string): { ticker: string; needsConfirmation: boolean } {
  if (!name) return { ticker: isin ?? "UNKNOWN", needsConfirmation: true };
  const words = name.trim().split(/\s+/);
  const first = words[0];
  if (/^[A-Z0-9]{2,8}$/.test(first)) return { ticker: first, needsConfirmation: false };
  if (words.length >= 2 && /^[A-Z0-9]{2,8}$/.test(words[1])) return { ticker: words[1], needsConfirmation: false };
  return { ticker: isin ?? name.substring(0, 8).toUpperCase(), needsConfirmation: true };
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

function parseDegiro(content: string): ParsedHolding[] {
  const rows = parseRows(content);
  const txs: RawTransaction[] = [];
  for (const row of rows) {
    const desc = col(row, "Description", "description");
    const isBuy = /^buy\b/i.test(desc);
    const isSell = /^sell\b/i.test(desc);
    if (!isBuy && !isSell) continue;
    const isin = col(row, "ISIN", "isin");
    const productName = col(row, "Product", "product");
    const { ticker, needsConfirmation } = guessTickerFromName(productName, isin);
    const match = desc.match(/[\d,.]+ @\s*([\d,.]+)/);
    const price = match ? parseNum(match[1]) : 0;
    const qtyMatch = desc.match(/^(?:buy|sell)\s+([\d,.]+)/i);
    const qty = qtyMatch ? parseNum(qtyMatch[1]) : 0;
    const currency = col(row, "FX", "Currency") || "EUR";
    const date = normalizeDate(col(row, "Date", "date"));
    if (qty <= 0) continue;
    txs.push({ ticker, isin, qty, price, currency, date, isBuy, instrumentName: productName, needsTickerConfirmation: needsConfirmation });
  }
  return aggregate(txs);
}

function parseTradeRepublic(content: string): ParsedHolding[] {
  const rows = parseRows(content);
  const txs: RawTransaction[] = [];
  for (const row of rows) {
    const type = col(row, "type", "Type").toLowerCase();
    const isBuy = type === "buy" || type === "order";
    const isSell = type === "sell";
    if (!isBuy && !isSell) continue;
    const isin = col(row, "instrument_isin", "isin");
    const name = col(row, "instrument_name", "name");
    const { ticker, needsConfirmation } = guessTickerFromName(name, isin);
    const qty = parseNum(col(row, "shares", "quantity", "Shares"));
    const price = parseNum(col(row, "average_price", "price", "Price"));
    const date = normalizeDate(col(row, "date", "Date", "timestamp"));
    if (qty <= 0) continue;
    txs.push({ ticker, isin, qty, price, currency: "EUR", date, isBuy, instrumentName: name, needsTickerConfirmation: needsConfirmation });
  }
  return aggregate(txs);
}

function parseLightyear(content: string): ParsedHolding[] {
  const rows = parseRows(content);
  console.log("[Lightyear] Total rows:", rows.length);
  if (rows.length > 0) {
    console.log("[Lightyear] First row keys:", Object.keys(rows[0]).join(" | "));
    console.log("[Lightyear] First row values:", Object.values(rows[0]).join(" | "));
  }
  const txs: RawTransaction[] = [];
  for (const row of rows) {
    const type = col(row, "Type", "type").trim();
    console.log("[Lightyear] type value:", JSON.stringify(type));
    const isBuy = type.toLowerCase() === "buy";
    const isSell = type.toLowerCase() === "sell";
    if (!isBuy && !isSell) continue;
    const ticker = col(row, "Ticker", "ticker", "Symbol").trim();
    const isin = col(row, "ISIN", "isin").trim();
    if (!ticker || ticker === "") continue;
    const qty = parseNum(col(row, "Quantity", "quantity"));
    const price = parseNum(col(row, "Price/share", "Price / share", "Price per share"));
    const currency = col(row, "CCY", "Currency", "currency") || "EUR";
    const date = normalizeDate(col(row, "Date", "date"));
    if (qty <= 0) continue;
    txs.push({ ticker, isin, qty, price, currency, date, isBuy });
  }
  return aggregate(txs);
}

function parseFreedom24(content: string): ParsedHolding[] {
  const rows = parseRows(content);
  const txs: RawTransaction[] = [];
  for (const row of rows) {
    const op = col(row, "Operation", "operation", "Type", "type").toLowerCase();
    const isBuy = op === "buy" || op.includes("purchase");
    const isSell = op === "sell";
    if (!isBuy && !isSell) continue;
    const ticker = col(row, "Ticker", "ticker", "Symbol");
    const isin = col(row, "ISIN", "isin");
    const qty = parseNum(col(row, "Quantity", "quantity", "Shares"));
    const price = parseNum(col(row, "Price", "price"));
    const currency = col(row, "Currency", "currency") || "EUR";
    const date = normalizeDate(col(row, "Date", "date"));
    if (!ticker || qty <= 0) continue;
    txs.push({ ticker, isin, qty, price, currency, date, isBuy });
  }
  return aggregate(txs);
}

function parseScalable(content: string): ParsedHolding[] {
  const rows = parseRows(content);
  const txs: RawTransaction[] = [];
  for (const row of rows) {
    const type = col(row, "Type", "type", "Typ").toLowerCase();
    const isBuy = type === "buy" || type === "kauf";
    const isSell = type === "sell" || type === "verkauf";
    if (!isBuy && !isSell) continue;
    const isin = col(row, "ISIN", "isin");
    const name = col(row, "Name", "name", "Bezeichnung");
    const { ticker, needsConfirmation } = guessTickerFromName(name, isin);
    const qty = parseNum(col(row, "Shares", "shares", "Stücke", "Quantity"));
    const price = parseNum(col(row, "Price", "price", "Kurs"));
    const currency = col(row, "Currency", "currency", "Währung") || "EUR";
    const date = normalizeDate(col(row, "Date", "date", "Datum"));
    if (qty <= 0) continue;
    txs.push({ ticker, isin, qty, price, currency, date, isBuy, instrumentName: name, needsTickerConfirmation: needsConfirmation });
  }
  return aggregate(txs);
}

function parseFlatex(content: string): ParsedHolding[] {
  const rows = parseRows(content);
  const txs: RawTransaction[] = [];
  for (const row of rows) {
    const typ = col(row, "Typ", "Type", "type").toLowerCase();
    const isBuy = typ === "kauf" || typ === "buy";
    const isSell = typ === "verkauf" || typ === "sell";
    if (!isBuy && !isSell) continue;
    const isin = col(row, "ISIN", "isin");
    const name = col(row, "Bezeichnung", "Name", "name");
    const { ticker, needsConfirmation } = guessTickerFromName(name, isin);
    const qty = parseNum(col(row, "Stücke", "Shares", "Quantity", "Menge"));
    const price = parseNum(col(row, "Kurs", "Price", "Preis"));
    const currency = col(row, "Währung", "Currency", "currency") || "EUR";
    const date = normalizeDate(col(row, "Datum", "Date", "date"));
    if (qty <= 0) continue;
    txs.push({ ticker, isin, qty, price, currency, date, isBuy, instrumentName: name, needsTickerConfirmation: needsConfirmation });
  }
  return aggregate(txs);
}

function parseSaxo(content: string): ParsedHolding[] {
  const rows = parseRows(content);
  const txs: RawTransaction[] = [];
  for (const row of rows) {
    const side = col(row, "Buy/Sell", "Side", "Direction", "type").toLowerCase();
    const isBuy = side === "buy" || side === "b";
    const isSell = side === "sell" || side === "s";
    if (!isBuy && !isSell) continue;
    const ticker = col(row, "Instrument", "Symbol", "Ticker", "ticker");
    const isin = col(row, "ISIN", "isin");
    const qty = parseNum(col(row, "Quantity", "quantity", "Shares", "Amount"));
    const price = parseNum(col(row, "Price", "price", "Trade Price"));
    const currency = col(row, "Currency", "currency") || "EUR";
    const date = normalizeDate(col(row, "Date", "date", "Trade Date"));
    if (!ticker || qty <= 0) continue;
    txs.push({ ticker, isin, qty, price, currency, date, isBuy });
  }
  return aggregate(txs);
}

function parseRevolut(content: string): ParsedHolding[] {
  const rows = parseRows(content);
  const txs: RawTransaction[] = [];
  for (const row of rows) {
    const type = col(row, "Type", "type", "Transaction Type").toUpperCase();
    const isBuy = type === "BUY" || type === "PURCHASE";
    const isSell = type === "SELL";
    if (!isBuy && !isSell) continue;
    const ticker = col(row, "Ticker", "ticker", "Symbol");
    const qty = parseNum(col(row, "Quantity", "quantity", "Shares"));
    const price = parseNum(col(row, "Price per share", "Price", "price"));
    const currency = col(row, "Currency", "currency") || "USD";
    const date = normalizeDate(col(row, "Date", "date", "Completed Date"));
    if (!ticker || qty <= 0) continue;
    txs.push({ ticker, qty, price, currency, date, isBuy });
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
    key: "degiro",
    name: "Degiro",
    emoji: "🔵",
    label: "Account CSV",
    instructions: [
      "Login to Degiro",
      "Go to Activity → Account Overview",
      "Select your full date range",
      "Click Export → CSV",
      "Upload the downloaded CSV below",
    ],
    parse: parseDegiro,
  },
  {
    key: "traderepublic",
    name: "Trade Republic",
    emoji: "⚫",
    label: "Trades CSV",
    instructions: [
      "Open the Trade Republic app",
      "Go to Profile → Documents",
      "Select Transaction History → Export CSV",
      "Upload the downloaded CSV below",
    ],
    parse: parseTradeRepublic,
  },
  {
    key: "lightyear",
    name: "Lightyear",
    emoji: "🟡",
    label: "Portfolio CSV",
    instructions: [
      "Open the Lightyear app",
      "Go to Account → Statements",
      "Export transaction history CSV",
      "Upload the downloaded CSV below",
    ],
    parse: parseLightyear,
  },
  {
    key: "freedom24",
    name: "Freedom24",
    emoji: "🟠",
    label: "Orders CSV",
    instructions: [
      "Login to Freedom24 web platform",
      "Go to My Money → Reports",
      "Export trades as CSV",
      "Upload the downloaded CSV below",
    ],
    parse: parseFreedom24,
  },
  {
    key: "scalable",
    name: "Scalable Capital",
    emoji: "🔴",
    label: "Trades CSV",
    instructions: [
      "Login to Scalable Capital",
      "Go to Documents → Transaction History",
      "Export CSV",
      "Upload the downloaded CSV below",
    ],
    parse: parseScalable,
  },
  {
    key: "flatex",
    name: "Flatex",
    emoji: "🟣",
    label: "Transactions CSV",
    instructions: [
      "Login to Flatex",
      "Go to Reports → Transaction History",
      "Export as CSV (German headers expected)",
      "Upload the downloaded CSV below",
    ],
    parse: parseFlatex,
  },
  {
    key: "saxo",
    name: "Saxo Bank",
    emoji: "🔷",
    label: "Orders CSV",
    instructions: [
      "Login to Saxo Bank",
      "Go to Account → Reports → Trade History",
      "Export as CSV",
      "Upload the downloaded CSV below",
    ],
    parse: parseSaxo,
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
