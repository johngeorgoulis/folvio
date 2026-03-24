import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, Platform, ScrollView, StyleSheet,
  Text, TouchableOpacity, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { usePortfolio } from "@/context/PortfolioContext";
import { useAllocation } from "@/context/AllocationContext";
import { formatEUR, formatPct, currentMonthLabel } from "@/utils/format";
import { DonutChart, CHART_COLORS } from "@/components/DonutChart";
import { LinearGradient } from "expo-linear-gradient";
import { classifyPortfolio, getAssetClass } from "@/services/assetClassService";
import { calculateAllocations } from "@/services/allocationService";
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

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function daysUntilDay(targetDay: number): number {
  const now = new Date();
  const today = now.getDate();
  if (targetDay > today) return targetDay - today;
  const next = new Date(now.getFullYear(), now.getMonth() + 1, targetDay);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), today);
  return Math.ceil((next.getTime() - startOfToday.getTime()) / (1000 * 60 * 60 * 24));
}

export default function DashboardScreen() {
  const insets = useSafeAreaInsets();
  const [, setTimeframe] = useState<Timeframe>("All");
  const [selectedClass, setSelectedClass] = useState<string | null>(null);
  const [dcaDay, setDcaDay] = useState<number | null>(null);
  const [dcaAmount, setDcaAmount] = useState<number>(0);

  const {
    holdings, isLoading,
    totalPortfolioValue, totalInvested,
    totalGain, totalGainPct,
  } = usePortfolio();

  const { targets, rebalanceThreshold } = useAllocation();

  const topPad = Platform.OS === "web" ? 24 : insets.top + 8;
  const bottomPad = Platform.OS === "web" ? 80 : insets.bottom + 80;

  useEffect(() => {
    AsyncStorage.multiGet(["folvio_dca_day", "folvio_forecast_dca"]).then((pairs) => {
      const day = pairs[0][1];
      const amt = pairs[1][1];
      if (day) setDcaDay(parseInt(day, 10));
      if (amt) setDcaAmount(parseFloat(amt) || 0);
    });
  }, []);

  const annualizedReturn = useMemo(() => {
    const dates = holdings.map((h) => h.purchase_date).filter(Boolean).sort();
    if (dates.length === 0 || totalInvested === 0) return null;
    const months = Math.max(1, Math.floor(
      (Date.now() - new Date(dates[0]).getTime()) / (1000 * 60 * 60 * 24 * 30.44)
    ));
    if (months < 1) return null;
    return (totalGainPct / months) * 12;
  }, [holdings, totalGainPct, totalInvested]);

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
        color: isSelected
          ? CHART_COLORS[i % CHART_COLORS.length]
          : CHART_COLORS[i % CHART_COLORS.length] + "33",
      };
    });
  }, [holdings, selectedClass]);

  const driftRows = useMemo(
    () => calculateAllocations(holdings, targets, rebalanceThreshold)
      .filter((r) => r.status === "overweight" || r.status === "underweight"),
    [holdings, targets, rebalanceThreshold]
  );

  const now = new Date();
  const currentMonthYear = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const dcaCompletedThisMonth = holdings.some((h) => h.purchase_date?.startsWith(currentMonthYear));
  const daysLeft = dcaDay !== null ? daysUntilDay(dcaDay) : null;

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
          <Text style={[styles.title, { color: theme.text }]}>Folvio</Text>
        </View>
        <View style={[styles.badge, { backgroundColor: theme.deepBlue }]}>
          <Text style={styles.badgeText}>EU</Text>
        </View>
      </View>

      {/* Hero Card */}
      <LinearGradient
        colors={["#1E3A5F", "#0A1628"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.heroCard}
      >
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
      </LinearGradient>

      {/* Allocation Donut — shows all holdings */}
      {holdings.length > 0 && (
        <View style={[styles.card, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Allocation</Text>
          <View style={styles.donutRow}>
            <TouchableOpacity onPress={() => setSelectedClass(null)} activeOpacity={0.8}>
              <DonutChart
                segments={donutSegments}
                size={140}
                strokeWidth={20}
                centerLabel={formatEUR(totalPortfolioValue, true)}
                centerSublabel={selectedClass ?? `${holdings.length} holding${holdings.length !== 1 ? "s" : ""}`}
              />
            </TouchableOpacity>
            <View style={styles.legend}>
              {holdings.map((h, i) => {
                const val = h.quantity * h.currentPrice;
                const pct = totalPortfolioValue > 0 ? (val / totalPortfolioValue) * 100 : 0;
                const gain = h.avg_cost_eur > 0
                  ? ((h.currentPrice - h.avg_cost_eur) / h.avg_cost_eur) * 100
                  : 0;
                return (
                  <View
                    key={h.id}
                    style={[styles.legendItem, {
                      opacity: selectedClass === null || getAssetClass(h.ticker, h.isin ?? "") === selectedClass ? 1 : 0.3,
                    }]}
                  >
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
            </View>
          </View>
        </View>
      )}

      {/* Drift alert banner */}
      {driftRows.length > 0 && holdings.length > 0 && targets.length > 0 && (
        <TouchableOpacity
          style={[styles.alertBanner, { backgroundColor: "#FBBF2414", borderColor: "#FBBF2455" }]}
          onPress={() => router.push("/rebalance" as never)}
          activeOpacity={0.8}
        >
          <Feather name="alert-triangle" size={15} color="#FBBF24" />
          <Text style={[styles.alertText, { color: "#FBBF24" }]}>
            {driftRows.length === 1
              ? `⚖️ ${driftRows[0].ticker} is ${Math.abs(driftRows[0].drift).toFixed(1)}% outside your target — consider adjusting your next DCA`
              : `⚖️ ${driftRows.length} holdings outside target allocation`}
          </Text>
          <Feather name="chevron-right" size={13} color="#FBBF2499" />
        </TouchableOpacity>
      )}

      {/* Asset Class Breakdown — based on market value */}
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
                  backgroundColor: selectedClass === ac.class ? (CLASS_COLORS[ac.class] + "22") : "transparent",
                  paddingHorizontal: selectedClass === ac.class ? 8 : 0,
                  paddingVertical: selectedClass === ac.class ? 4 : 0,
                  borderRadius: 8,
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
                    {ac.valueEUR >= 1000
                      ? formatEUR(ac.valueEUR, true)
                      : `€${Math.round(ac.valueEUR)}`}
                  </Text>
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* DCA Reminder card */}
      {dcaDay !== null && holdings.length > 0 && (
        <TouchableOpacity
          style={[styles.card, styles.dcaCard, {
            backgroundColor: theme.backgroundCard,
            borderColor: dcaCompletedThisMonth ? theme.border : theme.tint + "55",
          }]}
          onPress={() => router.push("/(tabs)/projections" as never)}
          activeOpacity={0.8}
        >
          <View style={[styles.dcaIconWrap, {
            backgroundColor: dcaCompletedThisMonth ? theme.positive + "22" : theme.tint + "22",
          }]}>
            <Text style={styles.dcaEmoji}>{dcaCompletedThisMonth ? "✅" : "💰"}</Text>
          </View>
          <View style={{ flex: 1 }}>
            {dcaCompletedThisMonth ? (
              <Text style={[styles.dcaTitle, { color: theme.positive }]}>
                DCA completed this month
              </Text>
            ) : daysLeft !== null ? (
              <>
                <Text style={[styles.dcaTitle, { color: theme.text }]}>
                  DCA due in {daysLeft} day{daysLeft !== 1 ? "s" : ""}
                </Text>
                <Text style={[styles.dcaSub, { color: theme.textSecondary }]}>
                  {dcaAmount > 0 ? `€${dcaAmount.toFixed(0)} scheduled` : "Investment"} for the {ordinal(dcaDay)}
                </Text>
              </>
            ) : (
              <Text style={[styles.dcaTitle, { color: theme.text }]}>
                DCA due on the {ordinal(dcaDay)}
              </Text>
            )}
          </View>
          <Feather name="chevron-right" size={16} color={theme.textTertiary} />
        </TouchableOpacity>
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
                <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: theme.textSecondary }}>
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
  heroCard: { borderRadius: 20, padding: 24, gap: 6, overflow: "hidden" },
  heroLabel: { color: "rgba(255,255,255,0.55)", fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 1 },
  heroValue: { color: "#FFFFFF", fontSize: 40, fontFamily: "Inter_700Bold", letterSpacing: -1.5 },
  heroRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  gainBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  gainText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  investedText: { color: "rgba(255,255,255,0.5)", fontSize: 12, fontFamily: "Inter_400Regular" },
  card: { borderRadius: 16, padding: 18, borderWidth: 1 },
  sectionTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 14 },
  donutRow: { flexDirection: "row", alignItems: "center", gap: 16 },
  legend: { flex: 1, gap: 7 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  legendTicker: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  legendPct: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 1 },
  alertBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  alertText: { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium", lineHeight: 17 },
  assetBarContainer: { flexDirection: "row", height: 14, borderRadius: 7, overflow: "hidden", marginBottom: 14, gap: 2 },
  assetBarSegment: { borderRadius: 3 },
  assetLegend: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  assetLegendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  assetLabel: { fontSize: 12, fontFamily: "Inter_400Regular" },
  dcaCard: { flexDirection: "row", alignItems: "center", gap: 12 },
  dcaIconWrap: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  dcaEmoji: { fontSize: 18 },
  dcaTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  dcaSub: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  statsGrid: { flexDirection: "row", gap: 12 },
  statCard: { flex: 1, borderRadius: 14, padding: 16, borderWidth: 1, gap: 6, alignItems: "flex-start" },
  statValue: { fontSize: 20, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  statLabel: { fontSize: 12, fontFamily: "Inter_400Regular" },
  emptyCard: { borderRadius: 16, padding: 32, borderWidth: 1, alignItems: "center", gap: 12, marginTop: 8 },
  emptyIcon: { width: 64, height: 64, borderRadius: 20, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_700Bold", textAlign: "center" },
  emptySubtitle: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 21, maxWidth: 280 },
});
