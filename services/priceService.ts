import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { upsertPrice, getPrice as dbGetPrice } from "@/services/db";
import type { HoldingRow } from "@/services/db";


export const EXCHANGE_SUFFIXES: Record<string, string> = {
  // Internal exchange codes
  "XETRA": ".DE",
  "EURONEXT_AMS": ".AS",
  "EURONEXT_PAR": ".PA",
  "LSE": ".L",
  "BORSA_IT": ".MI",
  "SIX": ".SW",
  "EURONEXT_BRU": ".BR",
  "BME": ".MC",
  "NASDAQ_HEL": ".HE",
  "NASDAQ_STO": ".ST",
  "OSLO": ".OL",
  "NASDAQ_CPH": ".CO",
  // Display names (used in ETF database exchanges[] field)
  "Euronext Paris": ".PA",
  "Euronext Amsterdam": ".AS",
  "Euronext Brussels": ".BR",
  "Euronext": ".PA",
  "Borsa Italiana": ".MI",
  "SIX Swiss": ".SW",
  "SIX Swiss Exchange": ".SW",
  "Bolsa de Madrid": ".MC",
  "Madrid Stock Exchange": ".MC",
  "Nasdaq Helsinki": ".HE",
  "Nasdaq Stockholm": ".ST",
  "Oslo Bors": ".OL",
  "Oslo Børs": ".OL",
  "Nasdaq Copenhagen": ".CO",
  "Cboe Denmark": ".CO",
  "Other": "",
};

const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_CONCURRENT = 5;

// ─── EODHD Data Source ────────────────────────────────────────────────────────
// Direct EODHD API calls using EXPO_PUBLIC_EODHD_API_KEY.
//   Real-time:  GET /real-time/{symbol}?api_token={key}&fmt=json
//   Historical: GET /eod/{symbol}?api_token={key}&fmt=json&from={date}

const EODHD_BASE = "https://eodhd.com/api";

function eodhdApiKey(): string {
  const key = process.env.EXPO_PUBLIC_EODHD_API_KEY ?? "";
  console.log(`[eodhdApiKey] key ${key ? `present (length=${key.length})` : "MISSING or empty"}`);
  return key;
}

interface EodhdRealtimeData {
  code: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  previousClose: number;
  change: number;
  change_p: number;
}

interface EodhdHistoricalBar {
  date: string;           // "YYYY-MM-DD"
  open: number;
  high: number;
  low: number;
  close: number;
  adjusted_close: number;
  volume: number;
}

/**
 * Infer the native currency from an EODHD exchange suffix.
 * All major EU exchanges trade in EUR; LSE in GBP; SIX in CHF.
 */
function symbolCurrency(symbol: string): string {
  const up = symbol.toUpperCase();
  if (up.endsWith(".LSE") || up.endsWith(".L")) return "GBP";
  if (up.endsWith(".SW") || up.endsWith(".SWX")) return "CHF";
  if (up.endsWith(".ST") || up.endsWith(".STO")) return "SEK";
  if (up.endsWith(".OL") || up.endsWith(".OSL")) return "NOK";
  if (up.endsWith(".CO") || up.endsWith(".CSE")) return "DKK";
  // .XETRA .DE .AS .AMS .PA .EPA .MI .MIL .BIT .BR .MC .HE → EUR
  return "EUR";
}

// ─── EODHD Suffix Waterfall ───────────────────────────────────────────────────
// For every ETF, try these EODHD exchange suffixes in order until the real-time
// endpoint returns close > 0.  The winning suffix is cached in AsyncStorage as
// "eodhd_symbol_cache_{TICKER}" so subsequent fetches skip the waterfall.
//
// Xetra gets both .XETRA (native EODHD) and .DE (common alias).

const EXCHANGE_EODHD_SUFFIXES: Record<string, string[]> = {
  "XETRA":        [".XETRA", ".DE"],
  "LSE":          [".LSE", ".L"],
  "EURONEXT_AMS": [".AS", ".AMS"],
  "EURONEXT_PAR": [".PA", ".EPA"],
  "BORSA_IT":     [".MI", ".MIL", ".BIT"],
  "SIX":          [".SW", ".SWX"],
  "EURONEXT_BRU": [".BR"],
  "BME":          [".MC"],
  "NASDAQ_HEL":   [".HE"],
  "NASDAQ_STO":   [".ST"],
  "OSLO":         [".OL"],
  "NASDAQ_CPH":   [".CO"],
};

// Priority suffixes are tried first for any exchange (incl. unknown/empty).
// Order: XETRA, LSE, MI (Borsa IT), AS (Euronext AMS), SW (SIX) — the five
// most common EU listing venues for UCITS ETFs.
const ALL_EODHD_SUFFIXES: string[] = [
  ".XETRA", ".LSE", ".MI", ".AS", ".SW",
  ".DE", ".L", ".MIL", ".BIT", ".AMS",
  ".PA", ".EPA",
  ".SWX",
  ".BR",
  ".MC",
  ".HE",
  ".ST",
  ".OL",
  ".CO",
  "",   // bare ticker — last resort
];

function buildSuffixWaterfall(exchange?: string): string[] {
  const preferred = exchange ? (EXCHANGE_EODHD_SUFFIXES[exchange] ?? []) : [];
  const rest = ALL_EODHD_SUFFIXES.filter(s => !preferred.includes(s));
  return [...preferred, ...rest];
}

// ─── ISIN-specific Symbol Overrides ──────────────────────────────────────────
// Hard-coded ISIN → EODHD symbol for tickers where auto-resolution consistently
// fails. Tried before the waterfall; winner cached as "price_ticker_cache_{ISIN}".
const ISIN_FORCED_SYMBOLS: Record<string, string> = {
  "IE00BFMXXD54": "VUAA.XETRA",   // Vanguard S&P 500 UCITS ETF (Acc) — Xetra native format
};

// Fallback waterfall tried after the forced symbol fails.
const ISIN_SYMBOL_WATERFALL: Record<string, string[]> = {
  "IE00BFMXXD54": ["VUAA.XETRA", "VUAA.DE", "VUAA.LSE", "VUAA.MI", "VUSA.XETRA"],
};

const ISIN_TICKER_CACHE_PREFIX = "price_ticker_cache_";

