import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
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
import { getSnapshots, type PortfolioSnapshot } from "@/services/snapshotService";
import { fetchChartHistory, type ChartPoint } from "@/services/priceService";

// ─── Benchmark definitions ─────────────────────────────────────────────────────

export const BENCHMARKS = [
  { label: "S&P 500",       symbol: "^GSPC",     description: "US large cap 500 companies" },
  { label: "MSCI World",    symbol: "IWDA.AS",   description: "Developed markets ~1,500 companies" },
  { label: "Euro Stoxx 50", symbol: "^STOXX50E", description: "50 largest Eurozone companies" },
  { label: "FTSE All-World",symbol: "VWRL.AS",   description: "Global all-cap index" },
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
  const [range, setRange] = useState<BenchRange>("1M");
  const [activeBench, setActiveBench] = useState<BenchmarkItem>(defaultBenchmark);
  const [snapshots, setSnapshots] = useState<PortfolioSnapshot[]>([]);
  const [benchData, setBenchData] = useState<ChartPoint[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setActiveBench(defaultBenchmark);
  }, [defaultBenchmark]);

  const loadData = useCallback(async () => {
    if (!isPremium) return;
    setLoading(true);
    try {
      const [snaps, bench] = await Promise.all([
        getSnapshots(range),
        fetchChartHistory(activeBench.symbol, range),
      ]);
      setSnapshots(snaps);
      setBenchData(bench);
    } finally {
      setLoading(false);
    }
  }, [isPremium, range, activeBench]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const { portfolioNorm, benchNorm } = useMemo(() => {
    const portValues = snapshots.map((s) => s.totalValueEUR).filter((v) => v > 0);
    const benchValues = benchData.map((b) => b.priceEUR).filter((v) => v > 0);

    if (portValues.length < 2 || benchValues.length < 2) {
      return { portfolioNorm: portValues.length >= 2 ? portValues.map((v) => (v / portValues[0]) * 100) : [], benchNorm: benchValues.length >= 2 ? benchValues.map((v) => (v / benchValues[0]) * 100) : [] };
    }

    const portStart = portValues[0];
    const benchStart = benchValues[0];
    return {
      portfolioNorm: portValues.map((v) => (v / portStart) * 100),
      benchNorm: benchValues.map((v) => (v / benchStart) * 100),
    };
  }, [snapshots, benchData]);

  const hasPortfolioData = portfolioNorm.length >= 2;
  const hasBenchData = benchNorm.length >= 2;

  if (!isPremium) {
    return (
      <View style={[styles.card, { backgroundColor: theme.backgroundCard, borderColor: theme.border, overflow: "hidden" }]}>
        <Text style={[styles.sectionTitle, { color: theme.text }]}>Benchmark Comparison</Text>
        <View style={styles.benchmarkBlur}>
          <View style={[styles.fakeLine, { backgroundColor: "#C9A84C55", top: 38, width: "80%" }]} />
          <View style={[styles.fakeLine, { backgroundColor: "#8A9BB055", top: 56, width: "90%", borderStyle: "dashed" }]} />
          <View style={[styles.fakeLine, { backgroundColor: "#C9A84C44", top: 80, width: "65%" }]} />
          <View style={[styles.fakeLine, { backgroundColor: "#8A9BB044", top: 100, width: "75%" }]} />
          <View style={[styles.fakeLine, { backgroundColor: "#C9A84C33", top: 118, width: "85%" }]} />
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
      {/* Title row */}
      <View style={styles.chartHeader}>
        <Text style={[styles.sectionTitle, { color: theme.text, marginBottom: 0 }]}>Benchmark Comparison</Text>
        <View style={styles.rangeRow}>
          {BENCH_RANGES.map((r) => (
            <TouchableOpacity
              key={r}
              style={[
                styles.rangeBtn,
                {
                  backgroundColor: range === r ? theme.tint + "22" : "transparent",
                  borderColor: range === r ? theme.tint : "transparent",
                },
              ]}
              onPress={() => setRange(r)}
            >
              <Text style={[styles.rangeBtnText, { color: range === r ? theme.tint : theme.textTertiary }]}>
                {r}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Benchmark picker */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
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
              onPress={() => setActiveBench(bm)}
            >
              <Text style={[styles.benchChipText, { color: activeBench.symbol === bm.symbol ? theme.tint : theme.textSecondary }]}>
                {bm.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* Chart area */}
      {loading ? (
        <View style={[styles.chartPlaceholder, { height: BCHART_H }]}>
          <ActivityIndicator size="small" color={theme.tint} />
        </View>
      ) : !hasPortfolioData && !hasBenchData ? (
        <View style={[styles.chartPlaceholder, { height: BCHART_H }]}>
          <Feather name="bar-chart-2" size={28} color={theme.textTertiary} />
          <Text style={[styles.chartEmptyTitle, { color: theme.text }]}>No data yet</Text>
          <Text style={[styles.chartEmptySub, { color: theme.textSecondary }]}>
            Build portfolio history by opening the app daily. Benchmark data requires a live connection.
          </Text>
        </View>
      ) : (
        <DualLineChart
          portfolioNorm={portfolioNorm}
          benchNorm={benchNorm}
          portfolioLabel="Your Portfolio"
          benchLabel={activeBench.label}
          width={width - 36}
        />
      )}
    </View>
  );
}

// ─── Portfolio Value Chart ─────────────────────────────────────────────────────

const CHART_H = 160;
const PAD = { top: 10, bottom: 28, left: 56, right: 8 };

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
  const rangeV = maxV - minV || 1;

  const isPositive = data[data.length - 1] >= data[0];
  const lineColor = isPositive ? "#34D399" : "#F87171";

  const points: ChartPt[] = data.map((v, i) => ({
    x: PAD.left + (i / (data.length - 1)) * innerW,
    y: PAD.top + (1 - (v - minV) / rangeV) * innerH,
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

  const yLabels = [
    { y: PAD.top, v: maxV },
    { y: PAD.top + innerH / 2, v: (maxV + minV) / 2 },
    { y: PAD.top + innerH, v: minV },
  ];

  const xLabels: { x: number; label: string }[] = [
    { x: PAD.left, label: fmtDate(snapshots[0].snapshotDate) },
    { x: PAD.left + innerW, label: fmtDate(snapshots[snapshots.length - 1].snapshotDate) },
  ];
  if (snapshots.length >= 3) {
    const mid = Math.floor(snapshots.length / 2);
    xLabels.splice(1, 0, { x: PAD.left + innerW / 2, label: fmtDate(snapshots[mid].snapshotDate) });
  }

  return (
    <View style={{ width, height: CHART_H, position: "relative" }}>
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
  if (v >= 1000) return `${(v / 1000).toFixed(0)}k`;
  return `${v.toFixed(0)}`;
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
  const [snapshots, setSnapshots] = useState<PortfolioSnapshot[]>([]);
  const [loadingChart, setLoadingChart] = useState(true);

  const [isPremium, setIsPremium] = useState(false);
  const [defaultBenchmark, setDefaultBenchmark] = useState<BenchmarkItem>(DEFAULT_BENCHMARK);
  const [showPremium, setShowPremium] = useState(false);

  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem("fortis_is_premium"),
      AsyncStorage.getItem("fortis_default_benchmark"),
    ]).then(([ip, bm]) => {
      if (ip === "true") setIsPremium(true);
      if (bm) {
        const found = BENCHMARKS.find((b) => b.symbol === bm || b.label === bm);
        if (found) setDefaultBenchmark(found);
      }
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoadingChart(true);
    getSnapshots(selectedRange).then((data) => {
      if (!cancelled) {
        setSnapshots(data);
        setLoadingChart(false);
      }
    });
    return () => { cancelled = true; };
  }, [selectedRange]);

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
  const hasEnoughData = snapshots.length >= 7;

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
        ) : !hasEnoughData ? (
          <View style={styles.chartPlaceholder}>
            <Feather name="trending-up" size={28} color={theme.textTertiary} />
            <Text style={[styles.chartEmptyTitle, { color: theme.text }]}>Keep tracking</Text>
            <Text style={[styles.chartEmptySub, { color: theme.textSecondary }]}>
              Open the app daily to build your portfolio history. Chart appears after 7 days of data.
            </Text>
          </View>
        ) : (
          <PortfolioChart snapshots={snapshots} width={chartWidth} />
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
            {totalGain >= 0 ? "+" : ""}{formatPct(totalGainPct)}
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

      {/* ── Section 4: Dividend Estimate ─────────────────────────────────── */}
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
