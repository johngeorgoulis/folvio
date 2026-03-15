import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import {
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
import { usePortfolio } from "@/context/PortfolioContext";
import { formatEUR, formatPct, formatDate } from "@/utils/format";
import EditHoldingModal from "@/components/EditHoldingModal";

export default function HoldingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const theme = isDark ? Colors.dark : Colors.light;
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 24 : insets.top;

  const { holdings, deleteHolding, totalPortfolioValue } = usePortfolio();
  const holding = holdings.find((h) => h.id === id);
  const [showEdit, setShowEdit] = useState(false);

  if (!holding) {
    return (
      <View style={[styles.container, { backgroundColor: theme.background, paddingTop: topPad + 20 }]}>
        <Text style={[styles.notFound, { color: theme.text }]}>Holding not found.</Text>
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
  const weight = totalPortfolioValue > 0 ? (marketValue / totalPortfolioValue) * 100 : 0;
  const isPositive = gain >= 0;

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

  const rows = [
    { label: "Ticker", value: holding.ticker },
    { label: "ISIN", value: holding.isin || "—" },
    { label: "Exchange", value: holding.exchange },
    { label: "Quantity", value: holding.quantity.toString() },
    { label: "Avg Cost (EUR)", value: formatEUR(holding.avg_cost_eur) },
    { label: "Current Price", value: formatEUR(holding.currentPrice) },
    { label: "Total Invested", value: formatEUR(totalCost) },
    { label: "Market Value", value: formatEUR(marketValue) },
    { label: "Total Return", value: `${isPositive ? "+" : ""}${formatEUR(gain)} (${formatPct(gainPct)})` },
    { label: "Portfolio Weight", value: `${weight.toFixed(1)}%` },
    { label: "Purchase Date", value: holding.purchase_date ? formatDate(holding.purchase_date) : "—" },
    { label: "Price Source", value: holding.priceSource === "api" ? "Auto (API)" : "Manual" },
  ];

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.navBar, { paddingTop: topPad + 8, borderBottomColor: theme.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backPressable}>
          <Feather name="arrow-left" size={22} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.navTitle, { color: theme.text }]}>{holding.ticker}</Text>
        <View style={styles.navActions}>
          <TouchableOpacity onPress={() => setShowEdit(true)} style={styles.navBtn}>
            <Feather name="edit-2" size={18} color={theme.tint} />
          </TouchableOpacity>
          <TouchableOpacity onPress={handleDelete} style={styles.navBtn}>
            <Feather name="trash-2" size={18} color={theme.negative} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={[styles.heroCard, { backgroundColor: theme.deepBlue }]}>
          <View style={styles.heroHeader}>
            <View>
              <Text style={styles.heroTicker}>{holding.ticker}</Text>
              {holding.name ? (
                <Text style={styles.heroName}>{holding.name}</Text>
              ) : null}
            </View>
            <View style={[styles.exchangeBadge, { backgroundColor: "rgba(255,255,255,0.12)" }]}>
              <Text style={styles.exchangeText}>{holding.exchange}</Text>
            </View>
          </View>
          <Text style={styles.heroValue}>{formatEUR(marketValue)}</Text>
          <View
            style={[
              styles.gainChip,
              { backgroundColor: isPositive ? "rgba(52,211,153,0.15)" : "rgba(248,113,113,0.15)" },
            ]}
          >
            <Feather
              name={isPositive ? "trending-up" : "trending-down"}
              size={14}
              color={isPositive ? "#34D399" : "#F87171"}
            />
            <Text style={[styles.gainChipText, { color: isPositive ? "#34D399" : "#F87171" }]}>
              {isPositive ? "+" : ""}{formatEUR(gain, true)} ({formatPct(gainPct)})
            </Text>
          </View>
        </View>

        <View style={[styles.detailCard, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}>
          {rows.map((row, i) => (
            <View key={row.label}>
              {i > 0 && <View style={[styles.rowDivider, { backgroundColor: theme.border }]} />}
              <View style={styles.detailRow}>
                <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>{row.label}</Text>
                <Text
                  style={[
                    styles.detailValue,
                    { color: theme.text },
                    row.label === "Total Return" && { color: isPositive ? theme.positive : theme.negative },
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
  heroCard: {
    borderRadius: 20,
    padding: 24,
    gap: 8,
  },
  heroHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  heroTicker: { color: "#FFFFFF", fontSize: 26, fontFamily: "Inter_700Bold" },
  heroName: { color: "rgba(255,255,255,0.6)", fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 3 },
  exchangeBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  exchangeText: { color: "#C9A84C", fontSize: 12, fontFamily: "Inter_600SemiBold" },
  heroValue: { color: "#FFFFFF", fontSize: 36, fontFamily: "Inter_700Bold", letterSpacing: -1 },
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
