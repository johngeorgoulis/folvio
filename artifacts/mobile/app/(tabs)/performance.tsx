import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { usePortfolio } from "@/context/PortfolioContext";
import { useAllocation } from "@/context/AllocationContext";
import { formatEUR, formatPct } from "@/utils/format";
import { calculateAllocations, validateTargets } from "@/services/allocationService";
import { getAssetClass } from "@/services/assetClassService";
import { type PortfolioSnapshot } from "@/services/snapshotService";
import { fetchBenchmarkReturn } from "@/services/priceService";
import { buildPortfolioHistory, getPortfolioHistory } from "@/services/portfolioHistoryService";
import type { HoldingRow } from "@/services/db";

// ─── Benchmark definitions ─────────────────────────────────────────────────────

export const BENCHMARKS = [
  { label: "S&P 500",       symbol: "^GSPC",     description: "US large cap 500 companies" },
  { label: "MSCI World",    symbol: "URTH",      description: "Developed markets ~1,500 companies" },
  { label: "Euro Stoxx 50", symbol: "^STOXX50E", description: "50 largest Eurozone companies" },
  { label: "FTSE All-World",symbol: "VWRL.L",    description: "Global all-cap index" },
  { label: "DAX",           symbol: "^GDAXI",    description: "30 largest German companies" },
] as const;
export type BenchmarkItem = typeof BENCHMARKS[number];
const DEFAULT_BENCHMARK = BENCHMARKS[0];

const BENCH_RANGES = ["1W", "1M", "3M", "1Y", "All"] as const;
type BenchRange = (typeof BENCH_RANGES)[number];

const PERF_RANGES = ["1W", "1M", "3M", "1Y", "All"] as const;
type Range = (typeof PERF_RANGES)[number];

// ─── Dual-line SVG Chart ───────────────────────────────────────────────────────

const BCHART_H = 170;
const BP = { top: 12, bottom: 28, left: 8, right: 8 };

function buildLinePath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return "";
  return pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
}

function DualLineChart({
  portfolioNorm,
  benchNorm,
  portfolioLabel,
  benchLabel,
  width,
}: {
  portfolioNorm: number[];
  benchNorm: number[];
  portfolioLabel: string;
  benchLabel: string;
  width: number;
}) {
  const theme = Colors.dark;
  const innerW = width - BP.left - BP.right;
  const innerH = BCHART_H - BP.top - BP.bottom;

  const allValues = [...portfolioNorm, ...benchNorm];
  const minV = Math.min(...allValues);
  const maxV = Math.max(...allValues);
  const rangeV = maxV - minV || 1;
  const pad = rangeV * 0.08;

  const lo = minV - pad;
  const hi = maxV + pad;
  const span = hi - lo || 1;

  function toX(i: number, total: number) {
    return BP.left + (total < 2 ? 0 : (i / (total - 1))) * innerW;
  }
  function toY(v: number) {
    return BP.top + (1 - (v - lo) / span) * innerH;
  }

  const portPts = portfolioNorm.map((v, i) => ({ x: toX(i, portfolioNorm.length), y: toY(v) }));
  const benchPts = benchNorm.map((v, i) => ({ x: toX(i, benchNorm.length), y: toY(v) }));

  const portPath = buildLinePath(portPts);
  const benchPath = buildLinePath(benchPts);

  const portReturn = portfolioNorm.length >= 2
    ? portfolioNorm[portfolioNorm.length - 1] - 100
    : 0;
  const benchReturn = benchNorm.length >= 2
    ? benchNorm[benchNorm.length - 1] - 100
    : 0;
  const diff = portReturn - benchReturn;

  const midY = toY(100);
  const baseline = `M${BP.left},${midY.toFixed(1)} L${(BP.left + innerW).toFixed(1)},${midY.toFixed(1)}`;

  return (
    <View>
      <Svg width={width} height={BCHART_H}>
        <Defs>
          <LinearGradient id="portGrad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#C9A84C" stopOpacity="0.18" />
            <Stop offset="1" stopColor="#C9A84C" stopOpacity="0" />
          </LinearGradient>
        </Defs>

        {/* Baseline at 100 */}
        <Path d={baseline} stroke={theme.border} strokeWidth={1} strokeDasharray="4,4" />

        {/* Benchmark line — grey dashed */}
        {benchPath ? (
          <Path
            d={benchPath}
            stroke="#8A9BB0"
            strokeWidth={1.5}
            strokeDasharray="6,4"
            fill="none"
          />
        ) : null}

        {/* Portfolio line — gold solid */}
        {portPath ? (
          <Path
            d={portPath}
            stroke="#C9A84C"
            strokeWidth={2.5}
            fill="none"
          />
        ) : null}
      </Svg>

      {/* Legend */}
      <View style={dStyles.legend}>
        <View style={dStyles.legendItem}>
          <View style={[dStyles.legendDot, { backgroundColor: "#C9A84C" }]} />
          <Text style={[dStyles.legendLabel, { color: theme.textSecondary }]}>Your Portfolio</Text>
        </View>
        <View style={dStyles.legendItem}>
          <View style={dStyles.legendDash}>
            <View style={[dStyles.dashSeg, { backgroundColor: "#8A9BB0" }]} />
            <View style={[dStyles.dashGap]} />
            <View style={[dStyles.dashSeg, { backgroundColor: "#8A9BB0" }]} />
          </View>
          <Text style={[dStyles.legendLabel, { color: theme.textSecondary }]}>{benchLabel}</Text>
        </View>
      </View>

      {/* Summary */}
      <View style={[dStyles.summaryBox, { backgroundColor: theme.backgroundElevated, borderRadius: 10 }]}>
        <SummaryRow label="Your Portfolio" value={portReturn} theme={theme} />
        <SummaryRow label={benchLabel} value={benchReturn} theme={theme} />
        <View style={[dStyles.summaryDivider, { backgroundColor: theme.border }]} />
        <View style={dStyles.summaryRow}>
          <Text style={[dStyles.summaryLabel, { color: theme.textSecondary }]}>Difference</Text>
          <Text style={[dStyles.summaryValue, { color: diff >= 0 ? theme.positive : theme.negative }]}>
            {diff >= 0 ? "+" : ""}{diff.toFixed(2)}%{" "}
            <Text style={[dStyles.summaryNote, { color: diff >= 0 ? theme.positive : theme.negative }]}>
              ({diff >= 0 ? "outperforming" : "underperforming"})
            </Text>
          </Text>
        </View>
      </View>

      {/* Disclaimer */}
      <Text style={[dStyles.disclaimer, { color: theme.textTertiary }]}>
        Benchmark data for informational purposes only. Past performance does not guarantee future results.
      </Text>
    </View>
  );
}

