import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useColorScheme,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { usePortfolio } from "@/context/PortfolioContext";
import { useAllocation } from "@/context/AllocationContext";
import { formatEUR, formatPct } from "@/utils/format";
import { calculateAllocations, validateTargets } from "@/services/allocationService";
import { getSnapshots, type PortfolioSnapshot } from "@/services/snapshotService";

const RANGES = ["1W", "1M", "3M", "1Y", "All"] as const;
type Range = (typeof RANGES)[number];

// ─── Custom Line Chart ────────────────────────────────────────────────────────

const CHART_H = 160;
const PAD = { top: 10, bottom: 28, left: 56, right: 8 };

interface ChartPoint { x: number; y: number }

function PortfolioChart({
  snapshots,
  width,
}: {
  snapshots: PortfolioSnapshot[];
  width: number;
}) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const theme = isDark ? Colors.dark : Colors.light;

  const data = snapshots.map((s) => s.totalValueEUR);
  if (data.length < 2) return null;

  const innerW = width - PAD.left - PAD.right;
  const innerH = CHART_H - PAD.top - PAD.bottom;

  const minV = Math.min(...data);
  const maxV = Math.max(...data);
  const rangeV = maxV - minV || 1;

  const isPositive = data[data.length - 1] >= data[0];
  const lineColor = isPositive ? "#34D399" : "#F87171";

  const points: ChartPoint[] = data.map((v, i) => ({
    x: PAD.left + (i / (data.length - 1)) * innerW,
    y: PAD.top + (1 - (v - minV) / rangeV) * innerH,
  }));

  // Build line segments using View rotation trick
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

  // Y-axis reference values
  const yLabels = [
    { y: PAD.top, v: maxV },
    { y: PAD.top + innerH / 2, v: (maxV + minV) / 2 },
    { y: PAD.top + innerH, v: minV },
  ];

  // X-axis date labels (first, last; middle if 3+ months)
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
      {/* Y-axis grid lines */}
      {yLabels.map((lbl, i) => (
        <View
          key={i}
          style={[
            styles.gridLine,
            {
              top: lbl.y,
              left: PAD.left,
              right: PAD.right,
              borderColor: theme.border,
            },
          ]}
        />
      ))}

      {/* Y-axis labels */}
      {yLabels.map((lbl, i) => (
        <Text
          key={i}
          style={[styles.chartYLabel, { top: lbl.y - 8, color: theme.textTertiary }]}
        >
          {fmtK(lbl.v)}
        </Text>
      ))}

      {/* Line segments */}
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

      {/* Start dot */}
      <View
        style={[
          styles.chartDot,
          { left: points[0].x - 4, top: points[0].y - 4, backgroundColor: lineColor },
        ]}
      />
      {/* End dot */}
      <View
        style={[
          styles.chartDot,
          {
            left: points[points.length - 1].x - 4,
            top: points[points.length - 1].y - 4,
            backgroundColor: lineColor,
          },
        ]}
      />

      {/* X-axis labels */}
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
              ...(i > 0 && i < xLabels.length - 1
                ? { left: lbl.x - 20, width: 40, textAlign: "center" }
                : {}),
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

// ─── Benchmark Placeholder ────────────────────────────────────────────────────