async function getCachedISINSymbol(isin: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(ISIN_TICKER_CACHE_PREFIX + isin.toUpperCase());
  } catch {
    return null;
  }
}

async function setCachedISINSymbol(isin: string, symbol: string): Promise<void> {
  try {
    await AsyncStorage.setItem(ISIN_TICKER_CACHE_PREFIX + isin.toUpperCase(), symbol);
  } catch { /* ignore */ }
}

// ─── Symbol Resolution Cache ──────────────────────────────────────────────────
// AsyncStorage: "eodhd_symbol_cache_{TICKER}" → winning EODHD symbol
// (e.g. "VWCE" → "VWCE.XETRA"). Bypasses the waterfall on every subsequent fetch.

const EODHD_CACHE_PREFIX = "eodhd_symbol_cache_";

async function getCachedEodhdSymbol(ticker: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(EODHD_CACHE_PREFIX + ticker.toUpperCase());
  } catch {
    return null;
  }
}

async function setCachedEodhdSymbol(ticker: string, symbol: string): Promise<void> {
  try {
    await AsyncStorage.setItem(EODHD_CACHE_PREFIX + ticker.toUpperCase(), symbol);
  } catch { /* ignore — cache is best-effort */ }
}

// ─── Core EODHD Fetchers ──────────────────────────────────────────────────────

/** Low-level: fetch EODHD real-time quote for an exact symbol. Returns null on any error. */
async function eodhdFetchRealtime(symbol: string): Promise<EodhdRealtimeData | null> {
  const key = eodhdApiKey();
  if (!key) return null;
  const url = `${EODHD_BASE}/real-time/${encodeURIComponent(symbol)}?api_token=${key}&fmt=json`;
  console.log(`[eodhdFetchRealtime] GET ${url.replace(key, "***")}`);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal })
      .finally(() => clearTimeout(timer));
    console.log(`[eodhdFetchRealtime] ${symbol} → HTTP ${res.status}`);
    if (!res.ok) return null;
    const data = await res.json();
    console.log(`[eodhdFetchRealtime] ${symbol} → ${JSON.stringify(data).slice(0, 200)}`);
    const item: EodhdRealtimeData = Array.isArray(data) ? data[0] : data;
    // Treat NA / 0 / null close as invalid
    if (!item || !item.close || item.close <= 0 || (item.close as unknown) === "NA") return null;
    return item;
  } catch (err) {
    console.warn(`[eodhdFetchRealtime] ${symbol} error:`, err);
    return null;
  }
}

/** Fetch EODHD EOD historical bars from fromDate onwards, sorted ascending by date. */
async function eodhdFetchHistory(symbol: string, fromDate: string): Promise<EodhdHistoricalBar[]> {
  const key = eodhdApiKey();
  if (!key) return [];
  const url = `${EODHD_BASE}/eod/${encodeURIComponent(symbol)}?api_token=${key}&fmt=json&from=${fromDate}`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal })
      .finally(() => clearTimeout(timer));
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return (data as EodhdHistoricalBar[])
      .filter(b => b.close > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
  } catch {
    return [];
  }
}

/**
 * Resolve the best EODHD symbol for a bare ticker using the suffix waterfall.
 * Uses the exchange hint to try that venue's suffixes first, minimising API calls.
 * Caches the winner in AsyncStorage so the waterfall is only run once per ticker.
 */
async function resolveEodhdSymbol(
  ticker: string,
  exchange?: string,
): Promise<{ symbol: string; data: EodhdRealtimeData } | null> {
  const upper = ticker.toUpperCase();

  // 1. Try cached symbol — skips the waterfall on every fetch after the first
  const cached = await getCachedEodhdSymbol(upper);
  if (cached) {
    const data = await eodhdFetchRealtime(cached);
    if (data) {
      console.log(`[eodhd] ${upper} → cache hit: ${cached}`);
      return { symbol: cached, data };
    }
    console.warn(`[eodhd] ${upper}: cached symbol ${cached} stale, re-resolving`);
  }

  // 2. Waterfall: try each suffix in exchange-biased order
  const waterfall = buildSuffixWaterfall(exchange);
  for (const suffix of waterfall) {
    const sym = suffix ? `${upper}${suffix}` : upper;
    const data = await eodhdFetchRealtime(sym);
    if (data) {
      await setCachedEodhdSymbol(upper, sym);
      console.log(`[eodhd] ${upper} → resolved via ${sym}`);
      return { symbol: sym, data };
    }
  }

  // Clear any stale cached symbol so the next refresh starts fresh
  try { await AsyncStorage.removeItem(EODHD_CACHE_PREFIX + upper); } catch { /* ignore */ }
  console.warn(`[eodhd] ${upper}: all suffixes failed — price unavailable`);
  return null;
}

export interface PriceResult {
  ticker: string;
  priceEUR: number;
  currency: string;
  source: "api" | "manual";
  lastFetched: string;
  isStale: boolean;
}

export interface PricePoint {
  date: string;
  priceEUR: number;
}

/** Build an exchange-suffixed symbol (e.g. "VWCE" + "XETRA" → "VWCE.DE"). */
export function buildEodhdSymbol(ticker: string, exchange: string): string {
  const suffix = EXCHANGE_SUFFIXES[exchange] ?? "";
  return `${ticker}${suffix}`;
}

/** @deprecated Use buildEodhdSymbol */
export const buildYahooSymbol = buildEodhdSymbol;

const fxMemCache: Record<string, { rate: number; fetchedAt: number }> = {};