function SummaryRow({
  label,
  value,
  theme,
}: {
  label: string;
  value: number;
  theme: typeof Colors.dark;
}) {
  return (
    <View style={dStyles.summaryRow}>
      <Text style={[dStyles.summaryLabel, { color: theme.textSecondary }]}>{label}</Text>
      <Text style={[dStyles.summaryValue, { color: value >= 0 ? theme.positive : theme.negative }]}>
        {value >= 0 ? "+" : ""}{value.toFixed(2)}%
      </Text>
    </View>
  );
}

const dStyles = StyleSheet.create({
  legend: { flexDirection: "row", gap: 18, paddingHorizontal: 4, marginTop: 4, marginBottom: 12 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendDash: { flexDirection: "row", alignItems: "center", gap: 1.5 },
  dashSeg: { width: 10, height: 2 },
  dashGap: { width: 4 },
  legendLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
  summaryBox: { padding: 14, gap: 10, marginTop: 4, marginBottom: 10 },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  summaryLabel: { fontSize: 13, fontFamily: "Inter_400Regular" },
  summaryValue: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  summaryNote: { fontSize: 11, fontFamily: "Inter_400Regular" },
  summaryDivider: { height: StyleSheet.hairlineWidth },
  disclaimer: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    fontStyle: "italic",
    textAlign: "center",
    lineHeight: 14,
    marginTop: 2,
  },
});

// ─── Portfolio Risk Profile ────────────────────────────────────────────────────

const ETF_HISTORICAL_METRICS: Record<string, { annualReturn: number; volatility: number; maxDrawdown: number }> = {
  VWCE:            { annualReturn: 11.2, volatility: 14.8, maxDrawdown: -33.8 },
  TDIV:            { annualReturn:  8.4, volatility: 12.1, maxDrawdown: -28.4 },
  VHYL:            { annualReturn:  7.9, volatility: 11.8, maxDrawdown: -27.6 },
  ERNE:            { annualReturn:  9.1, volatility: 16.2, maxDrawdown: -31.2 },
  IEGE:            { annualReturn:  8.7, volatility: 13.4, maxDrawdown: -29.8 },
  VUAA:            { annualReturn: 12.8, volatility: 15.2, maxDrawdown: -33.9 },
  IWDA:            { annualReturn: 11.1, volatility: 14.6, maxDrawdown: -33.4 },
  CSBGE7:          { annualReturn:  1.2, volatility:  4.8, maxDrawdown: -18.2 },
  AGGH:            { annualReturn:  0.8, volatility:  5.2, maxDrawdown: -19.1 },
  IEAG:            { annualReturn:  1.1, volatility:  4.9, maxDrawdown: -18.8 },
  EGLN:            { annualReturn:  6.2, volatility: 15.8, maxDrawdown: -28.4 },
  DEFAULT_EQUITY:  { annualReturn:  9.5, volatility: 14.0, maxDrawdown: -32.0 },
  DEFAULT_BOND:    { annualReturn:  1.0, volatility:  5.0, maxDrawdown: -18.0 },
  DEFAULT_COMMODITY:{ annualReturn: 5.0, volatility: 15.0, maxDrawdown: -25.0 },
};

function getETFMetrics(ticker: string, isin?: string) {
  const key = ticker.toUpperCase();
  if (ETF_HISTORICAL_METRICS[key]) return ETF_HISTORICAL_METRICS[key];
  const ac = getAssetClass(ticker, isin);
  if (ac === "Bond")      return ETF_HISTORICAL_METRICS.DEFAULT_BOND;
  if (ac === "Commodity") return ETF_HISTORICAL_METRICS.DEFAULT_COMMODITY;
  return ETF_HISTORICAL_METRICS.DEFAULT_EQUITY;
}

interface RiskProfile {
  annualReturn: number;
  volatility: number;
  maxDrawdown: number;
  sharpe: number;
}

function computeRiskProfile(
  holdings: { ticker: string; isin?: string | null; quantity: number; currentPrice: number; hasPrice: boolean }[]
): RiskProfile | null {
  const totalValue = holdings.reduce(
    (sum, h) => sum + (h.hasPrice ? h.quantity * h.currentPrice : 0), 0
  );
  if (totalValue === 0) return null;

  let annualReturn = 0, volatility = 0, maxDrawdown = 0;
  for (const h of holdings) {
    if (!h.hasPrice) continue;
    const weight = (h.quantity * h.currentPrice) / totalValue;
    const m = getETFMetrics(h.ticker, h.isin ?? undefined);
    annualReturn += weight * m.annualReturn;
    volatility   += weight * m.volatility;
    maxDrawdown  += weight * m.maxDrawdown;
  }
  const sharpe = volatility > 0 ? (annualReturn - 2.5) / volatility : 0;
  return { annualReturn, volatility, maxDrawdown, sharpe };
}

function RiskProfileCard({ profile }: { profile: RiskProfile }) {
  const theme = Colors.dark;

  const sharpeColor =
    profile.sharpe > 0.5 ? theme.positive :
    profile.sharpe >= 0.3 ? "#FBBF24" : theme.negative;

  const volatilityColor = profile.volatility > 15 ? "#FBBF24" : theme.text;

  const sentence =
    profile.sharpe > 0.5
      ? "Your portfolio has a favorable risk-adjusted return profile."
      : profile.sharpe >= 0.3
      ? "Your portfolio balances growth and stability reasonably well."
      : "Your portfolio is conservatively positioned — lower returns but reduced volatility.";

  function showInfo() {
    Alert.alert(
      "About Risk Profile",
      "Based on 10-year historical averages for each ETF in your portfolio. Past performance does not guarantee future results.",
      [{ text: "Got it" }]
    );
  }

  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}>
      <View style={riskStyles.header}>
        <Text style={[styles.sectionTitle, { color: theme.text, marginBottom: 0 }]}>Portfolio Risk Profile</Text>
        <TouchableOpacity onPress={showInfo} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="info" size={15} color={theme.textTertiary} />
        </TouchableOpacity>
      </View>
      <Text style={[riskStyles.sub, { color: theme.textSecondary }]}>Based on your current allocation</Text>

      <View style={riskStyles.grid}>
        <View style={[riskStyles.cell, { borderColor: theme.border }]}>
          <Text style={[riskStyles.cellLabel, { color: theme.textSecondary }]}>Est. Annual Return</Text>
          <Text style={[riskStyles.cellValue, { color: theme.positive }]}>
            +{profile.annualReturn.toFixed(1)}%
          </Text>
        </View>
        <View style={[riskStyles.cell, riskStyles.cellRight, { borderColor: theme.border }]}>
          <Text style={[riskStyles.cellLabel, { color: theme.textSecondary }]}>Volatility</Text>
          <Text style={[riskStyles.cellValue, { color: volatilityColor }]}>
            {profile.volatility.toFixed(1)}%
          </Text>
        </View>
        <View style={[riskStyles.cell, riskStyles.cellBottom, { borderColor: theme.border }]}>
          <Text style={[riskStyles.cellLabel, { color: theme.textSecondary }]}>Max Drawdown</Text>
          <Text style={[riskStyles.cellValue, { color: theme.negative }]}>
            {profile.maxDrawdown.toFixed(1)}%
          </Text>
        </View>
        <View style={[riskStyles.cell, riskStyles.cellRight, riskStyles.cellBottom, { borderColor: theme.border }]}>
          <Text style={[riskStyles.cellLabel, { color: theme.textSecondary }]}>Sharpe Ratio</Text>
          <Text style={[riskStyles.cellValue, { color: sharpeColor }]}>
            {profile.sharpe.toFixed(2)}
          </Text>
        </View>
      </View>

      <Text style={[riskStyles.sentence, { color: theme.textSecondary }]}>{sentence}</Text>
    </View>
  );
}

