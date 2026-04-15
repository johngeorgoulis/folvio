import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { upsertPrice, getPrice as dbGetPrice } from "@/services/db";
import type { HoldingRow } from "@/services/db";
import { lookupByTicker, initETFDatabase } from "@/services/etfDatabaseService";

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

// ─── FMP Data Source ──────────────────────────────────────────────────────────
// Two modes depending on platform and env:
//
//   WEB / native-with-server:
//     EXPO_PUBLIC_DOMAIN is set → route through the API proxy so the key is
//     kept server-side.  URL: https://<domain>/api/fmp/profile/<symbol>
//
//   NATIVE without server (EAS preview / production builds):
//     EXPO_PUBLIC_DOMAIN is NOT set → call FMP /stable directly using the
//     EXPO_PUBLIC_FMP_API_KEY build secret (set in eas.json env or EAS Secrets).
//     URL: https://financialmodelingprep.com/stable/profile?symbol=<symbol>&apikey=<key>
//
// eas.json env to add: "EXPO_PUBLIC_FMP_API_KEY": "<your-key>"

const FMP_DIRECT_BASE = "https://financialmodelingprep.com/stable";

function fmpUrl(path: string): string {
  const domain = process.env.EXPO_PUBLIC_DOMAIN ?? "";
  if (domain) {
    // Proxy path: keep API key server-side
    return `https://${domain}/api/fmp/${path}`;
  }
  // Direct path: extract symbol from path like "profile/VWCE.DE"
  // and rebuild as /stable/profile?symbol=VWCE.DE&apikey=<key>
  const apiKey = process.env.EXPO_PUBLIC_FMP_API_KEY ?? "";
  const [endpoint, symbol] = path.split("/");
  if (symbol) {
    return `${FMP_DIRECT_BASE}/${endpoint}?symbol=${encodeURIComponent(decodeURIComponent(symbol))}&apikey=${apiKey}`;
  }
  return `${FMP_DIRECT_BASE}/${path}?apikey=${apiKey}`;
}

const FMP_FETCH_OPTS = { headers: { Accept: "application/json" } };

/**
 * FMP /stable/profile response shape.
 * This is the primary data source: works for all symbols including European ETFs.
 * `range` is a "yearLow-yearHigh" string, e.g. "107.9-151.36".
 * `previousClose` is not returned directly; compute it as `price - change`.
 */
interface FMPProfileData {
  symbol: string;
  companyName: string;
  price: number;
  change: number;
  changePercentage: number;
  volume: number;
  averageVolume: number;
  marketCap: number | null;
  currency: string;
  exchange: string;
  exchangeFullName: string;
  range: string;            // "yearLow-yearHigh"
  isin: string | null;
  isEtf: boolean;
  isFund: boolean;
  ipoDate: string | null;
}

/**
 * Infer the native currency from the Yahoo-style symbol suffix.
 * Accurate for all UCITS ETFs; avoids an extra network round-trip.
 * NOTE: this is used only when FMP itself returns no `currency` field.
 */
function symbolCurrency(symbol: string): string {
  if (symbol.endsWith(".L")) return "GBP";
  if (symbol.endsWith(".SW")) return "CHF";
  return "EUR"; // .DE .AS .PA .MI → always EUR
}

/** Parse FMP's "yearLow-yearHigh" range string into numeric parts. */
function parseRange(range: string | undefined): { yearLow: number; yearHigh: number } {
  if (!range || typeof range !== "string") return { yearLow: 0, yearHigh: 0 };
  // Format: "107.9-151.36"  (dash separator; prices are always positive)
  const dash = range.lastIndexOf("-");
  if (dash <= 0) return { yearLow: 0, yearHigh: 0 };
  const low  = Number(range.slice(0, dash).trim());
  const high = Number(range.slice(dash + 1).trim());
  if (isNaN(low) || isNaN(high)) return { yearLow: 0, yearHigh: 0 };
  return { yearLow: low, yearHigh: high };
}

