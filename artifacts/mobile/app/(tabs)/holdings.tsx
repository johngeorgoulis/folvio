import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
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
  useColorScheme,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { usePortfolio, FREE_TIER_LIMIT } from "@/context/PortfolioContext";
import { formatEUR, formatPct } from "@/utils/format";
import AddHoldingModal from "@/components/AddHoldingModal";
import PremiumModal from "@/components/PremiumModal";

export default function HoldingsScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const theme = isDark ? Colors.dark : Colors.light;
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 24 : insets.top;
  const bottomPad = Platform.OS === "web" ? 80 : insets.bottom + 80;

  const {
    holdings,
    isAtLimit,
    isRefreshingPrices,
    deleteHolding,
    refreshPrices,
    totalPortfolioValue,
  } = usePortfolio();
  const [showAdd, setShowAdd] = useState(false);
  const [showPremium, setShowPremium] = useState(false);

  function handleAddPress() {
    if (isAtLimit) {
      setShowPremium(true);
    } else {
      setShowAdd(true);
    }
  }

  function handleDeleteHolding(id: string, ticker: string) {
    Alert.alert(
      "Remove Holding",
      `Remove ${ticker} from your portfolio?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => deleteHolding(id),
        },
      ]
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: topPad + 12, paddingBottom: bottomPad }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View>
            <Text style={[styles.pageTitle, { color: theme.text }]}>Holdings</Text>
            <Text style={[styles.pageSubtitle, { color: theme.textSecondary }]}>
              {holdings.length} of {FREE_TIER_LIMIT} (free tier)
            </Text>
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity
              style={[styles.refreshBtn, { borderColor: theme.border }]}
              onPress={refreshPrices}
              disabled={isRefreshingPrices}
            >
              {isRefreshingPrices ? (
                <ActivityIndicator size="small" color={theme.tint} />
              ) : (
                <Feather name="refresh-cw" size={16} color={theme.tint} />
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.addBtn, { backgroundColor: theme.tint }]}
              onPress={handleAddPress}
            >
              <Feather name="plus" size={20} color="#0A0F1A" />
            </TouchableOpacity>
          </View>
        </View>

        {holdings.length === 0 && (
          <View style={[styles.emptyState, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}>
            <Feather name="briefcase" size={32} color={theme.tint} />
            <Text style={[styles.emptyTitle, { color: theme.text }]}>No holdings yet</Text>
            <Text style={[styles.emptySubtitle, { color: theme.textSecondary }]}>
              Add your first UCITS ETF or stock to begin.
            </Text>
            <TouchableOpacity
              style={[styles.emptyBtn, { backgroundColor: theme.deepBlue }]}
              onPress={handleAddPress}
            >
              <Feather name="plus" size={16} color="#C9A84C" />
              <Text style={styles.emptyBtnText}>Add Holding</Text>
            </TouchableOpacity>
          </View>
        )}

        {holdings.map((h) => {
          const marketValue = h.quantity * h.currentPrice;
          const invested = h.quantity * h.avg_cost_eur;
          const gain = marketValue - invested;
          const gainPct = invested > 0 ? (gain / invested) * 100 : 0;
          const weight = totalPortfolioValue > 0 ? (marketValue / totalPortfolioValue) * 100 : 0;
          const isPositive = gain >= 0;

          return (
            <Pressable
              key={h.id}
              style={[styles.holdingCard, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}
              onPress={() => router.push({ pathname: "/holding/[id]", params: { id: h.id } })}
            >
              <View style={styles.holdingMain}>
                <View style={[styles.tickerBadge, { backgroundColor: theme.deepBlue }]}>
                  <Text style={styles.tickerText}>{h.ticker.slice(0, 4)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.tickerRow}>
                    <Text style={[styles.holdingTicker, { color: theme.text }]}>{h.ticker}</Text>
                    {h.hasPrice && h.priceIsStale && (
                      <Text style={styles.staleWarning}>⚠</Text>
                    )}
                    {!h.hasPrice && (
                      <Text style={[styles.noPrice, { color: theme.textSecondary }]}>no price</Text>
                    )}
                  </View>
                  <Text style={[styles.holdingName, { color: theme.textSecondary }]} numberOfLines={1}>
                    {h.name || h.exchange}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={[styles.holdingValue, { color: theme.text }]}>
                    {h.hasPrice ? formatEUR(marketValue) : "—"}
                  </Text>
                  {h.hasPrice && (
                    <View
                      style={[
                        styles.gainBadge,
                        { backgroundColor: isPositive ? theme.positive + "20" : theme.negative + "20" },
                      ]}
                    >
                      <Text style={[styles.gainText, { color: isPositive ? theme.positive : theme.negative }]}>
                        {isPositive ? "+" : ""}{formatPct(gainPct, false)}
                      </Text>
                    </View>
                  )}
                </View>
              </View>

              <View style={[styles.divider, { backgroundColor: theme.border }]} />

              <View style={styles.holdingDetails}>
                <View style={styles.detailItem}>
                  <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>Qty</Text>
                  <Text style={[styles.detailValue, { color: theme.text }]}>{h.quantity}</Text>
                </View>
                <View style={styles.detailItem}>
                  <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>Avg Cost</Text>
                  <Text style={[styles.detailValue, { color: theme.text }]}>{formatEUR(h.avg_cost_eur)}</Text>
                </View>
                <View style={styles.detailItem}>
                  <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>Price</Text>
                  <Text style={[styles.detailValue, { color: h.priceIsStale ? "#FBBF24" : theme.text }]}>
                    {h.hasPrice ? formatEUR(h.currentPrice) : "—"}
                  </Text>
                </View>
                <View style={styles.detailItem}>
                  <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>Weight</Text>
                  <Text style={[styles.detailValue, { color: theme.text }]}>{weight.toFixed(1)}%</Text>
                </View>
              </View>

              <TouchableOpacity
                style={styles.deleteBtn}
                onPress={() => handleDeleteHolding(h.id, h.ticker)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Feather name="trash-2" size={14} color={theme.textTertiary} />
              </TouchableOpacity>
            </Pressable>
          );
        })}
      </ScrollView>

      <AddHoldingModal visible={showAdd} onClose={() => setShowAdd(false)} />
      <PremiumModal visible={showPremium} onClose={() => setShowPremium(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 12 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  pageTitle: { fontSize: 28, fontFamily: "Inter_700Bold", letterSpacing: -0.8 },
  pageSubtitle: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  refreshBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  addBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  tickerRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  staleWarning: { fontSize: 12, color: "#FBBF24" },
  noPrice: { fontSize: 10, fontFamily: "Inter_400Regular" },
  emptyState: {
    borderRadius: 16,
    padding: 32,
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    marginTop: 8,
  },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  emptySubtitle: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  emptyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 8,
  },
  emptyBtnText: { color: "#C9A84C", fontSize: 15, fontFamily: "Inter_600SemiBold" },
  holdingCard: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    position: "relative",
  },
  holdingMain: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  tickerBadge: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  tickerText: {
    color: "#C9A84C",
    fontSize: 12,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.5,
  },
  holdingTicker: { fontSize: 16, fontFamily: "Inter_700Bold" },
  holdingName: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  holdingValue: { fontSize: 16, fontFamily: "Inter_700Bold" },
  gainBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    marginTop: 4,
  },
  gainText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  divider: { height: 1, marginVertical: 12 },
  holdingDetails: { flexDirection: "row", justifyContent: "space-between" },
  detailItem: { alignItems: "center" },
  detailLabel: { fontSize: 10, fontFamily: "Inter_500Medium", letterSpacing: 0.3 },
  detailValue: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginTop: 2 },
  deleteBtn: {
    position: "absolute",
    top: 14,
    right: 14,
  },
});
