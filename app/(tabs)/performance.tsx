import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useMemo, useRef, useState } from "react";
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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { usePortfolio } from "@/context/PortfolioContext";
import { useSubscription } from "@/context/SubscriptionContext";
import { formatPct } from "@/utils/format";
import { formatEUR } from "@/utils/format";
import { type PortfolioSnapshot } from "@/services/snapshotService";
import { fetchBenchmarkReturn } from "@/services/priceService";
import { buildPortfolioHistory, getPortfolioHistory } from "@/services/portfolioHistoryService";
import type { HoldingRow } from "@/services/db";

// ─── Benchmark definitions ─────────────────────────────────────────────────────

export const BENCHMARKS = [
  { label: "S&P 500",        symbol: "^GSPC",     description: "US large cap 500 companies" },
  { label: "MSCI World",     symbol: "URTH",      description: "Developed markets ~1,500 companies" },
  { label: "Euro Stoxx 50",  symbol: "^STOXX50E", description: "50 largest Eurozone companies" },
  { label: "FTSE All-World", symbol: "VWRL.L",    description: "Global all-cap index" },
  { label: "DAX",            symbol: "^GDAXI",    description: "30 largest German companies" },
] as const;
export type BenchmarkItem = typeof BENCHMARKS[number];
const DEFAULT_BENCHMARK = BENCHMARKS[1]; // MSCI World

const PERF_RANGES = ["1W", "1M", "3M", "1Y", "All"] as const;
type Range = (typeof PERF_RANGES)[number];

// ─── Benchmark Comparison helpers ─────────────────────────────────────────────

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
}: {
  isPremium: boolean;
  defaultBenchmark: BenchmarkItem;
  onUpgrade: () => void;
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

  const [selectedRange, setSelectedRange] = useState<Range>("1M");
  const [historySnapshots, setHistorySnapshots] = useState<PortfolioSnapshot[]>([]);
  const [loadingChart, setLoadingChart] = useState(true);
  const [buildingHistory, setBuildingHistory] = useState(false);

  const { canUseBenchmarkComparison, showPaywall } = useSubscription();
  const [defaultBenchmark, setDefaultBenchmark] = useState<BenchmarkItem>(DEFAULT_BENCHMARK);

  useEffect(() => {
    AsyncStorage.getItem("folvio_default_benchmark").then((bm) => {
      if (bm) {
        const found = BENCHMARKS.find((b) => b.symbol === bm || b.label === bm);
        if (found) setDefaultBenchmark(found);
      }
    }).catch(() => {});
  }, []);

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

    return { timeInMarketMonths, bestETF, worstETF };
  }, [holdings]);

  const chartWidth = width - 32;
  const hasEnoughData = historySnapshots.length >= 2;

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.background }]}
      contentContainerStyle={[styles.content, { paddingTop: topPad + 12, paddingBottom: bottomPad }]}
      showsVerticalScrollIndicator={false}
    >
      <Text style={[styles.pageTitle, { color: theme.text }]}>Returns</Text>

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
          {metrics.worstETF ? (
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
        isPremium={canUseBenchmarkComparison}
        defaultBenchmark={defaultBenchmark}
        onUpgrade={() => showPaywall("benchmark")}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 14 },
  pageTitle: { fontSize: 28, fontFamily: "Inter_700Bold", letterSpacing: -0.8, marginBottom: 2 },

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
});
