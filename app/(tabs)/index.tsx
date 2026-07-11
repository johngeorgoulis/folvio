import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useMemo, useState } from "react";
import {
  Platform, ScrollView, StyleSheet,
  Text, TouchableOpacity, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePortfolio } from "@/context/PortfolioContext";
import { useAllocation } from "@/context/AllocationContext";
import { useTheme } from "@/context/ThemeContext";
import { formatEUR, formatPct, currentMonthLabel } from "@/utils/format";
import { DonutChart, CHART_COLORS } from "@/components/DonutChart";
import { classifyPortfolio, getAssetClass } from "@/services/assetClassService";
import { calculateAllocations } from "@/services/allocationService";
import { router } from "expo-router";

const TIMEFRAMES = ["1W", "1M", "3M", "1Y", "All"] as const;
type Timeframe = typeof TIMEFRAMES[number];

const CLASS_COLORS: Record<string, string> = {
  "Equity":      "#60A5FA",
  "Bond":        "#34D399",
  "Commodity":   "#FBBF24",
  "Real Estate": "#A78BFA",
  "Cash":        "#F472B6",
  "Other":       "#94A3B8",
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
  const { theme } = useTheme();
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

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background }} />
    );
  }

  const s = makeStyles(theme);

  return (
    <ScrollView
      style={[s.container]}
      contentContainerStyle={[s.content, { paddingTop: topPad + 12, paddingBottom: bottomPad }]}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <View style={s.header}>
        <View>
          <Text style={s.headerDate}>{currentMonthLabel().toUpperCase()}</Text>
          <Text style={s.headerTitle}>FOLVIO</Text>
        </View>
        <TouchableOpacity
          onPress={() => router.push("/(tabs)/settings" as never)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={s.settingsLink}>SETTINGS</Text>
        </TouchableOpacity>
      </View>

      {/* ── Hero block ────────────────────────────────────────────────────── */}
      <View style={s.heroCard}>
        <Text style={s.heroLabel}>TOTAL VALUE</Text>
        <Text style={s.heroValue}>{formatEUR(totalPortfolioValue)}</Text>
        <View style={s.heroMetaRow}>
          <Text style={[s.heroGain, { color: totalGain >= 0 ? theme.positive : theme.negative }]}>
            {totalGain >= 0 ? "+" : ""}{formatPct(totalGainPct)} all time
          </Text>
          <Text style={s.heroInvested}>{formatEUR(totalInvested)} invested</Text>
        </View>
      </View>

      {/* ── Section divider ────────────────────────────────────────────────── */}
      <View style={s.divider} />

      {/* ── Allocation header ─────────────────────────────────────────────── */}
      <View style={s.sectionHeader}>
        <Text style={s.sectionTitle}>ALLOCATION</Text>
        <Text style={s.sectionCount}>{holdings.length} holding{holdings.length !== 1 ? "s" : ""}</Text>
      </View>

      {/* ── Holding rows with progress bars ──────────────────────────────── */}
      {holdings.map((h) => {
        const val = h.quantity * h.currentPrice;
        const pct = totalPortfolioValue > 0 ? (val / totalPortfolioValue) * 100 : 0;
        const gain = h.avg_cost_eur > 0
          ? ((h.currentPrice - h.avg_cost_eur) / h.avg_cost_eur) * 100
          : 0;
        return (
          <TouchableOpacity
            key={h.id}
            style={s.holdingPanel}
            onPress={() => router.push({ pathname: "/holding/[id]", params: { id: h.id } })}
            activeOpacity={0.75}
          >
            <View style={s.holdingRow1}>
              <Text style={s.holdingTicker}>{h.ticker}</Text>
              <Text style={s.holdingValue}>{h.hasPrice ? formatEUR(val) : "—"}</Text>
            </View>
            <View style={s.holdingRow2}>
              <Text style={s.holdingPct}>{pct.toFixed(1)}% of portfolio</Text>
              {h.hasPrice && (
                <Text style={[s.holdingGain, { color: gain >= 0 ? theme.positive : theme.negative }]}>
                  {gain >= 0 ? "+" : ""}{gain.toFixed(1)}%
                </Text>
              )}
            </View>
            <View style={s.progressTrack}>
              <View style={[s.progressFill, { width: `${Math.min(pct, 100)}%` as any }]} />
            </View>
          </TouchableOpacity>
        );
      })}

      {/* ── DonutChart allocation ──────────────────────────────────────────── */}
      {holdings.length > 0 && (
        <View style={s.card}>
          <Text style={s.cardTitle}>BREAKDOWN</Text>
          <View style={s.donutRow}>
            <TouchableOpacity onPress={() => setSelectedClass(null)} activeOpacity={0.8}>
              <DonutChart
                segments={donutSegments}
                size={160}
                strokeWidth={20}
                centerLabel={formatEUR(totalPortfolioValue, true)}
                centerSublabel={selectedClass ?? `${holdings.length} holdings`}
              />
            </TouchableOpacity>
            <View style={s.donutLegend}>
              {holdings.map((h, i) => {
                const val = h.quantity * h.currentPrice;
                const pct = totalPortfolioValue > 0 ? (val / totalPortfolioValue) * 100 : 0;
                const gain = h.avg_cost_eur > 0
                  ? ((h.currentPrice - h.avg_cost_eur) / h.avg_cost_eur) * 100
                  : 0;
                const isVisible = selectedClass === null || getAssetClass(h.ticker, h.isin ?? "") === selectedClass;
                return (
                  <View key={h.id} style={[s.legendItem, { opacity: isVisible ? 1 : 0.28 }]}>
                    <View style={[s.legendDot, { backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.legendTicker}>{h.ticker}</Text>
                      <Text style={s.legendPct}>
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

      {/* ── Drift alert ───────────────────────────────────────────────────── */}
      {driftRows.length > 0 && holdings.length > 0 && targets.length > 0 && (
        <TouchableOpacity style={s.driftAlert} onPress={() => router.push("/rebalance" as never)} activeOpacity={0.8}>
          <Text style={s.driftAlertText}>
            {driftRows.length === 1
              ? `${driftRows[0].ticker} is ${Math.abs(driftRows[0].drift).toFixed(1)}% outside your target — Rebalance`
              : `${driftRows.length} holdings outside target allocation — Rebalance`}
          </Text>
          <Feather name="arrow-right" size={14} color={theme.text} />
        </TouchableOpacity>
      )}

      {/* ── DCA Reminder ─────────────────────────────────────────────────── */}
      {dcaDay !== null && holdings.length > 0 && (
        <TouchableOpacity style={s.card} onPress={() => router.push("/(tabs)/insights" as never)} activeOpacity={0.8}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <View style={{ gap: 2 }}>
              <Text style={s.cardTitle}>DCA</Text>
              {dcaCompletedThisMonth ? (
                <Text style={[s.cardCaption, { color: theme.positive }]}>Completed this month</Text>
              ) : daysLeft !== null ? (
                <Text style={s.cardCaption}>Due in {daysLeft} day{daysLeft !== 1 ? "s" : ""} · {ordinal(dcaDay)}</Text>
              ) : null}
            </View>
            <Feather name="arrow-right" size={16} color={theme.textMuted} />
          </View>
        </TouchableOpacity>
      )}

      {/* ── Stats grid ───────────────────────────────────────────────────── */}
      {holdings.length > 0 && (
        <View style={s.statsGrid}>
          <TouchableOpacity style={s.statCell} onPress={() => router.push("/(tabs)/holdings")} activeOpacity={0.75}>
            <Text style={s.statLabel}>HOLDINGS</Text>
            <Text style={s.statValue}>{holdings.length}</Text>
          </TouchableOpacity>
          <View style={[s.statCell, { borderLeftWidth: 1, borderLeftColor: theme.hairline }]}>
            <Text style={s.statLabel}>TOTAL GAIN</Text>
            <Text style={[s.statValue, { color: totalGain >= 0 ? theme.positive : theme.negative }]}>
              {totalGain >= 0 ? "+" : ""}{formatEUR(totalGain, true)}
            </Text>
          </View>
        </View>
      )}

      {/* ── Empty state ───────────────────────────────────────────────────── */}
      {holdings.length === 0 && (
        <View style={s.emptyState}>
          <Text style={s.emptyTitle}>Build your portfolio</Text>
          <Text style={s.emptySubtitle}>
            Add your UCITS ETFs and stocks in the Holdings tab to start tracking your European portfolio.
          </Text>
          <TouchableOpacity style={s.emptyBtn} onPress={() => router.push("/(tabs)/holdings")} activeOpacity={0.85}>
            <Text style={s.emptyBtnText}>Go to Holdings →</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

function makeStyles(theme: ReturnType<typeof import("@/context/ThemeContext").useTheme>["theme"]) {
  return StyleSheet.create({
    container:    { flex: 1, backgroundColor: theme.background },
    content:      { paddingHorizontal: 20, gap: 0 },

    header:       { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 20 },
    headerDate:   { fontSize: 11, fontFamily: "Archivo_600SemiBold", color: theme.textMuted, letterSpacing: 0.8 },
    headerTitle:  { fontSize: 26, fontFamily: "Archivo_800ExtraBold", color: theme.text, letterSpacing: -0.5, marginTop: 2 },
    settingsLink: {
      fontSize: 12, fontFamily: "Archivo_800ExtraBold", color: theme.text,
      textDecorationLine: "underline", letterSpacing: 0.4,
    },

    heroCard: {
      borderTopWidth: 2, borderTopColor: theme.text,
      backgroundColor: theme.surface,
      padding: 20,
      marginBottom: 0,
      shadowColor: theme.shadow,
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 1,
      shadowRadius: 2,
      elevation: 1,
    },
    heroLabel:    { fontSize: 11, fontFamily: "Archivo_600SemiBold", color: theme.textMuted, letterSpacing: 0.8, marginBottom: 6 },
    heroValue:    { fontSize: 44, fontFamily: "Archivo_800ExtraBold", color: theme.text, letterSpacing: -1.5, lineHeight: 50 },
    heroMetaRow:  { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 8, flexWrap: "wrap" },
    heroGain:     { fontSize: 14, fontFamily: "Archivo_600SemiBold" },
    heroInvested: { fontSize: 13, fontFamily: "Archivo_400Regular", color: theme.textMuted },

    divider:      { height: 2, backgroundColor: theme.divider, marginVertical: 20 },

    sectionHeader:{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
    sectionTitle: { fontSize: 13, fontFamily: "Archivo_800ExtraBold", color: theme.text, letterSpacing: 0.4 },
    sectionCount: { fontSize: 12, fontFamily: "Archivo_400Regular", color: theme.textMuted },

    holdingPanel: {
      backgroundColor: theme.surface,
      padding: 14,
      marginBottom: 8,
      shadowColor: theme.shadow,
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 1,
      shadowRadius: 2,
      elevation: 1,
    },
    holdingRow1:  { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    holdingRow2:  { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 3 },
    holdingTicker:{ fontSize: 15, fontFamily: "Archivo_800ExtraBold", color: theme.text },
    holdingValue: { fontSize: 15, fontFamily: "Archivo_800ExtraBold", color: theme.text },
    holdingPct:   { fontSize: 12, fontFamily: "Archivo_400Regular", color: theme.textMuted },
    holdingGain:  { fontSize: 12, fontFamily: "Archivo_600SemiBold" },
    progressTrack:{ height: 3, backgroundColor: theme.hairline, marginTop: 10 },
    progressFill: { height: 3, backgroundColor: theme.accent },

    card:      { backgroundColor: theme.surface, padding: 16, marginBottom: 8, marginTop: 8, shadowColor: theme.shadow, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 1, shadowRadius: 2, elevation: 1 },
    cardTitle: { fontSize: 13, fontFamily: "Archivo_800ExtraBold", color: theme.text, letterSpacing: 0.4, marginBottom: 12 },
    cardCaption:{ fontSize: 12, fontFamily: "Archivo_400Regular", color: theme.textMuted },

    donutRow:    { flexDirection: "row", alignItems: "center", gap: 16 },
    donutLegend: { flex: 1, gap: 8 },
    legendItem:  { flexDirection: "row", alignItems: "center", gap: 8 },
    legendDot:   { width: 7, height: 7, borderRadius: 0, flexShrink: 0 },
    legendTicker:{ fontSize: 12, fontFamily: "Archivo_800ExtraBold", color: theme.text },
    legendPct:   { fontSize: 11, fontFamily: "Archivo_400Regular", color: theme.textMuted, marginTop: 1 },

    driftAlert: {
      borderTopWidth: 2, borderTopColor: theme.divider,
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      paddingVertical: 14, paddingHorizontal: 0, marginTop: 8,
    },
    driftAlertText: { flex: 1, fontSize: 13, fontFamily: "Archivo_600SemiBold", color: theme.text },

    statsGrid: { flexDirection: "row", marginTop: 8, borderTopWidth: 2, borderTopColor: theme.divider },
    statCell:  { flex: 1, padding: 16, gap: 4 },
    statLabel: { fontSize: 11, fontFamily: "Archivo_600SemiBold", color: theme.textMuted, letterSpacing: 0.6 },
    statValue: { fontSize: 20, fontFamily: "Archivo_800ExtraBold", color: theme.text, letterSpacing: -0.5 },

    emptyState: { paddingVertical: 40, gap: 12 },
    emptyTitle: { fontSize: 18, fontFamily: "Archivo_800ExtraBold", color: theme.text },
    emptySubtitle: { fontSize: 14, fontFamily: "Archivo_400Regular", color: theme.textMuted, lineHeight: 22 },
    emptyBtn: { paddingHorizontal: 20, paddingVertical: 13, backgroundColor: theme.accent, alignSelf: "flex-start", marginTop: 4 },
    emptyBtnText: { fontSize: 14, fontFamily: "Archivo_800ExtraBold", color: "#fff" },
  });
}
