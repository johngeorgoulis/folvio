import React, { useState, useMemo, useEffect } from "react";
import {
  ScrollView, View, Text, TextInput, TouchableOpacity,
  StyleSheet, Platform, useWindowDimensions,
} from "react-native";
import Svg, { Path, Defs, LinearGradient, Stop, Line, Text as SvgText } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { usePortfolio } from "@/context/PortfolioContext";
import { formatEUR } from "@/utils/format";

const theme = Colors.dark;

const SCENARIOS = [
  { label: "Conservative", key: "conservative", pct: 4,  color: "#8A9BB0" },
  { label: "Base",         key: "base",         pct: 7,  color: "#C9A84C" },
  { label: "Optimistic",   key: "optimistic",   pct: 10, color: "#34D399" },
] as const;

const HORIZONS = [10, 15, 20, 25, 30];

function projectValue(
  startValue: number,
  monthlyDCA: number,
  annualReturnPct: number,
  years: number
): number {
  const monthlyRate = annualReturnPct / 100 / 12;
  let value = startValue;
  for (let m = 0; m < years * 12; m++) {
    value = value * (1 + monthlyRate) + monthlyDCA;
  }
  return value;
}

function projectYearly(
  startValue: number,
  monthlyDCA: number,
  annualReturnPct: number,
  years: number
): number[] {
  const monthlyRate = annualReturnPct / 100 / 12;
  let value = startValue;
  const points: number[] = [startValue];
  for (let y = 1; y <= years; y++) {
    for (let m = 0; m < 12; m++) {
      value = value * (1 + monthlyRate) + monthlyDCA;
    }
    points.push(value);
  }
  return points;
}

function ProjectionChart({
  width,
  scenarios,
  years,
}: {
  width: number;
  scenarios: { color: string; points: number[] }[];
  years: number;
}) {
  const H = 200;
  const PAD = { top: 16, bottom: 32, left: 56, right: 8 };
  const innerW = width - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const allValues = scenarios.flatMap((s) => s.points);
  const maxV = Math.max(...allValues);
  const minV = Math.min(...allValues, 0);
  const span = maxV - minV || 1;

  function toX(i: number) {
    return PAD.left + (i / years) * innerW;
  }
  function toY(v: number) {
    return PAD.top + (1 - (v - minV) / span) * innerH;
  }

  function buildPath(points: number[]) {
    return points.map((v, i) => `${i === 0 ? "M" : "L"}${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(" ");
  }

  const yLabels = [maxV, maxV / 2, 0].map((v) => ({
    v,
    y: toY(v),
    label: v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v.toFixed(0)}`,
  }));

  const xLabels = [0, Math.floor(years / 2), years].map((yr) => ({
    yr,
    x: toX(yr),
    label: yr === 0 ? "Now" : `${yr}y`,
  }));

  return (
    <Svg width={width} height={H}>
      {/* Grid lines */}
      {yLabels.map((l, i) => (
        <Line key={i} x1={PAD.left} y1={l.y} x2={PAD.left + innerW} y2={l.y}
          stroke={theme.border} strokeWidth={1} strokeDasharray="4,4" />
      ))}
      {/* Y labels */}
      {yLabels.map((l, i) => (
        <SvgText key={i} x={PAD.left - 4} y={l.y + 4} fontSize={9}
          fill={theme.textTertiary} textAnchor="end" fontFamily="Inter_400Regular">
          {l.label}
        </SvgText>
      ))}
      {/* X labels */}
      {xLabels.map((l, i) => (
        <SvgText key={i} x={l.x} y={H - 4} fontSize={9}
          fill={theme.textTertiary} textAnchor="middle" fontFamily="Inter_400Regular">
          {l.label}
        </SvgText>
      ))}
      {/* Scenario lines */}
      {scenarios.map((s, i) => (
        <Path key={i} d={buildPath(s.points)} stroke={s.color}
          strokeWidth={2} fill="none" />
      ))}
    </Svg>
  );
}

