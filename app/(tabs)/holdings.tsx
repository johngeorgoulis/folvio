import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Swipeable } from "react-native-gesture-handler";
import { isExchangeOpen } from "@/utils/marketHours";
import { usePortfolio, FREE_TIER_LIMIT } from "@/context/PortfolioContext";
import { useSubscription } from "@/context/SubscriptionContext";
import { useAllocation } from "@/context/AllocationContext";
import { useTheme } from "@/context/ThemeContext";
import { formatEUR, formatPct, formatQuantity } from "@/utils/format";
import { calculateAllocations, validateTargets } from "@/services/allocationService";
import AddHoldingModal, { type AddHoldingInitialValues } from "@/components/AddHoldingModal";

function getDistBadge(name: string, ticker: string): "ACC" | "DIST" | null {
  const hay = (name + " " + ticker).toLowerCase();
  if (hay.includes("acc") || hay.includes("accumul")) return "ACC";
  if (hay.includes("dist") || hay.includes("distribut")) return "DIST";
  return null;
}

export default function HoldingsScreen() {
  const insets    = useSafeAreaInsets();
  const { theme } = useTheme();
  const topPad    = Platform.OS === "web" ? 24 : insets.top;
  const bottomPad = Platform.OS === "web" ? 80 : insets.bottom + 80;

  const {
    holdings,
    isAtLimit,
    isRefreshingPrices,
    deleteHolding,
    refreshPrices,
    totalPortfolioValue,
  } = usePortfolio();

  const { canAddUnlimitedHoldings, showPaywall } = useSubscription();
  const { targets, rebalanceThreshold } = useAllocation();

  const allocationRows = useMemo(
    () => calculateAllocations(holdings, targets, rebalanceThreshold),
    [holdings, targets, rebalanceThreshold]
  );
  const validation = useMemo(() => validateTargets(targets), [targets]);
  const needsRebalancing = allocationRows.filter(
    r => r.status === "overweight" || r.status === "underweight"
  ).length;

  const [showAdd, setShowAdd]             = useState(false);
  const [prefillValues, setPrefillValues] = useState<AddHoldingInitialValues | undefined>();

  const params = useLocalSearchParams<{
    prefillTicker?: string;
    prefillName?: string;
    prefillExchange?: string;
  }>();
  const processedTickerRef = useRef<string | null>(null);

  const isHardLimited = isAtLimit && !canAddUnlimitedHoldings;

  useEffect(() => {
    if (params.prefillTicker && params.prefillTicker !== processedTickerRef.current) {
      processedTickerRef.current = params.prefillTicker;
      const iv: AddHoldingInitialValues = {
        ticker:   params.prefillTicker,
        name:     params.prefillName ?? "",
        exchange: params.prefillExchange ?? "XETRA",
      };
      setPrefillValues(iv);
      if (!isHardLimited) setShowAdd(true);
      else showPaywall("holdings");
    }
  }, [params.prefillTicker, params.prefillName, params.prefillExchange, isHardLimited, showPaywall]);

  function handleAddPress() {
    if (isHardLimited) showPaywall("holdings");
    else setShowAdd(true);
  }

  function handleDeleteHolding(id: string, ticker: string) {
    Alert.alert(
      "Remove Holding",
      `Remove ${ticker} from your portfolio?`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: () => deleteHolding(id) },
      ]
    );
  }

  function renderRightActions(holdingId: string, ticker: string) {
    return (
      <TouchableOpacity
        style={[styles.swipeDelete, { backgroundColor: theme.negative }]}
        onPress={() => handleDeleteHolding(holdingId, ticker)}
      >
        <Feather name="trash-2" size={20} color="#fff" />
        <Text style={styles.swipeDeleteLabel}>Remove</Text>
      </TouchableOpacity>
    );
  }

  const s = makeStyles(theme);

  return (
    <View style={[s.container]}>
      <ScrollView
        contentContainerStyle={[s.content, { paddingTop: topPad + 12, paddingBottom: bottomPad }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <View style={s.header}>
          <View style={{ flex: 1 }}>
            <Text style={s.pageTitle}>HOLDINGS</Text>
            <Text style={s.pageSubtitle}>
              {holdings.length} position{holdings.length !== 1 ? "s" : ""}
              {isHardLimited && (
                <Text style={{ color: theme.accent }}> · Upgrade for unlimited</Text>
              )}
            </Text>
          </View>
          <View style={s.headerActions}>
            <TouchableOpacity
              style={s.actionBtn}
              onPress={refreshPrices}
              disabled={isRefreshingPrices}
            >
              {isRefreshingPrices ? (
                <ActivityIndicator size="small" color={theme.accent} />
              ) : (
                <Feather name="refresh-cw" size={16} color={theme.text} />
              )}
            </TouchableOpacity>
            <TouchableOpacity style={[s.actionBtn, s.addBtn]} onPress={handleAddPress}>
              <Feather name="plus" size={22} color={theme.text} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={s.headerDivider} />

        {/* ── Rebalance row ────────────────────────────────────────────────── */}
        <TouchableOpacity
          style={s.rebalanceRow}
          onPress={() => router.push("/rebalance" as never)}
          activeOpacity={0.8}
        >
          <View style={{ flex: 1 }}>
            <Text style={s.rebalanceTitle}>Rebalance Calculator</Text>
            {validation.valid ? (
              <Text style={[s.rebalanceSub, { color: needsRebalancing > 0 ? theme.accent : theme.positive }]}>
                {needsRebalancing > 0
                  ? `${needsRebalancing} holding${needsRebalancing > 1 ? "s" : ""} outside ±${rebalanceThreshold}% threshold`
                  : "Portfolio is balanced"}
              </Text>
            ) : (
              <Text style={[s.rebalanceSub, { color: theme.textMuted }]}>Set target allocations in Settings</Text>
            )}
          </View>
          <Feather name="arrow-right" size={16} color={theme.textMuted} />
        </TouchableOpacity>

        <View style={s.hairline} />

        {/* ── Empty state ─────────────────────────────────────────────────── */}
        {holdings.length === 0 && (
          <View style={s.emptyState}>
            <Text style={s.emptyTitle}>No holdings yet</Text>
            <Text style={s.emptySubtitle}>
              Add your first UCITS ETF or stock to begin tracking your European portfolio.
            </Text>
            <TouchableOpacity style={s.emptyBtn} onPress={handleAddPress}>
              <Text style={s.emptyBtnText}>+ Add Holding</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Holding cards ──────────────────────────────────────────────── */}
        {holdings.map((h, idx) => {
          const marketValue = h.quantity * h.currentPrice;
          const invested    = h.quantity * h.avg_cost_eur;
          const gain        = marketValue - invested;
          const gainPct     = invested > 0 ? (gain / invested) * 100 : 0;
          const weight      = totalPortfolioValue > 0 ? (marketValue / totalPortfolioValue) * 100 : 0;
          const isPositive  = gain >= 0;
          const distBadge   = getDistBadge(h.name ?? "", h.ticker);
          const isLast      = idx === holdings.length - 1;

          const targetAlloc = targets.find(t => t.ticker.toUpperCase() === h.ticker.toUpperCase());
          const driftPct    = targetAlloc ? Math.abs(weight - targetAlloc.target_pct) : 0;
          const hasDrift    = targetAlloc != null && driftPct > rebalanceThreshold;
          const showWarning = (h.hasPrice && h.priceIsStale && isExchangeOpen(h.exchange)) || hasDrift;

          const priceColor = !h.hasPrice
            ? theme.text
            : h.currentPrice > h.avg_cost_eur
            ? theme.positive
            : h.currentPrice < h.avg_cost_eur
            ? theme.negative
            : theme.text;

          return (
            <Swipeable
              key={h.id}
              renderRightActions={() => renderRightActions(h.id, h.ticker)}
              overshootRight={false}
            >
              <Pressable
                style={[s.holdingCard, isLast && { marginBottom: 0 }]}
                onPress={() => router.push({ pathname: "/holding/[id]", params: { id: h.id } })}
              >
                {/* Top row: ticker + tags + value */}
                <View style={s.holdingTop}>
                  <View style={{ flex: 1 }}>
                    <View style={s.tickerRow}>
                      <Text style={s.holdingTicker}>{h.ticker}</Text>
                      {showWarning && <Text style={{ fontSize: 12, color: theme.accent }}>⚠</Text>}
                      {!h.hasPrice && <Text style={s.noPrice}>no price</Text>}
                      {distBadge && <Text style={s.tag}>{distBadge}</Text>}
                      {h.exchange && <Text style={s.tag}>{h.exchange}</Text>}
                    </View>
                    <Text style={s.holdingName} numberOfLines={1}>{h.name || h.exchange}</Text>
                  </View>
                  <Text style={s.holdingValue}>
                    {h.hasPrice ? formatEUR(marketValue) : "—"}
                  </Text>
                </View>

                {/* Bottom row: qty · avg cost + gain % */}
                <View style={s.holdingBottom}>
                  <Text style={s.holdingMeta}>
                    {formatQuantity(h.quantity)} units · avg {formatEUR(h.avg_cost_eur)}
                  </Text>
                  {h.hasPrice && (
                    <Text style={[s.holdingGain, { color: isPositive ? theme.positive : theme.negative }]}>
                      {isPositive ? "+" : ""}{formatPct(gainPct, false)}
                    </Text>
                  )}
                </View>
              </Pressable>
              {!isLast && <View style={s.hairline} />}
            </Swipeable>
          );
        })}
      </ScrollView>

      <AddHoldingModal
        visible={showAdd}
        onClose={() => { setShowAdd(false); setPrefillValues(undefined); }}
        initialValues={prefillValues}
      />
    </View>
  );
}

function makeStyles(theme: ReturnType<typeof import("@/context/ThemeContext").useTheme>["theme"]) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.background },
    content:   { paddingHorizontal: 20, gap: 0 },

    header:        { flexDirection: "row", alignItems: "flex-end", marginBottom: 12 },
    pageTitle:     { fontSize: 26, fontFamily: "Archivo_800ExtraBold", color: theme.text, letterSpacing: -0.5 },
    pageSubtitle:  { fontSize: 12, fontFamily: "Archivo_400Regular", color: theme.textMuted, marginTop: 3 },
    headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
    actionBtn: {
      width: 40, height: 40,
      alignItems: "center", justifyContent: "center",
    },
    addBtn: {},
    headerDivider: { height: 2, backgroundColor: theme.text, marginBottom: 0 },

    rebalanceRow: {
      flexDirection: "row", alignItems: "center",
      paddingVertical: 14,
    },
    rebalanceTitle: { fontSize: 14, fontFamily: "Archivo_600SemiBold", color: theme.text },
    rebalanceSub:   { fontSize: 12, fontFamily: "Archivo_400Regular", marginTop: 2 },

    hairline: { height: 1, backgroundColor: theme.hairline },

    emptyState: { paddingVertical: 40, gap: 12 },
    emptyTitle: { fontSize: 18, fontFamily: "Archivo_800ExtraBold", color: theme.text },
    emptySubtitle: { fontSize: 14, fontFamily: "Archivo_400Regular", color: theme.textMuted, lineHeight: 22 },
    emptyBtn: { paddingHorizontal: 20, paddingVertical: 12, backgroundColor: theme.accent, alignSelf: "flex-start", marginTop: 4 },
    emptyBtnText: { fontSize: 14, fontFamily: "Archivo_800ExtraBold", color: "#fff" },

    holdingCard: {
      backgroundColor: theme.surface,
      paddingHorizontal: 14,
      paddingTop: 14,
      paddingBottom: 12,
      shadowColor: theme.shadow,
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 1,
      shadowRadius: 2,
      elevation: 1,
      marginTop: 8,
    },
    holdingTop: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
    tickerRow:  { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
    holdingTicker: { fontSize: 16, fontFamily: "Archivo_800ExtraBold", color: theme.text },
    holdingName:   { fontSize: 12, fontFamily: "Archivo_400Regular", color: theme.textMuted, marginTop: 3 },
    noPrice:       { fontSize: 10, fontFamily: "Archivo_400Regular", color: theme.textMuted },
    tag: {
      fontSize: 10, fontFamily: "Archivo_600SemiBold", color: theme.textMuted,
      borderWidth: 1, borderColor: theme.hairline,
      paddingHorizontal: 5, paddingVertical: 1,
    },
    holdingValue: { fontSize: 16, fontFamily: "Archivo_800ExtraBold", color: theme.text },
    holdingBottom: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 8 },
    holdingMeta:   { fontSize: 12, fontFamily: "Archivo_400Regular", color: theme.textMuted },
    holdingGain:   { fontSize: 13, fontFamily: "Archivo_600SemiBold" },

    swipeDelete: {
      justifyContent: "center",
      alignItems: "center",
      width: 80,
      marginLeft: 8,
      gap: 4,
    },
    swipeDeleteLabel: { color: "#fff", fontSize: 11, fontFamily: "Archivo_600SemiBold" },
  });
}

const styles = StyleSheet.create({
  swipeDelete: {
    justifyContent: "center",
    alignItems: "center",
    width: 80,
    marginLeft: 8,
    gap: 4,
  },
  swipeDeleteLabel: { color: "#fff", fontSize: 11, fontFamily: "Archivo_600SemiBold" },
});
