import AsyncStorage from "@react-native-async-storage/async-storage";
import { getAssetClass } from "@/services/assetClassService";

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
  const apiKey = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY;
  console.log("[Anthropic] key present:", !!apiKey, "length:", apiKey?.length ?? 0);
  if (!apiKey) throw new Error("EXPO_PUBLIC_ANTHROPIC_API_KEY not configured");

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

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system:
        "You are a portfolio analyst for European passive investors. " +
        "Generate exactly 4 concise, specific portfolio insights based on the data provided. " +
        "Focus on: geographic concentration, cost efficiency, asset allocation vs typical EU passive investor, " +
        "and one actionable suggestion. Be specific with numbers. Maximum 2 sentences per insight. " +
        "Respond ONLY with a JSON array, no other text.",
      messages: [
        {
          role: "user",
          content:
            `Analyze this portfolio and generate 4 insights as JSON:\n\n` +
            `${JSON.stringify(portfolioContext, null, 2)}\n\n` +
            `Respond with: [{"title": "...", "body": "...", "type": "neutral|positive|warning"}, ...]`,
        },
      ],
    }),
  });

  console.log("[Anthropic] response status:", response.status);

  if (!response.ok) {
    const body = await response.text();
    console.log("[Anthropic] error body:", body);
    throw new Error(`Anthropic API error ${response.status}: ${body}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text ?? "[]";
  console.log("[Anthropic] raw response text:", text);

  try {
    const insights: AIInsight[] = JSON.parse(text);
    console.log("[Anthropic] parsed insights count:", insights.length);
    return insights;
  } catch (parseErr) {
    console.log("[Anthropic] JSON parse error:", parseErr);
    throw new Error(`Failed to parse Claude response: ${text}`);
  }
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
