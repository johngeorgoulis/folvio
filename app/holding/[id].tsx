import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import {
  Alert,
  ActivityIndicator,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { usePortfolio } from "@/context/PortfolioContext";
import { formatEUR, formatPct } from "@/utils/format";
import { getExchangeLabel } from "@/components/ExchangePicker";
import EditHoldingModal from "@/components/EditHoldingModal";
import { fetchLivePrice } from "@/services/priceService";
import {
  getAssetClass,
  getTER,
  saveAssetClassOverride,
  ASSET_CLASS_OPTIONS,
  type AssetClass,
} from "@/services/assetClassService";
import { upsertPrice } from "@/services/db";

const theme = Colors.dark;

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

function formatDate(iso: string): string {
  if (!iso) return "—";
  try {
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  } catch {
    return iso;
  }
}

function MetricCell({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <View style={styles.metricCell}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, valueColor ? { color: valueColor } : {}]}>{value}</Text>
    </View>
  );
}

export default function HoldingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 24 : insets.top;
  const bottomPad = Platform.OS === "web" ? 16 : insets.bottom + 16;

  const { holdings, deleteHolding, refreshPrices, totalPortfolioValue } = usePortfolio();
  const holding = holdings.find((h) => h.id === id);
  const [showEdit, setShowEdit] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [localAssetClass, setLocalAssetClass] = useState<AssetClass>(
    () => getAssetClass(holding?.ticker ?? "", holding?.isin ?? "")
  );

  if (!holding) {
    return (
      <View style={[styles.container, { paddingTop: topPad + 20 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtnStandalone}>
          <Feather name="arrow-left" size={22} color={theme.text} />
        </TouchableOpacity>
        <View style={styles.notFoundWrap}>
          <Text style={styles.notFoundText}>Holding not found.</Text>
        </View>
      </View>
    );
  }

  const marketValue = holding.quantity * holding.currentPrice;
  const invested = holding.quantity * holding.avg_cost_eur;
  const gain = marketValue - invested;
  const gainPct = invested > 0 ? (gain / invested) * 100 : 0;
  const weight = totalPortfolioValue > 0 ? (marketValue / totalPortfolioValue) * 100 : 0;
  const isPositive = gain >= 0;
  const gainColor = isPositive ? theme.positive : theme.negative;

  const estimatedAnnualIncome =
    holding.yield_pct != null && holding.currentPrice > 0
      ? holding.quantity * holding.currentPrice * (holding.yield_pct / 100)
      : null;

  const exchangeLabel = getExchangeLabel(holding.exchange);
  const ter = getTER(holding.ticker);

  function handleEditAssetClass() {
    Alert.alert(
      "Set Asset Class",
      `Current: ${localAssetClass}\n\nChoose the correct class for ${holding!.ticker}:`,
      [
        ...ASSET_CLASS_OPTIONS.map((cls) => ({
          text: cls === localAssetClass ? `✓ ${cls}` : cls,
          onPress: async () => {
            await saveAssetClassOverride(holding!.ticker, cls);
            setLocalAssetClass(cls);
          },
        })),
        { text: "Cancel", style: "cancel" as const },
      ]
    );
  }

  async function handleRefreshPrice() {
    setRefreshing(true);
    try {
      const result = await fetchLivePrice(holding!.ticker, holding!.exchange);
      if (result) {
        await upsertPrice(holding!.ticker, result.priceEUR, "api");
        await refreshPrices();
      } else {
        Alert.alert("Price Unavailable", "Could not fetch a live price for this ticker.");
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

  return (
    <View style={styles.container}>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <View style={[styles.headerWrap, { paddingTop: topPad + 12 }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Feather name="arrow-left" size={22} color="rgba(255,255,255,0.8)" />
        </TouchableOpacity>

        <View style={styles.headerContent}>
          <View style={styles.headerTop}>
            <Text style={styles.tickerText}>{holding.ticker}</Text>
            <View style={styles.exchangeBadge}>
              <Text style={styles.exchangeText}>{exchangeLabel.split(" (")[0]}</Text>
            </View>
            <TouchableOpacity
              style={[styles.exchangeBadge, { backgroundColor: "rgba(255,255,255,0.08)", borderColor: "rgba(255,255,255,0.15)" }]}
              onPress={handleEditAssetClass}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Text style={[styles.exchangeText, { color: "rgba(255,255,255,0.7)" }]}>{localAssetClass}</Text>
              <Feather name="edit-2" size={9} color="rgba(255,255,255,0.45)" style={{ marginLeft: 4 }} />
            </TouchableOpacity>
          </View>
          {!!holding.name && (
            <Text style={styles.nameText} numberOfLines={1}>{holding.name}</Text>
          )}
          <View style={styles.priceRow}>
            <Text style={styles.priceText}>
              {holding.hasPrice ? formatEUR(holding.currentPrice) : "No price"}
            </Text>
            {holding.hasPrice && (
              <View style={[styles.gainPill, { backgroundColor: gainColor + "22" }]}>
                <Text style={[styles.gainPillText, { color: gainColor }]}>
                  {isPositive ? "+" : ""}{gainPct.toFixed(2)}% vs cost
                </Text>
              </View>
            )}
          </View>
          <View style={styles.priceStatusRow}>
            {holding.priceIsStale ? (
              <Text style={styles.staleLabel}>⚠ Stale · {staleLabelFor(holding.priceLastFetched)}</Text>
            ) : holding.hasPrice ? (
              <Text style={styles.liveLabel}>● Live · {staleLabelFor(holding.priceLastFetched)}</Text>
            ) : (
              <Text style={styles.noPriceLabel}>No live price</Text>
            )}
            <TouchableOpacity
              style={styles.refreshBtn}
              onPress={handleRefreshPrice}
              disabled={refreshing}
            >
              {refreshing ? (
                <ActivityIndicator size="small" color={theme.tint} />
              ) : (
                <Feather name="refresh-cw" size={13} color={theme.tint} />
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 90 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── 2×3 Metrics Grid ─────────────────────────────────────────── */}
        <View style={[styles.card, styles.metricsCard]}>
          <View style={styles.metricRow}>
            <MetricCell label="Quantity" value={`${holding.quantity} units`} />
            <View style={styles.metricVDivider} />
            <MetricCell label="Avg Cost" value={formatEUR(holding.avg_cost_eur)} />
          </View>
          <View style={styles.metricHDivider} />
          <View style={styles.metricRow}>
            <MetricCell label="Total Invested" value={formatEUR(invested)} />
            <View style={styles.metricVDivider} />
            <MetricCell
              label="Current Value"
              value={holding.hasPrice ? formatEUR(marketValue) : "—"}
            />
          </View>
          <View style={styles.metricHDivider} />
          <View style={styles.metricRow}>
            <MetricCell
              label="Return (€)"
              value={
                holding.hasPrice
                  ? `${isPositive ? "+" : ""}${formatEUR(gain, true)}`
                  : "—"
              }
              valueColor={holding.hasPrice ? gainColor : undefined}
            />
            <View style={styles.metricVDivider} />
            <MetricCell
              label="Return (%)"
              value={
                holding.hasPrice
                  ? `${isPositive ? "+" : ""}${gainPct.toFixed(2)}%`
                  : "—"
              }
              valueColor={holding.hasPrice ? gainColor : undefined}
            />
          </View>
        </View>

        {/* ── Additional Info ───────────────────────────────────────────── */}
        <View style={styles.card}>
          {holding.yield_pct != null && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Trailing Yield</Text>
              <Text style={styles.infoValue}>
                {holding.yield_pct.toFixed(2)}%
                {estimatedAnnualIncome != null && (
                  <Text style={styles.infoSub}> → est. {formatEUR(estimatedAnnualIncome)}/yr</Text>
                )}
              </Text>
            </View>
          )}
          {ter !== null && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>TER (Annual Fee)</Text>
              <Text style={[styles.infoValue, { color: ter <= 0.10 ? theme.positive : ter <= 0.25 ? theme.tint : theme.negative }]}>
                {ter.toFixed(2)}%/yr
              </Text>
            </View>
          )}
          {!!holding.purchase_date && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Purchase Date</Text>
              <Text style={styles.infoValue}>{formatDate(holding.purchase_date)}</Text>
            </View>
          )}
          {!!holding.isin && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>ISIN</Text>
              <Text style={[styles.infoValue, { letterSpacing: 0.5, fontFamily: "Inter_400Regular" }]}>
                {holding.isin}
              </Text>
            </View>
          )}
          {!!holding.isin && (
            <TouchableOpacity
              style={[styles.infoRow, { borderBottomWidth: 0 }]}
              onPress={() => Linking.openURL(`https://www.justetf.com/en/etf-profile.html?isin=${holding.isin}`)}
            >
              <Text style={styles.infoLabel}>View on JustETF</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Text style={[styles.infoValue, { color: theme.tint }]}>justetf.com</Text>
                <Feather name="external-link" size={12} color={theme.tint} />
              </View>
            </TouchableOpacity>
          )}
          {holding.yield_pct == null && !holding.purchase_date && !holding.isin && (
            <View style={[styles.infoRow, { borderBottomWidth: 0 }]}>
              <Text style={styles.infoLabel}>Portfolio Weight</Text>
              <Text style={styles.infoValue}>{weight.toFixed(1)}%</Text>
            </View>
          )}
        </View>
      </ScrollView>

      {/* ── Bottom action bar ─────────────────────────────────────────────── */}
      <View style={[styles.actionBar, { paddingBottom: bottomPad }]}>
        <TouchableOpacity
          style={[styles.actionBtn, styles.editBtn]}
          onPress={() => setShowEdit(true)}
          activeOpacity={0.75}
        >
          <Feather name="edit-2" size={16} color={theme.tint} />
          <Text style={[styles.actionBtnText, { color: theme.tint }]}>Edit</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, styles.deleteBtn]}
          onPress={handleDelete}
          activeOpacity={0.75}
        >
          <Feather name="trash-2" size={16} color={theme.negative} />
          <Text style={[styles.actionBtnText, { color: theme.negative }]}>Delete</Text>
        </TouchableOpacity>
      </View>

      <EditHoldingModal visible={showEdit} holding={holding} onClose={() => setShowEdit(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },

  headerWrap: {
    backgroundColor: theme.deepBlue,
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  backBtn: { marginBottom: 14 },
  backBtnStandalone: { margin: 16 },

  headerContent: { gap: 4 },
  headerTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  tickerText: {
    fontSize: 32,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
    letterSpacing: -1,
  },
  exchangeBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(201,168,76,0.18)",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: "rgba(201,168,76,0.35)",
  },
  exchangeText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: "#C9A84C",
    letterSpacing: 0.5,
  },
  nameText: {
    fontSize: 13,
    color: "rgba(255,255,255,0.6)",
    fontFamily: "Inter_400Regular",
  },
  priceRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 6 },
  priceText: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
    letterSpacing: -0.5,
  },
  gainPill: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 20 },
  gainPillText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },

  priceStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 6,
  },
  liveLabel: { fontSize: 12, color: "#2ECC71", fontFamily: "Inter_400Regular" },
  staleLabel: { fontSize: 12, color: "#F39C12", fontFamily: "Inter_400Regular" },
  noPriceLabel: { fontSize: 12, color: "rgba(255,255,255,0.4)", fontFamily: "Inter_400Regular" },
  refreshBtn: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.1)",
  },

  content: { paddingHorizontal: 16, paddingTop: 16, gap: 12 },

  card: {
    backgroundColor: theme.backgroundCard,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.border,
    overflow: "hidden",
  },
  metricsCard: {},

  metricRow: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  metricHDivider: { height: 1, backgroundColor: theme.border },
  metricVDivider: { width: 1, backgroundColor: theme.border, marginHorizontal: 16 },
  metricCell: { flex: 1, gap: 5 },
  metricLabel: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    color: theme.textSecondary,
    letterSpacing: 0.2,
  },
  metricValue: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    color: theme.text,
  },

  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  infoLabel: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: theme.textSecondary,
  },
  infoValue: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: theme.text,
  },
  infoSub: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: theme.textSecondary,
  },

  actionBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    gap: 12,
    padding: 16,
    backgroundColor: theme.backgroundCard,
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  editBtn: { borderColor: theme.tint, backgroundColor: theme.tint + "11" },
  deleteBtn: { borderColor: theme.negative, backgroundColor: theme.negative + "11" },
  actionBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },

  notFoundWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  notFoundText: { fontSize: 14, fontFamily: "Inter_400Regular", color: theme.textSecondary },
});
