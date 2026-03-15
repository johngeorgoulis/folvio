import { Feather } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import {
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
import { formatEUR, formatPct } from "@/utils/format";

const YIELD_RATES: Record<string, number> = {
  VWCE: 1.4,
  VWRL: 2.1,
  IWDA: 1.3,
  CSPX: 1.3,
  EUNL: 1.8,
  VEUR: 3.0,
  MEUD: 2.5,
};

function getEstimatedYield(ticker: string): number {
  return YIELD_RATES[ticker.toUpperCase()] ?? 1.5;
}

const SCENARIOS = [
  { label: "Conservative", rate: 5, color: "#64748B" },
  { label: "Base", rate: 7, color: "#C9A84C" },
  { label: "Optimistic", rate: 10, color: "#34D399" },
];

export default function PerformanceScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const theme = isDark ? Colors.dark : Colors.light;
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const topPad = Platform.OS === "web" ? 24 : insets.top;
  const bottomPad = Platform.OS === "web" ? 80 : insets.bottom + 80;

  const { holdings, totalPortfolioValue, totalInvested, totalGain, totalGainPct } = usePortfolio();
  const [selectedScenario, setSelectedScenario] = useState(1);

  const annualDividendEstimate = useMemo(() => {
    return holdings.reduce((sum, h) => {
      const yieldPct = getEstimatedYield(h.ticker);
      return sum + h.quantity * h.currentPrice * (yieldPct / 100);
    }, 0);
  }, [holdings]);

  const holdingRows = useMemo(() => {
    return holdings
      .map((h) => {
        const mv = h.quantity * h.currentPrice;
        const invested = h.quantity * h.avg_cost_eur;
        const gain = mv - invested;
        const gainPct = invested > 0 ? (gain / invested) * 100 : 0;
        const weight = totalPortfolioValue > 0 ? (mv / totalPortfolioValue) * 100 : 0;
        const yieldPct = getEstimatedYield(h.ticker);
        const annualIncome = mv * (yieldPct / 100);
        return { ...h, mv, gain, gainPct, weight, yieldPct, annualIncome };
      })
      .sort((a, b) => b.mv - a.mv);
  }, [holdings, totalPortfolioValue]);

  const projectedValue = useMemo(() => {
    const rate = SCENARIOS[selectedScenario].rate / 100;
    return totalPortfolioValue * Math.pow(1 + rate, 10);
  }, [totalPortfolioValue, selectedScenario]);

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.background }]}
      contentContainerStyle={[styles.content, { paddingTop: topPad + 12, paddingBottom: bottomPad }]}
      showsVerticalScrollIndicator={false}
    >
      <Text style={[styles.pageTitle, { color: theme.text }]}>Performance</Text>

      <View style={[styles.overviewCard, { backgroundColor: theme.deepBlue }]}>
        <View style={styles.overviewGrid}>
          <View style={styles.overviewItem}>
            <Text style={styles.overviewLabel}>Total Return</Text>
            <Text style={[styles.overviewValue, { color: totalGain >= 0 ? "#6EE7B7" : "#FCA5A5" }]}>
              {totalGain >= 0 ? "+" : ""}{formatEUR(totalGain, true)}
            </Text>
            <Text style={[styles.overviewPct, { color: totalGain >= 0 ? "#6EE7B7" : "#FCA5A5" }]}>
              {formatPct(totalGainPct)}
            </Text>
          </View>
          <View style={[styles.dividerV, { backgroundColor: "rgba(255,255,255,0.12)" }]} />
          <View style={styles.overviewItem}>
            <Text style={styles.overviewLabel}>Annual Div. Est.</Text>
            <Text style={[styles.overviewValue, { color: "#C9A84C" }]}>
              {formatEUR(annualDividendEstimate, true)}
            </Text>
            <Text style={styles.overviewPctMuted}>based on avg yields</Text>
          </View>
        </View>
      </View>

      <View style={[styles.card, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}>
        <Text style={[styles.sectionTitle, { color: theme.text }]}>10-Year Projection</Text>
        <View style={styles.scenarioRow}>
          {SCENARIOS.map((s, i) => (
            <TouchableOpacity
              key={s.label}
              style={[
                styles.scenarioBtn,
                {
                  backgroundColor: selectedScenario === i ? s.color + "22" : theme.backgroundElevated,
                  borderColor: selectedScenario === i ? s.color : theme.border,
                },
              ]}
              onPress={() => setSelectedScenario(i)}
            >
              <Text style={[styles.scenarioBtnText, { color: selectedScenario === i ? s.color : theme.textSecondary }]}>
                {s.label}
              </Text>
              <Text style={[styles.scenarioRate, { color: selectedScenario === i ? s.color : theme.textTertiary }]}>
                {s.rate}% p.a.
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={[styles.projectionBox, { backgroundColor: theme.backgroundElevated, borderColor: theme.border }]}>
          <Text style={[styles.projectionLabel, { color: theme.textSecondary }]}>Projected value in 10 years</Text>
          <Text style={[styles.projectionValue, { color: SCENARIOS[selectedScenario].color }]}>
            {formatEUR(projectedValue)}
          </Text>
          <Text style={[styles.projectionNote, { color: theme.textTertiary }]}>
            Starting from {formatEUR(totalPortfolioValue)} today
          </Text>
        </View>
      </View>

      {holdingRows.length > 0 && (
        <View style={[styles.card, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Holdings Performance</Text>
          {holdingRows.map((h, i) => (
            <View key={h.id}>
              {i > 0 && <View style={[styles.rowDivider, { backgroundColor: theme.border }]} />}
              <View style={styles.holdingRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.holdingTicker, { color: theme.text }]}>{h.ticker}</Text>
                  <Text style={[styles.holdingWeight, { color: theme.textSecondary }]}>
                    {h.weight.toFixed(1)}% of portfolio
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={[styles.holdingReturn, { color: h.gain >= 0 ? theme.positive : theme.negative }]}>
                    {h.gain >= 0 ? "+" : ""}{formatPct(h.gainPct, false)}
                  </Text>
                  <Text style={[styles.holdingGainAbs, { color: h.gain >= 0 ? theme.positive : theme.negative }]}>
                    {h.gain >= 0 ? "+" : ""}{formatEUR(h.gain, true)}
                  </Text>
                </View>
              </View>
            </View>
          ))}
        </View>
      )}

      {holdingRows.length > 0 && (
        <View style={[styles.card, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Dividend Estimates</Text>
          <Text style={[styles.divNote, { color: theme.textSecondary }]}>
            Based on known UCITS ETF yield averages. For illustration only.
          </Text>
          {holdingRows.map((h, i) => (
            <View key={h.id}>
              {i > 0 && <View style={[styles.rowDivider, { backgroundColor: theme.border }]} />}
              <View style={styles.holdingRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.holdingTicker, { color: theme.text }]}>{h.ticker}</Text>
                  <Text style={[styles.holdingWeight, { color: theme.textSecondary }]}>
                    ~{h.yieldPct.toFixed(1)}% est. yield
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={[styles.holdingReturn, { color: "#C9A84C" }]}>
                    {formatEUR(h.annualIncome, true)}/yr
                  </Text>
                </View>
              </View>
            </View>
          ))}
          <View style={[styles.totalRow, { borderColor: theme.border }]}>
            <Text style={[styles.totalLabel, { color: theme.text }]}>Total Annual</Text>
            <Text style={[styles.totalValue, { color: "#C9A84C" }]}>
              {formatEUR(annualDividendEstimate)}/yr
            </Text>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 14 },
  pageTitle: { fontSize: 28, fontFamily: "Inter_700Bold", letterSpacing: -0.8, marginBottom: 2 },
  overviewCard: {
    borderRadius: 20,
    padding: 24,
  },
  overviewGrid: { flexDirection: "row", alignItems: "center" },
  overviewItem: { flex: 1, alignItems: "center", gap: 4 },
  overviewLabel: { color: "rgba(255,255,255,0.55)", fontSize: 11, fontFamily: "Inter_500Medium", letterSpacing: 0.5 },
  overviewValue: { fontSize: 22, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  overviewPct: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  overviewPctMuted: { fontSize: 11, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.4)" },
  dividerV: { width: 1, height: 48, marginHorizontal: 12 },
  card: { borderRadius: 16, padding: 18, borderWidth: 1 },
  sectionTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 14 },
  scenarioRow: { flexDirection: "row", gap: 8, marginBottom: 14 },
  scenarioBtn: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 10,
    alignItems: "center",
    gap: 2,
  },
  scenarioBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  scenarioRate: { fontSize: 11, fontFamily: "Inter_400Regular" },
  projectionBox: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    alignItems: "center",
    gap: 4,
  },
  projectionLabel: { fontSize: 12, fontFamily: "Inter_400Regular" },
  projectionValue: { fontSize: 32, fontFamily: "Inter_700Bold", letterSpacing: -1 },
  projectionNote: { fontSize: 11, fontFamily: "Inter_400Regular" },
  holdingRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10 },
  holdingTicker: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  holdingWeight: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  holdingReturn: { fontSize: 14, fontFamily: "Inter_700Bold" },
  holdingGainAbs: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 2 },
  rowDivider: { height: 1 },
  divNote: { fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 12, marginTop: -6, lineHeight: 17 },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 1,
    paddingTop: 12,
    marginTop: 4,
  },
  totalLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  totalValue: { fontSize: 16, fontFamily: "Inter_700Bold" },
});