export async function fetchFXRate(from: string, to: string): Promise<number> {
  const key = `${from}_${to}`;
  const cached = fxMemCache[key];
  if (cached && Date.now() - cached.fetchedAt < 60_000) return cached.rate;

  const url = `https://api.frankfurter.app/latest?from=${from}&to=${to}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`FX fetch failed: ${res.status}`);
  const data = await res.json();
  const rate: number = data.rates[to];
  if (!rate) throw new Error(`No rate for ${from}→${to}`);
  fxMemCache[key] = { rate, fetchedAt: Date.now() };
  return rate;
}

export function normalizeToEUR(
  price: number,
  currency: string,
  fxRates: Record<string, number>
): number {
  switch (currency) {
    case "EUR": return price;
    case "GBp":
    case "GBX": return (price / 100) * (fxRates["GBP"] ?? 1);
    case "GBP": return price * (fxRates["GBP"] ?? 1);
    case "USD": return price * (fxRates["USD"] ?? 1);
    case "CHF": return price * (fxRates["CHF"] ?? 1);
    case "SEK": return price * (fxRates["SEK"] ?? 1);
    case "NOK": return price * (fxRates["NOK"] ?? 1);
    case "DKK": return price * (fxRates["DKK"] ?? 1);
    default:
      console.warn(`[priceService] Unknown currency: ${currency}`);
      return price;
  }
}

/** Shared helper: given a resolved EODHD symbol + real-time data, compute EUR price. */
async function priceFromSymbolData(
  ticker: string,
  sym: string,
  data: EodhdRealtimeData,
): Promise<PriceResult> {
  const currency = symbolCurrency(sym);
  let fxRate = 1;
  if (currency !== "EUR") {
    const fxFrom = currency === "GBp" || currency === "GBX" ? "GBP" : currency;
    try { fxRate = await fetchFXRate(fxFrom, "EUR"); } catch { /* use 1 */ }
  }
  const priceEUR = normalizeToEUR(data.close, currency, { [currency]: fxRate });
  console.log(`[eodhd] ${ticker} (${sym}): ${data.close} ${currency} → ${priceEUR.toFixed(4)} EUR`);
  return { ticker, priceEUR, currency, source: "api", lastFetched: new Date().toISOString(), isStale: false };
}

export async function fetchLivePrice(
  ticker: string,
  exchange: string,
  isin?: string,
): Promise<PriceResult | null> {
  if (isin) {
    const upper = isin.toUpperCase();

    // 1. Hard forced symbol — bypass all caches and waterfall
    const forcedSym = ISIN_FORCED_SYMBOLS[upper];
    if (forcedSym) {
      console.log(`[eodhd] ISIN ${upper}: forced symbol ${forcedSym}`);
      const data = await eodhdFetchRealtime(forcedSym);
      if (data) {
        await setCachedISINSymbol(upper, forcedSym);
        return priceFromSymbolData(ticker, forcedSym, data);
      }
      console.warn(`[eodhd] ISIN ${upper}: forced symbol ${forcedSym} returned no price, trying waterfall`);
    }

    // 2. ISIN waterfall (with its own cache)
    const isinWaterfall = ISIN_SYMBOL_WATERFALL[upper];
    if (isinWaterfall) {
      const cachedSymbol = await getCachedISINSymbol(upper);
      if (cachedSymbol) {
        const data = await eodhdFetchRealtime(cachedSymbol);
        if (data) {
          console.log(`[eodhd] ISIN ${upper} → cache hit: ${cachedSymbol}`);
          return priceFromSymbolData(ticker, cachedSymbol, data);
        }
        console.warn(`[eodhd] ISIN ${upper}: cached symbol ${cachedSymbol} stale, re-resolving`);
      }
      for (const sym of isinWaterfall) {
        console.log(`[eodhd] ISIN ${upper}: trying ${sym}`);
        const data = await eodhdFetchRealtime(sym);
        if (data) {
          await setCachedISINSymbol(upper, sym);
          console.log(`[eodhd] ISIN ${upper} → resolved via ${sym}`);
          return priceFromSymbolData(ticker, sym, data);
        }
      }
      console.warn(`[eodhd] ISIN ${upper}: all ISIN-specific symbols failed, falling back to ticker waterfall`);
    }
  }

  // 3. Standard ticker waterfall
  const resolved = await resolveEodhdSymbol(ticker, exchange);

  // 4. XETRA explicit retry: if the waterfall failed for a Xetra holding, try
  //    {TICKER}.XETRA directly — EODHD's native format for Xetra-listed ETFs.
  if (!resolved && exchange === "XETRA") {
    const xetraSymbol = `${ticker.toUpperCase()}.XETRA`;
    console.log(`[eodhd] XETRA fallback: trying ${xetraSymbol} for ${ticker}`);
    const data = await eodhdFetchRealtime(xetraSymbol);
    if (data) {
      await setCachedEodhdSymbol(ticker, xetraSymbol);
      console.log(`[eodhd] ${ticker}: XETRA fallback succeeded via ${xetraSymbol}`);
      return priceFromSymbolData(ticker, xetraSymbol, data);
    }
  }

  if (!resolved) {
    console.warn(`[eodhd] fetchLivePrice: no price found for ${ticker}`);
    return null;
  }

  const { symbol, data } = resolved;
  return priceFromSymbolData(ticker, symbol, data);
}

export async function getCachedPrice(ticker: string): Promise<PriceResult | null> {
  try {
    const row = await dbGetPrice(ticker);
    if (!row) return null;
    const age = Date.now() - new Date(row.last_fetched).getTime();
    return {
      ticker,
      priceEUR: row.price_eur,
      currency: "EUR",
      source: row.source as "api" | "manual",
      lastFetched: row.last_fetched,
      isStale: row.source !== "manual" && age > CACHE_TTL_MS,
    };
  } catch {
    return null;
  }
}

async function fetchAndCacheOne(ticker: string, exchange: string, isin?: string): Promise<void> {
  const cached = await getCachedPrice(ticker);

  if (cached?.source === "manual") return;
  if (cached && !cached.isStale) return;

  const result = await fetchLivePrice(ticker, exchange, isin);
  if (result) {
    await upsertPrice(ticker, result.priceEUR, "api");
  }
}

export async function refreshAllPrices(
  holdings: Pick<HoldingRow, "ticker" | "exchange" | "isin">[]
): Promise<void> {
  if (holdings.length === 0) return;

  const unique = holdings.filter(
    (h, i, arr) => arr.findIndex((x) => x.ticker === h.ticker) === i
  );

  for (let i = 0; i < unique.length; i += MAX_CONCURRENT) {
    const batch = unique.slice(i, i + MAX_CONCURRENT);
    await Promise.allSettled(
      batch.map((h) => fetchAndCacheOne(h.ticker, h.exchange, h.isin))
    );
  }
}

export async function fetchHistoricalPrices(
  symbol: string,
  range: string
): Promise<PricePoint[]> {
  const rangeDays: Record<string, number> = {
    "1W": 7, "1M": 31, "3M": 92, "1Y": 366, "All": 1830,
  };
  const fromDate = dateStringDaysAgo(rangeDays[range] ?? 31);
  const ticker = symbol.split(".")[0];
  const cached = await getCachedEodhdSymbol(ticker);
  const eodhdSym = cached ?? symbol;

  const bars = await eodhdFetchHistory(eodhdSym, fromDate);
  if (bars.length === 0) return [];

  const currency = symbolCurrency(eodhdSym);
  let fxRate = 1;
  if (currency !== "EUR") {
    const fxFrom = currency === "GBp" || currency === "GBX" ? "GBP" : currency;
    try { fxRate = await fetchFXRate(fxFrom, "EUR"); } catch { /* use 1 */ }
  }
  const toEUR = (p: number) =>
    currency === "GBp" || currency === "GBX" ? (p / 100) * fxRate : p * fxRate;

  return bars.map(b => ({ date: b.date, priceEUR: toEUR(b.close) }));
}

// ─── Search & Detail Types ────────────────────────────────────────────────────

export interface SearchResult {
  symbol: string;
  shortName: string;
  quoteType: string;
  exchange: string;
  exchDisp: string;
  typeDisp: string;
}

export interface TickerMeta {
  symbol: string;
  shortName: string;
  longName: string;
  currency: string;
  exchangeName: string;
  quoteType: string;
  regularMarketPrice: number;
  previousClose: number;
  regularMarketChange: number;
  regularMarketChangePercent: number;
  fiftyTwoWeekHigh: number;
  fiftyTwoWeekLow: number;
  regularMarketVolume: number;
  averageDailyVolume3Month: number;
  totalAssets?: number;
  trailingAnnualDividendYield?: number;
  marketCap?: number;
  trailingPE?: number;
  isin?: string | null;
}

export interface ChartPoint {
  timestamp: number;
  priceEUR: number;
}

const CHART_INTERVALS: Record<string, { interval: string; range: string }> = {
  "1D":  { interval: "5m",  range: "1d"  },
  "1W":  { interval: "1h",  range: "5d"  },
  "1M":  { interval: "1d",  range: "1mo" },
  "3M":  { interval: "1d",  range: "3mo" },
  "6M":  { interval: "1d",  range: "6mo" },
  "YTD": { interval: "1d",  range: "ytd" },
  "1Y":  { interval: "1d",  range: "1y"  },
  "3Y":  { interval: "1wk", range: "3y"  },
  "5Y":  { interval: "1wk", range: "5y"  },
  "All": { interval: "1mo", range: "max" },
};

// ─── EODHD Historical Chart Helpers ──────────────────────────────────────────

function dateStringDaysAgo(days: number): string {
  const d = new Date(Date.now() - days * 86_400_000);
  return d.toISOString().split("T")[0];
}

function ytdFromDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-01-01`;
}

