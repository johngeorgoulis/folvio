import AsyncStorage from "@react-native-async-storage/async-storage";

const CACHE_PREFIX = "folvio_overlap_v1_";
const CACHE_TTL = 24 * 60 * 60 * 1000;

export interface TopHolding {
  name: string;
  weight: number;
}

export interface OverlapPair {
  etf1: string;
  etf2: string;
  overlapPct: number;
  sharedHoldings: string[];
  combinedPortfolioWeight: number;
}

export interface ConcentratedStock {
  name: string;
  etfCount: number;
  etfTickers: string[];
}

export interface OverlapResult {
  worstPair: OverlapPair | null;
  concentratedStocks: ConcentratedStock[];
  etfsChecked: number;
}

function getServerUrl(): string {
  const full = process.env.EXPO_PUBLIC_API_SERVER_URL;
  if (full) return full.replace(/\/$/, "");
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (domain) return `https://${domain}`;
  throw new Error("EXPO_PUBLIC_API_SERVER_URL is not configured");
}

async function getCachedTopHoldings(isin: string): Promise<TopHolding[] | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_PREFIX + isin);
    if (!raw) return null;
    const { data, timestamp } = JSON.parse(raw) as { data: TopHolding[]; timestamp: number };
    if (Date.now() - timestamp > CACHE_TTL) return null;
    return data;
  } catch {
    return null;
  }
}

async function setCachedTopHoldings(isin: string, data: TopHolding[]): Promise<void> {
  try {
    await AsyncStorage.setItem(
      CACHE_PREFIX + isin,
      JSON.stringify({ data, timestamp: Date.now() })
    );
  } catch {}
}

async function fetchTopHoldings(isin: string): Promise<TopHolding[]> {
  const cached = await getCachedTopHoldings(isin);
  if (cached !== null) return cached;

  try {
    const serverUrl = getServerUrl();
    const res = await fetch(`${serverUrl}/api/etf/top-holdings/${encodeURIComponent(isin)}`);
    if (!res.ok) {
      await setCachedTopHoldings(isin, []);
      return [];
    }
    const json = (await res.json()) as { topHoldings?: TopHolding[] };
    const result = Array.isArray(json.topHoldings) ? json.topHoldings : [];
    await setCachedTopHoldings(isin, result);
    return result;
  } catch {
    await setCachedTopHoldings(isin, []);
    return [];
  }
}

function normalize(name: string): string {
  return name.toLowerCase().replace(/[.,\s]+/g, " ").trim();
}

export async function detectOverlap(
  holdings: Array<{
    ticker: string;
    isin: string;
    quantity: number;
    currentPrice: number;
    hasPrice: boolean;
  }>
): Promise<OverlapResult> {
  const priced = holdings.filter(
    h => h.hasPrice && h.currentPrice > 0 && h.quantity > 0 && h.isin
  );

  if (priced.length < 2) {
    return { worstPair: null, concentratedStocks: [], etfsChecked: 0 };
  }

  const totalValue = priced.reduce((s, h) => s + h.quantity * h.currentPrice, 0);
  const portfolioWeight = (h: typeof priced[0]) =>
    totalValue > 0 ? (h.quantity * h.currentPrice / totalValue) * 100 : 0;

  // Fetch all top-10 lists in parallel
  const fetched = await Promise.all(
    priced.map(async h => ({
      ticker: h.ticker,
      isin: h.isin,
      weight: portfolioWeight(h),
      holdings: await fetchTopHoldings(h.isin),
    }))
  );

  const withData = fetched.filter(f => f.holdings.length > 0);

  if (withData.length < 2) {
    return { worstPair: null, concentratedStocks: [], etfsChecked: withData.length };
  }

  // Find the worst-overlapping pair
  let worstPair: OverlapPair | null = null;

  for (let i = 0; i < withData.length; i++) {
    for (let j = i + 1; j < withData.length; j++) {
      const a = withData[i];
      const b = withData[j];

      const setA = new Set(a.holdings.map(h => normalize(h.name)));
      const setB = new Set(b.holdings.map(h => normalize(h.name)));

      const sharedNormalized = [...setA].filter(n => setB.has(n));
      const avgSize = (a.holdings.length + b.holdings.length) / 2;
      const overlapPct = (sharedNormalized.length / avgSize) * 100;

      if (overlapPct > (worstPair?.overlapPct ?? 0)) {
        const sharedHoldings = a.holdings
          .filter(h => setB.has(normalize(h.name)))
          .map(h => h.name);

        worstPair = {
          etf1: a.ticker,
          etf2: b.ticker,
          overlapPct,
          sharedHoldings,
          combinedPortfolioWeight: a.weight + b.weight,
        };
      }
    }
  }

  // Find stocks appearing in 3+ ETFs
  const stockToTickers = new Map<string, { original: string; tickers: string[] }>();
  for (const etf of withData) {
    for (const h of etf.holdings) {
      const key = normalize(h.name);
      if (!stockToTickers.has(key)) {
        stockToTickers.set(key, { original: h.name, tickers: [] });
      }
      stockToTickers.get(key)!.tickers.push(etf.ticker);
    }
  }

  const concentratedStocks: ConcentratedStock[] = [];
  for (const { original, tickers } of stockToTickers.values()) {
    if (tickers.length >= 3) {
      concentratedStocks.push({ name: original, etfCount: tickers.length, etfTickers: tickers });
    }
  }
  concentratedStocks.sort((a, b) => b.etfCount - a.etfCount);

  return { worstPair, concentratedStocks, etfsChecked: withData.length };
}
