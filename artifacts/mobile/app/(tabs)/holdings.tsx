import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
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
import Colors from "@/constants/colors";
import { usePortfolio, FREE_TIER_LIMIT } from "@/context/PortfolioContext";
import { useSubscription } from "@/context/SubscriptionContext";
import { formatEUR, formatPct } from "@/utils/format";
import AddHoldingModal, { type AddHoldingInitialValues } from "@/components/AddHoldingModal";

const theme = Colors.dark;

// Detect ACC / DIST from the fund name or ticker
function getDistBadge(name: string, ticker: string): "ACC" | "DIST" | null {
  const hay = (name + " " + ticker).toLowerCase();
  if (hay.includes("acc") || hay.includes("accumul")) return "ACC";
  if (hay.includes("dist") || hay.includes("distribut")) return "DIST";
  return null;
}

export default function HoldingsScreen() {
  const insets    = useSafeAreaInsets();
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
        style={styles.swipeDelete}
        onPress={() => handleDeleteHolding(holdingId, ticker)}
      >
        <Feather name="trash-2" size={20} color="#fff" />
        <Text style={styles.swipeDeleteLabel}>Remove</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: topPad + 12, paddingBottom: bottomPad }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <View style={styles.header}>
          <View>
            <Text style={styles.pageTitle}>Holdings</Text>
            <Text style={styles.pageSubtitle}>
              {holdings.length} holding{holdings.length !== 1 ? "s" : ""}
              {isHardLimited && (
                <Text style={{ color: theme.tint }}> · Upgrade for unlimited</Text>
              )}
            </Text>
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity
              style={styles.refreshBtn}
              onPress={refreshPrices}
              disabled={isRefreshingPrices}
            >
              {isRefreshingPrices ? (
                <ActivityIndicator size="small" color={theme.tint} />
              ) : (
                <Feather name="refresh-cw" size={16} color={theme.tint} />
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.addBtn} onPress={handleAddPress}>
              <Feather name="plus" size={20} color={theme.background} />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Empty state ─────────────────────────────────────────────────── */}
        {holdings.length === 0 && (
          <View style={styles.emptyState}>
            <View style={styles.emptyIconWrap}>
              <Feather name="briefcase" size={30} color={theme.tint} />
            </View>
            <Text style={styles.emptyTitle}>No holdings yet</Text>
            <Text style={styles.emptySubtitle}>
              Add your first UCITS ETF or stock to begin tracking your European portfolio.
            </Text>
            <TouchableOpacity style={styles.emptyBtn} onPress={handleAddPress}>
              <Feather name="plus" size={16} color={theme.background} />
              <Text style={styles.emptyBtnText}>Add Holding</Text>
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

          return (
            <Swipeable
              key={h.id}
              renderRightActions={() => renderRightActions(h.id, h.ticker)}
              overshootRight={false}
            >
              <Pressable
                style={styles.holdingCard}
                onPress={() => router.push({ pathname: "/holding/[id]", params: { id: h.id } })}
              >
                {/* ── Main row ────────────────────────────────────────────── */}
                <View style={styles.holdingMain}>
                  {/* Left: ticker badge */}
                  <View style={styles.tickerBadge}>
                    <Text style={styles.tickerBadgeText}>{h.ticker.slice(0, 4)}</Text>
                  </View>

                  {/* Centre: name + badges */}
                  <View style={{ flex: 1 }}>
                    <View style={styles.tickerRow}>
                      <Text style={styles.holdingTicker}>{h.ticker}</Text>
                      {h.hasPrice && h.priceIsStale && (
                        <Text style={{ fontSize: 12, color: "#FBBF24" }}>⚠</Text>
                      )}
                      {!h.hasPrice && (
                        <Text style={styles.noPrice}>no price</Text>
                      )}
                    </View>
                    <View style={styles.nameRow}>
                      <Text style={styles.holdingName} numberOfLines={1}>
                        {h.name || h.exchange}
                      </Text>
                      {distBadge && (
                        <View style={styles.pill}>
                          <Text style={styles.pillText}>{distBadge}</Text>
                        </View>
                      )}
                      {h.exchange && (
                        <View style={styles.pill}>
                          <Text style={styles.pillText}>{h.exchange}</Text>
                        </View>
                      )}
                    </View>
                  </View>

                  {/* Right: value + gain% */}
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={styles.holdingValue}>
                      {h.hasPrice ? formatEUR(marketValue) : "—"}
                    </Text>
                    {h.hasPrice && (
                      <Text style={[styles.holdingGain, { color: isPositive ? theme.positive : theme.negative }]}>
                        {isPositive ? "+" : ""}{formatPct(gainPct, false)}
                      </Text>
                    )}
                  </View>
                </View>

                {/* ── Inset divider ────────────────────────────────────────── */}
                <View style={styles.divider} />

                {/* ── Detail strip ─────────────────────────────────────────── */}
                <View style={styles.detailStrip}>
                  <View style={styles.detailItem}>
                    <Text style={styles.detailLabel}>QTY</Text>
                    <Text style={styles.detailValue}>{h.quantity}</Text>
                  </View>
                  <View style={styles.detailItem}>
                    <Text style={styles.detailLabel}>AVG COST</Text>
                    <Text style={styles.detailValue}>{formatEUR(h.avg_cost_eur)}</Text>
                  </View>
                  <View style={styles.detailItem}>
                    <Text style={styles.detailLabel}>PRICE</Text>
                    <Text style={[styles.detailValue, h.priceIsStale ? { color: "#FBBF24" } : {}]}>
                      {h.hasPrice ? formatEUR(h.currentPrice) : "—"}
                    </Text>
                  </View>
                  <View style={styles.detailItem}>
                    <Text style={styles.detailLabel}>WEIGHT</Text>
                    <Text style={styles.detailValue}>{weight.toFixed(1)}%</Text>
                  </View>
                </View>
              </Pressable>
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

// ── Styles ─────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1 },
  content:   { paddingHorizontal: 16, gap: 10 },

  // Header
  header:        { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  pageTitle:     { fontSize: 26, fontFamily: "Inter_700Bold", color: theme.text, letterSpacing: -0.8 },
  pageSubtitle:  { fontSize: 12, fontFamily: "Inter_400Regular", color: theme.textSecondary, marginTop: 2 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  refreshBtn: {
    width: 44, height: 44, borderRadius: 12,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: theme.border,
    backgroundColor: theme.backgroundCard,
  },
  addBtn: {
    width: 44, height: 44, borderRadius: 12,
    alignItems: "center", justifyContent: "center",
    backgroundColor: theme.tint,
  },

  // Swipe delete
  swipeDelete: {
    backgroundColor: theme.negative,
    justifyContent: "center",
    alignItems: "center",
    width: 80,
    borderRadius: 14,
    marginLeft: 8,
    gap: 4,
  },
  swipeDeleteLabel: { color: "#fff", fontSize: 11, fontFamily: "Inter_600SemiBold" },

  // Empty state
  emptyState: {
    backgroundColor: theme.backgroundCard,
    borderRadius: 16,
    padding: 36,
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: theme.border,
    marginTop: 8,
  },
  emptyIconWrap: {
    width: 68, height: 68, borderRadius: 20,
    backgroundColor: theme.backgroundElevated,
    borderWidth: 1, borderColor: theme.border,
    alignItems: "center", justifyContent: "center",
    marginBottom: 4,
  },
  emptyTitle:    { fontSize: 18, fontFamily: "Inter_700Bold", color: theme.text },
  emptySubtitle: { fontSize: 14, fontFamily: "Inter_400Regular", color: theme.textSecondary, textAlign: "center", lineHeight: 21 },
  emptyBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 22, paddingVertical: 13,
    backgroundColor: theme.tint, borderRadius: 12, marginTop: 4,
  },
  emptyBtnText: { color: theme.background, fontSize: 15, fontFamily: "Inter_700Bold" },

  // Holding card
  holdingCard: {
    backgroundColor: theme.backgroundCard,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.border,
    minHeight: 64,
    overflow: "hidden",
  },

  // Main row
  holdingMain: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    minHeight: 64,
  },

  // Ticker badge
  tickerBadge: {
    width: 46, height: 46, borderRadius: 12,
    backgroundColor: theme.backgroundElevated,
    borderWidth: 1, borderColor: theme.border,
    alignItems: "center", justifyContent: "center",
  },
  tickerBadgeText: { color: theme.tint, fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.3 },

  // Name row
  tickerRow:   { flexDirection: "row", alignItems: "center", gap: 5 },
  nameRow:     { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 3, flexWrap: "wrap" },
  holdingTicker: { fontSize: 16, fontFamily: "Inter_700Bold", color: theme.text },
  holdingName:   { fontSize: 12, fontFamily: "Inter_400Regular", color: theme.textSecondary, flexShrink: 1 },
  noPrice:       { fontSize: 10, fontFamily: "Inter_400Regular", color: theme.textTertiary },

  // Pills (ACC/DIST/exchange)
  pill: {
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 6, backgroundColor: theme.backgroundElevated,
    borderWidth: 1, borderColor: theme.border,
  },
  pillText: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: theme.textSecondary },

  // Right side
  holdingValue: { fontSize: 16, fontFamily: "Inter_700Bold", color: theme.text },
  holdingGain:  { fontSize: 12, fontFamily: "Inter_600SemiBold", marginTop: 3 },

  // Inset divider (20px from left, not full-width)
  divider: {
    height: 1,
    backgroundColor: theme.border,
    marginLeft: 20, // inset from left edge
  },

  // Detail strip
  detailStrip: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  detailItem:  { alignItems: "center", gap: 3 },
  detailLabel: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: theme.textTertiary, letterSpacing: 0.5 },
  detailValue: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: theme.text },
});