const riskStyles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  sub: { fontSize: 11, fontFamily: "Inter_400Regular", marginBottom: 16 },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    borderWidth: 1,
    borderRadius: 12,
    overflow: "hidden",
    borderColor: "#1E3A5F",
    marginBottom: 14,
  },
  cell: {
    width: "50%",
    padding: 14,
    borderRightWidth: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  cellRight: { borderLeftWidth: StyleSheet.hairlineWidth },
  cellBottom: { borderBottomWidth: 0 },
  cellLabel: { fontSize: 10, fontFamily: "Inter_500Medium", letterSpacing: 0.2, marginBottom: 6 },
  cellValue: { fontSize: 22, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  sentence: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18, fontStyle: "italic" },
});

// ─── Crisis Backtest Section ───────────────────────────────────────────────────

const CRISES = [
  {
    id: "dotcom" as const,
    name: "Dot-com",
    dateRange: "Mar '00–Oct '02",
    durationMonths: 31,
    drawdowns: { equity: -48, bond: 8, gold: 12 },
    msciDrawdown: -49,
    msciRecoveryMonths: 56,
  },
  {
    id: "financial" as const,
    name: "Financial Crisis",
    dateRange: "Oct '07–Mar '09",
    durationMonths: 17,
    drawdowns: { equity: -52, bond: 6, gold: 25 },
    msciDrawdown: -54,
    msciRecoveryMonths: 49,
  },
  {
    id: "covid" as const,
    name: "COVID Crash",
    dateRange: "Feb–Mar 2020",
    durationMonths: 2,
    drawdowns: { equity: -32, bond: 3, gold: 5 },
    msciDrawdown: -34,
    msciRecoveryMonths: 5,
  },
  {
    id: "rate2022" as const,
    name: "2022 Rate Hike",
    dateRange: "Jan–Oct 2022",
    durationMonths: 9,
    drawdowns: { equity: -24, bond: -18, gold: -3 },
    msciDrawdown: -25,
    msciRecoveryMonths: 18,
  },
];
type CrisisId = typeof CRISES[number]["id"];

function classifyETF(ticker: string): "equity" | "bond" | "gold" | null {
  const t = ticker.toUpperCase();
  if (["VWCE", "TDIV", "VHYL", "ERNE", "IEGE"].includes(t)) return "equity";
  if (["CSBGE7"].includes(t)) return "bond";
  if (["EGLN"].includes(t)) return "gold";
  return null;
}

