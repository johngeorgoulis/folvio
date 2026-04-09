import type { Holding } from "@/context/PortfolioContext";
import type { TargetAllocationRow } from "@/services/db";

export interface AllocationRow {
  ticker: string;
  exchange: string;
  targetPct: number;
  actualPct: number;
  drift: number;
  currentValueEUR: number;
  status: "ok" | "overweight" | "underweight" | "untracked" | "no_price";
}

export interface RebalanceSuggestion {
  ticker: string;
  exchange: string;
  action: "buy" | "sell" | "skip";
  units: number;
  estimatedValueEUR: number;
  reason?: string;
}

export interface RebalanceResult {
  mode: "dca" | "full";
  cashInput: number;
  suggestions: RebalanceSuggestion[];
  totalToDeploy: number;
  transactionCount: number;
  warnings: string[];
}

export function validateTargets(targets: TargetAllocationRow[]): { valid: boolean; error?: string } {
  if (targets.length === 0) {
    return { valid: false, error: "No target allocations defined. Add them in Settings." };
  }
  const sum = targets.reduce((s, t) => s + t.target_pct, 0);
  if (Math.abs(sum - 100) > 0.01) {
    return {
      valid: false,
      error: `Targets sum to ${sum.toFixed(1)}% — must equal exactly 100%.`,
    };
  }
  return { valid: true };
}

export function getPortfolioTotalEUR(holdings: Holding[]): number {
  return holdings
    .filter((h) => h.hasPrice)
    .reduce((sum, h) => sum + h.quantity * h.currentPrice, 0);
}

export function calculateAllocations(
  holdings: Holding[],
  targets: TargetAllocationRow[],
  threshold: number
): AllocationRow[] {
  const totalEUR = getPortfolioTotalEUR(holdings);
  const targetMap = new Map(targets.map((t) => [t.ticker, t.target_pct]));
  const rows: AllocationRow[] = [];
  const seenTickers = new Set<string>();

  for (const h of holdings) {
    seenTickers.add(h.ticker);
    const hasTarget = targetMap.has(h.ticker);
    const targetPct = targetMap.get(h.ticker) ?? 0;

    if (!h.hasPrice) {
      rows.push({
        ticker: h.ticker,
        exchange: h.exchange,
        targetPct,
        actualPct: 0,
        drift: hasTarget ? -targetPct : 0,
        currentValueEUR: 0,
        status: "no_price",
      });
      continue;
    }

    const currentValueEUR = h.quantity * h.currentPrice;
    const actualPct = totalEUR > 0 ? (currentValueEUR / totalEUR) * 100 : 0;
    const drift = actualPct - targetPct;

    let status: AllocationRow["status"];
    if (!hasTarget) {
      status = "untracked";
    } else if (Math.abs(drift) <= threshold) {
      status = "ok";
    } else if (drift > threshold) {
      status = "overweight";
    } else {
      status = "underweight";
    }

    rows.push({ ticker: h.ticker, exchange: h.exchange, targetPct, actualPct, drift, currentValueEUR, status });
  }

  for (const t of targets) {
    if (!seenTickers.has(t.ticker)) {
      rows.push({
        ticker: t.ticker,
        exchange: "",
        targetPct: t.target_pct,
        actualPct: 0,
        drift: -t.target_pct,
        currentValueEUR: 0,
        status: "underweight",
      });
    }
  }

  return rows.sort((a, b) => b.currentValueEUR - a.currentValueEUR);
}

