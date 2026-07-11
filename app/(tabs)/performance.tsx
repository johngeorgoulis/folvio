import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import Svg, { Path, Line, Text as SvgText } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/context/ThemeContext"; import { minimalLight } from "@/constants/colors";
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
  theme: typeof minimalLight;
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
  summaryLabel: { fontSize: 13, fontFamily: "Archivo_400Regular" },
  summaryValue: { fontSize: 13, fontFamily: "Archivo_600SemiBold" },
  summaryNote: { fontSize: 11, fontFamily: "Archivo_400Regular" },
  summaryDivider: { height: StyleSheet.hairlineWidth },
  disclaimer: {
    fontSize: 10,
    fontFamily: "Archivo_400Regular",
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
  const { theme } = useTheme();
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
        <Text style={[{ fontSize: 11, fontFamily: "Archivo_400Regular", color: theme.textTertiary, marginBottom: 14 }]}>
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
  const { theme } = useTheme();

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

// ─── Forecast / Wealth Projections Section ─────────────────────────────────────

const SCENARIOS = [
  { label: "Conservative", key: "conservative" as const, pct: 4,  color: "#8A9BB0" },
  { label: "Base",         key: "base"         as const, pct: 7,  color: "#C9A84C" },
  { label: "Optimistic",   key: "optimistic"   as const, pct: 10, color: "#34D399" },
];
const HORIZONS = [10, 15, 20, 25, 30];

function projectForecastValue(
  start: number, monthly: number, annualPct: number,
  years: number, escalation = 0
): number {
  const r = annualPct / 100 / 12;
  let v = start, m = monthly;
  for (let y = 0; y < years; y++) {
    if (y > 0 && escalation > 0) m *= (1 + escalation / 100);
    for (let mo = 0; mo < 12; mo++) v = v * (1 + r) + m;
  }
  return v;
}

function projectForecastYearly(
  start: number, monthly: number, annualPct: number,
  years: number, escalation = 0
): number[] {
  const r = annualPct / 100 / 12;
  let v = start, m = monthly;
  const pts = [start];
  for (let y = 0; y < years; y++) {
    if (y > 0 && escalation > 0) m *= (1 + escalation / 100);
    for (let mo = 0; mo < 12; mo++) v = v * (1 + r) + m;
    pts.push(v);
  }
  return pts;
}

function ForecastChart({
  width, activeLines, ghostLines, investedLine, years, locked, onUnlock,
}: {
  width: number;
  activeLines: { color: string; points: number[] }[];
  ghostLines:  { color: string; points: number[] }[];
  investedLine: number[];
  years: number;
  locked: boolean;
  onUnlock: () => void;
}) {
  const H   = 200;
  const PAD = { top: 16, bottom: 32, left: 56, right: 8 };
  const iW  = width - PAD.left - PAD.right;
  const iH  = H - PAD.top - PAD.bottom;

  const allPts = [...activeLines, ...ghostLines].flatMap(s => s.points);
  const maxV = Math.max(...allPts);
  const minV = Math.min(...allPts, 0);
  const span = maxV - minV || 1;

  const toX = (i: number) => PAD.left + (i / years) * iW;
  const toY = (v: number) => PAD.top + (1 - (v - minV) / span) * iH;
  const path = (pts: number[]) =>
    pts.map((v, i) => `${i === 0 ? "M" : "L"}${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(" ");

  const yLabels = [maxV, maxV / 2, 0].map(v => ({
    v, y: toY(v),
    label: v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v.toFixed(0)}`,
  }));
  const xLabels = [0, Math.floor(years / 2), years].map(yr => ({
    yr, x: toX(yr), label: yr === 0 ? "Now" : `${yr}y`,
  }));

  return (
    <View>
      <Svg width={width} height={H}>
        {yLabels.map((l, i) => (
          <Line key={i} x1={PAD.left} y1={l.y} x2={PAD.left + iW} y2={l.y}
            stroke={Colors.dark.border} strokeWidth={1} strokeDasharray="4,4" />
        ))}
        {yLabels.map((l, i) => (
          <SvgText key={i} x={PAD.left - 4} y={l.y + 4} fontSize={9}
            fill={Colors.dark.textTertiary} textAnchor="end" fontFamily="Archivo_400Regular">
            {l.label}
          </SvgText>
        ))}
        {xLabels.map((l, i) => (
          <SvgText key={i} x={l.x} y={H - 4} fontSize={9}
            fill={Colors.dark.textTertiary} textAnchor="middle" fontFamily="Archivo_400Regular">
            {l.label}
          </SvgText>
        ))}
        {ghostLines.map((s, i) => (
          <Path key={`g${i}`} d={path(s.points)} stroke={s.color}
            strokeWidth={2} fill="none" opacity={0.18} />
        ))}
        {activeLines.map((s, i) => (
          <Path key={`a${i}`} d={path(s.points)} stroke={s.color} strokeWidth={2} fill="none" />
        ))}
        {investedLine.length >= 2 && (
          <Path d={path(investedLine)} stroke="rgba(255,255,255,0.3)"
            strokeWidth={1.5} strokeDasharray="4,3" fill="none" />
        )}
      </Svg>
      {locked && (
        <TouchableOpacity
          style={fcStyles.chartOverlay}
          onPress={onUnlock}
          activeOpacity={0.9}
        >
          <View style={[fcStyles.chartLockBadge, { backgroundColor: Colors.dark.backgroundElevated, borderColor: Colors.dark.border }]}>
            <Feather name="lock" size={13} color={Colors.dark.tint} />
            <Text style={[fcStyles.chartLockText, { color: Colors.dark.text }]}>Unlock all scenarios</Text>
            <View style={[fcStyles.chartLockPill, { backgroundColor: "#3B82F622" }]}>
              <Text style={[fcStyles.chartLockPillText, { color: "#3B82F6" }]}>INVESTOR</Text>
            </View>
          </View>
        </TouchableOpacity>
      )}
    </View>
  );
}

