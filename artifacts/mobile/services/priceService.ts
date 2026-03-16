import { Platform } from "react-native";
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
  "XETRA": ".DE",
  "EURONEXT_AMS": ".AS",
  "EURONEXT_PAR": ".PA",
  "LSE": ".L",
  "BORSA_IT": ".MI",
  "SIX": ".SW",
  "Euronext Paris": ".PA",
  "Euronext Amsterdam": ".AS",
  "Euronext": ".PA",
  "Borsa Italiana": ".MI",
  "SIX Swiss": ".SW",
  "Other": "",
};

const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_CONCURRENT = 5;

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
  const symbol = buildYahooSymbol(ticker, exchange);
  const url = yahooChartUrl(symbol, "1d", "2d");

  try {
    const res = await fetch(url, { headers: YAHOO_HEADERS });
    if (!res.ok) throw new Error(`Yahoo Finance ${res.status} for ${symbol}`);
    const data = await res.json();

    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta?.regularMarketPrice) throw new Error(`No price in response for ${symbol}`);

    const rawPrice: number = meta.regularMarketPrice;
    const currency: string = meta.currency;

    const fxRates: Record<string, number> = {};
    if (currency !== "EUR") {
      const fxFrom =
        currency === "GBp" || currency === "GBX" ? "GBP" : currency;
      if (["GBP", "USD", "CHF"].includes(fxFrom)) {
        fxRates[fxFrom] = await fetchFXRate(fxFrom, "EUR");
      }
    }

    const priceEUR = normalizeToEUR(rawPrice, currency, fxRates);
    const now = new Date().toISOString();

    console.log(`[priceService] ${symbol}: ${rawPrice} ${currency} → ${priceEUR.toFixed(4)} EUR`);

    return {
      ticker,
      priceEUR,
      currency,
      source: "api",
      lastFetched: now,
      isStale: false,
    };
  } catch (err) {
    console.warn(`[priceService] fetchLivePrice failed for ${ticker} (${symbol}):`, err);
    return null;
  }
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
  "1Y":  { interval: "1wk", range: "1y"  },
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

export async function fetchTickerMeta(symbol: string): Promise<TickerMeta | null> {
  const url = yahooChartUrl(symbol, "1d", "1y");
  try {
    const res = await fetch(url, { headers: YAHOO_HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) throw new Error("No result");

    const meta = result.meta ?? {};
    const currency: string = meta.currency ?? "EUR";

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

    const rawPrice: number = meta.regularMarketPrice ?? 0;
    const rawPrev: number = meta.previousClose ?? meta.chartPreviousClose ?? rawPrice;
    const priceEUR = toEUR(rawPrice);
    const prevEUR = toEUR(rawPrev);
    const change = priceEUR - prevEUR;
    const changePct = prevEUR !== 0 ? (change / prevEUR) * 100 : 0;

    return {
      symbol: meta.symbol ?? symbol,
      shortName: meta.shortName ?? symbol,
      longName: meta.longName ?? meta.shortName ?? symbol,
      currency,
      exchangeName: meta.fullExchangeName ?? meta.exchangeName ?? "",
      quoteType: meta.instrumentType ?? "EQUITY",
      regularMarketPrice: priceEUR,
      previousClose: prevEUR,
      regularMarketChange: change,
      regularMarketChangePercent: changePct,
      fiftyTwoWeekHigh: toEUR(meta.fiftyTwoWeekHigh),
      fiftyTwoWeekLow: toEUR(meta.fiftyTwoWeekLow),
      regularMarketVolume: meta.regularMarketVolume ?? 0,
      averageDailyVolume3Month: meta.averageDailyVolume3Month ?? 0,
      totalAssets: undefined,
      trailingAnnualDividendYield: undefined,
      marketCap: undefined,
      trailingPE: undefined,
    };
  } catch (err) {
    console.warn(`[fetchTickerMeta] failed for ${symbol}:`, err);
    return null;
  }
}

export async function fetchChartHistory(symbol: string, range: string): Promise<ChartPoint[]> {
  const cfg = CHART_INTERVALS[range] ?? { interval: "1d", range: "1mo" };
  const url = yahooChartUrl(symbol, cfg.interval, cfg.range);
  try {
    const res = await fetch(url, { headers: YAHOO_HEADERS });
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

export async function testPriceFetch(): Promise<void> {
  console.log("[testPriceFetch] Fetching VWCE.DE...");
  const result = await fetchLivePrice("VWCE", "XETRA");
  if (result) {
    console.log("[testPriceFetch] Success:", JSON.stringify(result, null, 2));
  } else {
    console.log("[testPriceFetch] Failed to fetch price for VWCE.DE");
  }
}
