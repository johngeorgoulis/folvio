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
import { normalizeToEUR } from "@/services/priceService";
import type { PortfolioSnapshot } from "@/services/snapshotService";

const RANGE_DAYS: Record<string, number> = {
  "1W": 7,
  "1M": 30,
  "3M": 90,
  "1Y": 365,
  "All": 99999,
};

// ─── EODHD EOD historical chart ───────────────────────────────────────────────

const EODHD_BASE = "https://eodhd.com/api";

function eodhdApiKey(): string {
  return process.env.EXPO_PUBLIC_EODHD_API_KEY ?? "";
}

async function fetchEodhdHistory(
  ticker: string,
  exchange: string,
  fromDate: string,
  toDate: string
): Promise<{ dates: string[]; closes: number[]; currency: string }> {
  const key = eodhdApiKey();
  if (!key) return { dates: [], closes: [], currency: "EUR" };

  // Map internal exchange codes to EODHD suffixes — try XETRA format first for EU exchanges
  const SUFFIX_MAP: Record<string, string[]> = {
    "XETRA": [".XETRA", ".DE"],
    "LSE": [".LSE", ".L"],
    "EURONEXT_AMS": [".AS"],
    "EURONEXT_PAR": [".PA"],
    "BORSA_IT": [".MI"],
    "SIX": [".SW"],
    "EURONEXT_BRU": [".BR"],
    "BME": [".MC"],
    "NASDAQ_HEL": [".HE"],
    "NASDAQ_STO": [".ST"],
    "OSLO": [".OL"],
    "NASDAQ_CPH": [".CO"],
  };

  const suffixes = SUFFIX_MAP[exchange] ?? [".XETRA", ".DE"];
  const currency = exchange === "LSE" ? "GBP" : exchange === "SIX" ? "CHF" : "EUR";

  for (const suffix of suffixes) {
    const symbol = `${ticker.toUpperCase()}${suffix}`;
    try {
      const url = `${EODHD_BASE}/eod/${encodeURIComponent(symbol)}?api_token=${key}&fmt=json&from=${fromDate}&to=${toDate}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12_000);
      const res = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal })
        .finally(() => clearTimeout(timer));
      if (!res.ok) continue;
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) continue;

      const dates: string[] = [];
      const closes: number[] = [];
      for (const bar of data) {
        if (bar.close > 0) {
          dates.push(bar.date);
          closes.push(bar.close);
        }
      }
      if (dates.length > 0) return { dates, closes, currency };
    } catch { /* try next suffix */ }
  }

  return { dates: [], closes: [], currency: "EUR" };
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
      const latestStored = await getLatestEtfPriceDate(h.ticker);

      const fetchFrom = latestStored
        ? new Date(new Date(latestStored).getTime() + 86400000).toISOString().split("T")[0]
        : h.purchase_date;

      if (fetchFrom > yesterday) continue;

      const { dates, closes, currency } = await fetchEodhdHistory(h.ticker, h.exchange, fetchFrom, yesterday);
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