/**
 * Fetch EODHD EOD chart data and convert to ChartPoint[].
 *
 * Ranges 3Y / 5Y / All require a paid EODHD plan — return [] so the caller
 * can show an "Upgrade to Pro" lock in the UI.
 *
 * For 1D the EOD endpoint only has yesterday + today (2 daily bars) which
 * is enough to show the daily trend.
 */
export async function fetchEodhdChartHistory(
  symbol: string,
  range: string,
): Promise<ChartPoint[]> {
  if (!eodhdApiKey()) return [];
  // Premium ranges — caller should show upgrade lock
  if (range === "3Y" || range === "5Y" || range === "All") return [];

  // Resolve the winning EODHD symbol from cache (or run waterfall)
  const ticker = symbol.split(".")[0];
  const cached = await getCachedEodhdSymbol(ticker);
  // If we have a cache hit use it; otherwise try the symbol as passed, then waterfall
  const eodhdSymbol = cached ?? symbol;

  const fromDate =
    range === "1D"  ? dateStringDaysAgo(2)   :
    range === "1W"  ? dateStringDaysAgo(7)   :
    range === "1M"  ? dateStringDaysAgo(31)  :
    range === "3M"  ? dateStringDaysAgo(92)  :
    range === "6M"  ? dateStringDaysAgo(183) :
    range === "YTD" ? ytdFromDate()          :
    range === "1Y"  ? dateStringDaysAgo(366) :
    dateStringDaysAgo(366); // fallback

  let bars = await eodhdFetchHistory(eodhdSymbol, fromDate);

  // If the cached/passed symbol returned nothing, run a full waterfall resolve
  if (bars.length === 0 && !cached) {
    const resolved = await resolveEodhdSymbol(ticker);
    if (resolved) {
      bars = await eodhdFetchHistory(resolved.symbol, fromDate);
    }
  }

  if (bars.length === 0) return [];

  const currency = symbolCurrency(eodhdSymbol);
  let fxRate = 1;
  if (currency !== "EUR") {
    const fxFrom = currency === "GBp" || currency === "GBX" ? "GBP" : currency;
    try { fxRate = await fetchFXRate(fxFrom, "EUR"); } catch { /* use 1 */ }
  }
  const toEUR = (p: number) =>
    currency === "GBp" || currency === "GBX" ? (p / 100) * fxRate : p * fxRate;

  return bars.map(b => ({
    timestamp: new Date(b.date).getTime(),
    priceEUR:  toEUR(b.close),
  }));
}

/** @deprecated Use fetchEodhdChartHistory instead */
export const fetchFMPChartHistory = fetchEodhdChartHistory;

interface EodhdSearchResult {
  Code: string;
  Name: string;
  Country: string;
  Exchange: string;
  Currency: string;
  Type: string;
  ISIN?: string;
}

const EODHD_EXCHANGE_MAP: Record<string, string> = {
  "XETRA": "XETRA", "F": "XETRA",
  "AS": "EURONEXT_AMS",
  "PA": "EURONEXT_PAR",
  "LSE": "LSE", "L": "LSE",
  "MI": "BORSA_IT", "MIL": "BORSA_IT",
  "SW": "SIX",
  "BR": "EURONEXT_BRU",
  "MC": "BME",
  "HE": "NASDAQ_HEL",
  "ST": "NASDAQ_STO",
  "OL": "OSLO",
  "CO": "NASDAQ_CPH",
};

