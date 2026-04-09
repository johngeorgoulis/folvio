import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useMemo, useState } from "react";
import {
  Platform, ScrollView, StyleSheet,
  Text, TouchableOpacity, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { usePortfolio } from "@/context/PortfolioContext";
import { useAllocation } from "@/context/AllocationContext";
import { formatEUR, formatPct, currentMonthLabel } from "@/utils/format";
import { DonutChart, CHART_COLORS } from "@/components/DonutChart";
import { classifyPortfolio, getAssetClass } from "@/services/assetClassService";
import { calculateAllocations } from "@/services/allocationService";
import { router } from "expo-router";

const theme = Colors.dark;

// ── Types ─────────────────────────────────────────────────────────────────────
const TIMEFRAMES = ["1W", "1M", "3M", "1Y", "All"] as const;
type Timeframe = typeof TIMEFRAMES[number];

// ── Asset class palette (chart use only — not UI chrome) ──────────────────────
const CLASS_COLORS: Record<string, string> = {
  "Equity":      "#60A5FA",
  "Bond":        "#34D399",
  "Commodity":   "#FBBF24",
  "Real Estate": "#A78BFA",
  "Cash":        "#F472B6",
  "Other":       "#94A3B8",
};

// ── Helpers ───────────────────────────────────────────────────────────────────
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

// ── Skeleton shimmer placeholder ──────────────────────────────────────────────
function SkeletonCard({ height = 120 }: { height?: number }) {
  return (
    <View style={[styles.skeletonCard, { height }]}>
      <View style={styles.skeletonLine} />
      <View style={[styles.skeletonLine, { width: "60%", marginTop: 10 }]} />
    </View>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
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

  const topPad    = Platform.OS === "web" ? 24 : insets.top + 8;
  const bottomPad = Platform.OS === "web" ? 80 : insets.bottom + 80;

  useEffect(() => {
    AsyncStorage.multiGet(["folvio_dca_day", "folvio_forecast_dca"])
      .then((pairs) => {
        const day = pairs[0][1];
        const amt = pairs[1][1];
        if (day) setDcaDay(parseInt(day, 10));
        if (amt) setDcaAmount(parseFloat(amt) || 0);
      })
      .catch(() => {});
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

  const donutSegments = useMemo(() =>
    holdings.map((h, i) => {
      const assetClass = getAssetClass(h.ticker, h.isin ?? "");
      const isSelected = selectedClass === null || assetClass === selectedClass;
      return {
        label: h.ticker,
        value: h.quantity * h.currentPrice,
        color: isSelected
          ? CHART_COLORS[i % CHART_COLORS.length]
          : CHART_COLORS[i % CHART_COLORS.length] + "33",
      };
    }),
    [holdings, selectedClass]
  );

  const driftRows = useMemo(
    () => calculateAllocations(holdings, targets, rebalanceThreshold)
      .filter((r) => r.status === "overweight" || r.status === "underweight"),
    [holdings, targets, rebalanceThreshold]
  );

  const now = new Date();
  const currentMonthYear = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const dcaCompletedThisMonth = holdings.some((h) => h.purchase_date?.startsWith(currentMonthYear));
  const daysLeft = dcaDay !== null ? daysUntilDay(dcaDay) : null;

  // ── Loading skeleton ────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <View style={{ paddingTop: topPad + 12, paddingHorizontal: 16, gap: 14 }}>
          <SkeletonCard height={100} />
          <SkeletonCard height={200} />
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.background }]}
      contentContainerStyle={[styles.content, { paddingTop: topPad + 12, paddingBottom: bottomPad }]}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerDate}>{currentMonthLabel()}</Text>
          <Text style={styles.headerTitle}>Folvio</Text>
        </View>
        <View style={styles.euBadge}>
          <Text style={styles.euBadgeText}>EU</Text>
        </View>
      </View>

      {/* ── Hero Card ────────────────────────────────────────────────────── */}
      <View style={styles.heroCard}>
        {/* Amber accent stripe */}
        <View style={styles.heroAccentBar} />
        <View style={styles.heroInner}>
          <Text style={styles.heroLabel}>TOTAL PORTFOLIO VALUE</Text>
          <Text style={styles.heroValue}>{formatEUR(totalPortfolioValue)}</Text>

          <View style={styles.heroMetaRow}>
            <View style={[
              styles.heroBadge,
              { backgroundColor: totalGain >= 0 ? theme.positive + "20" : theme.negative + "20" },
            ]}>
              <Feather
                name={totalGain >= 0 ? "arrow-up-right" : "arrow-down-right"}
                size={13}
                color={totalGain >= 0 ? theme.positive : theme.negative}
              />
              <Text style={[styles.heroBadgeText, { color: totalGain >= 0 ? theme.positive : theme.negative }]}>
                {totalGain >= 0 ? "+" : ""}{formatPct(totalGainPct)} all time
              </Text>
            </View>
            {annualizedReturn !== null && (
              <View style={[
                styles.heroBadge,
                { backgroundColor: theme.backgroundCard },
              ]}>
                <Text style={[styles.heroBadgeText, { color: annualizedReturn >= 0 ? theme.positive : theme.negative }]}>
                  {annualizedReturn >= 0 ? "+" : ""}{annualizedReturn.toFixed(1)}%/yr
                </Text>
              </View>
            )}
          </View>

          <Text style={styles.heroInvested}>{formatEUR(totalInvested)} invested</Text>
        </View>
      </View>

      {/* ── Drift Alert Banner (left-bordered card) ───────────────────────── */}
      {driftRows.length > 0 && holdings.length > 0 && targets.length > 0 && (
        <TouchableOpacity
          style={styles.driftAlert}
          onPress={() => router.push("/rebalance" as never)}
          activeOpacity={0.8}
        >
          <View style={styles.driftAlertBorder} />
          <View style={styles.driftAlertContent}>
            <Feather name="alert-triangle" size={15} color={theme.tint} />
            <Text style={styles.driftAlertText}>
              {driftRows.length === 1
                ? `${driftRows[0].ticker} is ${Math.abs(driftRows[0].drift).toFixed(1)}% outside your target`
                : `${driftRows.length} holdings outside target allocation`}
            </Text>
            <Feather name="chevron-right" size={14} color={theme.tint + "88"} />
          </View>
        </TouchableOpacity>
      )}

      {/* ── Allocation Donut ──────────────────────────────────────────────── */}
      {holdings.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Allocation</Text>
          <View style={styles.donutRow}>
            <TouchableOpacity onPress={() => setSelectedClass(null)} activeOpacity={0.8}>
              <DonutChart
                segments={donutSegments}
                size={180}
                strokeWidth={24}
                centerLabel={formatEUR(totalPortfolioValue, true)}
                centerSublabel={selectedClass ?? `${holdings.length} holding${holdings.length !== 1 ? "s" : ""}`}
              />
            </TouchableOpacity>
            <View style={styles.donutLegend}>
              {holdings.map((h, i) => {
                const val = h.quantity * h.currentPrice;
                const pct = totalPortfolioValue > 0 ? (val / totalPortfolioValue) * 100 : 0;
                const gain = h.avg_cost_eur > 0
                  ? ((h.currentPrice - h.avg_cost_eur) / h.avg_cost_eur) * 100
                  : 0;
                const isVisible = selectedClass === null || getAssetClass(h.ticker, h.isin ?? "") === selectedClass;
                return (
                  <View
                    key={h.id}
                    style={[styles.legendItem, { opacity: isVisible ? 1 : 0.28 }]}
                  >
                    <View style={[styles.legendDot, { backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.legendTicker}>{h.ticker}</Text>
                      <Text style={styles.legendPct}>
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

      {/* ── Asset Mix Bar ─────────────────────────────────────────────────── */}
      {assetClasses.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Asset Mix</Text>
          <View style={styles.assetBar}>
            {assetClasses.map((ac) => (
              <View
                key={ac.class}
                style={[styles.assetBarSegment, {
                  flex: ac.valuePct,
                  backgroundColor: CLASS_COLORS[ac.class] ?? "#94A3B8",
                }]}
              />
            ))}
          </View>
          <View style={styles.assetLegend}>
            {assetClasses.map((ac) => (
              <TouchableOpacity
                key={ac.class}
                style={[styles.assetLegendItem, {
                  opacity: selectedClass === null || selectedClass === ac.class ? 1 : 0.35,
                  backgroundColor: selectedClass === ac.class
                    ? (CLASS_COLORS[ac.class] ?? "#94A3B8") + "22"
                    : "transparent",
                  paddingHorizontal: selectedClass === ac.class ? 8 : 0,
                  paddingVertical:   selectedClass === ac.class ? 3 : 0,
                  borderRadius: 6,
                }]}
                onPress={() => setSelectedClass(selectedClass === ac.class ? null : ac.class)}
                activeOpacity={0.7}
              >
                <View style={[styles.legendDot, { backgroundColor: CLASS_COLORS[ac.class] ?? "#94A3B8" }]} />
                <Text style={styles.assetLabel}>
                  {ac.class}{"  "}
                  <Text style={{ color: theme.text, fontFamily: "Inter_600SemiBold" }}>
                    {ac.valuePct.toFixed(0)}%
                  </Text>
                  {"  "}
                  <Text style={{ color: theme.textTertiary }}>
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

      {/* ── DCA Reminder ─────────────────────────────────────────────────── */}
      {dcaDay !== null && holdings.length > 0 && (
        <TouchableOpacity
          style={[styles.card, styles.dcaCard, {
            borderColor: dcaCompletedThisMonth ? theme.border : theme.tint + "55",
          }]}
          onPress={() => router.push("/(tabs)/projections" as never)}
          activeOpacity={0.8}
        >
          <View style={[styles.dcaIcon, {
            backgroundColor: dcaCompletedThisMonth ? theme.positive + "22" : theme.tint + "18",
          }]}>
            <Feather
              name={dcaCompletedThisMonth ? "check-circle" : "calendar"}
              size={20}
              color={dcaCompletedThisMonth ? theme.positive : theme.tint}
            />
          </View>
          <View style={{ flex: 1 }}>
            {dcaCompletedThisMonth ? (
              <Text style={[styles.dcaTitle, { color: theme.positive }]}>DCA completed this month</Text>
            ) : daysLeft !== null ? (
              <>
                <Text style={styles.dcaTitle}>
                  DCA due in {daysLeft} day{daysLeft !== 1 ? "s" : ""}
                </Text>
                <Text style={styles.dcaSub}>
                  {dcaAmount > 0 ? `€${dcaAmount.toFixed(0)}` : "Investment"} · {ordinal(dcaDay)} of the month
                </Text>
              </>
            ) : (
              <Text style={styles.dcaTitle}>DCA due on the {ordinal(dcaDay)}</Text>
            )}
          </View>
          <Feather name="chevron-right" size={16} color={theme.textTertiary} />
        </TouchableOpacity>
      )}

      {/* ── Dividend Income ───────────────────────────────────────────────── */}
      {holdings.length > 0 && (() => {
        const annualDiv = holdings.reduce((sum, h) => {
          const y = h.yield_pct ?? 0;
          if (!y || !h.hasPrice) return sum;
          return sum + h.quantity * h.currentPrice * (y / 100);
        }, 0);
        if (annualDiv === 0) return null;
        return (
          <View style={styles.card}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <View style={{ gap: 2 }}>
                <Text style={styles.cardTitle}>Dividend Income</Text>
                <Text style={styles.cardCaption}>Estimated annual</Text>
              </View>
              <View style={{ alignItems: "flex-end", gap: 2 }}>
                <Text style={styles.dividendValue}>{formatEUR(annualDiv)}</Text>
                <Text style={styles.cardCaption}>{formatEUR(annualDiv / 12)}/month</Text>
              </View>
            </View>
          </View>
        );
      })()}

      {/* ── Stats Grid ───────────────────────────────────────────────────── */}
      {holdings.length > 0 && (
        <View style={styles.statsGrid}>
          <TouchableOpacity
            style={styles.statCard}
            onPress={() => router.push("/(tabs)/holdings")}
            activeOpacity={0.75}
          >
            <Feather name="layers" size={18} color={theme.tint} />
            <Text style={styles.statValue}>{holdings.length}</Text>
            <Text style={styles.statLabel}>Holdings</Text>
            <Feather
              name="chevron-right"
              size={12}
              color={theme.textTertiary}
              style={{ position: "absolute", top: 14, right: 14 }}
            />
          </TouchableOpacity>
          <View style={styles.statCard}>
            <Feather
              name={totalGain >= 0 ? "arrow-up-right" : "arrow-down-right"}
              size={18}
              color={totalGain >= 0 ? theme.positive : theme.negative}
            />
            <Text style={[styles.statValue, { color: totalGain >= 0 ? theme.positive : theme.negative }]}>
              {totalGain >= 0 ? "+" : ""}{formatEUR(totalGain, true)}
            </Text>
            <Text style={styles.statLabel}>Total Gain</Text>
          </View>
        </View>
      )}

      {/* ── Empty state ───────────────────────────────────────────────────── */}
      {holdings.length === 0 && (
        <View style={styles.emptyCard}>
          <View style={styles.emptyIconWrap}>
            <Feather name="briefcase" size={30} color={theme.tint} />
          </View>
          <Text style={styles.emptyTitle}>Build your portfolio</Text>
          <Text style={styles.emptySubtitle}>
            Add your UCITS ETFs and stocks in the Holdings tab to start tracking your European portfolio.
          </Text>
          <TouchableOpacity
            style={styles.emptyBtn}
            onPress={() => router.push("/(tabs)/holdings")}
            activeOpacity={0.85}
          >
            <Text style={styles.emptyBtnText}>Go to Holdings →</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1 },
  content:   { paddingHorizontal: 16, gap: 14 },

  // Skeleton
  skeletonCard: {
    backgroundColor: theme.backgroundCard,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 20,
    justifyContent: "flex-end",
  },
  skeletonLine: {
    height: 12,
    borderRadius: 6,
    backgroundColor: theme.backgroundElevated,
    width: "80%",
  },

  // Header
  header:       { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 2 },
  headerDate:   { fontSize: 12, fontFamily: "Inter_500Medium", color: theme.textTertiary, letterSpacing: 0.3 },
  headerTitle:  { fontSize: 26, fontFamily: "Inter_700Bold", color: theme.text, letterSpacing: -0.8 },
  euBadge:      { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: theme.backgroundElevated, borderWidth: 1, borderColor: theme.border },
  euBadgeText:  { color: theme.tint, fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 1.2 },

  // Hero card
  heroCard: {
    backgroundColor: theme.backgroundCard,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.border,
    overflow: "hidden",
  },
  heroAccentBar: { height: 3, backgroundColor: theme.tint, width: "100%" },
  heroInner:    { padding: 22, gap: 8 },
  heroLabel:    { fontSize: 11, fontFamily: "Inter_600SemiBold", color: theme.textTertiary, letterSpacing: 1.2 },
  heroValue:    { fontSize: 40, fontFamily: "Inter_700Bold", color: theme.text, letterSpacing: -2 },
  heroMetaRow:  { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  heroBadge:    { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  heroBadgeText:{ fontSize: 13, fontFamily: "Inter_600SemiBold" },
  heroInvested: { fontSize: 12, fontFamily: "Inter_400Regular", color: theme.textTertiary, marginTop: 2 },

  // Drift alert (left-bordered card)
  driftAlert: {
    flexDirection: "row",
    backgroundColor: theme.backgroundElevated,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
    overflow: "hidden",
  },
  driftAlertBorder:  { width: 4, backgroundColor: theme.tint },
  driftAlertContent: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 13 },
  driftAlertText:    { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", color: theme.text, lineHeight: 19 },

  // Card
  card:      { backgroundColor: theme.backgroundCard, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: theme.border },
  cardTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: theme.text, marginBottom: 14 },
  cardCaption: { fontSize: 12, fontFamily: "Inter_400Regular", color: theme.textTertiary },

  // Donut
  donutRow:    { flexDirection: "row", alignItems: "center", gap: 20 },
  donutLegend: { flex: 1, gap: 10 },
  legendItem:  { flexDirection: "row", alignItems: "center", gap: 9 },
  legendDot:   { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  legendTicker:{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: theme.text },
  legendPct:   { fontSize: 11, fontFamily: "Inter_400Regular", color: theme.textSecondary, marginTop: 1 },

  // Asset mix bar
  assetBar: { flexDirection: "row", height: 8, borderRadius: 4, overflow: "hidden", marginBottom: 14, gap: 2 },
  assetBarSegment: { borderRadius: 2 },
  assetLegend:     { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  assetLegendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  assetLabel:      { fontSize: 12, fontFamily: "Inter_400Regular", color: theme.textSecondary },

  // DCA card
  dcaCard:  { flexDirection: "row", alignItems: "center", gap: 14 },
  dcaIcon:  { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  dcaTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: theme.text },
  dcaSub:   { fontSize: 12, fontFamily: "Inter_400Regular", color: theme.textSecondary, marginTop: 2 },

  // Dividend
  dividendValue: { fontSize: 22, fontFamily: "Inter_700Bold", color: theme.tint, letterSpacing: -0.5 },

  // Stats grid
  statsGrid: { flexDirection: "row", gap: 12 },
  statCard:  { flex: 1, backgroundColor: theme.backgroundCard, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: theme.border, gap: 6 },
  statValue: { fontSize: 20, fontFamily: "Inter_700Bold", color: theme.text, letterSpacing: -0.5 },
  statLabel: { fontSize: 12, fontFamily: "Inter_400Regular", color: theme.textSecondary },

  // Empty state
  emptyCard: {
    backgroundColor: theme.backgroundCard,
    borderRadius: 16,
    padding: 36,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: "center",
    gap: 12,
    marginTop: 8,
  },
  emptyIconWrap: {
    width: 68, height: 68, borderRadius: 20,
    backgroundColor: theme.backgroundElevated,
    borderWidth: 1, borderColor: theme.border,
    alignItems: "center", justifyContent: "center",
    marginBottom: 4,
  },
  emptyTitle:    { fontSize: 18, fontFamily: "Inter_700Bold", color: theme.text, textAlign: "center" },
  emptySubtitle: { fontSize: 14, fontFamily: "Inter_400Regular", color: theme.textSecondary, textAlign: "center", lineHeight: 22, maxWidth: 280 },
  emptyBtn:      { marginTop: 4, paddingHorizontal: 22, paddingVertical: 13, backgroundColor: theme.tint, borderRadius: 12 },
  emptyBtnText:  { fontSize: 15, fontFamily: "Inter_700Bold", color: theme.background },
});