function CrisisBacktestSection() {
  const theme = Colors.dark;
  const { holdings } = usePortfolio();
  const [selectedId, setSelectedId] = useState<CrisisId>("financial");
  const [dca, setDca] = useState(400);

  useEffect(() => {
    AsyncStorage.getItem("folvio_forecast_dca").then(v => {
      if (v) setDca(parseFloat(v) || 400);
    });
  }, []);

  const crisis = CRISES.find(c => c.id === selectedId)!;

  const analysis = useMemo(() => {
    const priced = holdings.filter(h => h.hasPrice && h.currentPrice > 0 && h.quantity > 0);
    if (priced.length === 0) return null;

    const totalValue = priced.reduce((s, h) => s + h.quantity * h.currentPrice, 0);
    if (totalValue <= 0) return null;

    const classified = priced.map(h => ({
      ticker: h.ticker,
      weight: (h.quantity * h.currentPrice) / totalValue,
      type: classifyETF(h.ticker),
    }));

    const unknownTickers = classified.filter(w => w.type === null).map(w => w.ticker);
    const known = classified.filter(w => w.type !== null) as { ticker: string; weight: number; type: "equity" | "bond" | "gold" }[];

    const knownTotalWeight = known.reduce((s, w) => s + w.weight, 0);
    if (knownTotalWeight <= 0) {
      return { unknownTickers, portfolioDrawdown: 0, defensiveWeight: 0, recoveryMonths: 0, dcaAdvantage: 0, capital: 0, lumpSumFinal: 0, dcaFinal: 0, pctDiff: 0, drawdownDiff: 0 };
    }

    const normalized = known.map(w => ({ ...w, normWeight: w.weight / knownTotalWeight }));

    let portfolioDrawdown = 0;
    let defensiveWeight = 0;
    for (const w of normalized) {
      const dd = w.type === "equity" ? crisis.drawdowns.equity
        : w.type === "bond" ? crisis.drawdowns.bond
        : crisis.drawdowns.gold;
      portfolioDrawdown += w.normWeight * dd;
      if (w.type === "bond" || w.type === "gold") defensiveWeight += w.normWeight;
    }

    const defensiveAdj = 1 - defensiveWeight * 0.3;
    const recoveryMonths = portfolioDrawdown === 0
      ? crisis.msciRecoveryMonths
      : Math.max(1, Math.round(
          crisis.msciRecoveryMonths
          * (Math.abs(portfolioDrawdown) / Math.abs(crisis.msciDrawdown))
          * defensiveAdj
        ));

    const depressedFactor = 1 + portfolioDrawdown / 100;
    const dcaAdvantage = depressedFactor > 0 && depressedFactor < 1
      ? (1 / depressedFactor - 1) * 100
      : 0;

    const capital = dca * crisis.durationMonths;
    const drawdownFraction = portfolioDrawdown / 100;
    const lumpSumFinal = capital * (1 + drawdownFraction) * (1 - drawdownFraction);
    const avgPriceFactor = 1 + drawdownFraction * 0.5;
    const dcaFinal = avgPriceFactor > 0 ? capital / avgPriceFactor : capital;
    const pctDiff = lumpSumFinal > 0 ? ((dcaFinal - lumpSumFinal) / Math.abs(lumpSumFinal)) * 100 : 0;

    const drawdownDiff = Math.abs(portfolioDrawdown) - Math.abs(crisis.msciDrawdown);

    return { unknownTickers, portfolioDrawdown, defensiveWeight, recoveryMonths, dcaAdvantage, capital, lumpSumFinal, dcaFinal, pctDiff, drawdownDiff };
  }, [holdings, crisis, dca]);

  if (holdings.length === 0) {
    return (
      <View style={[styles.card, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}>
        <Text style={[styles.sectionTitle, { color: theme.text }]}>Crisis Backtest</Text>
        <Text style={[crisisStyles.emptyHint, { color: theme.textSecondary }]}>
          Add holdings to your portfolio to see crisis analysis.
        </Text>
      </View>
    );
  }

  const pDrawdown = analysis?.portfolioDrawdown ?? 0;
  const cushioned = analysis ? analysis.drawdownDiff <= 0 : false;
  const diffAbs = Math.abs(analysis?.drawdownDiff ?? 0);

  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}>
      <Text style={[styles.sectionTitle, { color: theme.text }]}>Crisis Backtest</Text>
      <Text style={[crisisStyles.subtitle, { color: theme.textSecondary }]}>
        How would your portfolio have behaved during major market crises?
      </Text>

      {/* Crisis selector */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={crisisStyles.selectorScroll}>
        <View style={crisisStyles.selectorRow}>
          {CRISES.map(c => (
            <TouchableOpacity
              key={c.id}
              style={[
                crisisStyles.crisisChip,
                {
                  backgroundColor: selectedId === c.id ? theme.tint + "22" : theme.backgroundElevated,
                  borderColor: selectedId === c.id ? theme.tint : theme.border,
                },
              ]}
              onPress={() => setSelectedId(c.id)}
            >
              <Text style={[crisisStyles.crisisName, { color: selectedId === c.id ? theme.tint : theme.text }]}>
                {c.name}
              </Text>
              <Text style={[crisisStyles.crisisDate, { color: selectedId === c.id ? theme.tint + "BB" : theme.textTertiary }]}>
                {c.dateRange}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {analysis === null ? (
        <Text style={[crisisStyles.emptyHint, { color: theme.textSecondary }]}>
          No classifiable ETFs found. Add VWCE, TDIV, VHYL, ERNE, IEGE, CSBGE7, or EGLN.
        </Text>
      ) : (
        <>
          {analysis.unknownTickers.length > 0 && (
            <View style={[crisisStyles.warningBox, { backgroundColor: "#FBBF2411", borderColor: "#FBBF2433" }]}>
              <Feather name="alert-triangle" size={12} color="#FBBF24" />
              <Text style={[crisisStyles.warningText, { color: "#FBBF24" }]}>
                {analysis.unknownTickers.join(", ")} not classified — excluded from calculations.
              </Text>
            </View>
          )}

          {/* Block 1 — Drawdown */}
          <View style={[crisisStyles.metricBlock, { backgroundColor: theme.backgroundElevated }]}>
            <Text style={[crisisStyles.metricTitle, { color: theme.textSecondary }]}>Estimated Max Drawdown</Text>
            <View style={crisisStyles.metricRow}>
              <View style={crisisStyles.metricHalf}>
                <Text style={[crisisStyles.metricBig, { color: pDrawdown < 0 ? theme.negative : theme.positive }]}>
                  {pDrawdown >= 0 ? "+" : ""}{pDrawdown.toFixed(1)}%
                </Text>
                <Text style={[crisisStyles.metricSmall, { color: theme.textTertiary }]}>Your Portfolio</Text>
              </View>
              <View style={[crisisStyles.metricDivider, { backgroundColor: theme.border }]} />
              <View style={crisisStyles.metricHalf}>
                <Text style={[crisisStyles.metricBig, { color: theme.negative }]}>
                  {crisis.msciDrawdown.toFixed(1)}%
                </Text>
                <Text style={[crisisStyles.metricSmall, { color: theme.textTertiary }]}>MSCI World</Text>
              </View>
            </View>
            <Text style={[crisisStyles.metricNote, { color: cushioned ? theme.positive : theme.negative }]}>
              {cushioned
                ? `Your allocation cushioned the drawdown by ${diffAbs.toFixed(1)}%`
                : `Your allocation amplified the drawdown by ${diffAbs.toFixed(1)}%`}
            </Text>
          </View>

          {/* Block 2 — Recovery Time */}
          <View style={[crisisStyles.metricBlock, { backgroundColor: theme.backgroundElevated }]}>
            <Text style={[crisisStyles.metricTitle, { color: theme.textSecondary }]}>Estimated Recovery</Text>
            <Text style={[crisisStyles.metricBig, { color: theme.positive, textAlign: "center" }]}>
              ~{analysis.recoveryMonths} months
            </Text>
            <Text style={[crisisStyles.metricNote, { color: theme.textTertiary, textAlign: "center" }]}>
              Based on {(analysis.defensiveWeight * 100).toFixed(0)}% defensive allocation
              {" "}(MSCI World: {crisis.msciRecoveryMonths} months)
            </Text>
          </View>

          {/* Block 3 — DCA Effect */}
          <View style={[crisisStyles.metricBlock, { backgroundColor: theme.backgroundElevated }]}>
            <Text style={[crisisStyles.metricTitle, { color: theme.textSecondary }]}>DCA Effect</Text>
            <Text style={[crisisStyles.metricBig, { color: theme.positive, textAlign: "center" }]}>
              +{analysis.dcaAdvantage.toFixed(1)}% more units
            </Text>
            <Text style={[crisisStyles.metricNote, { color: theme.textTertiary, textAlign: "center" }]}>
              Continuing {formatEUR(dca)}/month DCA during this crisis would have bought ~{analysis.dcaAdvantage.toFixed(1)}% more units at depressed prices
            </Text>
          </View>

          {/* Block 4 — Lump Sum vs DCA */}
          <View style={[crisisStyles.metricBlock, { backgroundColor: theme.backgroundElevated }]}>
            <Text style={[crisisStyles.metricTitle, { color: theme.textSecondary }]}>Lump Sum vs DCA</Text>
            <Text style={[crisisStyles.metricCaption, { color: theme.textTertiary }]}>
              Capital: {formatEUR(analysis.capital)} ({formatEUR(dca)}/mo × {crisis.durationMonths} months)
            </Text>
            <View style={crisisStyles.metricRow}>
              <View style={crisisStyles.metricHalf}>
                <Text style={[crisisStyles.metricBig, { color: theme.text }]}>
                  {formatEUR(analysis.lumpSumFinal)}
                </Text>
                <Text style={[crisisStyles.metricSmall, { color: theme.textTertiary }]}>Lump Sum</Text>
              </View>
              <View style={[crisisStyles.metricDivider, { backgroundColor: theme.border }]} />
              <View style={crisisStyles.metricHalf}>
                <Text style={[crisisStyles.metricBig, { color: theme.positive }]}>
                  {formatEUR(analysis.dcaFinal)}
                </Text>
                <Text style={[crisisStyles.metricSmall, { color: theme.textTertiary }]}>DCA</Text>
              </View>
            </View>
            {analysis.pctDiff > 0 && (
              <Text style={[crisisStyles.metricNote, { color: theme.positive }]}>
                DCA would have resulted in +{analysis.pctDiff.toFixed(1)}% more value than lump sum at peak
              </Text>
            )}
          </View>

          <Text style={[dStyles.disclaimer, { color: theme.textTertiary }]}>
            Simulated results based on historical index data and your current portfolio allocation. Past performance does not guarantee future results.
          </Text>
        </>
      )}
    </View>
  );
}

// ─── Benchmark Comparison Section ─────────────────────────────────────────────

function BenchmarkComparisonSection({
  isPremium,
  defaultBenchmark,
  onUpgrade,
  width,
}: {
  isPremium: boolean;
  defaultBenchmark: BenchmarkItem;
  onUpgrade: () => void;
  width: number;
}) {
  const theme = Colors.dark;
  const { holdings, totalInvested, totalPortfolioValue } = usePortfolio();
  const [activeBench, setActiveBench] = useState<BenchmarkItem>(defaultBenchmark);
  const [benchReturn, setBenchReturn] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const hasFetchedRef = useRef(false);

  const earliestDate = useMemo(() => {
    if (holdings.length === 0) return null;
    const dates = holdings.map((h) => h.purchase_date).filter(Boolean).sort();
    return dates[0] ?? null;
  }, [holdings]);

  async function loadBench(bench: BenchmarkItem, date: string) {
    if (!isPremium) return;
    setLoading(true);
    setBenchReturn(null);
    try {
      const pct = await fetchBenchmarkReturn(bench.symbol, date);
      setBenchReturn(pct);
    } catch {
      setBenchReturn(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (hasFetchedRef.current || !earliestDate) return;
    hasFetchedRef.current = true;
    loadBench(activeBench, earliestDate);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [earliestDate]);

  function handleChipTap(bm: BenchmarkItem) {
    setActiveBench(bm);
    hasFetchedRef.current = false;
    if (earliestDate) {
      hasFetchedRef.current = true;
      loadBench(bm, earliestDate);
    }
  }

  const portfolioReturn = totalInvested > 0
    ? ((totalPortfolioValue - totalInvested) / totalInvested) * 100
    : 0;
  const diff = benchReturn !== null ? portfolioReturn - benchReturn : null;

  if (!isPremium) {
    return (
      <View style={[styles.card, { backgroundColor: theme.backgroundCard, borderColor: theme.border, overflow: "hidden" }]}>
        <Text style={[styles.sectionTitle, { color: theme.text }]}>Benchmark Comparison</Text>
        <View style={styles.benchmarkBlur}>
          <View style={[styles.fakeLine, { backgroundColor: "#C9A84C55", top: 38, width: "80%" }]} />
          <View style={[styles.fakeLine, { backgroundColor: "#8A9BB055", top: 56, width: "90%" }]} />
          <View style={[styles.fakeLine, { backgroundColor: "#C9A84C44", top: 80, width: "65%" }]} />
          <View style={[styles.fakeLine, { backgroundColor: "#8A9BB044", top: 100, width: "75%" }]} />
        </View>
        <View style={styles.premiumOverlay}>
          <TouchableOpacity
            style={[styles.premiumBadge, { backgroundColor: theme.tint + "22", borderColor: theme.tint + "44" }]}
            onPress={onUpgrade}
            activeOpacity={0.8}
          >
            <Feather name="lock" size={16} color={theme.tint} />
            <Text style={[styles.premiumText, { color: theme.tint }]}>Premium Feature</Text>
          </TouchableOpacity>
          <Text style={[styles.premiumSub, { color: theme.textSecondary }]}>
            Upgrade to compare your portfolio{"\n"}against S&P 500, MSCI World, DAX & more
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}>
      <Text style={[styles.sectionTitle, { color: theme.text }]}>Benchmark Comparison</Text>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
        <View style={{ flexDirection: "row", gap: 6 }}>
          {BENCHMARKS.map((bm) => (
            <TouchableOpacity
              key={bm.symbol}
              style={[
                styles.benchChip,
                {
                  backgroundColor: activeBench.symbol === bm.symbol ? theme.deepBlue : theme.backgroundElevated,
                  borderColor: activeBench.symbol === bm.symbol ? theme.tint : theme.border,
                },
              ]}
              onPress={() => handleChipTap(bm)}
            >
              <Text style={[styles.benchChipText, { color: activeBench.symbol === bm.symbol ? theme.tint : theme.textSecondary }]}>
                {bm.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {earliestDate && (
        <Text style={[{ fontSize: 11, fontFamily: "Inter_400Regular", color: theme.textTertiary, marginBottom: 14 }]}>
          Since {earliestDate} (your first purchase)
        </Text>
      )}

      {loading ? (
        <ActivityIndicator size="small" color={theme.tint} style={{ marginVertical: 20 }} />
      ) : (
        <View style={[dStyles.summaryBox, { backgroundColor: theme.backgroundElevated, borderRadius: 10 }]}>
          <SummaryRow label="Your Portfolio" value={portfolioReturn} theme={theme} />
          <SummaryRow label={activeBench.label} value={benchReturn ?? 0} theme={theme} />
          <View style={[dStyles.summaryDivider, { backgroundColor: theme.border }]} />
          <View style={dStyles.summaryRow}>
            <Text style={[dStyles.summaryLabel, { color: theme.textSecondary }]}>Difference</Text>
            {diff !== null ? (
              <Text style={[dStyles.summaryValue, { color: diff >= 0 ? theme.positive : theme.negative }]}>
                {diff >= 0 ? "+" : ""}{diff.toFixed(2)}%{" "}
                <Text style={[dStyles.summaryNote, { color: diff >= 0 ? theme.positive : theme.negative }]}>
                  ({diff >= 0 ? "outperforming" : "underperforming"})
                </Text>
              </Text>
            ) : (
              <Text style={[dStyles.summaryValue, { color: theme.textTertiary }]}>—</Text>
            )}
          </View>
        </View>
      )}

      {diff !== null && diff < 0 && (
        <Text style={[dStyles.disclaimer, { color: theme.textTertiary, fontStyle: "italic", marginTop: 10, fontSize: 11, lineHeight: 17 }]}>
          Your portfolio includes defensive assets (bonds, gold) which reduce volatility and drawdowns but may lag pure equity benchmarks during strong bull markets. This is by design, not underperformance.
        </Text>
      )}

      <Text style={[dStyles.disclaimer, { color: theme.textTertiary }]}>
        Portfolio return based on avg cost vs current price. Benchmark return over same period.
      </Text>
    </View>
  );
}

// ─── Portfolio Value Chart ─────────────────────────────────────────────────────

const CHART_H = 160;
const PAD = { top: 10, bottom: 28, left: 56, right: 20 };

interface ChartPt { x: number; y: number }

function PortfolioChart({
  snapshots,
  width,
}: {
  snapshots: PortfolioSnapshot[];
  width: number;
}) {
  const theme = Colors.dark;

  const data = snapshots.map((s) => s.totalValueEUR);
  if (data.length < 2) return null;

  const innerW = width - PAD.left - PAD.right;
  const innerH = CHART_H - PAD.top - PAD.bottom;

  const minV = Math.min(...data);
  const maxV = Math.max(...data);
  const rawRange = maxV - minV || maxV * 0.1 || 1;
  const pad = rawRange * 0.05;
  const displayMin = minV - pad;
  const displayMax = maxV + pad;
  const rangeV = displayMax - displayMin;

  const isPositive = data[data.length - 1] >= data[0];
  const lineColor = isPositive ? "#34D399" : "#F87171";

  const points: ChartPt[] = data.map((v, i) => ({
    x: PAD.left + (i / (data.length - 1)) * innerW,
    y: PAD.top + (1 - (v - displayMin) / rangeV) * innerH,
  }));

  const segments = points.slice(0, -1).map((p1, i) => {
    const p2 = points[i + 1];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    const cx = (p1.x + p2.x) / 2;
    const cy = (p1.y + p2.y) / 2;
    return { cx, cy, length, angle };
  });

  const yLabels = [0, 1, 2, 3].map((i) => {
    const frac = i / 3;
    return {
      y: PAD.top + frac * innerH,
      v: displayMax - frac * rangeV,
    };
  });

  const xLabels: { x: number; label: string }[] = [
    { x: PAD.left, label: fmtDate(snapshots[0].snapshotDate) },
    { x: PAD.left + innerW, label: fmtDate(snapshots[snapshots.length - 1].snapshotDate) },
  ];
  if (snapshots.length >= 3) {
    const mid = Math.floor(snapshots.length / 2);
    xLabels.splice(1, 0, { x: PAD.left + innerW / 2, label: fmtDate(snapshots[mid].snapshotDate) });
  }

  return (
    <View style={{ width, height: CHART_H, position: "relative", overflow: "hidden" }}>
      {yLabels.map((lbl, i) => (
        <View key={i} style={[styles.gridLine, { top: lbl.y, left: PAD.left, right: PAD.right, borderColor: theme.border }]} />
      ))}
      {yLabels.map((lbl, i) => (
        <Text key={i} style={[styles.chartYLabel, { top: lbl.y - 8, color: theme.textTertiary }]}>
          {fmtK(lbl.v)}
        </Text>
      ))}
      {segments.map((seg, i) => (
        <View
          key={i}
          style={{
            position: "absolute",
            left: seg.cx - seg.length / 2,
            top: seg.cy - 1.5,
            width: seg.length,
            height: 3,
            backgroundColor: lineColor,
            borderRadius: 2,
            transform: [{ rotate: `${seg.angle}deg` }],
          }}
        />
      ))}
      <View style={[styles.chartDot, { left: points[0].x - 4, top: points[0].y - 4, backgroundColor: lineColor }]} />
      <View style={[styles.chartDot, { left: points[points.length - 1].x - 4, top: points[points.length - 1].y - 4, backgroundColor: lineColor }]} />
      {xLabels.map((lbl, i) => (
        <Text
          key={i}
          style={[
            styles.chartXLabel,
            {
              color: theme.textTertiary,
              left: i === 0 ? PAD.left : undefined,
              right: i === xLabels.length - 1 ? PAD.right : undefined,
              bottom: 0,
              ...(i > 0 && i < xLabels.length - 1 ? { left: lbl.x - 20, width: 40, textAlign: "center" } : {}),
            },
          ]}
        >
          {lbl.label}
        </Text>
      ))}
    </View>
  );
}

function fmtDate(iso: string): string {
  const [, mm, dd] = iso.split("-");
  return `${dd}/${mm}`;
}

function fmtK(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  if (v >= 100) return `${v.toFixed(0)}`;
  return `${v.toFixed(1)}`;
}

// ─── Main Screen ───────────────────────────────────────────────────────────────

export default function PerformanceScreen() {
  const theme = Colors.dark;
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const topPad = Platform.OS === "web" ? 24 : insets.top;
  const bottomPad = Platform.OS === "web" ? 80 : insets.bottom + 80;

  const { holdings, totalPortfolioValue, totalInvested, totalGain, totalGainPct } = usePortfolio();
  const { targets, rebalanceThreshold } = useAllocation();

  const [selectedRange, setSelectedRange] = useState<Range>("1M");
  const [historySnapshots, setHistorySnapshots] = useState<PortfolioSnapshot[]>([]);
  const [loadingChart, setLoadingChart] = useState(true);
  const [buildingHistory, setBuildingHistory] = useState(false);

  const [isPremium, setIsPremium] = useState(true); // TODO: wire to RevenueCat before release
  const [defaultBenchmark, setDefaultBenchmark] = useState<BenchmarkItem>(DEFAULT_BENCHMARK);
  const [showPremium, setShowPremium] = useState(false);

  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem("folvio_is_premium"),
      AsyncStorage.getItem("folvio_default_benchmark"),
    ]).then(([ip, bm]) => {
      if (ip === "true") setIsPremium(true);
      if (bm) {
        const found = BENCHMARKS.find((b) => b.symbol === bm || b.label === bm);
        if (found) setDefaultBenchmark(found);
      }
    }).catch(() => {});
  }, []);

  // Reload from DB when range selector changes
  useEffect(() => {
    let cancelled = false;
    setLoadingChart(true);
    getPortfolioHistory(selectedRange)
      .then((data) => {
        if (!cancelled) {
          setHistorySnapshots(data);
          setLoadingChart(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoadingChart(false);
      });
    return () => { cancelled = true; };
  }, [selectedRange]);

  // Backfill historical prices in background when holdings change
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const holdingsKey = (holdings as any[]).map((h) => `${h.ticker ?? ""}${h.quantity ?? ""}`).join(",");
  useEffect(() => {
    if (!holdingsKey) return;
    setBuildingHistory(true);
    buildPortfolioHistory(holdings as unknown as HoldingRow[])
      .then(() => getPortfolioHistory(selectedRange))
      .then((data) => setHistorySnapshots(data))
      .catch(console.warn)
      .finally(() => setBuildingHistory(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdingsKey]);

  const riskProfile = useMemo(() => computeRiskProfile(holdings), [holdings]);

  const allocationRows = useMemo(
    () => calculateAllocations(holdings, targets, rebalanceThreshold),
    [holdings, targets, rebalanceThreshold]
  );
  const validation = useMemo(() => validateTargets(targets), [targets]);
  const needsRebalancing = allocationRows.filter(
    (r) => r.status === "overweight" || r.status === "underweight"
  ).length;

  const metrics = useMemo(() => {
    const dates = holdings.map((h) => h.purchase_date).filter(Boolean).sort();
    let timeInMarketMonths = 0;
    if (dates.length > 0) {
      const oldest = new Date(dates[0]).getTime();
      timeInMarketMonths = Math.floor((Date.now() - oldest) / (1000 * 60 * 60 * 24 * 30.44));
    }

    let bestETF: { ticker: string; returnPct: number } | null = null;
    let worstETF: { ticker: string; returnPct: number } | null = null;
    for (const h of holdings) {
      if (!h.hasPrice || h.avg_cost_eur <= 0) continue;
      const ret = ((h.currentPrice - h.avg_cost_eur) / h.avg_cost_eur) * 100;
      if (!bestETF || ret > bestETF.returnPct) bestETF = { ticker: h.ticker, returnPct: ret };
      if (!worstETF || ret < worstETF.returnPct) worstETF = { ticker: h.ticker, returnPct: ret };
    }

    const estimatedAnnualDividend = holdings.reduce((sum, h) => {
      const y = h.yield_pct ?? 0;
      if (!y || !h.hasPrice) return sum;
      return sum + h.quantity * h.currentPrice * (y / 100);
    }, 0);

    return { timeInMarketMonths, bestETF, worstETF, estimatedAnnualDividend };
  }, [holdings]);

  const chartWidth = width - 32;
  const hasEnoughData = historySnapshots.length >= 2;

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.background }]}
      contentContainerStyle={[styles.content, { paddingTop: topPad + 12, paddingBottom: bottomPad }]}
      showsVerticalScrollIndicator={false}
    >
      <Text style={[styles.pageTitle, { color: theme.text }]}>Performance</Text>

      {/* Rebalance entry card */}
      <TouchableOpacity
        style={[
          styles.rebalanceCard,
          { backgroundColor: theme.backgroundCard, borderColor: needsRebalancing > 0 ? "#FBBF24" : theme.border },
        ]}
        onPress={() => router.push("/rebalance" as never)}
        activeOpacity={0.8}
      >
        <View style={styles.rebalanceLeft}>
          <View style={[styles.rebalanceIcon, { backgroundColor: needsRebalancing > 0 ? "#FBBF2422" : theme.backgroundElevated }]}>
            <Feather name="sliders" size={20} color={needsRebalancing > 0 ? "#FBBF24" : theme.tint} />
          </View>
          <View>
            <Text style={[styles.rebalanceTitle, { color: theme.text }]}>Rebalance Calculator</Text>
            {validation.valid ? (
              <Text style={[styles.rebalanceSub, { color: needsRebalancing > 0 ? "#FBBF24" : theme.positive }]}>
                {needsRebalancing > 0
                  ? `${needsRebalancing} holding${needsRebalancing > 1 ? "s" : ""} outside ±${rebalanceThreshold}% threshold`
                  : "Portfolio is balanced"}
              </Text>
            ) : (
              <Text style={[styles.rebalanceSub, { color: theme.textSecondary }]}>
                Set target allocations in Settings
              </Text>
            )}
          </View>
        </View>
        <Feather name="chevron-right" size={18} color={theme.textTertiary} />
      </TouchableOpacity>

      {/* ── Risk Profile Card ─────────────────────────────────────────────── */}
      {riskProfile && <RiskProfileCard profile={riskProfile} />}

      {/* ── Section 1: Portfolio Value Chart ──────────────────────────────── */}
      <View style={[styles.card, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}>
        <View style={styles.chartHeader}>
          <Text style={[styles.sectionTitle, { color: theme.text, marginBottom: 0 }]}>Portfolio Value</Text>
          <View style={styles.rangeRow}>
            {PERF_RANGES.map((r) => (
              <TouchableOpacity
                key={r}
                style={[
                  styles.rangeBtn,
                  {
                    backgroundColor: selectedRange === r ? theme.tint + "22" : "transparent",
                    borderColor: selectedRange === r ? theme.tint : "transparent",
                  },
                ]}
                onPress={() => setSelectedRange(r)}
              >
                <Text style={[styles.rangeBtnText, { color: selectedRange === r ? theme.tint : theme.textTertiary }]}>
                  {r}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {loadingChart ? (
          <View style={styles.chartPlaceholder}>
            <ActivityIndicator size="small" color={theme.tint} />
          </View>
        ) : hasEnoughData ? (
          <>
            <PortfolioChart snapshots={historySnapshots} width={chartWidth} />
            {buildingHistory && (
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingTop: 4 }}>
                <ActivityIndicator size="small" color={theme.tint} />
                <Text style={{ color: theme.textTertiary, fontSize: 11 }}>Updating…</Text>
              </View>
            )}
          </>
        ) : buildingHistory ? (
          <View style={styles.chartPlaceholder}>
            <ActivityIndicator size="small" color={theme.tint} />
            <Text style={[styles.chartEmptyTitle, { color: theme.text }]}>Fetching price history</Text>
            <Text style={[styles.chartEmptySub, { color: theme.textSecondary }]}>
              Downloading historical prices for your holdings…
            </Text>
          </View>
        ) : (
          <View style={styles.chartPlaceholder}>
            <Feather name="trending-up" size={28} color={theme.textTertiary} />
            <Text style={[styles.chartEmptyTitle, { color: theme.text }]}>No history yet</Text>
            <Text style={[styles.chartEmptySub, { color: theme.textSecondary }]}>
              Add holdings with a purchase date to see your portfolio value over time.
            </Text>
          </View>
        )}
      </View>

      {/* ── Section 2: Return Metrics 2×2 grid ───────────────────────────── */}
      <View style={styles.metricsGrid}>
        <View style={[styles.metricCard, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}>
          <Text style={[styles.metricLabel, { color: theme.textSecondary }]}>Total Return</Text>
          <Text style={[styles.metricValue, { color: totalGain >= 0 ? theme.positive : theme.negative }]}>
            {totalGain >= 0 ? "+" : ""}{formatEUR(totalGain, true)}
          </Text>
          <Text style={[styles.metricSub, { color: totalGain >= 0 ? theme.positive : theme.negative }]}>
            {formatPct(totalGainPct)}
          </Text>
        </View>

        <View style={[styles.metricCard, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}>
          <Text style={[styles.metricLabel, { color: theme.textSecondary }]}>Time in Market</Text>
          <Text style={[styles.metricValue, { color: theme.text }]}>{metrics.timeInMarketMonths}</Text>
          <Text style={[styles.metricSub, { color: theme.textSecondary }]}>months</Text>
        </View>

        <View style={[styles.metricCard, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}>
          <Text style={[styles.metricLabel, { color: theme.textSecondary }]}>Best ETF</Text>
          {metrics.bestETF ? (
            <>
              <Text style={[styles.metricValue, { color: theme.positive }]}>{metrics.bestETF.ticker}</Text>
              <Text style={[styles.metricSub, { color: theme.positive }]}>+{metrics.bestETF.returnPct.toFixed(2)}%</Text>
            </>
          ) : (
            <Text style={[styles.metricValue, { color: theme.textTertiary }]}>—</Text>
          )}
        </View>

        <View style={[styles.metricCard, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}>
          <Text style={[styles.metricLabel, { color: theme.textSecondary }]}>Worst ETF</Text>
          {metrics.worstETF && metrics.worstETF.ticker !== metrics.bestETF?.ticker ? (
            <>
              <Text style={[styles.metricValue, { color: theme.negative }]}>{metrics.worstETF.ticker}</Text>
              <Text style={[styles.metricSub, { color: theme.negative }]}>{metrics.worstETF.returnPct.toFixed(2)}%</Text>
            </>
          ) : metrics.worstETF ? (
            <>
              <Text style={[styles.metricValue, { color: theme.negative }]}>{metrics.worstETF.ticker}</Text>
              <Text style={[styles.metricSub, { color: theme.negative }]}>{metrics.worstETF.returnPct.toFixed(2)}%</Text>
            </>
          ) : (
            <Text style={[styles.metricValue, { color: theme.textTertiary }]}>—</Text>
          )}
        </View>
      </View>

      {/* ── Section 3: Benchmark Comparison ──────────────────────────────── */}
      <BenchmarkComparisonSection
        isPremium={isPremium}
        defaultBenchmark={defaultBenchmark}
        onUpgrade={() => setShowPremium(true)}
        width={chartWidth + 32}
      />

      {/* ── Section 4: Crisis Backtest ────────────────────────────────────── */}
      <CrisisBacktestSection />

      {/* ── Section 5: Dividend Estimate ─────────────────────────────────── */}
      <View style={[styles.card, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}>
        <Text style={[styles.sectionTitle, { color: theme.text }]}>Dividend Estimate</Text>
        <View style={[styles.dividendBox, { backgroundColor: theme.backgroundElevated }]}>
          <Text style={[styles.dividendLabel, { color: theme.textSecondary }]}>Estimated annual income</Text>
          <Text style={[styles.dividendValue, { color: "#C9A84C" }]}>
            {formatEUR(metrics.estimatedAnnualDividend)}/yr
          </Text>
        </View>
        {metrics.estimatedAnnualDividend === 0 && (
          <Text style={[styles.dividendHint, { color: theme.textTertiary }]}>
            Add a trailing yield % to your holdings in the Holdings tab to see your estimated income.
          </Text>
        )}
        <Text style={[styles.dividendDisclaimer, { color: theme.textTertiary }]}>
          Based on trailing yield. Not guaranteed.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 14 },
  pageTitle: { fontSize: 28, fontFamily: "Inter_700Bold", letterSpacing: -0.8, marginBottom: 2 },

  rebalanceCard: {
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  rebalanceLeft: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  rebalanceIcon: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  rebalanceTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  rebalanceSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },

  card: { borderRadius: 16, padding: 18, borderWidth: 1 },
  sectionTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 14 },
  chartHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  rangeRow: { flexDirection: "row", gap: 2 },
  rangeBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  rangeBtnText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  chartPlaceholder: {
    height: CHART_H,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 24,
  },
  chartEmptyTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginTop: 4 },
  chartEmptySub: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 18 },

  gridLine: { position: "absolute", height: 1, borderTopWidth: StyleSheet.hairlineWidth },
  chartYLabel: {
    position: "absolute",
    left: 0,
    width: PAD.left - 6,
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    textAlign: "right",
  },
  chartXLabel: { position: "absolute", fontSize: 10, fontFamily: "Inter_400Regular" },
  chartDot: { position: "absolute", width: 8, height: 8, borderRadius: 4 },

  metricsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  metricCard: {
    flex: 1,
    minWidth: "45%",
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 4,
  },
  metricLabel: { fontSize: 11, fontFamily: "Inter_500Medium", letterSpacing: 0.3 },
  metricValue: { fontSize: 20, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  metricSub: { fontSize: 12, fontFamily: "Inter_500Medium" },

  benchmarkBlur: { height: 140, position: "relative", marginBottom: 0 },
  fakeLine: { position: "absolute", height: 2, borderRadius: 1, left: 0 },
  premiumOverlay: {
    position: "absolute",
    top: 30,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  premiumBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  premiumText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  premiumSub: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 18 },

  benchChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  benchChipText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },

  dividendBox: {
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    gap: 6,
    marginBottom: 10,
  },
  dividendLabel: { fontSize: 12, fontFamily: "Inter_400Regular" },
  dividendValue: { fontSize: 28, fontFamily: "Inter_700Bold", letterSpacing: -0.8 },
  dividendHint: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 18,
    marginBottom: 8,
  },
  dividendDisclaimer: { fontSize: 11, fontFamily: "Inter_400Regular", textAlign: "center", fontStyle: "italic" },
});

const crisisStyles = StyleSheet.create({
  subtitle: { fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 16, lineHeight: 18 },
  selectorScroll: { marginBottom: 16 },
  selectorRow: { flexDirection: "row", gap: 8 },
  crisisChip: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderWidth: 1, minWidth: 120 },
  crisisName: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  crisisDate: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 2 },
  warningBox: { flexDirection: "row", alignItems: "flex-start", gap: 6, borderWidth: 1, borderRadius: 8, padding: 10, marginBottom: 12 },
  warningText: { fontSize: 11, fontFamily: "Inter_400Regular", flex: 1, lineHeight: 16 },
  metricBlock: { borderRadius: 12, padding: 14, gap: 10, marginBottom: 10 },
  metricTitle: { fontSize: 11, fontFamily: "Inter_500Medium", letterSpacing: 0.3 },
  metricRow: { flexDirection: "row", alignItems: "center" },
  metricHalf: { flex: 1, alignItems: "center", gap: 4 },
  metricDivider: { width: 1, height: 40, marginHorizontal: 8 },
  metricBig: { fontSize: 22, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  metricSmall: { fontSize: 11, fontFamily: "Inter_400Regular" },
  metricNote: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
  metricCaption: { fontSize: 11, fontFamily: "Inter_400Regular" },
  emptyHint: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", padding: 20 },
});