export async function searchTickers(query: string): Promise<SearchResult[]> {
  const key = eodhdApiKey();
  if (!key) return [];
  const url = `${EODHD_BASE}/search/${encodeURIComponent(query)}?api_token=${key}&fmt=json&limit=15`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6_000);
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal })
      .finally(() => clearTimeout(timer));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: EodhdSearchResult[] = await res.json();
    return data.map((r) => ({
      symbol: `${r.Code}.${r.Exchange}`,
      shortName: r.Name ?? "",
      quoteType: r.Type?.toUpperCase().includes("ETF") ? "ETF" : "EQUITY",
      exchange: EODHD_EXCHANGE_MAP[r.Exchange?.toUpperCase()] ?? r.Exchange ?? "",
      exchDisp: r.Exchange ?? "",
      typeDisp: r.Type ?? "",
    }));
  } catch {
    return [];
  }
}

export async function resolveExchangeFromISIN(isin: string, ticker: string): Promise<string> {
  const STATIC_OVERRIDES: Record<string, string> = {
    "VWCE": "XETRA", "VWRL": "XETRA", "VUAA": "XETRA", "EQQQ": "XETRA",
    "IWDA": "EURONEXT_AMS", "VHYL": "EURONEXT_AMS", "TDIV": "EURONEXT_AMS",
    "EGLN": "LSE", "ERNE": "LSE", "VUSA": "LSE", "VGOV": "LSE",
    "CSBGE7": "SIX", "IEGE": "BORSA_IT",
  };

  const upper = ticker.toUpperCase();
  if (STATIC_OVERRIDES[upper]) return STATIC_OVERRIDES[upper];

  try {
    const results = await searchTickers(ticker);
    if (results.length > 0) {
      const EXCHANGE_PRIORITY: Record<string, number> = {
        "XETRA": 1, "EURONEXT_AMS": 2, "EURONEXT_PAR": 3,
        "BORSA_IT": 4, "SIX": 5, "LSE": 6, "EURONEXT_BRU": 7,
      };
      const matching = results.filter(r =>
        r.symbol.toUpperCase().startsWith(upper + ".")
      );
      const candidates = matching.length > 0 ? matching : results.slice(0, 3);
      const sorted = candidates.sort((a, b) =>
        (EXCHANGE_PRIORITY[a.exchange] ?? 99) - (EXCHANGE_PRIORITY[b.exchange] ?? 99)
      );
      const best = sorted[0];
      if (best.exchange && EODHD_EXCHANGE_MAP[best.exchDisp?.toUpperCase() ?? ""]) {
        return EODHD_EXCHANGE_MAP[best.exchDisp.toUpperCase()];
      }
      if (best.exchange) return best.exchange;
    }
  } catch { /* fall through */ }

  if (!isin) return "XETRA";
  const country = isin.substring(0, 2).toUpperCase();
  switch (country) {
    case "IE": return "XETRA";
    case "NL": return "EURONEXT_AMS";
    case "LU": return "EURONEXT_PAR";
    case "FR": return "EURONEXT_PAR";
    case "GB": return "LSE";
    case "DE": return "XETRA";
    default:   return "XETRA";
  }
}

export async function fetchTickerMeta(symbol: string): Promise<TickerMeta | null> {
  try {
    const ticker = symbol.split(".")[0];
    // Infer exchange from Yahoo-style suffix so the waterfall starts at the right venue
    const inferredExchange = exchangeFromSuffix(symbol) ?? undefined;

    const resolved = await resolveEodhdSymbol(ticker, inferredExchange);
    if (!resolved) {
      console.warn(`[eodhd] fetchTickerMeta: no price found for ${symbol}`);
      return null;
    }

    const { symbol: eodhdSymbol, data } = resolved;
    const currency = symbolCurrency(eodhdSymbol);

    let fxRate = 1;
    if (currency !== "EUR") {
      const fxFrom = currency === "GBp" || currency === "GBX" ? "GBP" : currency;
      try { fxRate = await fetchFXRate(fxFrom, "EUR"); } catch { /* use 1 */ }
    }
    const toEUR = (p: number | undefined): number => {
      if (p == null || isNaN(p) || (p as unknown) === "NA") return 0;
      if (currency === "GBp" || currency === "GBX") return (p / 100) * fxRate;
      return p * fxRate;
    };

    const priceEUR  = toEUR(data.close);
    const prevClose = data.previousClose > 0 ? data.previousClose : data.close - data.change;
    const prevEUR   = toEUR(prevClose);
    const changeEUR = toEUR(data.change);
    const changePct = data.change_p !== 0
      ? data.change_p
      : (prevEUR !== 0 ? (changeEUR / prevEUR) * 100 : 0);

    // Fetch 1Y history to compute 52-week high/low from daily bars
    const yearBars = await eodhdFetchHistory(eodhdSymbol, dateStringDaysAgo(366));
    const yearHigh = yearBars.reduce((m, b) => Math.max(m, toEUR(b.high)), 0);
    const yearLow  = yearBars.reduce(
      (m, b) => (b.low > 0 ? Math.min(m, toEUR(b.low)) : m),
      Infinity,
    );

    const exchangeName = exchangeNameFromEodhdSymbol(eodhdSymbol);

    return {
      symbol:       ticker,
      shortName:    ticker,
      longName:     ticker,
      currency,
      exchangeName,
      quoteType:    "ETF",
      regularMarketPrice:         priceEUR,
      previousClose:              prevEUR,
      regularMarketChange:        changeEUR,
      regularMarketChangePercent: changePct,
      fiftyTwoWeekHigh:           yearHigh > 0 ? yearHigh : 0,
      fiftyTwoWeekLow:            yearLow  < Infinity ? yearLow : 0,
      regularMarketVolume:        data.volume ?? 0,
      averageDailyVolume3Month:   0,
      totalAssets:                undefined,
      trailingAnnualDividendYield: undefined,
      marketCap:    undefined,
      trailingPE:   undefined,
      isin:         null,
    };
  } catch (err) {
    console.warn(`[eodhd] fetchTickerMeta failed for ${symbol}:`, err);
    return null;
  }
}

// ─── Exchange helpers used by fetchTickerMeta ─────────────────────────────────

