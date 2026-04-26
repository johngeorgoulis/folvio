import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { upsertPrice, getPrice as dbGetPrice } from "@/services/db";
import type { HoldingRow } from "@/services/db";

function yahooChartUrl(symbol: string, interval: string, range: string): string {
  if (Platform.OS === "web") {
    const domain = process.env.EXPO_PUBLIC_DOMAIN ?? "";
    return `https://${domain}/api/yahoo/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
  }
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
}

function yahooSearchUrl(q: string): string {
  if (Platform.OS === "web") {
    const domain = process.env.EXPO_PUBLIC_DOMAIN ?? "";
    return `https://${domain}/api/yahoo/search?q=${encodeURIComponent(q)}`;
  }
  return `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=15&newsCount=0`;
}

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
// Xetra gets both .XETRA (native EODHD) and .DE (Yahoo-compatible alias).

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
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal })
      .finally(() => clearTimeout(timer));
    if (!res.ok) return null;
    const data = await res.json();
    const item: EodhdRealtimeData = Array.isArray(data) ? data[0] : data;
    // Treat NA / 0 / null close as invalid
    if (!item || !item.close || item.close <= 0 || (item.close as unknown) === "NA") return null;
    return item;
  } catch {
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

export function buildYahooSymbol(ticker: string, exchange: string): string {
  const suffix = EXCHANGE_SUFFIXES[exchange] ?? "";
  return `${ticker}${suffix}`;
}

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

export async function fetchLivePrice(
  ticker: string,
  exchange: string
): Promise<PriceResult | null> {
  const resolved = await resolveEodhdSymbol(ticker, exchange);
  if (!resolved) {
    console.warn(`[eodhd] fetchLivePrice: no price found for ${ticker}`);
    return null;
  }

  const { symbol, data } = resolved;
  const currency = symbolCurrency(symbol);
  let fxRate = 1;
  if (currency !== "EUR") {
    const fxFrom = currency === "GBp" || currency === "GBX" ? "GBP" : currency;
    try { fxRate = await fetchFXRate(fxFrom, "EUR"); } catch { /* use 1 */ }
  }
  const priceEUR = normalizeToEUR(data.close, currency, { [currency]: fxRate });
  console.log(`[eodhd] ${ticker} (${symbol}): ${data.close} ${currency} → ${priceEUR.toFixed(4)} EUR`);

  return {
    ticker,
    priceEUR,
    currency,
    source: "api",
    lastFetched: new Date().toISOString(),
    isStale: false,
  };
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

async function fetchAndCacheOne(ticker: string, exchange: string): Promise<void> {
  const cached = await getCachedPrice(ticker);

  if (cached?.source === "manual") return;
  if (cached && !cached.isStale) return;

  const result = await fetchLivePrice(ticker, exchange);
  if (result) {
    await upsertPrice(ticker, result.priceEUR, "api");
  }
}

export async function refreshAllPrices(
  holdings: Pick<HoldingRow, "ticker" | "exchange">[]
): Promise<void> {
  if (holdings.length === 0) return;

  const unique = holdings.filter(
    (h, i, arr) => arr.findIndex((x) => x.ticker === h.ticker) === i
  );

  for (let i = 0; i < unique.length; i += MAX_CONCURRENT) {
    const batch = unique.slice(i, i + MAX_CONCURRENT);
    await Promise.allSettled(
      batch.map((h) => fetchAndCacheOne(h.ticker, h.exchange))
    );
  }
}

const YAHOO_RANGES: Record<string, string> = {
  "1W": "5d",
  "1M": "1mo",
  "3M": "3mo",
  "1Y": "1y",
  "All": "5y",
};

export async function fetchHistoricalPrices(
  symbol: string,
  range: string
): Promise<PricePoint[]> {
  const yahooRange = YAHOO_RANGES[range] ?? "1mo";
  const url = yahooChartUrl(symbol, "1d", yahooRange);

  try {
    const res = await fetch(url, { headers: YAHOO_HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const result = data?.chart?.result?.[0];
    if (!result) throw new Error("No result");

    const timestamps: number[] = result.timestamp ?? [];
    const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];
    const currency: string = result.meta?.currency ?? "EUR";

    let fxRate = 1;
    if (currency !== "EUR") {
      const fxFrom = currency === "GBp" || currency === "GBX" ? "GBP" : currency;
      if (["GBP", "USD", "CHF"].includes(fxFrom)) {
        try {
          fxRate = await fetchFXRate(fxFrom, "EUR");
        } catch {
          // Use 1 as fallback
        }
      }
    }

    const points: PricePoint[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const price = closes[i];
      if (price == null || isNaN(price)) continue;

      const date = new Date(timestamps[i] * 1000).toISOString().split("T")[0];
      const priceEUR =
        currency === "GBp" || currency === "GBX"
          ? (price / 100) * fxRate
          : price * fxRate;

      points.push({ date, priceEUR });
    }

    return points;
  } catch (err) {
    console.warn(`[priceService] fetchHistoricalPrices failed for ${symbol}:`, err);
    return [];
  }
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
 * is enough to show the daily trend; the caller can fall back to Yahoo
 * for intraday resolution when more points are needed.
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

const YAHOO_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
  Accept: "application/json",
};

export async function searchTickers(query: string): Promise<SearchResult[]> {
  const url = yahooSearchUrl(query);
  try {
    const res = await fetch(url, { headers: YAHOO_HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return (data?.quotes ?? []).map((q: Record<string, string>) => ({
      symbol: q.symbol ?? "",
      shortName: q.shortname ?? q.longname ?? "",
      quoteType: q.quoteType ?? "EQUITY",
      exchange: q.exchange ?? "",
      exchDisp: q.exchDisp ?? "",
      typeDisp: q.typeDisp ?? "",
    }));
  } catch {
    return [];
  }
}

export async function resolveExchangeFromISIN(isin: string, ticker: string): Promise<string> {
  // Static overrides — highest priority, known correct listings
  const STATIC_OVERRIDES: Record<string, string> = {
    "VWCE": "XETRA",
    "VWRL": "XETRA",
    "IWDA": "EURONEXT_AMS",
    "VHYL": "EURONEXT_AMS",
    "TDIV": "EURONEXT_AMS",
    "EGLN": "LSE",
    "CSBGE7": "SIX",
    "ERNE": "LSE",
    "IEGE": "BORSA_IT",
    "VUSA": "LSE",
    "EQQQ": "XETRA",
    "VGOV": "LSE",
  };

  const upper = ticker.toUpperCase();
  if (STATIC_OVERRIDES[upper]) return STATIC_OVERRIDES[upper];

  // Try ticker-based Yahoo search (more reliable than ISIN search)
  try {
    const results = await searchTickers(ticker);
    if (results.length > 0) {
      const EXCHANGE_PRIORITY: Record<string, number> = {
        "GER": 1, "XET": 1,
        "AMS": 2, "PAR": 3,
        "MIL": 4, "EBS": 5,
        "LSE": 6, "BRU": 7,
      };
      const EXCHANGE_MAP: Record<string, string> = {
        "GER": "XETRA", "XET": "XETRA",
        "AMS": "EURONEXT_AMS", "PAR": "EURONEXT_PAR",
        "MIL": "BORSA_IT", "EBS": "SIX",
        "LSE": "LSE", "BRU": "EURONEXT_PAR",
      };
      const matching = results.filter(r =>
        r.symbol.toUpperCase().startsWith(upper)
      );
      const candidates = matching.length > 0 ? matching : results.slice(0, 3);
      const sorted = candidates.sort((a, b) =>
        (EXCHANGE_PRIORITY[a.exchange] ?? 99) - (EXCHANGE_PRIORITY[b.exchange] ?? 99)
      );
      const best = sorted[0];
      if (EXCHANGE_MAP[best.exchange]) return EXCHANGE_MAP[best.exchange];
      // Derive from symbol suffix
      const suffix = best.symbol.split(".").pop()?.toUpperCase() ?? "";
      const SUFFIX_MAP: Record<string, string> = {
        "DE": "XETRA", "AS": "EURONEXT_AMS", "PA": "EURONEXT_PAR",
        "MI": "BORSA_IT", "SW": "SIX", "L": "LSE",
      };
      if (SUFFIX_MAP[suffix]) return SUFFIX_MAP[suffix];
    }
  } catch {
    // fall through to ISIN-based fallback
  }

  // ISIN country fallback
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
    const inferredExchange = exchangeFromYahooSuffix(symbol);

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

function exchangeFromYahooSuffix(symbol: string): string | undefined {
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

export async function fetchDividendYield(ticker: string, exchange: string): Promise<number | null> {
  const symbol = buildYahooSymbol(ticker, exchange);
  const url = yahooChartUrl(symbol, "1d", "1y");
  try {
    const res = await fetch(url, { headers: YAHOO_HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) return null;
    // trailingAnnualDividendYield is a decimal (e.g. 0.034 = 3.4%)
    const yld: number | undefined = meta.trailingAnnualDividendYield;
    if (yld && yld > 0) return Math.round(yld * 10000) / 100; // convert to %
    return null;
  } catch {
    return null;
  }
}

export async function fetchChartHistory(symbol: string, range: string): Promise<ChartPoint[]> {
  const cfg = CHART_INTERVALS[range] ?? { interval: "1d", range: "1mo" };
  const url = yahooChartUrl(symbol, cfg.interval, cfg.range);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(url, { headers: YAHOO_HEADERS, signal: controller.signal })
      .finally(() => clearTimeout(timer));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return [];

    const timestamps: number[] = result.timestamp ?? [];
    const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];
    const currency: string = result.meta?.currency ?? "EUR";

    let fxRate = 1;
    if (currency !== "EUR") {
      const fxFrom = currency === "GBp" || currency === "GBX" ? "GBP" : currency;
      if (["GBP", "USD", "CHF"].includes(fxFrom)) {
        try { fxRate = await fetchFXRate(fxFrom, "EUR"); } catch { /* use 1 */ }
      }
    }

    const points: ChartPoint[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const price = closes[i];
      if (price == null || isNaN(price)) continue;
      const priceEUR =
        currency === "GBp" || currency === "GBX"
          ? (price / 100) * fxRate
          : price * fxRate;
      points.push({ timestamp: timestamps[i] * 1000, priceEUR });
    }
    return points;
  } catch (err) {
    console.warn(`[fetchChartHistory] failed for ${symbol}:`, err);
    return [];
  }
}

// ─── Period-based price change (canonical, used everywhere) ─────────────────

export interface PeriodReturn {
  changePct: number;
  changeAbs: number;
  startPriceEUR: number;
  endPriceEUR: number;
}

/**
 * Build a Yahoo Finance chart URL using explicit period1/period2 unix timestamps.
 * Used solely to fetch the historical start price for multi-period return calculations.
 */
function yahooChartUrlByPeriod(
  symbol: string,
  interval: string,
  period1: number,
  period2?: number
): string {
  const p2 = period2 ?? Math.floor(Date.now() / 1000);
  if (Platform.OS === "web") {
    const domain = process.env.EXPO_PUBLIC_DOMAIN ?? "";
    return `https://${domain}/api/yahoo/chart/${encodeURIComponent(symbol)}?interval=${interval}&period1=${period1}&period2=${p2}`;
  }
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&period1=${period1}&period2=${p2}`;
}

export async function fetchPeriodReturn(
  symbol: string,
  period: "1D" | "1W" | "1M" | "3M" | "6M" | "YTD" | "1Y" | "3Y" | "5Y" | "All",
  _opts?: { previousCloseEUR?: number; currentPriceEUR?: number }
): Promise<PeriodReturn | null> {
  // Premium ranges — caller shows upgrade lock
  if (period === "3Y" || period === "5Y" || period === "All") return null;

  const ticker = symbol.split(".")[0];
  const inferredExchange = exchangeFromYahooSuffix(symbol);

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
  const period1 = Math.floor(new Date(startDateString).getTime() / 1000);
  const period2 = Math.floor(Date.now() / 1000);

  const url = Platform.OS === "web"
    ? `https://${process.env.EXPO_PUBLIC_DOMAIN ?? ""}/api/yahoo/chart/${encodeURIComponent(ticker)}?interval=1d&period1=${period1}&period2=${period2}`
    : `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&period1=${period1}&period2=${period2}`;

  try {
    const res = await fetch(url, { headers: YAHOO_HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const closes: (number | null)[] =
      data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];

    let firstClose: number | null = null;
    for (const c of closes) {
      if (c != null && c > 0) { firstClose = c; break; }
    }

    let lastClose: number | null = null;
    for (let i = closes.length - 1; i >= 0; i--) {
      if (closes[i] != null && closes[i]! > 0) { lastClose = closes[i]; break; }
    }

    if (firstClose == null || lastClose == null) return null;
    return ((lastClose - firstClose) / firstClose) * 100;
  } catch (err) {
    console.warn(`[fetchBenchmarkReturn] ${ticker}:`, err);
    return null;
  }
}

export async function fetchSymbolPrice(
  fullSymbol: string
): Promise<{ price: number; changePct: number } | null> {
  const url = yahooChartUrl(fullSymbol, "1d", "2d");
  try {
    const res = await fetch(url, { headers: YAHOO_HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta?.regularMarketPrice) throw new Error("No price");

    const rawPrice: number = meta.regularMarketPrice;
    const rawPrev: number = meta.previousClose ?? meta.chartPreviousClose ?? rawPrice;
    const currency: string = meta.currency ?? "USD";

    let fxRate = 1;
    if (currency !== "EUR") {
      const fxFrom = currency === "GBp" || currency === "GBX" ? "GBP" : currency;
      if (["GBP", "USD", "CHF"].includes(fxFrom)) {
        try { fxRate = await fetchFXRate(fxFrom, "EUR"); } catch { /* use 1 */ }
      }
    }

    const toEUR = (p: number) =>
      currency === "GBp" || currency === "GBX" ? (p / 100) * fxRate : p * fxRate;

    const price = toEUR(rawPrice);
    const prev = toEUR(rawPrev);
    const changePct = prev !== 0 ? ((price - prev) / prev) * 100 : 0;
    return { price, changePct };
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
