import { upsertPrice, getPrice as dbGetPrice } from "@/services/db";
import type { HoldingRow } from "@/services/db";

export const EXCHANGE_SUFFIXES: Record<string, string> = {
  "XETRA": ".DE",
  "Euronext Paris": ".PA",
  "Euronext Amsterdam": ".AS",
  "Euronext": ".PA",
  "LSE": ".L",
  "Borsa Italiana": ".MI",
  "SIX Swiss": ".SW",
  "SIX": ".SW",
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
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=2d`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        Accept: "application/json",
      },
    });
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
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=${yahooRange}`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        Accept: "application/json",
      },
    });
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

export async function testPriceFetch(): Promise<void> {
  console.log("[testPriceFetch] Fetching VWCE.DE...");
  const result = await fetchLivePrice("VWCE", "XETRA");
  if (result) {
    console.log("[testPriceFetch] Success:", JSON.stringify(result, null, 2));
  } else {
    console.log("[testPriceFetch] Failed to fetch price for VWCE.DE");
  }
}
