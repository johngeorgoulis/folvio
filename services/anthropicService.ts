import AsyncStorage from "@react-native-async-storage/async-storage";
import { getAssetClass } from "@/services/assetClassService";
import { getInvestorProfile } from "@/services/db";

const CACHE_KEY = "folvio_ai_insights";
const CACHE_TTL = 24 * 60 * 60 * 1000;

export interface AIInsight {
  title: string;
  body: string;
  type: "neutral" | "positive" | "warning";
}

interface CachedInsights {
  insights: AIInsight[];
  timestamp: number;
}

const ETF_TER: Record<string, number> = {
  VWCE: 0.22,
  TDIV: 0.38,
  VHYL: 0.29,
  ERNE: 0.25,
  IEGE: 0.12,
  VUAA: 0.07,
  IWDA: 0.20,
  CSBGE7: 0.07,
  AGGH: 0.10,
  IEAG: 0.10,
  EGLN: 0.19,
};

function getServerUrl(): string {
  const full = process.env.EXPO_PUBLIC_API_SERVER_URL;
  if (full) return full.replace(/\/$/, "");
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (domain) return `https://${domain}`;
  throw new Error("EXPO_PUBLIC_API_SERVER_URL is not configured");
}

export async function generatePortfolioInsights(
  holdings: Array<{
    ticker: string;
    isin?: string | null;
    quantity: number;
    currentPrice: number;
    avg_cost_eur: number;
    hasPrice: boolean;
    yield_pct?: number | null;
    purchase_date?: string | null;
  }>,
  totalPortfolioValue: number,
  dcaAmount: number
): Promise<AIInsight[]> {
  const serverUrl = getServerUrl();

  const priced = holdings.filter(h => h.hasPrice && h.currentPrice > 0 && h.quantity > 0);

  let equityPct = 0, bondPct = 0, commodityPct = 0, weightedTER = 0;

  const holdingsSummary = priced.map(h => {
    const value = h.quantity * h.currentPrice;
    const weight = totalPortfolioValue > 0 ? (value / totalPortfolioValue) * 100 : 0;
    const assetClass = getAssetClass(h.ticker, h.isin ?? undefined);
    const ter = ETF_TER[h.ticker.toUpperCase()] ?? 0.20;
    const returnSincePurchase = h.avg_cost_eur > 0
      ? ((h.currentPrice - h.avg_cost_eur) / h.avg_cost_eur) * 100
      : 0;

    if (assetClass === "Equity") equityPct += weight;
    else if (assetClass === "Bond") bondPct += weight;
    else if (assetClass === "Commodity") commodityPct += weight;
    weightedTER += (weight / 100) * ter;

    return {
      ticker: h.ticker,
      weight: weight.toFixed(1) + "%",
      assetClass,
      ter: ter.toFixed(2) + "%",
      returnSincePurchase: returnSincePurchase.toFixed(1) + "%",
      yieldPct: h.yield_pct != null ? h.yield_pct.toFixed(2) + "%" : null,
    };
  });

  const dates = holdings.map(h => h.purchase_date).filter(Boolean).sort();
  const timeInMarketMonths = dates.length > 0
    ? Math.floor((Date.now() - new Date(dates[0]!).getTime()) / (1000 * 60 * 60 * 24 * 30.44))
    : 0;

  const portfolioContext = {
    totalValueEUR: Math.round(totalPortfolioValue),
    timeInMarketMonths,
    holdings: holdingsSummary,
    assetMix: {
      equity: equityPct.toFixed(1) + "%",
      bond: bondPct.toFixed(1) + "%",
      commodity: commodityPct.toFixed(1) + "%",
    },
    weightedAverageTER: weightedTER.toFixed(3) + "%",
    dcaMonthlyEUR: dcaAmount,
  };

  const investorProfile = await getInvestorProfile().catch(() => null);

  console.log("[Anthropic] calling server:", `${serverUrl}/api/insights`);

  let response: Response;
  try {
    response = await fetch(`${serverUrl}/api/insights`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ portfolioContext, investorProfile }),
    });
  } catch (networkErr) {
    console.log("[Anthropic] network error:", networkErr);
    throw new Error(`Network error: ${networkErr instanceof Error ? networkErr.message : String(networkErr)}`);
  }

  console.log("[Anthropic] server response status:", response.status);

  if (!response.ok) {
    const body = await response.text();
    console.log("[Anthropic] server error body:", body);
    throw new Error(`Server error ${response.status}: ${body}`);
  }

  const data = await response.json() as { insights?: AIInsight[]; error?: string };

  if (data.error) {
    console.log("[Anthropic] server returned error:", data.error);
    throw new Error(data.error);
  }

  const insights = data.insights ?? [];
  console.log("[Anthropic] received insights count:", insights.length);
  return insights;
}

export async function getCachedInsights(): Promise<AIInsight[] | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cached: CachedInsights = JSON.parse(raw);
    if (Date.now() - cached.timestamp > CACHE_TTL) return null;
    return cached.insights;
  } catch {
    return null;
  }
}

export async function saveInsightsToCache(insights: AIInsight[]): Promise<void> {
  const cached: CachedInsights = { insights, timestamp: Date.now() };
  await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(cached));
}

export async function clearInsightsCache(): Promise<void> {
  await AsyncStorage.removeItem(CACHE_KEY);
}
