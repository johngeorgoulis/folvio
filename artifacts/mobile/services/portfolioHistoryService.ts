import { Platform } from "react-native";
import {
  upsertEtfPrices,
  getEtfPricesForTicker,
  getLatestEtfPriceDate,
  upsertPortfolioHistory,
  getPortfolioHistoryByRange,
  type EtfPriceRow,
  type PortfolioHistoryRow,
  type HoldingRow,
} from "@/services/db";
import { buildYahooSymbol, normalizeToEUR } from "@/services/priceService";
import type { PortfolioSnapshot } from "@/services/snapshotService";

const RANGE_DAYS: Record<string, number> = {
  "1W": 7,
  "1M": 30,
  "3M": 90,
  "1Y": 365,
  "All": 99999,
};

// ─── Yahoo Finance historical chart ──────────────────────────────────────────

function yahooHistUrl(symbol: string, period1: number, period2: number): string {
  if (Platform.OS === "web") {
    const domain = process.env.EXPO_PUBLIC_DOMAIN ?? "";
    return `https://${domain}/api/yahoo/chart/${encodeURIComponent(symbol)}?interval=1d&period1=${period1}&period2=${period2}`;
  }
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&period1=${period1}&period2=${period2}`;
}

async function fetchYahooHistory(
  yahooSymbol: string,
  fromDate: string,
  toDate: string
): Promise<{ dates: string[]; closes: number[]; currency: string }> {
  try {
    const period1 = Math.floor(new Date(fromDate).getTime() / 1000);
    const period2 = Math.floor(new Date(toDate).getTime() / 1000) + 86400;
    const url = yahooHistUrl(yahooSymbol, period1, period2);
    const res = await fetch(url);
    if (!res.ok) return { dates: [], closes: [], currency: "EUR" };
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return { dates: [], closes: [], currency: "EUR" };

    const timestamps: number[] = result.timestamp ?? [];
    const rawCloses: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];
    const currency: string = result.meta?.currency ?? "EUR";

    const dates: string[] = [];
    const closes: number[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const c = rawCloses[i];
      if (c != null && c > 0) {
        dates.push(new Date(timestamps[i] * 1000).toISOString().split("T")[0]);
        closes.push(c);
      }
    }
    return { dates, closes, currency };
  } catch {
    return { dates: [], closes: [], currency: "EUR" };
  }
}

// ─── Frankfurter FX history ───────────────────────────────────────────────────

async function fetchFxRangeHistory(
  fromCurrency: string,
  fromDate: string,
  toDate: string
): Promise<Record<string, number>> {
  try {
    const url = `https://api.frankfurter.app/${fromDate}..${toDate}?from=${fromCurrency}&to=EUR`;
    const res = await fetch(url);
    if (!res.ok) return {};
    const data = await res.json();
    const out: Record<string, number> = {};
    for (const [date, currencies] of Object.entries(data.rates ?? {})) {
      const rate = (currencies as Record<string, number>)["EUR"];
      if (rate) out[date] = rate;
    }
    return out;
  } catch {
    return {};
  }
}

function findCarryForwardRate(
  ratesByDate: Record<string, number>,
  date: string
): number {
  const sortedDates = Object.keys(ratesByDate).sort();
  let rate = 1;
  for (const d of sortedDates) {
    if (d <= date) rate = ratesByDate[d];
    else break;
  }
  return rate;
}

// ─── Recompute portfolio history from stored prices ───────────────────────────

