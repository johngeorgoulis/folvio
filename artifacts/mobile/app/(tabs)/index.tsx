import { Feather } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator, Platform, ScrollView, StyleSheet,
  Text, TouchableOpacity, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { usePortfolio } from "@/context/PortfolioContext";
import { formatEUR, formatPct, currentMonthLabel } from "@/utils/format";
import { DonutChart, CHART_COLORS } from "@/components/DonutChart";
import { classifyPortfolio, getAssetClass } from "@/services/assetClassService";
import { router } from "expo-router";

const theme = Colors.dark;

const TIMEFRAMES = ["1W", "1M", "3M", "1Y", "All"] as const;
type Timeframe = typeof TIMEFRAMES[number];

const CLASS_COLORS: Record<string, string> = {
  "Equity":      "#C9A84C",
  "Bond":        "#8A9BB0",
  "Commodity":   "#F59E0B",
  "Real Estate": "#34D399",
  "Cash":        "#A78BFA",
  "Other":       "#6B7280",
};

export default function DashboardScreen() {
  const insets = useSafeAreaInsets();
  const [timeframe, setTimeframe] = useState<Timeframe>("All");
  const [selectedClass, setSelectedClass] = useState<string | null>(null);

  const {
    holdings, isLoading,
    totalPortfolioValue, totalInvested,
    totalGain, totalGainPct,
  } = usePortfolio();

  const topPad = Platform.OS === "web" ? 24 : insets.top;
  const bottomPad = Platform.OS === "web" ? 80 : insets.bottom + 80;

  // Annualized return
  const annualizedReturn = useMemo(() => {
    const dates = holdings.map((h) => h.purchase_date).filter(Boolean).sort();
    if (dates.length === 0 || totalInvested === 0) return null;
    const months = Math.max(1, Math.floor(
      (Date.now() - new Date(dates[0]).getTime()) / (1000 * 60 * 60 * 24 * 30.44)
    ));
    if (months < 1) return null;
    return (totalGainPct / months) * 12;
  }, [holdings, totalGainPct, totalInvested]);

  // Asset class breakdown
  const assetClasses = useMemo(() =>
    classifyPortfolio(holdings.map((h) => ({
      ticker: h.ticker,
      isin: h.isin,
      quantity: h.quantity,
      currentPrice: h.currentPrice,
      hasPrice: h.hasPrice,
    }))),
    [holdings]
  );

  const donutSegments = useMemo(() => {
    return holdings.map((h, i) => {
      const assetClass = getAssetClass(h.ticker, h.isin ?? "");
      const isSelected = selectedClass === null || assetClass === selectedClass;
      return {
        label: h.ticker,
        value: h.quantity * h.currentPrice,
        color: isSelected ? CHART_COLORS[i % CHART_COLORS.length] : CHART_COLORS[i % CHART_COLORS.length] + "33",
      };
    });
  }, [holdings, selectedClass]);

  if (isLoading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: theme.background }]}>
        <ActivityIndicator color={theme.tint} />
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.background }]}
      contentContainerStyle={[styles.content, { paddingTop: topPad + 12, paddingBottom: bottomPad }]}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>{currentMonthLabel()}</Text>
          <Text style={[styles.title, { color: theme.text }]}>Fortis</Text>
        </View>
        <View style={[styles.badge, { backgroundColor: theme.deepBlue }]}>
          <Text style={styles.badgeText}>EU</Text>
        </View>
      </View>

      {/* Hero Card */}
      <View style={[styles.heroCard, { backgroundColor: theme.deepBlue }]}>
        <Text style={styles.heroLabel}>TOTAL PORTFOLIO VALUE</Text>
        <Text style={styles.heroValue}>{formatEUR(totalPortfolioValue)}</Text>
        <View style={styles.heroRow}>
          <View style={[styles.gainBadge, { backgroundColor: "rgba(255,255,255,0.12)" }]}>
            <Text style={[styles.gainText, { color: totalGain >= 0 ? "#6EE7B7" : "#FCA5A5" }]}>
              {formatPct(totalGainPct)} all time
            </Text>
          </View>
          {annualizedReturn !== null && (
            <View style={[styles.gainBadge, { backgroundColor: "rgba(255,255,255,0.08)" }]}>
              <Text style={[styles.gainText, { color: annualizedReturn >= 0 ? "#6EE7B7" : "#FCA5A5" }]}>
                {annualizedReturn >= 0 ? "+" : ""}{annualizedReturn.toFixed(1)}%/yr
              </Text>
            </View>
          )}
        </View>
        <Text style={styles.investedText}>{formatEUR(totalInvested)} invested</Text>
      </View>

      {/* Allocation Donut */}
      {holdings.length > 0 && (
        <View style={[styles.card, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Allocation</Text>
          <View style={styles.donutRow}>
            <DonutChart
              segments={donutSegments}
              size={140}
              strokeWidth={20}
              centerLabel={formatEUR(totalPortfolioValue, true)}
              centerSublabel={`${holdings.length} holding${holdings.length !== 1 ? "s" : ""}`}
            />
            <View style={styles.legend}>
              {holdings.slice(0, 5).map((h, i) => {
                const val = h.quantity * h.currentPrice;
                const pct = totalPortfolioValue > 0 ? (val / totalPortfolioValue) * 100 : 0;
                const gain = h.avg_cost_eur > 0 ? (h.currentPrice - h.avg_cost_eur) / h.avg_cost_eur * 100 : 0;
                return (
                  <View key={h.id} style={[styles.legendItem, {
                    opacity: selectedClass === null || getAssetClass(h.ticker, h.isin ?? "") === selectedClass ? 1 : 0.3
                  }]}>
                    <View style={[styles.dot, { backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.legendTicker, { color: theme.text }]}>{h.ticker}</Text>
                      <Text style={[styles.legendPct, { color: theme.textSecondary }]}>
                        {pct.toFixed(1)}%{"  "}
                        <Text style={{ color: gain >= 0 ? theme.positive : theme.negative }}>
                          {gain >= 0 ? "+" : ""}{gain.toFixed(1)}%
                        </Text>
                      </Text>
                    </View>
                  </View>
                );
              })}
              {holdings.length > 5 && (
                <Text style={[styles.moreText, { color: theme.textSecondary }]}>+{holdings.length - 5} more</Text>
              )}
            </View>
          </View>
        </View>
      )}

      {/* Asset Class Breakdown */}
      {assetClasses.length > 0 && (
        <View style={[styles.card, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Asset Mix</Text>
          <View style={styles.assetBarContainer}>
            {assetClasses.map((ac) => (
              <View
                key={ac.class}
                style={[styles.assetBarSegment, {
                  flex: ac.valuePct,
                  backgroundColor: CLASS_COLORS[ac.class] ?? "#6B7280",
                }]}
              />
            ))}
          </View>
          <View style={styles.assetLegend}>
            {assetClasses.map((ac) => (
              <TouchableOpacity
                key={ac.class}
                style={[styles.assetLegendItem, {
                  opacity: selectedClass === null || selectedClass === ac.class ? 1 : 0.4,
                }]}
                onPress={() => setSelectedClass(selectedClass === ac.class ? null : ac.class)}
                activeOpacity={0.7}
              >
                <View style={[styles.dot, { backgroundColor: CLASS_COLORS[ac.class] ?? "#6B7280" }]} />
                <Text style={[styles.assetLabel, { color: theme.textSecondary }]}>
                  {ac.class}{" "}
                  <Text style={{ color: theme.text, fontFamily: "Inter_600SemiBold" }}>
                    {ac.valuePct.toFixed(0)}%
                  </Text>
                  {" · "}
                  <Text style={{ color: theme.textTertiary, fontFamily: "Inter_400Regular" }}>
                    {formatEUR(ac.valueEUR, true)}
                  </Text>
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* Dividend Income Card */}
      {holdings.length > 0 && (() => {
        const annualDiv = holdings.reduce((sum, h) => {
          const y = h.yield_pct ?? 0;
          if (!y || !h.hasPrice) return sum;
          return sum + h.quantity * h.currentPrice * (y / 100);
        }, 0);
        if (annualDiv === 0) return null;
        return (
          <View style={[styles.card, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <View>
                <Text style={[styles.sectionTitle, { color: theme.text, marginBottom: 2 }]}>
                  Dividend Income
                </Text>
                <Text style={[{ fontSize: 12, fontFamily: "Inter_400Regular", color: theme.textSecondary }]}>
                  Estimated annual income
                </Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={{ fontSize: 24, fontFamily: "Inter_700Bold", color: "#C9A84C", letterSpacing: -0.5 }}>
                  {formatEUR(annualDiv)}
                </Text>
                <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: theme.textSecondary }}>
                  {formatEUR(annualDiv / 12)}/month
                </Text>
              </View>
            </View>
          </View>
        );
      })()}

      {/* Stats Grid */}
      {holdings.length > 0 && (
        <View style={styles.statsGrid}>
          <TouchableOpacity
            style={[styles.statCard, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}
            onPress={() => router.push("/(tabs)/holdings")}
            activeOpacity={0.75}
          >
            <Feather name="layers" size={18} color={theme.tint} />
            <Text style={[styles.statValue, { color: theme.text }]}>{holdings.length}</Text>
            <Text style={[styles.statLabel, { color: theme.textSecondary }]}>Holdings</Text>
            <Feather name="chevron-right" size={12} color={theme.textTertiary} style={{ position: "absolute", top: 12, right: 12 }} />
          </TouchableOpacity>
          <View style={[styles.statCard, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}>
            <Feather name={totalGain >= 0 ? "arrow-up-right" : "arrow-down-right"} size={18} color={totalGain >= 0 ? theme.positive : theme.negative} />
            <Text style={[styles.statValue, { color: totalGain >= 0 ? theme.positive : theme.negative }]}>
              {totalGain >= 0 ? "+" : ""}{formatEUR(totalGain, true)}
            </Text>
            <Text style={[styles.statLabel, { color: theme.textSecondary }]}>Total Gain</Text>
          </View>
        </View>
      )}

      {/* Empty state */}
      {holdings.length === 0 && (
        <View style={[styles.emptyCard, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}>
          <View style={[styles.emptyIcon, { backgroundColor: theme.deepBlue + "22" }]}>
            <Feather name="briefcase" size={28} color={theme.tint} />
          </View>
          <Text style={[styles.emptyTitle, { color: theme.text }]}>Build your portfolio</Text>
          <Text style={[styles.emptySubtitle, { color: theme.textSecondary }]}>
            Add your UCITS ETFs and stocks in the Holdings tab to start tracking your European portfolio.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 14 },
  loadingContainer: { flex: 1, justifyContent: "center", alignItems: "center" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 2 },
  subtitle: { fontSize: 12, fontFamily: "Inter_500Medium", letterSpacing: 0.3 },
  title: { fontSize: 30, fontFamily: "Inter_700Bold", letterSpacing: -1 },
  badge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  badgeText: { color: "#C9A84C", fontSize: 12, fontFamily: "Inter_700Bold", letterSpacing: 1 },
  heroCard: { borderRadius: 20, padding: 24, gap: 6 },
  heroLabel: { color: "rgba(255,255,255,0.55)", fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 1 },
  heroValue: { color: "#FFFFFF", fontSize: 40, fontFamily: "Inter_700Bold", letterSpacing: -1.5 },
  heroRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  gainBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  gainText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  investedText: { color: "rgba(255,255,255,0.5)", fontSize: 12, fontFamily: "Inter_400Regular" },
  card: { borderRadius: 16, padding: 18, borderWidth: 1 },
  sectionTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 14 },
  donutRow: { flexDirection: "row", alignItems: "center", gap: 20 },
  legend: { flex: 1, gap: 10 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  legendTicker: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  legendPct: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
  moreText: { fontSize: 11, fontFamily: "Inter_400Regular" },
  assetBarContainer: { flexDirection: "row", height: 14, borderRadius: 7, overflow: "hidden", marginBottom: 14, gap: 2 },
  assetBarSegment: { borderRadius: 3 },
  assetLegend: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  assetLegendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  assetLabel: { fontSize: 12, fontFamily: "Inter_400Regular" },
  statsGrid: { flexDirection: "row", gap: 12 },
  statCard: { flex: 1, borderRadius: 14, padding: 16, borderWidth: 1, gap: 6, alignItems: "flex-start" },
  statValue: { fontSize: 20, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  statLabel: { fontSize: 12, fontFamily: "Inter_400Regular" },
  emptyCard: { borderRadius: 16, padding: 32, borderWidth: 1, alignItems: "center", gap: 12, marginTop: 8 },
  emptyIcon: { width: 64, height: 64, borderRadius: 20, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_700Bold", textAlign: "center" },
  emptySubtitle: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 21, maxWidth: 280 },
});