function exchangeFromSuffix(symbol: string): string | undefined {
  if (symbol.endsWith(".DE"))  return "XETRA";
  if (symbol.endsWith(".AS"))  return "EURONEXT_AMS";
  if (symbol.endsWith(".PA"))  return "EURONEXT_PAR";
  if (symbol.endsWith(".L"))   return "LSE";
  if (symbol.endsWith(".MI"))  return "BORSA_IT";
  if (symbol.endsWith(".SW"))  return "SIX";
  if (symbol.endsWith(".BR"))  return "EURONEXT_BRU";
  if (symbol.endsWith(".MC"))  return "BME";
  if (symbol.endsWith(".HE"))  return "NASDAQ_HEL";
  if (symbol.endsWith(".ST"))  return "NASDAQ_STO";
  if (symbol.endsWith(".OL"))  return "OSLO";
  if (symbol.endsWith(".CO"))  return "NASDAQ_CPH";
  return undefined;
}

function exchangeNameFromEodhdSymbol(symbol: string): string {
  const up = symbol.toUpperCase();
  if (up.endsWith(".XETRA") || up.endsWith(".DE"))  return "XETRA";
  if (up.endsWith(".LSE")   || up.endsWith(".L"))   return "London Stock Exchange";
  if (up.endsWith(".AS")    || up.endsWith(".AMS")) return "Euronext Amsterdam";
  if (up.endsWith(".PA")    || up.endsWith(".EPA")) return "Euronext Paris";
  if (up.endsWith(".MI")    || up.endsWith(".MIL") || up.endsWith(".BIT")) return "Borsa Italiana";
  if (up.endsWith(".SW")    || up.endsWith(".SWX")) return "SIX Swiss Exchange";
  if (up.endsWith(".BR"))  return "Euronext Brussels";
  if (up.endsWith(".MC"))  return "Bolsa de Madrid";
  if (up.endsWith(".HE"))  return "Nasdaq Helsinki";
  if (up.endsWith(".ST"))  return "Nasdaq Stockholm";
  if (up.endsWith(".OL"))  return "Oslo Børs";
  if (up.endsWith(".CO"))  return "Nasdaq Copenhagen";
  return "";
}

const KNOWN_YIELDS: Record<string, number> = {
  // Vanguard
  "VWCE": 0.0,   "VWRL": 1.6,   "VHYL": 3.4,   "VUSA": 1.2,
  "VEUR": 2.8,   "VFEM": 2.9,   "VGOV": 2.1,   "VGWD": 2.5,
  "VUAA": 0.0,   "VFEA": 0.0,   "VEVE": 0.0,   "VERX": 0.0,
  // iShares
  "IWDA": 0.0,   "SWRD": 0.0,   "EQQQ": 0.0,   "IQQQ": 0.0,
  "CSPX": 0.0,   "CSP1": 0.0,   "IUSA": 1.2,   "IUES": 2.8,
  "IEEM": 2.4,   "EMIM": 2.1,   "EGLN": 0.0,   "IGLN": 0.0,
  "IEGE": 3.2,   "ERNE": 3.9,   "CSBGE7": 2.8, "IBGX": 2.4,
  "EUNA": 2.2,   "IEGY": 3.1,   "IDVY": 3.8,   "IQQH": 0.0,
  "SPPW": 0.0,   "SAWD": 0.0,   "SUSW": 0.0,
  // VanEck
  "TDIV": 3.8,   "TRET": 3.2,   "MVOL": 2.1,
  // Amundi
  "LCUW": 0.0,   "CW8":  0.0,   "PAEEM": 2.3,  "PANX": 0.0,
  "LYP6": 0.0,   "LYPE": 0.0,   "AHYQ": 0.0,
  // SPDR
  "SPY5": 1.2,   "SPYY": 1.2,   "ZPRS": 0.0,   "SPXS": 0.0,
  "ZPRV": 0.0,   "ZPRX": 0.0,
  // Xtrackers
  "XDWD": 0.0,   "XDEW": 0.0,   "XMAW": 0.0,   "X014": 0.0,
  "DBXD": 0.0,   "XDWH": 0.0,
  // WisdomTree
  "WQDS": 0.0,   "WTEF": 2.9,
  // Invesco
  "MXWO": 0.0,   "QQQ3": 0.0,
  // HANetf / other
  "2B7S": 0.0,   "QDVW": 0.0,   "10AI": 0.0,
  // Bonds / Fixed Income
  "AGGH": 3.1,   "IEAG": 2.8,   "IBTM": 3.4,   "IBTS": 2.9,
  "LQDE": 3.6,   "IHYG": 5.8,   "HYLD": 5.2,
};

export async function fetchDividendYield(ticker: string, _exchange: string): Promise<number | null> {
  // Check static known yields first
  const knownYield = KNOWN_YIELDS[ticker.toUpperCase()];
  if (knownYield !== undefined) return knownYield;

  // Try EODHD fundamentals for ETF yield
  const key = eodhdApiKey();
  if (!key) return null;
  try {
    const cachedSym = await getCachedEodhdSymbol(ticker.toUpperCase());
    if (!cachedSym) return null;
    const url = `${EODHD_BASE}/fundamentals/${encodeURIComponent(cachedSym)}?api_token=${key}&filter=ETF_Data::Yield`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal })
      .finally(() => clearTimeout(timer));
    if (!res.ok) return null;
    const data = await res.json();
    const yld = typeof data === "number" ? data : null;
    if (yld && yld > 0) return Math.round(yld * 100) / 100;
    return null;
  } catch {
    return null;
  }
}

export async function fetchChartHistory(symbol: string, range: string): Promise<ChartPoint[]> {
  return fetchEodhdChartHistory(symbol, range);
}

// ─── Period-based price change (canonical, used everywhere) ─────────────────

export interface PeriodReturn {
  changePct: number;
  changeAbs: number;
  startPriceEUR: number;
  endPriceEUR: number;
}