async function recomputePortfolioHistory(
  holdings: HoldingRow[],
  fromDate: string,
  toDate: string
): Promise<void> {
  const allPrices = new Map<string, EtfPriceRow[]>();
  for (const h of holdings) {
    if (!allPrices.has(h.ticker)) {
      allPrices.set(h.ticker, await getEtfPricesForTicker(h.ticker));
    }
  }

  const sortedHoldings = [...holdings].sort((a, b) =>
    a.purchase_date.localeCompare(b.purchase_date)
  );

  const priceIdxMap = new Map<string, number>();
  const currentPriceMap = new Map<string, number>();
  for (const h of holdings) {
    priceIdxMap.set(h.ticker, 0);
    currentPriceMap.set(h.ticker, h.avg_cost_eur);
  }

  const portfolioValues: { date: string; totalValueEur: number; totalInvestedEur: number }[] = [];
  const current = new Date(fromDate);
  const end = new Date(toDate);

  while (current <= end) {
    const dateStr = current.toISOString().split("T")[0];

    for (const [ticker, prices] of allPrices) {
      let idx = priceIdxMap.get(ticker) ?? 0;
      while (idx < prices.length && prices[idx].date <= dateStr) {
        currentPriceMap.set(ticker, prices[idx].close_eur);
        idx++;
      }
      priceIdxMap.set(ticker, idx);
    }

    const active = sortedHoldings.filter((h) => h.purchase_date <= dateStr);
    if (active.length > 0) {
      let totalValue = 0;
      let totalInvested = 0;
      for (const h of active) {
        const price = currentPriceMap.get(h.ticker) ?? h.avg_cost_eur;
        totalValue += h.quantity * price;
        totalInvested += h.quantity * h.avg_cost_eur;
      }
      if (totalValue > 0) {
        portfolioValues.push({ date: dateStr, totalValueEur: totalValue, totalInvestedEur: totalInvested });
      }
    }

    current.setDate(current.getDate() + 1);
  }

  await upsertPortfolioHistory(portfolioValues);
}

// ─── Public API ───────────────────────────────────────────────────────────────

let buildInProgress = false;

export async function buildPortfolioHistory(holdings: HoldingRow[]): Promise<void> {
  if (buildInProgress || holdings.length === 0) return;
  buildInProgress = true;

  try {
    const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
    const sortedDates = holdings.map((h) => h.purchase_date).filter(Boolean).sort();
    const firstDate = sortedDates[0];
    if (!firstDate) return;

    const globalMinDate = firstDate;

    const fxCache = new Map<string, Record<string, number>>();

    for (const h of holdings) {
      const yahooSymbol = buildYahooSymbol(h.ticker, h.exchange);
      const latestStored = await getLatestEtfPriceDate(h.ticker);

      const fetchFrom = latestStored
        ? new Date(new Date(latestStored).getTime() + 86400000).toISOString().split("T")[0]
        : h.purchase_date;

      if (fetchFrom > yesterday) continue;

      const { dates, closes, currency } = await fetchYahooHistory(yahooSymbol, fetchFrom, yesterday);
      if (dates.length === 0) continue;

      const fxBase = currency === "GBp" || currency === "GBX" ? "GBP" : currency;

      if (currency !== "EUR" && !fxCache.has(fxBase)) {
        const rates = await fetchFxRangeHistory(fxBase, globalMinDate, yesterday);
        fxCache.set(fxBase, rates);
      }

      const fxRates = fxCache.get(fxBase) ?? {};
      const pricesEur = dates.map((date, i) => {
        const raw = closes[i];
        if (currency === "EUR") return { date, closeEur: raw };
        const rate = findCarryForwardRate(fxRates, date);
        return { date, closeEur: normalizeToEUR(raw, currency, { [fxBase]: rate }) };
      });

      await upsertEtfPrices(h.ticker, pricesEur);
    }

    await recomputePortfolioHistory(holdings, firstDate, yesterday);
  } catch (err) {
    console.warn("[portfolioHistoryService] build failed:", err);
  } finally {
    buildInProgress = false;
  }
}

export async function getPortfolioHistory(range: string): Promise<PortfolioSnapshot[]> {
  try {
    const days = RANGE_DAYS[range] ?? 30;
    const rows = await getPortfolioHistoryByRange(days);
    return rows.map((r: PortfolioHistoryRow, i: number) => ({
      id: i,
      snapshotDate: r.date,
      totalValueEUR: r.total_value_eur,
      totalInvestedEUR: r.total_invested_eur,
      createdAt: r.created_at,
    }));
  } catch (err) {
    console.warn("[portfolioHistoryService] getPortfolioHistory failed:", err);
    return [];
  }
}