// ─── FMP Symbol resolution ────────────────────────────────────────────────────
//
// FMP uses Yahoo Finance–style exchange suffixes for European ETFs:
//   .DE (XETRA)  .AS (Euronext Amsterdam)  .PA (Euronext Paris)
//   .L  (LSE)    .SW (SIX Swiss)           .MI (Borsa Italiana)
//
// The ".AMS", ".XETR", ".PAR", ".MIL" formats were tested and do NOT work in
// FMP's /stable API. Yahoo-style suffixes are the correct primary format.
//
// However, FMP has uneven ETF coverage across European exchanges.  A UCITS ETF
// listed on XETRA may only appear in FMP under its Amsterdam or London listing
// (and vice-versa).  The fallback table below encodes cross-listing order for
// every EU exchange so a single failed lookup automatically retries the other
// venues before giving up.
//
// Fallback order per exchange (most → least reliable FMP coverage):
const FMP_EXCHANGE_FALLBACKS: Partial<Record<string, string[]>> = {
  ".DE": [".AS", ".L", ".PA"],
  ".AS": [".L", ".DE", ".PA"],
  ".PA": [".DE", ".AS", ".L"],
  ".L":  [".DE", ".AS", ".PA", ".SW"],
  ".MI": [".L", ".DE", ".AS", ".PA"],
  ".SW": [".DE", ".AS", ".L"],
  // Smaller exchanges fall back to main EU hubs
  ".BR": [".DE", ".AS", ".PA", ".L"],
  ".MC": [".DE", ".AS", ".PA", ".L"],
  ".HE": [".DE", ".AS", ".L", ".PA"],
  ".ST": [".DE", ".AS", ".L", ".PA"],
  ".OL": [".DE", ".AS", ".L", ".PA"],
  ".CO": [".DE", ".AS", ".L", ".PA"],
};

// Per-ticker overrides for ETFs whose cross-listed symbols differ from the
// primary ticker (iShares often uses different tickers on different exchanges).
// Each entry is the full ordered list of symbols to try, most-likely first.
// These are checked BEFORE the generic suffix-swap fallback.
const FMP_TICKER_OVERRIDES: Record<string, string[]> = {
  // iShares Euro Govt Bond 0-1yr (IE00B3FH7618) — LSE ticker differs from MI/AS
  "IEGE":   ["IEGE.MI", "IEGE.L", "IEGE.DE", "IEGE.AS", "IBGS.L", "IEGE"],
  // iShares Euro Govt Bond 3-7yr (IE00B3VTML14) — SIX ticker, try all exchanges
  "CSBGE7": ["CSBGE7.SW", "CSBGE7.DE", "CSBGE7.AS", "CSBGE7.L", "IBGM.L", "CSBGE7"],
};

/** Low-level: fetch a single FMP profile by exact symbol. Returns null if not found. */
async function fmpFetchProfileSingle(symbol: string): Promise<FMPProfileData | null> {
  const url = fmpUrl(`profile/${encodeURIComponent(symbol)}`);
  const keyPreview = (process.env.EXPO_PUBLIC_FMP_API_KEY ?? "").slice(0, 4) || "(not set)";
  console.log(`[fmp:debug] fmpFetchProfileSingle(${symbol}) url=${url} key=${keyPreview}***`);
  try {
    const res = await fetch(url, FMP_FETCH_OPTS);
    console.log(`[fmp:debug] ${symbol} HTTP ${res.status} ok=${res.ok}`);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`[fmp:debug] ${symbol} non-OK body:`, body.slice(0, 300));
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json();
    console.log(`[fmp:debug] ${symbol} raw response:`, JSON.stringify(data).slice(0, 400));
    // /stable/profile returns an array [{...}]; handle single-object defensively
    const profile: FMPProfileData = Array.isArray(data) ? data[0] : data;
    if (!profile?.price) {
      console.warn(`[fmp:debug] ${symbol} → null (no price). profile keys:`, profile ? Object.keys(profile) : "null/undefined");
      return null;
    }
    console.log(`[fmp:debug] ${symbol} → price=${profile.price} currency=${profile.currency}`);
    return profile;
  } catch (err) {
    console.error(`[fmp:debug] ${symbol} caught error:`, err);
    return null;
  }
}