export async function fetchPeriodReturn(
  symbol: string,
  period: "1D" | "1W" | "1M" | "3M" | "6M" | "YTD" | "1Y" | "3Y" | "5Y" | "All",
  _opts?: { previousCloseEUR?: number; currentPriceEUR?: number }
): Promise<PeriodReturn | null> {
  // Premium ranges — caller shows upgrade lock
  if (period === "3Y" || period === "5Y" || period === "All") return null;

  const ticker = symbol.split(".")[0];
  const inferredExchange = exchangeFromSuffix(symbol);

  // Resolve the EODHD symbol (uses cache after first load)
  const resolved = await resolveEodhdSymbol(ticker, inferredExchange);
  if (!resolved) return null;

  const { symbol: eodhdSymbol, data } = resolved;
  const currency = symbolCurrency(eodhdSymbol);

  let fxRate = 1;
  if (currency !== "EUR") {
    const fxFrom = currency === "GBp" || currency === "GBX" ? "GBP" : currency;
    try { fxRate = await fetchFXRate(fxFrom, "EUR"); } catch { /* use 1 */ }
  }
  const toEUR = (p: number) =>
    currency === "GBp" || currency === "GBX" ? (p / 100) * fxRate : p * fxRate;

  const endPriceEUR = toEUR(data.close);

  // ── 1D: use real-time change fields directly — no historical fetch needed ──
  if (period === "1D") {
    const prevClose = data.previousClose > 0
      ? data.previousClose
      : data.close - data.change;
    if (!prevClose || prevClose <= 0) return null;
    const startPriceEUR = toEUR(prevClose);
    const changeEUR     = endPriceEUR - startPriceEUR;
    const changePct     = data.change_p !== 0
      ? data.change_p
      : (startPriceEUR !== 0 ? (changeEUR / startPriceEUR) * 100 : 0);
    return { changePct, changeAbs: changeEUR, startPriceEUR, endPriceEUR };
  }

  // ── 1W / 1M / 3M / 6M / YTD / 1Y: fetch EOD history for start price ─────
  const fromDate =
    period === "1W"  ? dateStringDaysAgo(7)   :
    period === "1M"  ? dateStringDaysAgo(31)  :
    period === "3M"  ? dateStringDaysAgo(92)  :
    period === "6M"  ? dateStringDaysAgo(183) :
    period === "YTD" ? ytdFromDate()          :
    dateStringDaysAgo(366); // 1Y

  try {
    const bars = await eodhdFetchHistory(eodhdSymbol, fromDate);
    if (bars.length === 0) return null;

    const startPriceEUR = toEUR(bars[0].close);
    if (startPriceEUR === 0) return null;

    const changeAbs = endPriceEUR - startPriceEUR;
    const changePct = (changeAbs / startPriceEUR) * 100;
    return { changePct, changeAbs, startPriceEUR, endPriceEUR };
  } catch (err) {
    console.warn(`[eodhd] fetchPeriodReturn ${period} failed for ${symbol}:`, err);
    return null;
  }
}

export async function fetchBenchmarkReturn(
  ticker: string,
  startDateString: string
): Promise<number | null> {
  try {
    const bars = await eodhdFetchHistory(ticker, startDateString);
    if (bars.length < 2) return null;
    const first = bars[0].close;
    const last  = bars[bars.length - 1].close;
    if (!first || first <= 0) return null;
    return ((last - first) / first) * 100;
  } catch (err) {
    console.warn(`[fetchBenchmarkReturn] ${ticker}:`, err);
    return null;
  }
}

export async function fetchSymbolPrice(
  fullSymbol: string
): Promise<{ price: number; changePct: number } | null> {
  try {
    const data = await eodhdFetchRealtime(fullSymbol);
    if (!data) {
      // Try resolving via waterfall using ticker portion
      const ticker = fullSymbol.split(".")[0];
      const resolved = await resolveEodhdSymbol(ticker);
      if (!resolved) return null;
      const d = resolved.data;
      const currency = symbolCurrency(resolved.symbol);
      let fxRate = 1;
      if (currency !== "EUR") {
        const fxFrom = currency === "GBp" || currency === "GBX" ? "GBP" : currency;
        try { fxRate = await fetchFXRate(fxFrom, "EUR"); } catch { /* use 1 */ }
      }
      const toEUR = (p: number) =>
        currency === "GBp" || currency === "GBX" ? (p / 100) * fxRate : p * fxRate;
      const price = toEUR(d.close);
      const prev = d.previousClose > 0 ? toEUR(d.previousClose) : price;
      return { price, changePct: d.change_p ?? (prev !== 0 ? ((price - prev) / prev) * 100 : 0) };
    }
    const currency = symbolCurrency(fullSymbol);
    let fxRate = 1;
    if (currency !== "EUR") {
      const fxFrom = currency === "GBp" || currency === "GBX" ? "GBP" : currency;
      try { fxRate = await fetchFXRate(fxFrom, "EUR"); } catch { /* use 1 */ }
    }
    const toEUR = (p: number) =>
      currency === "GBp" || currency === "GBX" ? (p / 100) * fxRate : p * fxRate;
    const price = toEUR(data.close);
    const prev = data.previousClose > 0 ? toEUR(data.previousClose) : price;
    return { price, changePct: data.change_p ?? (prev !== 0 ? ((price - prev) / prev) * 100 : 0) };
  } catch {
    return null;
  }
}

export interface ServerETFData {
  isin?: string;
  ter: number | null;
  fundSize: string | null;
  replicationMethod: string | null;
  numberOfHoldings: number | null;
  launchDate: string | null;
  domicile: string | null;
  distributionPolicy: string | null;
  description: string | null;
}

export interface ISINResolveResult {
  isin: string;
  ticker: string | null;
  candidates: string[];
  etfData: ServerETFData | null;
}

