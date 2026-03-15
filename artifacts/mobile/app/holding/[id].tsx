import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import {
  Alert,
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useColorScheme,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { usePortfolio } from "@/context/PortfolioContext";
import { formatEUR, formatPct, formatDate } from "@/utils/format";
import EditHoldingModal from "@/components/EditHoldingModal";
import { fetchLivePrice } from "@/services/priceService";
import { upsertPrice } from "@/services/db";

function staleLabelFor(lastFetched: string): string {
  if (!lastFetched) return "";
  const ageMs = Date.now() - new Date(lastFetched).getTime();
  const mins = Math.floor(ageMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function HoldingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const theme = isDark ? Colors.dark : Colors.light;
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 24 : insets.top;

  const { holdings, deleteHolding, refreshPrices, totalPortfolioValue } =
    usePortfolio();
  const holding = holdings.find((h) => h.id === id);
  const [showEdit, setShowEdit] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  if (!holding) {
    return (
      <View
        style={[
          styles.container,
          { backgroundColor: theme.background, paddingTop: topPad + 20 },
        ]}
      >
        <Text style={[styles.notFound, { color: theme.text }]}>
          Holding not found.
        </Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={{ color: theme.tint }}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const marketValue = holding.quantity * holding.currentPrice;
  const totalCost = holding.quantity * holding.avg_cost_eur;
  const gain = marketValue - totalCost;
  const gainPct = totalCost > 0 ? (gain / totalCost) * 100 : 0;
  const weight =
    totalPortfolioValue > 0 ? (marketValue / totalPortfolioValue) * 100 : 0;
  const isPositive = gain >= 0;

  const priceIsManual = holding.priceSource === "manual";
  const priceIsStale = holding.priceIsStale;
  const hasPrice = holding.hasPrice;

  async function handleRefreshPrice() {
    setRefreshing(true);
    try {
      const result = await fetchLivePrice(holding!.ticker, holding!.exchange);
      if (result) {
        await upsertPrice(holding!.ticker, result.priceEUR, "api");
        await refreshPrices();
      } else {
        Alert.alert(
          "Price Unavailable",
          "Could not fetch a live price. Check your connection or enter a price manually."
        );
      }
    } finally {
      setRefreshing(false);
    }
  }

  function handleDelete() {
    Alert.alert(
      "Remove Holding",
      `Remove ${holding!.ticker} from your portfolio? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            await deleteHolding(holding!.id);
            router.back();
          },
        },
      ]
    );
  }

  function renderPriceStatus() {
    if (!hasPrice) {
      return (
        <View style={styles.priceStatusRow}>
          <Text style={[styles.priceStatusText, { color: theme.textSecondary }]}>
            Price unavailable
          </Text>
          <TouchableOpacity
            onPress={() => setShowEdit(true)}
            style={[styles.manualBtn, { borderColor: theme.tint }]}
          >
            <Text style={[styles.manualBtnText, { color: theme.tint }]}>
              Enter manually
            </Text>
          </TouchableOpacity>
        </View>
      );
    }
    if (priceIsStale) {
      return (
        <View style={styles.priceStatusRow}>
          <View style={styles.staleChip}>
            <Text style={styles.staleIcon}>⚠</Text>
            <Text style={styles.staleText}>
              Stale · {staleLabelFor(holding.priceLastFetched)}
            </Text>
          </View>
          <TouchableOpacity
            onPress={handleRefreshPrice}
            style={[styles.refreshBtn, { backgroundColor: theme.tint }]}
            disabled={refreshing}
          >
            {refreshing ? (
              <ActivityIndicator size="small" color="#000" />
            ) : (
              <Text style={styles.refreshBtnText}>Refresh</Text>
            )}
          </TouchableOpacity>
        </View>
      );
    }
    if (priceIsManual) {
      return (
        <View style={styles.priceStatusRow}>
          <Text style={[styles.priceStatusText, { color: theme.textSecondary }]}>
            Manual price
          </Text>
          <TouchableOpacity
            onPress={handleRefreshPrice}
            style={[styles.refreshBtn, { backgroundColor: "rgba(255,255,255,0.1)" }]}
            disabled={refreshing}
          >
            {refreshing ? (
              <ActivityIndicator size="small" color={theme.tint} />
            ) : (
              <Text style={[styles.refreshBtnText, { color: theme.tint }]}>
                Fetch live
              </Text>
            )}
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <View style={styles.priceStatusRow}>
        <View style={styles.liveChip}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>
            Live · {staleLabelFor(holding.priceLastFetched)}
          </Text>
        </View>
        <TouchableOpacity
          onPress={handleRefreshPrice}
          style={[styles.refreshBtn, { backgroundColor: "rgba(255,255,255,0.1)" }]}
          disabled={refreshing}
        >
          {refreshing ? (
            <ActivityIndicator size="small" color={theme.tint} />
          ) : (
            <Feather name="refresh-cw" size={13} color={theme.tint} />
          )}
        </TouchableOpacity>
      </View>
    );
  }

  const detailRows = [
    { label: "ISIN", value: holding.isin || "—" },
    { label: "Exchange", value: holding.exchange },
    { label: "Quantity", value: holding.quantity.toString() },
    { label: "Avg Cost (EUR)", value: formatEUR(holding.avg_cost_eur) },
    {
      label: "Current Price",
      value: hasPrice ? formatEUR(holding.currentPrice) : "—",
    },
    { label: "Total Invested", value: formatEUR(totalCost) },
    { label: "Market Value", value: hasPrice ? formatEUR(marketValue) : "—" },
    {
      label: "Total Return",
      value: hasPrice
        ? `${isPositive ? "+" : ""}${formatEUR(gain)} (${formatPct(gainPct)})`
        : "—",
      isReturn: true,
    },
    { label: "Portfolio Weight", value: `${weight.toFixed(1)}%` },
    {
      label: "Purchase Date",
      value: holding.purchase_date ? formatDate(holding.purchase_date) : "—",
    },
  ];

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View
        style={[
          styles.navBar,
          { paddingTop: topPad + 8, borderBottomColor: theme.border },
        ]}
      >
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backPressable}
        >
          <Feather name="arrow-left" size={22} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.navTitle, { color: theme.text }]}>
          {holding.ticker}
        </Text>
        <View style={styles.navActions}>
          <TouchableOpacity
            onPress={() => setShowEdit(true)}
            style={styles.navBtn}
          >
            <Feather name="edit-2" size={18} color={theme.tint} />
          </TouchableOpacity>
          <TouchableOpacity onPress={handleDelete} style={styles.navBtn}>
            <Feather name="trash-2" size={18} color={theme.negative} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.heroCard, { backgroundColor: theme.deepBlue }]}>
          <View style={styles.heroHeader}>
            <View>
              <Text style={styles.heroTicker}>{holding.ticker}</Text>
              {holding.name ? (
                <Text style={styles.heroName}>{holding.name}</Text>
              ) : null}
            </View>
            <View
              style={[
                styles.exchangeBadge,
                { backgroundColor: "rgba(255,255,255,0.12)" },
              ]}
            >
              <Text style={styles.exchangeText}>{holding.exchange}</Text>
            </View>
          </View>

          <Text style={styles.heroValue}>
            {hasPrice ? formatEUR(marketValue) : "—"}
          </Text>

          {hasPrice && (
            <View
              style={[
                styles.gainChip,
                {
                  backgroundColor: isPositive
                    ? "rgba(52,211,153,0.15)"
                    : "rgba(248,113,113,0.15)",
                },
              ]}
            >
              <Feather
                name={isPositive ? "trending-up" : "trending-down"}
                size={14}
                color={isPositive ? "#34D399" : "#F87171"}
              />
              <Text
                style={[
                  styles.gainChipText,
                  { color: isPositive ? "#34D399" : "#F87171" },
                ]}
              >
                {isPositive ? "+" : ""}
                {formatEUR(gain)} ({formatPct(gainPct)})
              </Text>
            </View>
          )}

          {renderPriceStatus()}
        </View>

        <View
          style={[
            styles.detailCard,
            { backgroundColor: theme.backgroundCard, borderColor: theme.border },
          ]}
        >
          {detailRows.map((row, i) => (
            <View key={row.label}>
              {i > 0 && (
                <View
                  style={[styles.rowDivider, { backgroundColor: theme.border }]}
                />
              )}
              <View style={styles.detailRow}>
                <Text
                  style={[styles.detailLabel, { color: theme.textSecondary }]}
                >
                  {row.label}
                </Text>
                <Text
                  style={[
                    styles.detailValue,
                    { color: theme.text },
                    row.isReturn && hasPrice
                      ? { color: isPositive ? theme.positive : theme.negative }
                      : null,
                  ]}
                >
                  {row.value}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

      {holding && (
        <EditHoldingModal
          visible={showEdit}
          holding={holding}
          onClose={() => setShowEdit(false)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  notFound: { textAlign: "center", marginTop: 40, fontSize: 16 },
  backBtn: { alignItems: "center", marginTop: 16 },
  navBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  backPressable: { padding: 4, marginRight: 8 },
  navTitle: { flex: 1, fontSize: 18, fontFamily: "Inter_700Bold" },
  navActions: { flexDirection: "row", gap: 8 },
  navBtn: { padding: 8 },
  scrollContent: { padding: 16, gap: 14, paddingBottom: 40 },
  heroCard: { borderRadius: 20, padding: 24, gap: 10 },
  heroHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  heroTicker: {
    color: "#FFFFFF",
    fontSize: 26,
    fontFamily: "Inter_700Bold",
  },
  heroName: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    marginTop: 3,
  },
  exchangeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  exchangeText: {
    color: "#C9A84C",
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  heroValue: {
    color: "#FFFFFF",
    fontSize: 36,
    fontFamily: "Inter_700Bold",
    letterSpacing: -1,
  },
  gainChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  gainChipText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  priceStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
  },
  priceStatusText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  staleChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  staleIcon: { fontSize: 12, color: "#FBBF24" },
  staleText: {
    fontSize: 12,
    color: "#FBBF24",
    fontFamily: "Inter_400Regular",
  },
  liveChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#34D399",
  },
  liveText: {
    fontSize: 12,
    color: "#34D399",
    fontFamily: "Inter_400Regular",
  },
  refreshBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    minWidth: 28,
    alignItems: "center",
  },
  refreshBtnText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: "#0A0F1A",
  },
  manualBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
  },
  manualBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  detailCard: { borderRadius: 16, padding: 16, borderWidth: 1 },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
  },
  detailLabel: { fontSize: 13, fontFamily: "Inter_400Regular" },
  detailValue: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  rowDivider: { height: 1 },
});