export default function ProjectionsScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  // Calculate annualized return from actual portfolio performance
  const { totalPortfolioValue, totalInvested, totalGainPct, holdings } = usePortfolio();

  const annualizedReturn = useMemo(() => {
    const dates = holdings.map((h) => h.purchase_date).filter(Boolean).sort();
    if (dates.length === 0 || totalInvested === 0) return 7;
    const months = Math.max(1, Math.floor(
      (Date.now() - new Date(dates[0]).getTime()) / (1000 * 60 * 60 * 24 * 30.44)
    ));
    const annualized = (totalGainPct / months) * 12;
    // Clamp between 1% and 30% to avoid extreme values
    return Math.round(Math.min(30, Math.max(1, annualized)) * 10) / 10;
  }, [holdings, totalGainPct, totalInvested]);

  const [monthlyDCA, setMonthlyDCA] = useState("400");
  const [years, setYears] = useState(30);
  const [scenarioPcts, setScenarioPcts] = useState({ conservative: 4, base: 7, optimistic: 10 });
  const [editingScenario, setEditingScenario] = useState<string | null>(null);

  // Sync base scenario with actual portfolio return on first load
  useEffect(() => {
    if (annualizedReturn > 0) {
      setScenarioPcts({
        conservative: Math.max(1, Math.round((annualizedReturn - 3) * 10) / 10),
        base: annualizedReturn,
        optimistic: Math.round((annualizedReturn + 3) * 10) / 10,
      });
    }
  }, [annualizedReturn]);

  const startValue = totalPortfolioValue > 0 ? totalPortfolioValue : 0;
  const dca = parseFloat(monthlyDCA) || 0;
  const chartWidth = width - 32;

  const scenarioData = useMemo(() =>
    SCENARIOS.map((s) => ({
      ...s,
      pct: scenarioPcts[s.key],
      points: projectYearly(startValue, dca, scenarioPcts[s.key], years),
      final: projectValue(startValue, dca, scenarioPcts[s.key], years),
    })),
    [startValue, dca, years, scenarioPcts]
  );

  const tableData = useMemo(() =>
    HORIZONS.map((h) => ({
      years: h,
      values: SCENARIOS.map((s) => projectValue(startValue, dca, scenarioPcts[s.key], h)),
    })),
    [startValue, dca, scenarioPcts]
  );

  const topPad = Platform.OS === "web" ? 24 : insets.top;
  const bottomPad = Platform.OS === "web" ? 80 : insets.bottom + 80;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.background }}
      contentContainerStyle={{ paddingTop: topPad + 12, paddingBottom: bottomPad, paddingHorizontal: 16, gap: 16 }}
      showsVerticalScrollIndicator={false}
    >
      <Text style={[s.title, { color: theme.text }]}>Projections</Text>

      {/* Inputs */}
      <View style={[s.card, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}>
        <Text style={[s.cardTitle, { color: theme.text }]}>Inputs</Text>

        <View style={s.inputRow}>
          <Text style={[s.inputLabel, { color: theme.textSecondary }]}>Monthly DCA (€)</Text>
          <TextInput
            style={[s.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElevated }]}
            value={monthlyDCA}
            onChangeText={setMonthlyDCA}
            keyboardType="numeric"
            placeholder="400"
            placeholderTextColor={theme.textTertiary}
          />
        </View>

        <View style={s.inputRow}>
          <Text style={[s.inputLabel, { color: theme.textSecondary }]}>Starting Value</Text>
          <Text style={[s.inputValue, { color: theme.tint }]}>{formatEUR(startValue)}</Text>
        </View>

        {/* Horizon selector */}
        <Text style={[s.inputLabel, { color: theme.textSecondary, marginBottom: 8 }]}>Horizon</Text>
        <View style={s.segmented}>
          {HORIZONS.map((h) => (
            <TouchableOpacity
              key={h}
              style={[s.segBtn, { backgroundColor: years === h ? theme.tint : theme.backgroundElevated, borderColor: years === h ? theme.tint : theme.border }]}
              onPress={() => setYears(h)}
            >
              <Text style={[s.segBtnText, { color: years === h ? "#000" : theme.textSecondary }]}>{h}Y</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Chart */}
      <View style={[s.card, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}>
        <Text style={[s.cardTitle, { color: theme.text }]}>Growth Projection</Text>
        <ProjectionChart
          width={chartWidth - 36}
          scenarios={scenarioData.map((sc) => ({ color: sc.color, points: sc.points }))}
          years={years}
        />
        {/* Legend */}
        <View style={s.legend}>
          {scenarioData.map((sc) => (
            <View key={sc.key} style={s.legendItem}>
              <View style={[s.legendDot, { backgroundColor: sc.color }]} />
              <Text style={[s.legendLabel, { color: theme.textSecondary }]}>{sc.label} ({sc.pct}%)</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Table */}
      <View style={[s.card, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}>
        <Text style={[s.cardTitle, { color: theme.text }]}>Summary Table</Text>
        {/* Header */}
        <View style={[s.tableRow, { borderBottomColor: theme.border }]}>
          <Text style={[s.tableHeader, { color: theme.textTertiary, flex: 1 }]}>Year</Text>
          {SCENARIOS.map((sc) => (
            <Text key={sc.key} style={[s.tableHeader, { color: sc.color, flex: 2, textAlign: "right" }]}>{sc.label}</Text>
          ))}
        </View>
        {tableData.map((row) => (
          <View key={row.years} style={[s.tableRow, { borderBottomColor: theme.border }]}>
            <Text style={[s.tableCell, { color: theme.text, flex: 1 }]}>{row.years}Y</Text>
            {row.values.map((v, i) => (
              <Text key={i} style={[s.tableCell, { color: SCENARIOS[i].color, flex: 2, textAlign: "right" }]}>
                {v >= 1000000 ? `€${(v / 1000000).toFixed(2)}M` : `€${(v / 1000).toFixed(1)}k`}
              </Text>
            ))}
          </View>
        ))}
      </View>

      {/* Scenario rate editor */}
      <View style={[s.card, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}>
        <Text style={[s.cardTitle, { color: theme.text }]}>Annual Return Assumptions</Text>
        <Text style={[s.cardSub, { color: theme.textSecondary }]}>
          Base scenario uses your actual annualized return ({annualizedReturn}%/yr)
        </Text>
        {SCENARIOS.map((sc) => (
          <View key={sc.key} style={[s.inputRow, { marginTop: 10 }]}>
            <View style={[s.legendDot, { backgroundColor: sc.color, marginRight: 8 }]} />
            <Text style={[s.inputLabel, { color: theme.textSecondary, flex: 1 }]}>{sc.label}</Text>
            <TextInput
              style={[s.input, { color: sc.color, borderColor: sc.color + "44", backgroundColor: theme.backgroundElevated, width: 70 }]}
              value={String(scenarioPcts[sc.key])}
              onChangeText={(v) => setScenarioPcts((prev) => ({ ...prev, [sc.key]: parseFloat(v) || 0 }))}
              keyboardType="numeric"
              maxLength={4}
            />
            <Text style={[s.inputLabel, { color: theme.textSecondary, marginLeft: 4 }]}>%/yr</Text>
          </View>
        ))}
      </View>

      {/* Disclaimer */}
      <Text style={[s.disclaimer, { color: theme.textTertiary }]}>
        Projections are estimates only. Past performance does not guarantee future results. Does not account for taxes, fees, or inflation.
      </Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  title: { fontSize: 28, fontFamily: "Inter_700Bold", letterSpacing: -0.8, marginBottom: 4 },
  card: { borderRadius: 16, padding: 18, borderWidth: 1 },
  cardTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 4 },
  cardSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 4 },
  inputRow: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  inputLabel: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  inputValue: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, fontSize: 14, fontFamily: "Inter_600SemiBold", minWidth: 80, textAlign: "right" },
  segmented: { flexDirection: "row", gap: 8 },
  segBtn: { flex: 1, paddingVertical: 8, borderRadius: 10, borderWidth: 1, alignItems: "center" },
  segBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 8 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
  tableRow: { flexDirection: "row", paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  tableHeader: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  tableCell: { fontSize: 13, fontFamily: "Inter_500Medium" },
  disclaimer: { fontSize: 11, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 16, fontStyle: "italic" },
});