function BenchmarkSection({ theme }: { theme: typeof Colors.dark }) {
  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundCard, borderColor: theme.border, overflow: "hidden" }]}>
      <Text style={[styles.sectionTitle, { color: theme.text }]}>Benchmark Comparison</Text>
      <View style={styles.benchmarkBlur}>
        {/* Fake chart lines */}
        <View style={[styles.fakeLine, { backgroundColor: "#34D39966", top: 40, width: "85%" }]} />
        <View style={[styles.fakeLine, { backgroundColor: "#C9A84C66", top: 60, width: "75%" }]} />
        <View style={[styles.fakeLine, { backgroundColor: "#34D39944", top: 80, width: "90%" }]} />
        <View style={[styles.fakeLine, { backgroundColor: "#C9A84C44", top: 100, width: "70%" }]} />
      </View>
      <View style={styles.premiumOverlay}>
        <View style={[styles.premiumBadge, { backgroundColor: theme.tint + "22", borderColor: theme.tint + "44" }]}>
          <Feather name="lock" size={16} color={theme.tint} />
          <Text style={[styles.premiumText, { color: theme.tint }]}>Premium Feature</Text>
        </View>
        <Text style={[styles.premiumSub, { color: theme.textSecondary }]}>
          Upgrade to compare your portfolio against{"\n"}VWCE, IWDA, and SWDA benchmarks
        </Text>
      </View>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function PerformanceScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const theme = isDark ? Colors.dark : Colors.light;
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const topPad = Platform.OS === "web" ? 24 : insets.top;
  const bottomPad = Platform.OS === "web" ? 80 : insets.bottom + 80;

  const { holdings, totalPortfolioValue, totalInvested, totalGain, totalGainPct } = usePortfolio();
  const { targets, rebalanceThreshold } = useAllocation();

  const [selectedRange, setSelectedRange] = useState<Range>("1M");
  const [snapshots, setSnapshots] = useState<PortfolioSnapshot[]>([]);
  const [loadingChart, setLoadingChart] = useState(true);

  // Load snapshots when range changes
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

  // Rebalance status
  const allocationRows = useMemo(
    () => calculateAllocations(holdings, targets, rebalanceThreshold),
    [holdings, targets, rebalanceThreshold]
  );
  const validation = useMemo(() => validateTargets(targets), [targets]);
  const needsRebalancing = allocationRows.filter(
    (r) => r.status === "overweight" || r.status === "underweight"
  ).length;

  // Return metrics
  const metrics = useMemo(() => {
    // Time in market
    const dates = holdings.map((h) => h.purchase_date).filter(Boolean).sort();
    let timeInMarketMonths = 0;
    if (dates.length > 0) {
      const oldest = new Date(dates[0]).getTime();
      const now = Date.now();
      timeInMarketMonths = Math.floor((now - oldest) / (1000 * 60 * 60 * 24 * 30.44));
    }

    // Best / Worst ETF
    let bestETF: { ticker: string; returnPct: number } | null = null;
    let worstETF: { ticker: string; returnPct: number } | null = null;
    for (const h of holdings) {
      if (!h.hasPrice || h.avg_cost_eur <= 0) continue;
      const ret = ((h.currentPrice - h.avg_cost_eur) / h.avg_cost_eur) * 100;
      if (!bestETF || ret > bestETF.returnPct) bestETF = { ticker: h.ticker, returnPct: ret };
      if (!worstETF || ret < worstETF.returnPct) worstETF = { ticker: h.ticker, returnPct: ret };
    }

    // Annual dividend estimate from user-entered yield_pct
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
            {RANGES.map((r) => (
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
          <Text style={[styles.metricValue, { color: theme.text }]}>
            {metrics.timeInMarketMonths}
          </Text>
          <Text style={[styles.metricSub, { color: theme.textSecondary }]}>months</Text>
        </View>

        <View style={[styles.metricCard, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}>
          <Text style={[styles.metricLabel, { color: theme.textSecondary }]}>Best ETF</Text>
          {metrics.bestETF ? (
            <>
              <Text style={[styles.metricValue, { color: theme.positive }]}>
                {metrics.bestETF.ticker}
              </Text>
              <Text style={[styles.metricSub, { color: theme.positive }]}>
                +{metrics.bestETF.returnPct.toFixed(2)}%
              </Text>
            </>
          ) : (
            <Text style={[styles.metricValue, { color: theme.textTertiary }]}>—</Text>
          )}
        </View>

        <View style={[styles.metricCard, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}>
          <Text style={[styles.metricLabel, { color: theme.textSecondary }]}>Worst ETF</Text>
          {metrics.worstETF && metrics.worstETF.ticker !== metrics.bestETF?.ticker ? (
            <>
              <Text style={[styles.metricValue, { color: theme.negative }]}>
                {metrics.worstETF.ticker}
              </Text>
              <Text style={[styles.metricSub, { color: theme.negative }]}>
                {metrics.worstETF.returnPct.toFixed(2)}%
              </Text>
            </>
          ) : metrics.worstETF ? (
            <>
              <Text style={[styles.metricValue, { color: theme.negative }]}>
                {metrics.worstETF.ticker}
              </Text>
              <Text style={[styles.metricSub, { color: theme.negative }]}>
                {metrics.worstETF.returnPct.toFixed(2)}%
              </Text>
            </>
          ) : (
            <Text style={[styles.metricValue, { color: theme.textTertiary }]}>—</Text>
          )}
        </View>
      </View>

      {/* ── Section 3: Benchmark Comparison (Premium) ─────────────────────── */}
      <BenchmarkSection theme={theme} />

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

  // Rebalance card
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

  // Chart card
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

  // Chart internals
  gridLine: { position: "absolute", height: 1, borderTopWidth: StyleSheet.hairlineWidth },
  chartYLabel: {
    position: "absolute",
    left: 0,
    width: PAD.left - 6,
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    textAlign: "right",
  },
  chartXLabel: {
    position: "absolute",
    fontSize: 10,
    fontFamily: "Inter_400Regular",
  },
  chartDot: {
    position: "absolute",
    width: 8,
    height: 8,
    borderRadius: 4,
  },

  // Metrics 2x2 grid
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

  // Benchmark section
  benchmarkBlur: { height: 130, position: "relative", marginBottom: 0 },
  fakeLine: {
    position: "absolute",
    height: 2,
    borderRadius: 1,
    left: 0,
  },
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

  // Dividend
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