export function calculateDCARebalance(
  holdings: Holding[],
  targets: TargetAllocationRow[],
  cashAmount: number
): RebalanceResult {
  const warnings: string[] = [];
  const totalEUR = getPortfolioTotalEUR(holdings);
  const newTotalValue = totalEUR + cashAmount;
  const targetMap = new Map(targets.map((t) => [t.ticker, t.target_pct]));

  for (const h of holdings) {
    if (!h.hasPrice) {
      warnings.push(`${h.ticker} excluded — price unavailable. Update manually.`);
    }
  }
  for (const t of targets) {
    if (!holdings.find((h) => h.ticker === t.ticker)) {
      warnings.push(`${t.ticker} has a target allocation but is not in your portfolio.`);
    }
  }

  const pricedHoldings = holdings.filter((h) => h.hasPrice && targetMap.has(h.ticker));
  const suggestions: RebalanceSuggestion[] = [];
  let totalToDeploy = 0;

  for (const h of pricedHoldings) {
    const targetPct = targetMap.get(h.ticker)!;
    const targetValue = newTotalValue * (targetPct / 100);
    const currentValue = h.quantity * h.currentPrice;
    const delta = targetValue - currentValue;

    if (delta <= 0) {
      suggestions.push({
        ticker: h.ticker,
        exchange: h.exchange,
        action: "skip",
        units: 0,
        estimatedValueEUR: 0,
        reason: "already overweight — skip in DCA mode",
      });
    } else {
      const units = Math.round((delta / h.currentPrice) * 100) / 100;
      const estimatedValueEUR = Math.round(units * h.currentPrice * 100) / 100;
      totalToDeploy += estimatedValueEUR;
      suggestions.push({ ticker: h.ticker, exchange: h.exchange, action: "buy", units, estimatedValueEUR });
    }
  }

  return {
    mode: "dca",
    cashInput: cashAmount,
    suggestions: suggestions.sort((a, b) => b.estimatedValueEUR - a.estimatedValueEUR),
    totalToDeploy: Math.round(totalToDeploy * 100) / 100,
    transactionCount: suggestions.filter((s) => s.action === "buy").length,
    warnings,
  };
}

export function calculateFullRebalance(
  holdings: Holding[],
  targets: TargetAllocationRow[]
): RebalanceResult {
  const warnings: string[] = [];
  warnings.push("Selling may trigger capital gains tax. Consult a tax advisor.");

  const totalEUR = getPortfolioTotalEUR(holdings);
  const targetMap = new Map(targets.map((t) => [t.ticker, t.target_pct]));

  for (const h of holdings) {
    if (!h.hasPrice) {
      warnings.push(`${h.ticker} excluded — price unavailable. Update manually.`);
    }
  }

  const pricedHoldings = holdings.filter((h) => h.hasPrice && targetMap.has(h.ticker));
  const suggestions: RebalanceSuggestion[] = [];
  let totalToDeploy = 0;

  for (const h of pricedHoldings) {
    const targetPct = targetMap.get(h.ticker)!;
    const targetValue = totalEUR * (targetPct / 100);
    const currentValue = h.quantity * h.currentPrice;
    const delta = targetValue - currentValue;
    const rawUnits = delta / h.currentPrice;
    const units = Math.round(Math.abs(rawUnits) * 100) / 100;
    const estimatedValueEUR = Math.round(units * h.currentPrice * 100) / 100;

    if (Math.abs(delta) < 0.01) {
      suggestions.push({
        ticker: h.ticker,
        exchange: h.exchange,
        action: "skip",
        units: 0,
        estimatedValueEUR: 0,
        reason: "perfectly balanced",
      });
    } else if (delta > 0) {
      totalToDeploy += estimatedValueEUR;
      suggestions.push({ ticker: h.ticker, exchange: h.exchange, action: "buy", units, estimatedValueEUR });
    } else {
      suggestions.push({ ticker: h.ticker, exchange: h.exchange, action: "sell", units, estimatedValueEUR });
    }
  }

  const actionOrder = { buy: 0, sell: 1, skip: 2 };
  return {
    mode: "full",
    cashInput: 0,
    suggestions: suggestions.sort((a, b) => actionOrder[a.action] - actionOrder[b.action]),
    totalToDeploy: Math.round(totalToDeploy * 100) / 100,
    transactionCount: suggestions.filter((s) => s.action !== "skip").length,
    warnings,
  };
}