/**
 * Fetch the FMP /stable/profile for any symbol, with automatic fallback to
 * cross-listed exchanges when the primary symbol returns no data.
 *
 * Five-tier fallback strategy:
 *   0. Ticker override: FMP_TICKER_OVERRIDES lists explicit symbol variants for
 *      ETFs where cross-listed tickers differ (e.g. IEGE.MI vs IBGS.L)
 *   1. Primary: try symbol as-is (Yahoo-style suffix = correct FMP format)
 *   2. Exchange swap: all European suffixes have cross-listing fallbacks
 *      (e.g. VWCE.DE → tries .AS → .L → .PA before giving up)
 *   3. Bare ticker: for suffixed symbols, try the ticker without any suffix
 *      (some ETFs are indexed by FMP without an exchange code)
 *   4. Suffix probe: for bare tickers (no suffix stored), probe all EU venues
 */
async function fmpFetchProfile(symbol: string): Promise<FMPProfileData | null> {
  // 0. Per-ticker override — explicit symbol list for ETFs with divergent tickers
  const baseTicker = symbol.replace(/\.[A-Z0-9]+$/, "");
  const overrides = FMP_TICKER_OVERRIDES[baseTicker];
  if (overrides) {
    for (const s of overrides) {
      const result = await fmpFetchProfileSingle(s);
      if (result) {
        console.log(`[fmp] ${symbol} → resolved via ticker override ${s} (${result.currency})`);
        return result;
      }
    }
    // Overrides exhausted — skip generic fallback to avoid duplicate requests
    console.warn(`[fmp] profile not found for ${symbol} (tried all ticker overrides)`);
    return null;
  }

  // 1. Primary: try the symbol as-is
  const primary = await fmpFetchProfileSingle(symbol);
  if (primary) return primary;

  const suffixMatch = symbol.match(/(\.[A-Z0-9]+$)/);

  if (suffixMatch) {
    const suffix    = suffixMatch[1];
    const base      = symbol.slice(0, -suffix.length);

    // 2. Exchange swap — try every cross-listed venue for this exchange
    const fallbacks = FMP_EXCHANGE_FALLBACKS[suffix];
    if (fallbacks) {
      for (const alt of fallbacks) {
        const result = await fmpFetchProfileSingle(base + alt);
        if (result) {
          console.log(`[fmp] ${symbol} → no data; resolved via ${base + alt} (${result.currency})`);
          return result;
        }
      }
    }

    // 3. Bare ticker — some ETFs are in FMP without an exchange suffix
    const bareResult = await fmpFetchProfileSingle(base);
    if (bareResult) {
      console.log(`[fmp] ${symbol} → resolved via bare ticker ${base} (${bareResult.currency})`);
      return bareResult;
    }
  } else {
    // 4. Bare ticker (no exchange suffix stored) — probe all EU/UK venues
    const suffixOrder = [".DE", ".AS", ".PA", ".L", ".MI", ".SW"];
    for (const alt of suffixOrder) {
      const result = await fmpFetchProfileSingle(symbol + alt);
      if (result) {
        console.log(`[fmp] bare ticker ${symbol} resolved via ${symbol + alt} (${result.currency})`);
        return result;
      }
    }
  }

  console.warn(`[fmp] profile not found for ${symbol} (tried all fallbacks)`);
  return null;
}

// ─── Symbol Resolution Cache ──────────────────────────────────────────────────
// AsyncStorage cache mapping bare ticker → the FMP symbol that last succeeded
// (e.g. "VHYL" → "VHYL.AS"). This lets subsequent fetches skip the waterfall.
const SYMBOL_CACHE_PREFIX = "folvio_sym_";

async function getResolvedSymbol(ticker: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(SYMBOL_CACHE_PREFIX + ticker.toUpperCase());
  } catch {
    return null;
  }
}

async function setResolvedSymbol(ticker: string, symbol: string): Promise<void> {
  try {
    await AsyncStorage.setItem(SYMBOL_CACHE_PREFIX + ticker.toUpperCase(), symbol);
  } catch {
    // Ignore storage errors — cache is best-effort
  }
}