export async function fetchETFDataFromServer(isin: string): Promise<ServerETFData | null> {
  if (!isin || Platform.OS === "web") return null;
  try {
    const domain = process.env.EXPO_PUBLIC_DOMAIN ?? "";
    if (!domain) return null;
    const res = await fetch(`https://${domain}/api/etf/ter/${isin}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function fetchETFDataBySymbol(symbol: string): Promise<ServerETFData | null> {
  if (!symbol || Platform.OS === "web") return null;
  try {
    const domain = process.env.EXPO_PUBLIC_DOMAIN ?? "";
    if (!domain) return null;
    const res = await fetch(
      `https://${domain}/api/etf/by-symbol?symbol=${encodeURIComponent(symbol)}`
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ─── EODHD ETF Fundamentals ───────────────────────────────────────────────────

export interface ETFHolding {
  name: string;
  weightPct: number;
  country?: string;
  sector?: string;
}

export interface ETFSectorWeight {
  sector: string;
  weightPct: number;
}

export interface ETFCountryWeight {
  country: string;
  weightPct: number;
}

export interface ETFFundamentals {
  isin?: string;
  name?: string;
  ter?: number | null;         // Net_Expense_Ratio as decimal (0.0022 = 0.22%)
  aum?: number | null;         // TotalAssets in USD
  yield?: number | null;       // annual yield as decimal
  inceptionDate?: string | null;
  domicile?: string | null;
  replicationMethod?: string | null;
  distributionPolicy?: string | null;
  holdingsCount?: number | null;
  topHoldings?: ETFHolding[];
  sectorWeights?: ETFSectorWeight[];
  countryWeights?: ETFCountryWeight[];
}

const ETF_FUND_CACHE_PREFIX = "eodhd_etf_fund_";
const ETF_FUND_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface CachedFundamentals {
  data: ETFFundamentals;
  fetchedAt: number;
}

export async function fetchETFFundamentals(
  ticker: string,
  exchange?: string,
): Promise<ETFFundamentals | null> {
  const key = eodhdApiKey();
  if (!key) return null;

  const cacheKey = ETF_FUND_CACHE_PREFIX + ticker.toUpperCase();
  try {
    const raw = await AsyncStorage.getItem(cacheKey);
    if (raw) {
      const cached: CachedFundamentals = JSON.parse(raw);
      if (Date.now() - cached.fetchedAt < ETF_FUND_TTL_MS) {
        return cached.data;
      }
    }
  } catch { /* ignore cache errors */ }

  // Resolve the EODHD symbol for this ticker
  const cachedSym = await getCachedEodhdSymbol(ticker.toUpperCase());
  const eodhdSym = cachedSym ?? (exchange
    ? `${ticker.toUpperCase()}${(EXCHANGE_EODHD_SUFFIXES[exchange] ?? [".XETRA"])[0]}`
    : `${ticker.toUpperCase()}.XETRA`);

  const url = `${EODHD_BASE}/fundamentals/${encodeURIComponent(eodhdSym)}?api_token=${key}&filter=ETF_Data&fmt=json`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal })
      .finally(() => clearTimeout(timer));
    if (!res.ok) return null;
    const d = await res.json();
    if (!d || typeof d !== "object") return null;

    // Parse top holdings — EODHD returns them as an object keyed by symbol
    const rawHoldings = d.Holdings ?? d.Top_Holdings ?? {};
    const topHoldings: ETFHolding[] = Object.values(rawHoldings)
      .map((h: any) => ({
        name: h.Name ?? h.name ?? "",
        weightPct: parseFloat(h["Assets_%"] ?? h.weight ?? "0") || 0,
        country: h.Country ?? h.country,
        sector: h.Sector ?? h.sector,
      }))
      .filter((h) => h.name && h.weightPct > 0)
      .sort((a, b) => b.weightPct - a.weightPct)
      .slice(0, 10);

    // Sector weights
    const rawSectors = d.Sector_Weightings ?? d.sectors ?? [];
    const sectorWeights: ETFSectorWeight[] = (Array.isArray(rawSectors) ? rawSectors : Object.values(rawSectors))
      .map((s: any) => ({
        sector: s.Sector ?? s.sector ?? s.type ?? "",
        weightPct: parseFloat(s["Equity_%"] ?? s.weight ?? "0") || 0,
      }))
      .filter((s) => s.sector && s.weightPct > 0)
      .sort((a, b) => b.weightPct - a.weightPct)
      .slice(0, 8);

    // Country weights
    const rawCountries = d.Country_Weightings ?? d.countries ?? [];
    const countryWeights: ETFCountryWeight[] = (Array.isArray(rawCountries) ? rawCountries : Object.values(rawCountries))
      .map((c: any) => ({
        country: c.Country ?? c.country ?? "",
        weightPct: parseFloat(c["Equity_%"] ?? c.weight ?? "0") || 0,
      }))
      .filter((c) => c.country && c.weightPct > 0)
      .sort((a, b) => b.weightPct - a.weightPct)
      .slice(0, 10);

    const ter = d.Net_Expense_Ratio != null && d.Net_Expense_Ratio !== "NA"
      ? parseFloat(d.Net_Expense_Ratio) * 100  // convert 0.0022 → 0.22%
      : null;

    const result: ETFFundamentals = {
      isin: d.ISIN ?? undefined,
      name: d.Name ?? undefined,
      ter: ter && ter > 0 ? ter : null,
      aum: d.TotalAssets && d.TotalAssets !== "NA" ? parseFloat(d.TotalAssets) : null,
      yield: d.Yield && d.Yield !== "NA" ? parseFloat(d.Yield) : null,
      inceptionDate: d.InceptionDate ?? undefined,
      domicile: d.Domicile ?? undefined,
      replicationMethod: d.ReplicationMethod ?? undefined,
      distributionPolicy: d.DistributionPolicy ?? undefined,
      holdingsCount: d.Holdings_Count ?? (Object.keys(rawHoldings).length || null),
      topHoldings,
      sectorWeights,
      countryWeights,
    };

    try {
      const cached: CachedFundamentals = { data: result, fetchedAt: Date.now() };
      await AsyncStorage.setItem(cacheKey, JSON.stringify(cached));
    } catch { /* ignore */ }

    return result;
  } catch (err) {
    console.warn(`[fetchETFFundamentals] ${ticker}:`, err);
    return null;
  }
}

export async function resolveISIN(isin: string): Promise<ISINResolveResult | null> {
  if (!isin || Platform.OS === "web") return null;
  try {
    const domain = process.env.EXPO_PUBLIC_DOMAIN ?? "";
    if (!domain) return null;
    const res = await fetch(
      `https://${domain}/api/etf/isin-resolve?isin=${encodeURIComponent(isin.toUpperCase())}`
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function testPriceFetch(): Promise<void> {
  console.log("[testPriceFetch] Fetching VWCE.DE...");
  const result = await fetchLivePrice("VWCE", "XETRA");
  if (result) {
    console.log("[testPriceFetch] Success:", JSON.stringify(result, null, 2));
  } else {
    console.log("[testPriceFetch] Failed to fetch price for VWCE.DE");
  }
}