function DCAEscalationSlider({
  value, onChange, monthlyDCA,
}: {
  value: number;
  onChange: (v: number) => void;
  monthlyDCA: number;
}) {
  const MIN = 0, MAX = 10, THUMB = 22;
  const trackRef    = useRef<View>(null);
  const trackPageX  = useRef(0);
  const trackWidthR = useRef(200);

  function clampedValue(pageX: number) {
    const x   = pageX - trackPageX.current;
    const raw = (x / trackWidthR.current) * (MAX - MIN) + MIN;
    return Math.round(Math.max(MIN, Math.min(MAX, raw)));
  }

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder:  () => true,
      onPanResponderGrant: e => onChange(clampedValue(e.nativeEvent.pageX)),
      onPanResponderMove:  e => onChange(clampedValue(e.nativeEvent.pageX)),
    })
  ).current;

  const fillPct = ((value - MIN) / (MAX - MIN)) * 100;

  return (
    <View style={[fcStyles.subCard, { backgroundColor: Colors.dark.backgroundElevated, borderColor: Colors.dark.border }]}>
      <View style={fcStyles.sliderHeader}>
        <Text style={[fcStyles.subCardTitle, { color: Colors.dark.textSecondary, marginBottom: 0 }]}>
          Annual DCA Escalation
        </Text>
        <Text style={[fcStyles.sliderValueText, { color: Colors.dark.tint }]}>
          {value === 0 ? "Off" : `+${value}% / yr`}
        </Text>
      </View>
      <View style={{ height: THUMB, justifyContent: "center", marginTop: 10, marginBottom: 4 }}
        ref={trackRef}
        onLayout={() => {
          trackRef.current?.measureInWindow((x, _y, w) => {
            trackPageX.current  = x;
            trackWidthR.current = w;
          });
        }}
        {...pan.panHandlers}
      >
        <View style={[fcStyles.sliderTrack, { backgroundColor: Colors.dark.border }]} />
        <View style={[fcStyles.sliderFill,  { width: `${fillPct}%` as any, backgroundColor: Colors.dark.tint }]} />
        <View style={[fcStyles.sliderThumb, { left: `${fillPct}%` as any, marginLeft: -(THUMB / 2), backgroundColor: Colors.dark.tint }]} />
      </View>
      <View style={fcStyles.sliderTicks}>
        {[0, 2, 5, 7, 10].map(v => (
          <TouchableOpacity key={v} onPress={() => onChange(v)}
            hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}>
            <Text style={[fcStyles.sliderTick, { color: v === value ? Colors.dark.tint : Colors.dark.textTertiary }]}>
              {v}%
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      {value > 0 && (
        <Text style={[fcStyles.subText, { color: Colors.dark.textTertiary, marginTop: 8 }]}>
          After 10 yr your monthly DCA grows to {formatEUR(monthlyDCA * Math.pow(1 + value / 100, 10))}/mo
        </Text>
      )}
    </View>
  );
}

function ForecastSection() {
  const { width } = useWindowDimensions();
  const { totalPortfolioValue, totalInvested, totalGainPct, holdings } = usePortfolio();
  const { canUseAllScenarios, canUseWealthProjections, showPaywall } = useSubscription();

  const annualizedReturn = useMemo(() => {
    const dates = holdings.map(h => h.purchase_date).filter(Boolean).sort();
    if (dates.length === 0 || totalInvested === 0) return 7;
    const months = Math.max(1, Math.floor(
      (Date.now() - new Date(dates[0]!).getTime()) / (1000 * 60 * 60 * 24 * 30.44)
    ));
    return Math.round(Math.min(30, Math.max(1, (totalGainPct / months) * 12)) * 10) / 10;
  }, [holdings, totalGainPct, totalInvested]);

  const [monthlyDCA,   setMonthlyDCA]   = useState("400");
  const [years,        setYears]        = useState(30);
  const [escalation,   setEscalation]   = useState(0);
  const [scenarioPcts, setScenarioPcts] = useState({ conservative: 4, base: 7, optimistic: 10 });

  useEffect(() => {
    AsyncStorage.getItem("folvio_forecast_dca")
      .then(v => { if (v) setMonthlyDCA(v); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (annualizedReturn > 0) {
      setScenarioPcts({
        conservative: Math.max(1, Math.round((annualizedReturn - 3) * 10) / 10),
        base: annualizedReturn,
        optimistic: Math.round((annualizedReturn + 3) * 10) / 10,
      });
    }
  }, [annualizedReturn]);

  function handleDCAChange(v: string) {
    setMonthlyDCA(v);
    AsyncStorage.setItem("folvio_forecast_dca", v);
  }

  const start  = totalPortfolioValue > 0 ? totalPortfolioValue : 0;
  const dca    = parseFloat(monthlyDCA) || 0;
  const chartW = width - 68;
  const esc    = canUseWealthProjections ? escalation : 0;

  const scenarioData = useMemo(() =>
    SCENARIOS.map(s => ({
      ...s,
      pct:    scenarioPcts[s.key],
      points: projectForecastYearly(start, dca, scenarioPcts[s.key], years, esc),
      final:  projectForecastValue(start, dca, scenarioPcts[s.key], years, esc),
    })),
    [start, dca, years, scenarioPcts, esc]
  );

  const tableData = useMemo(() =>
    HORIZONS.map(h => ({
      years:  h,
      values: SCENARIOS.map(s => projectForecastValue(start, dca, scenarioPcts[s.key], h, esc)),
    })),
    [start, dca, scenarioPcts, esc]
  );

  const investedLine = useMemo(() => {
    const pts = [start];
    let total = start;
    for (let y = 1; y <= years; y++) { total += dca * 12; pts.push(total); }
    return pts;
  }, [start, dca, years]);

  const baseOnly    = scenarioData.filter(s => s.key === "base");
  const nonBase     = scenarioData.filter(s => s.key !== "base");
  const activeLines = canUseAllScenarios ? scenarioData : baseOnly;
  const ghostLines  = canUseAllScenarios ? []           : nonBase;
  const visibleScenarios = canUseAllScenarios ? SCENARIOS : SCENARIOS.filter(s => s.key === "base");

  return (
    <View style={[styles.card, { backgroundColor: Colors.dark.backgroundCard, borderColor: Colors.dark.border }]}>
      <View style={fcStyles.titleRow}>
        <Text style={[styles.sectionTitle, { color: Colors.dark.text, marginBottom: 0 }]}>Forecast</Text>
        {canUseWealthProjections && (
          <View style={[fcStyles.tierBadge, { backgroundColor: Colors.dark.tint + "22" }]}>
            <Text style={[fcStyles.tierBadgeText, { color: Colors.dark.tint }]}>PRO</Text>
          </View>
        )}
        {canUseAllScenarios && !canUseWealthProjections && (
          <View style={[fcStyles.tierBadge, { backgroundColor: "#3B82F622" }]}>
            <Text style={[fcStyles.tierBadgeText, { color: "#3B82F6" }]}>INVESTOR</Text>
          </View>
        )}
      </View>

      <View style={[fcStyles.subCard, { backgroundColor: Colors.dark.backgroundElevated, borderColor: Colors.dark.border }]}>
        <View style={fcStyles.inputRow}>
          <Text style={[fcStyles.inputLabel, { color: Colors.dark.textSecondary }]}>Monthly DCA (€)</Text>
          <TextInput
            style={[fcStyles.input, { color: Colors.dark.text, borderColor: Colors.dark.border, backgroundColor: Colors.dark.backgroundCard }]}
            value={monthlyDCA}
            onChangeText={handleDCAChange}
            keyboardType="numeric"
            placeholder="400"
            placeholderTextColor={Colors.dark.textTertiary}
          />
        </View>
        <View style={fcStyles.inputRow}>
          <Text style={[fcStyles.inputLabel, { color: Colors.dark.textSecondary }]}>Starting Value</Text>
          <Text style={[fcStyles.inputValue, { color: Colors.dark.tint }]}>{formatEUR(start)}</Text>
        </View>
        <Text style={[fcStyles.inputLabel, { color: Colors.dark.textSecondary, marginBottom: 8 }]}>Horizon</Text>
        <View style={fcStyles.segmented}>
          {HORIZONS.map(h => (
            <TouchableOpacity key={h}
              style={[fcStyles.segBtn, {
                backgroundColor: years === h ? Colors.dark.tint : Colors.dark.backgroundCard,
                borderColor:     years === h ? Colors.dark.tint : Colors.dark.border,
              }]}
              onPress={() => setYears(h)}
            >
              <Text style={[fcStyles.segBtnText, { color: years === h ? "#000" : Colors.dark.textSecondary }]}>{h}Y</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {canUseWealthProjections && (
        <DCAEscalationSlider value={escalation} onChange={setEscalation} monthlyDCA={dca} />
      )}

      <View style={[fcStyles.subCard, { backgroundColor: Colors.dark.backgroundElevated, borderColor: Colors.dark.border }]}>
        <Text style={[fcStyles.subCardTitle, { color: Colors.dark.textSecondary }]}>Over {years} years you will invest</Text>
        <Text style={[fcStyles.bigNumber, { color: Colors.dark.tint }]}>{formatEUR(dca * 12 * years + start)}</Text>
        <Text style={[fcStyles.subText, { color: Colors.dark.textSecondary }]}>
          {formatEUR(start)} starting + {formatEUR(dca * 12 * years)} contributions ({formatEUR(dca)}/mo × {years * 12} mo)
        </Text>
      </View>

      <Text style={[fcStyles.subCardTitle, { color: Colors.dark.textSecondary, marginBottom: 8 }]}>Growth Projection</Text>
      <ForecastChart
        width={chartW}
        activeLines={activeLines.map(sc => ({ color: sc.color, points: sc.points }))}
        ghostLines={ghostLines.map(sc => ({ color: sc.color, points: sc.points }))}
        investedLine={investedLine}
        years={years}
        locked={!canUseAllScenarios}
        onUnlock={() => showPaywall("all-scenarios")}
      />

      <View style={[fcStyles.legend, { marginTop: 10 }]}>
        {activeLines.map(sc => (
          <View key={sc.key} style={fcStyles.legendItem}>
            <View style={[fcStyles.legendDot, { backgroundColor: sc.color }]} />
            <Text style={[fcStyles.legendLabel, { color: Colors.dark.textSecondary }]}>{sc.label} ({sc.pct}%)</Text>
          </View>
        ))}
        {!canUseAllScenarios && nonBase.map(sc => (
          <View key={sc.key} style={[fcStyles.legendItem, { opacity: 0.35 }]}>
            <View style={[fcStyles.legendDot, { backgroundColor: sc.color }]} />
            <Text style={[fcStyles.legendLabel, { color: Colors.dark.textSecondary }]}>{sc.label} 🔒</Text>
          </View>
        ))}
        <View style={fcStyles.legendItem}>
          <View style={[fcStyles.legendDot, { backgroundColor: "rgba(255,255,255,0.3)" }]} />
          <Text style={[fcStyles.legendLabel, { color: Colors.dark.textSecondary }]}>Total Invested</Text>
        </View>
      </View>

      <Text style={[fcStyles.subCardTitle, { color: Colors.dark.textSecondary, marginTop: 8, marginBottom: 8 }]}>Summary Table</Text>
      <View style={[fcStyles.subCard, { backgroundColor: Colors.dark.backgroundElevated, borderColor: Colors.dark.border, padding: 0, overflow: "hidden" }]}>
        <View style={[fcStyles.tableRow, { borderBottomColor: Colors.dark.border, backgroundColor: Colors.dark.backgroundCard }]}>
          <Text style={[fcStyles.tableHeader, { color: Colors.dark.textTertiary, flex: 1 }]}>Year</Text>
          {visibleScenarios.map(sc => (
            <Text key={sc.key} style={[fcStyles.tableHeader, { color: sc.color, flex: 2, textAlign: "right" }]}>{sc.label}</Text>
          ))}
        </View>
        {tableData.map(row => (
          <View key={row.years} style={[fcStyles.tableRow, { borderBottomColor: Colors.dark.border }]}>
            <Text style={[fcStyles.tableCell, { color: Colors.dark.text, flex: 1 }]}>{row.years}Y</Text>
            {visibleScenarios.map(sc => {
              const idx = SCENARIOS.findIndex(s => s.key === sc.key);
              const v   = row.values[idx];
              return (
                <Text key={sc.key} style={[fcStyles.tableCell, { color: sc.color, flex: 2, textAlign: "right" }]}>
                  {v >= 1_000_000 ? `€${(v / 1_000_000).toFixed(2)}M` : `€${(v / 1000).toFixed(1)}k`}
                </Text>
              );
            })}
          </View>
        ))}
      </View>

      {canUseWealthProjections && (
        <>
          <Text style={[fcStyles.subCardTitle, { color: Colors.dark.textSecondary, marginTop: 12, marginBottom: 4 }]}>
            Return Assumptions
          </Text>
          <Text style={[fcStyles.subText, { color: Colors.dark.textTertiary, marginBottom: 10 }]}>
            Base uses your annualised return ({annualizedReturn}%/yr)
          </Text>
          {SCENARIOS.map(sc => (
            <View key={sc.key} style={[fcStyles.inputRow, { marginBottom: 10 }]}>
              <View style={[fcStyles.legendDot, { backgroundColor: sc.color, marginRight: 8 }]} />
              <Text style={[fcStyles.inputLabel, { color: Colors.dark.textSecondary, flex: 1 }]}>{sc.label}</Text>
              <TextInput
                style={[fcStyles.input, { color: sc.color, borderColor: sc.color + "44", backgroundColor: Colors.dark.backgroundElevated, width: 70 }]}
                value={String(scenarioPcts[sc.key])}
                onChangeText={v => setScenarioPcts(prev => ({ ...prev, [sc.key]: parseFloat(v) || 0 }))}
                keyboardType="numeric"
                maxLength={4}
              />
              <Text style={[fcStyles.inputLabel, { color: Colors.dark.textSecondary, marginLeft: 4, flex: 0 }]}>%/yr</Text>
            </View>
          ))}
        </>
      )}

      <Text style={[styles.disclaimer, { color: Colors.dark.textTertiary }]}>
        Projections are estimates only. Past performance does not guarantee future results.
        Does not account for taxes, fees, or inflation.
      </Text>
    </View>
  );
}

const fcStyles = StyleSheet.create({
  titleRow:     { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 14 },
  tierBadge:    { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  tierBadgeText:{ fontSize: 10, fontFamily: "Archivo_800ExtraBold", letterSpacing: 0.5 },

  subCard:      { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 12 },
  subCardTitle: { fontSize: 12, fontFamily: "Archivo_600SemiBold", letterSpacing: 0.2, marginBottom: 2 },
  bigNumber:    { fontSize: 26, fontFamily: "Archivo_800ExtraBold", letterSpacing: -0.5, marginBottom: 2 },
  subText:      { fontSize: 12, fontFamily: "Archivo_400Regular", lineHeight: 17 },

  inputRow:   { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  inputLabel: { fontSize: 13, fontFamily: "Archivo_400Regular", flex: 1 },
  inputValue: { fontSize: 14, fontFamily: "Archivo_600SemiBold" },
  input: {
    borderWidth: 1, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 6,
    fontSize: 14, fontFamily: "Archivo_600SemiBold",
    minWidth: 80, textAlign: "right",
  },

  segmented: { flexDirection: "row", gap: 8 },
  segBtn:    { flex: 1, paddingVertical: 8, borderRadius: 10, borderWidth: 1, alignItems: "center" },
  segBtnText:{ fontSize: 13, fontFamily: "Archivo_600SemiBold" },

  legend:     { flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: 12 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot:  { width: 8, height: 8, borderRadius: 4 },
  legendLabel:{ fontSize: 11, fontFamily: "Archivo_400Regular" },

  tableRow:   { flexDirection: "row", paddingVertical: 10, paddingHorizontal: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  tableHeader:{ fontSize: 11, fontFamily: "Archivo_600SemiBold" },
  tableCell:  { fontSize: 13, fontFamily: "Archivo_600SemiBold" },

  chartOverlay: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 32,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(10,15,30,0.72)",
    borderRadius: 8,
  },
  chartLockBadge: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 12, borderWidth: 1,
  },
  chartLockText:    { fontSize: 13, fontFamily: "Archivo_600SemiBold" },
  chartLockPill:    { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  chartLockPillText:{ fontSize: 10, fontFamily: "Archivo_800ExtraBold", letterSpacing: 0.5 },

  sliderHeader:    { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sliderValueText: { fontSize: 15, fontFamily: "Archivo_800ExtraBold" },
  sliderTrack: { position: "absolute", left: 0, right: 0, height: 6, borderRadius: 3 },
  sliderFill:  { position: "absolute", left: 0, height: 6, borderRadius: 3 },
  sliderThumb: { position: "absolute", width: 22, height: 22, borderRadius: 11, top: -8 },
  sliderTicks: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
  sliderTick:  { fontSize: 11, fontFamily: "Archivo_600SemiBold" },
});

// ─── Main Screen ───────────────────────────────────────────────────────────────

export default function PerformanceScreen() {
  const { theme } = useTheme();
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

      {/* ── Section 4: Forecast / Wealth Projections ─────────────────────── */}
      <ForecastSection />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 14 },
  pageTitle: { fontSize: 28, fontFamily: "Archivo_800ExtraBold", letterSpacing: -0.8, marginBottom: 2 },

  card: { borderRadius: 16, padding: 18, borderWidth: 1 },
  sectionTitle: { fontSize: 15, fontFamily: "Archivo_600SemiBold", marginBottom: 14 },
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
  rangeBtnText: { fontSize: 11, fontFamily: "Archivo_600SemiBold" },
  chartPlaceholder: {
    height: CHART_H,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 24,
  },
  chartEmptyTitle: { fontSize: 14, fontFamily: "Archivo_600SemiBold", marginTop: 4 },
  chartEmptySub: { fontSize: 12, fontFamily: "Archivo_400Regular", textAlign: "center", lineHeight: 18 },

  gridLine: { position: "absolute", height: 1, borderTopWidth: StyleSheet.hairlineWidth },
  chartYLabel: {
    position: "absolute",
    left: 0,
    width: PAD.left - 6,
    fontSize: 10,
    fontFamily: "Archivo_400Regular",
    textAlign: "right",
  },
  chartXLabel: { position: "absolute", fontSize: 10, fontFamily: "Archivo_400Regular" },
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
  metricLabel: { fontSize: 11, fontFamily: "Archivo_600SemiBold", letterSpacing: 0.3 },
  metricValue: { fontSize: 20, fontFamily: "Archivo_800ExtraBold", letterSpacing: -0.5 },
  metricSub: { fontSize: 12, fontFamily: "Archivo_600SemiBold" },

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
  premiumText: { fontSize: 13, fontFamily: "Archivo_600SemiBold" },
  premiumSub: { fontSize: 12, fontFamily: "Archivo_400Regular", textAlign: "center", lineHeight: 18 },

  benchChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  benchChipText: { fontSize: 12, fontFamily: "Archivo_600SemiBold" },
  disclaimer: {
    fontSize: 10,
    fontFamily: "Archivo_400Regular",
    fontStyle: "italic",
    textAlign: "center",
    lineHeight: 14,
    marginTop: 8,
  },
});