// ─── ISIN Lookup via FMP Search ───────────────────────────────────────────────
// Last-resort fallback when all exchange-suffix attempts fail.
// Only works for native (direct FMP) — web proxy doesn't expose a search route.
async function fmpSearchByISIN(isin: string): Promise<FMPProfileData | null> {
  const domain = process.env.EXPO_PUBLIC_DOMAIN ?? "";
  const apiKey = process.env.EXPO_PUBLIC_FMP_API_KEY ?? "";
  // Skip for web proxy mode (no /api/fmp/search proxy route) and when no key
  if (domain || !apiKey) return null;

  const url = `${FMP_DIRECT_BASE}/search?query=${encodeURIComponent(isin)}&apikey=${apiKey}`;
  try {
    const res = await fetch(url, FMP_FETCH_OPTS);
    if (!res.ok) return null;
    const results: Array<{ symbol?: string }> = await res.json();
    if (!Array.isArray(results) || results.length === 0) return null;

    // Prefer EU exchange suffixes (most reliable coverage)
    const EU_ORDER = [".DE", ".AS", ".PA", ".L", ".MI", ".SW", ".BR", ".MC", ".HE", ".ST", ".OL", ".CO"];
    const sorted = [...results].sort((a, b) => {
      const ai = EU_ORDER.findIndex(s => (a.symbol ?? "").endsWith(s));
      const bi = EU_ORDER.findIndex(s => (b.symbol ?? "").endsWith(s));
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

    for (const r of sorted.slice(0, 6)) {
      if (!r.symbol) continue;
      const profile = await fmpFetchProfileSingle(r.symbol);
      if (profile) {
        console.log(`[fmp] ISIN ${isin} → resolved via FMP search: ${r.symbol}`);
        return profile;
      }
    }
  } catch (err) {
    console.warn(`[fmp] fmpSearchByISIN failed for ${isin}:`, err);
  }
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
    case "EUR":
      return price;
    case "GBp":
    case "GBX":
      return (price / 100) * (fxRates["GBP"] ?? 1);
    case "GBP":
      return price * (fxRates["GBP"] ?? 1);
    case "USD":
      return price * (fxRates["USD"] ?? 1);
    case "CHF":
      return price * (fxRates["CHF"] ?? 1);
    default:
      console.warn(`[priceService] Unknown currency: ${currency}`);
      return price;
  }
}

export async function fetchLivePrice(
  ticker: string,
  exchange: string
): Promise<PriceResult | null> {
  let profile: FMPProfileData | null = null;

  // ── Step 1: Try the cached winning symbol first (skip waterfall) ─────────
  const cachedSymbol = await getResolvedSymbol(ticker);
  if (cachedSymbol) {
    profile = await fmpFetchProfileSingle(cachedSymbol);
    if (profile) {
      console.log(`[fmp] ${ticker} → cache hit: ${cachedSymbol}`);
    }
  }

  // ── Step 2: Full waterfall (primary symbol → exchange swaps → bare → probe) ─
  if (!profile) {
    const primarySymbol = buildYahooSymbol(ticker, exchange);
    profile = await fmpFetchProfile(primarySymbol);

    // ── Step 3: ISIN lookup via FMP search (last resort) ─────────────────
    if (!profile) {
      try {
        await initETFDatabase();
        const etfEntry = lookupByTicker(ticker);
        if (etfEntry?.isin) {
          profile = await fmpSearchByISIN(etfEntry.isin);
        }
      } catch {
        // ignore — ISIN lookup is best-effort
      }
    }

    // Cache the winning symbol so we skip the waterfall next time
    if (profile?.symbol) {
      await setResolvedSymbol(ticker, profile.symbol);
    }
  }

  if (!profile?.price) {
    console.warn(`[fmp] fetchLivePrice: no price found for ${ticker}`);
    return null;
  }

  const usedSymbol = profile.symbol ?? buildYahooSymbol(ticker, exchange);
  const currency = profile.currency ?? symbolCurrency(usedSymbol);
  let fxRate = 1;
  if (currency !== "EUR") {
    const fxFrom = currency === "GBp" || currency === "GBX" ? "GBP" : currency;
    if (["GBP", "USD", "CHF"].includes(fxFrom)) {
      fxRate = await fetchFXRate(fxFrom, "EUR");
    }
  }
  const priceEUR = normalizeToEUR(profile.price, currency, { [currency]: fxRate });
  console.log(`[fmp] ${ticker} (${usedSymbol}): ${profile.price} ${currency} → ${priceEUR.toFixed(4)} EUR`);

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
  "1Y":  { interval: "1d",  range: "1y"  },
  "All": { interval: "1mo", range: "5y"  },
};

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
    // Single call to FMP /stable/profile — includes price, change, currency, ISIN, isEtf
    const profile = await fmpFetchProfile(symbol);

    if (!profile?.price) {
      console.warn(`[fmp] fetchTickerMeta: no profile for ${symbol}`);
      return null;
    }

    const currency = profile.currency ?? symbolCurrency(symbol);
    let fxRate = 1;
    if (currency !== "EUR") {
      const fxFrom = currency === "GBp" || currency === "GBX" ? "GBP" : currency;
      if (["GBP", "USD", "CHF"].includes(fxFrom)) {
        try { fxRate = await fetchFXRate(fxFrom, "EUR"); } catch { /* use 1 */ }
      }
    }
    const toEUR = (price: number | undefined): number => {
      if (price == null || isNaN(price)) return 0;
      if (currency === "GBp" || currency === "GBX") return (price / 100) * fxRate;
      return price * fxRate;
    };

    const priceEUR   = toEUR(profile.price);
    const changeEUR  = toEUR(profile.change);     // change from previous close (in EUR)
    const prevEUR    = priceEUR - changeEUR;
    // FMP changePercentage is in %, e.g. 1.00531 → +1.005%
    const changePct  = profile.changePercentage ?? (prevEUR !== 0 ? (changeEUR / prevEUR) * 100 : 0);

    const { yearLow, yearHigh } = parseRange(profile.range);
    const isEtf = profile.isEtf ?? profile.isFund ?? false;

    return {
      symbol:       profile.symbol ?? symbol,
      shortName:    profile.companyName ?? symbol,
      longName:     profile.companyName ?? symbol,
      currency,
      exchangeName: profile.exchangeFullName ?? profile.exchange ?? "",
      quoteType:    isEtf ? "ETF" : "EQUITY",
      regularMarketPrice:         priceEUR,
      previousClose:              prevEUR,
      regularMarketChange:        changeEUR,
      regularMarketChangePercent: changePct,
      fiftyTwoWeekHigh:           toEUR(yearHigh),
      fiftyTwoWeekLow:            toEUR(yearLow),
      regularMarketVolume:        profile.volume        ?? 0,
      averageDailyVolume3Month:   profile.averageVolume ?? 0,
      totalAssets:                undefined,
      trailingAnnualDividendYield: undefined,
      marketCap:    profile.marketCap != null ? toEUR(profile.marketCap) : undefined,
      trailingPE:   undefined,
      isin:  (typeof profile.isin === "string" && profile.isin.length >= 12)
               ? profile.isin.substring(0, 12) : null,
    };
  } catch (err) {
    console.warn(`[fmp] fetchTickerMeta failed for ${symbol}:`, err);
    return null;
  }
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
  period: "1D" | "1W" | "1M" | "3M" | "6M" | "1Y" | "All",
  _opts?: { previousCloseEUR?: number; currentPriceEUR?: number }
): Promise<PeriodReturn | null> {

  // ── 1D ───────────────────────────────────────────────────────────────────
  // FMP profile includes `change` (from previous close) and `changePercentage`.
  // previousClose = price - change; no historical fetch needed.
  if (period === "1D") {
    try {
      const profile = await fmpFetchProfile(symbol);
      if (!profile?.price) return null;

      const currency = profile.currency ?? symbolCurrency(symbol);
      let fxRate = 1;
      if (currency !== "EUR") {
        const fxFrom = currency === "GBp" || currency === "GBX" ? "GBP" : currency;
        if (["GBP", "USD", "CHF"].includes(fxFrom)) {
          try { fxRate = await fetchFXRate(fxFrom, "EUR"); } catch { /* use 1 */ }
        }
      }
      const toEUR = (p: number) =>
        currency === "GBp" || currency === "GBX" ? (p / 100) * fxRate : p * fxRate;

      const endPriceEUR   = toEUR(profile.price);
      const changeEUR     = toEUR(profile.change);
      const startPriceEUR = endPriceEUR - changeEUR;        // previousClose
      if (startPriceEUR === 0) return null;
      const changePct = profile.changePercentage ??
        (startPriceEUR !== 0 ? (changeEUR / startPriceEUR) * 100 : 0);
      return { changePct, changeAbs: changeEUR, startPriceEUR, endPriceEUR };
    } catch (err) {
      console.warn(`[fmp] fetchPeriodReturn 1D failed for ${symbol}:`, err);
      return null;
    }
  }

  // ── 1W / 1M / 3M / 6M / 1Y / All ────────────────────────────────────────
  // Strategy: FMP profile for the live end price (accurate), Yahoo historical
  // for the start price (period1 forward-rolls to the first trading day).
  const PERIOD_CALENDAR_DAYS: Partial<Record<string, number>> = {
    "1W": 7, "1M": 30, "3M": 91, "6M": 182, "1Y": 365,
  };
  const calendarDays = PERIOD_CALENDAR_DAYS[period];
  const period1Unix = period === "All"
    ? 0
    : calendarDays != null
      ? Math.floor((Date.now() - calendarDays * 86_400_000) / 1000)
      : null;
  if (period1Unix === null) return null;

  const yahooUrl = yahooChartUrlByPeriod(symbol, "1d", period1Unix);

  try {
    // Check FMP first — bail before Yahoo if no live price data exists for this symbol.
    // This avoids hanging on Yahoo when FMP has no coverage (e.g. ERNE.L on LSE).
    const profile = await fmpFetchProfile(symbol);
    if (!profile?.price) return null;

    // FMP has data — fetch Yahoo historical with a 10s timeout so a blocked/slow
    // Yahoo response never permanently freezes the loading spinner.
    const yController = new AbortController();
    const yTimer = setTimeout(() => yController.abort(), 10_000);
    const yRes = await fetch(yahooUrl, { headers: YAHOO_HEADERS, signal: yController.signal })
      .finally(() => clearTimeout(yTimer));
    if (!yRes.ok) throw new Error(`Yahoo ${yRes.status}`);

    const yData = await yRes.json();
    const yResult = yData?.chart?.result?.[0];
    if (!yResult) return null;

    const currency = profile.currency ?? symbolCurrency(symbol);
    let fxRate = 1;
    if (currency !== "EUR") {
      const fxFrom = currency === "GBp" || currency === "GBX" ? "GBP" : currency;
      if (["GBP", "USD", "CHF"].includes(fxFrom)) {
        try { fxRate = await fetchFXRate(fxFrom, "EUR"); } catch { /* use 1 */ }
      }
    }
    const toEUR = (p: number) =>
      currency === "GBp" || currency === "GBX" ? (p / 100) * fxRate : p * fxRate;

    const rawCloses: (number | null)[] =
      yResult.indicators?.quote?.[0]?.close ?? [];
    const closesEUR = rawCloses
      .filter((c): c is number => c != null && c > 0)
      .map(toEUR);

    if (closesEUR.length < 1) return null;
    const startPriceEUR = closesEUR[0];           // first trading day on/after period1
    const endPriceEUR   = toEUR(profile.price);   // live price from FMP

    if (startPriceEUR === 0) return null;
    const changeAbs = endPriceEUR - startPriceEUR;
    const changePct = (changeAbs / startPriceEUR) * 100;
    return { changePct, changeAbs, startPriceEUR, endPriceEUR };
  } catch (err) {
    console.warn(`[fmp] fetchPeriodReturn ${period} failed for ${symbol}:`, err);
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
