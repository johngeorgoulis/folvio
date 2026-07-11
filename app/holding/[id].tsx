import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
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
import { useTheme } from "@/context/ThemeContext";
import { getPriceStatusLabel, isExchangeOpen } from "@/utils/marketHours";
import { usePortfolio } from "@/context/PortfolioContext";
import { useAllocation } from "@/context/AllocationContext";
import { formatEUR, formatPct, formatQuantity } from "@/utils/format";
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
import { upsertPrice, getAllContributionSummaries } from "@/services/db";

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
  theme,
}: {
  label: string;
  value: string;
  valueColor?: string;
  theme: any;
}) {
  return (
    <View style={styles.metricCell}>
      <Text style={[styles.metricLabel, { color: theme.textSecondary }]}>{label}</Text>
      <Text style={[styles.metricValue, { color: valueColor ?? theme.text }]}>{value}</Text>
    </View>
  );
}

export default function HoldingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 24 : insets.top;
  const bottomPad = Platform.OS === "web" ? 16 : insets.bottom + 16;
  const { theme } = useTheme();

  const { holdings, deleteHolding, refreshPrices, totalPortfolioValue } = usePortfolio();
  const { targets } = useAllocation();
  const holding = holdings.find((h) => h.id === id);
  const [showEdit, setShowEdit] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [localAssetClass, setLocalAssetClass] = useState<AssetClass>(
    () => getAssetClass(holding?.ticker ?? "", holding?.isin ?? "")
  );
  const [brokerBreakdown, setBrokerBreakdown] = useState<{ broker: string; units: number }[]>([]);

  useEffect(() => {
    if (!holding) return;
    getAllContributionSummaries().then((rows) => {
      const filtered = rows.filter(
        (r) => r.ticker === holding.ticker.toUpperCase() && r.units > 0
      );
      setBrokerBreakdown(filtered);
    }).catch(() => {});
  }, [holding?.ticker]);

  if (!holding) {
    return (
      <View style={[styles.container, { backgroundColor: theme.background, paddingTop: topPad + 20 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtnStandalone}>
          <Feather name="arrow-left" size={22} color={theme.text} />
        </TouchableOpacity>
        <View style={styles.notFoundWrap}>
          <Text style={[styles.notFoundText, { color: theme.textSecondary }]}>Holding not found.</Text>
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

  const isAccumulating =
    holding.isin === "IE00BK5BQT80" ||
    (holding.name + " " + holding.ticker).toLowerCase().includes("acc") ||
    (holding.name + " " + holding.ticker).toLowerCase().includes("accumul");

  const exchangeLabel = getExchangeLabel(holding.exchange);
  const ter = getTER(holding.ticker);

  const targetAlloc = targets.find(t => t.ticker.toUpperCase() === holding.ticker.toUpperCase());
  const targetPct   = targetAlloc?.target_pct ?? null;
  const driftPct    = targetPct != null ? weight - targetPct : null;
  const driftAbs    = driftPct != null ? Math.abs(driftPct) : 0;
  const driftColor  = driftPct == null
    ? theme.textSecondary
    : driftAbs <= 2  ? theme.positive
    : driftAbs <= 5  ? theme.accent
    : theme.negative;

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
      const result = await fetchLivePrice(holding!.ticker, holding!.exchange, holding!.isin || undefined);
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
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <View style={[styles.headerWrap, { paddingTop: topPad + 12, backgroundColor: theme.surface, borderBottomWidth: 2, borderBottomColor: theme.text }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Feather name="arrow-left" size={22} color={theme.text} />
        </TouchableOpacity>

        <View style={styles.headerContent}>
          <View style={styles.headerTop}>
            <Text style={[styles.tickerText, { color: theme.text }]}>{holding.ticker}</Text>
            <View style={[styles.exchangeBadge, { borderColor: theme.hairline }]}>
              <Text style={[styles.exchangeText, { color: theme.textSecondary }]}>{exchangeLabel.split(" (")[0]}</Text>
            </View>
            <TouchableOpacity
              style={[styles.exchangeBadge, { borderColor: theme.hairline }]}
              onPress={handleEditAssetClass}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Text style={[styles.exchangeText, { color: theme.textMuted }]}>{localAssetClass}</Text>
              <Feather name="edit-2" size={9} color={theme.textMuted} style={{ marginLeft: 4 }} />
            </TouchableOpacity>
          </View>
          {!!holding.name && (
            <Text style={[styles.nameText, { color: theme.textSecondary }]} numberOfLines={1}>{holding.name}</Text>
          )}
          <View style={styles.priceRow}>
            <Text style={[styles.priceText, { color: theme.text }]}>
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
            {(() => {
              const label = getPriceStatusLabel(
                holding.exchange,
                holding.priceLastFetched,
                holding.hasPrice,
                holding.priceIsStale,
              );
              if (!holding.hasPrice) {
                return <Text style={[styles.noPriceLabel, { color: theme.textMuted }]}>{label}</Text>;
              }
              if (!label) {
                return <Text style={[styles.liveLabel, { color: theme.positive }]}>● Live</Text>;
              }
              return <Text style={[styles.noPriceLabel, { color: theme.textMuted }]}>{label}</Text>;
            })()}
            <TouchableOpacity
              style={[styles.refreshBtn, { backgroundColor: theme.surface }]}
              onPress={handleRefreshPrice}
              disabled={refreshing}
            >
              {refreshing ? (
                <ActivityIndicator size="small" color={theme.accent} />
              ) : (
                <Feather name="refresh-cw" size={13} color={theme.accent} />
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
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.hairline }]}>
          <View style={styles.metricRow}>
            <MetricCell label="Quantity" value={`${formatQuantity(holding.quantity)} units`} theme={theme} />
            <View style={[styles.metricVDivider, { backgroundColor: theme.hairline }]} />
            <MetricCell label="Avg Cost" value={formatEUR(holding.avg_cost_eur)} theme={theme} />
          </View>
          <View style={[styles.metricHDivider, { backgroundColor: theme.hairline }]} />
          <View style={styles.metricRow}>
            <MetricCell label="Total Invested" value={formatEUR(invested)} theme={theme} />
            <View style={[styles.metricVDivider, { backgroundColor: theme.hairline }]} />
            <MetricCell
              label="Current Value"
              value={holding.hasPrice ? formatEUR(marketValue) : "—"}
              theme={theme}
            />
          </View>
          <View style={[styles.metricHDivider, { backgroundColor: theme.hairline }]} />
          <View style={styles.metricRow}>
            <MetricCell
              label="Return (€)"
              value={holding.hasPrice ? `${isPositive ? "+" : ""}${formatEUR(gain, true)}` : "—"}
              valueColor={holding.hasPrice ? gainColor : undefined}
              theme={theme}
            />
            <View style={[styles.metricVDivider, { backgroundColor: theme.hairline }]} />
            <MetricCell
              label="Return (%)"
              value={holding.hasPrice ? `${isPositive ? "+" : ""}${gainPct.toFixed(2)}%` : "—"}
              valueColor={holding.hasPrice ? gainColor : undefined}
              theme={theme}
            />
          </View>
        </View>

        {/* ── Target Allocation ────────────────────────────────────────── */}
        {targetPct != null && (
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.hairline }]}>
            <View style={[styles.infoRow, { borderBottomColor: theme.hairline }]}>
              <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>Current</Text>
              <Text style={[styles.infoValue, { color: theme.text }]}>{weight.toFixed(1)}%</Text>
            </View>
            <View style={[styles.infoRow, { borderBottomColor: theme.hairline }]}>
              <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>Target</Text>
              <Text style={[styles.infoValue, { color: theme.text }]}>{targetPct.toFixed(1)}%</Text>
            </View>
            <View style={[styles.infoRow, { borderBottomWidth: 0 }]}>
              <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>Drift</Text>
              <Text style={[styles.infoValue, { color: driftColor }]}>
                {driftPct != null ? `${driftPct >= 0 ? "+" : ""}${driftPct.toFixed(1)}%` : "—"}
              </Text>
            </View>
            <View style={styles.allocBarWrap}>
              <View style={[styles.allocBarTrack, { backgroundColor: theme.background }]}>
                <View
                  style={[
                    styles.allocBarFill,
                    { width: `${Math.min(weight, 100)}%`, backgroundColor: driftColor },
                  ]}
                />
              </View>
              {targetPct <= 100 && (
                <View
                  style={[
                    styles.allocTargetMarker,
                    { left: `${Math.min(targetPct, 100)}%`, backgroundColor: theme.textSecondary },
                  ]}
                />
              )}
            </View>
            <View style={styles.allocBarLabels}>
              <Text style={[styles.allocBarLabel, { color: theme.textMuted }]}>0%</Text>
              <Text style={[styles.allocBarLabel, { color: theme.textMuted }]}>Target: {targetPct.toFixed(0)}%</Text>
              <Text style={[styles.allocBarLabel, { color: theme.textMuted }]}>100%</Text>
            </View>
          </View>
        )}

        {/* ── Additional Info ───────────────────────────────────────────── */}
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.hairline }]}>
          {holding.yield_pct != null && (
            <View style={[styles.infoRow, { borderBottomColor: theme.hairline }]}>
              <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>Trailing Yield</Text>
              <Text style={[styles.infoValue, { color: theme.text }]}>
                {holding.yield_pct === 0 && isAccumulating
                  ? "Acc. — no distributions"
                  : (
                    <>
                      {holding.yield_pct.toFixed(2)}%
                      {estimatedAnnualIncome != null && (
                        <Text style={[styles.infoSub, { color: theme.textSecondary }]}> → est. {formatEUR(estimatedAnnualIncome)}/yr</Text>
                      )}
                    </>
                  )
                }
              </Text>
            </View>
          )}
          {ter !== null && (
            <View style={[styles.infoRow, { borderBottomColor: theme.hairline }]}>
              <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>TER (Annual Fee)</Text>
              <Text style={[styles.infoValue, { color: ter <= 0.10 ? theme.positive : ter <= 0.25 ? theme.accent : theme.negative }]}>
                {ter.toFixed(2)}%/yr
              </Text>
            </View>
          )}
          {!!holding.purchase_date && (
            <View style={[styles.infoRow, { borderBottomColor: theme.hairline }]}>
              <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>Purchase Date</Text>
              <Text style={[styles.infoValue, { color: theme.text }]}>{formatDate(holding.purchase_date)}</Text>
            </View>
          )}
          {!!holding.isin && (
            <View style={[styles.infoRow, { borderBottomColor: theme.hairline }]}>
              <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>ISIN</Text>
              <Text style={[styles.infoValue, { color: theme.text, letterSpacing: 0.5, fontFamily: "Archivo_400Regular" }]}>
                {holding.isin}
              </Text>
            </View>
          )}
          {!!holding.isin && (
            <TouchableOpacity
              style={[styles.infoRow, { borderBottomWidth: 0 }]}
              onPress={() => Linking.openURL(`https://www.justetf.com/en/etf-profile.html?isin=${holding.isin}`)}
            >
              <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>View on JustETF</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Text style={[styles.infoValue, { color: theme.accent }]}>justetf.com</Text>
                <Feather name="external-link" size={12} color={theme.accent} />
              </View>
            </TouchableOpacity>
          )}
          {holding.yield_pct == null && !holding.purchase_date && !holding.isin && (
            <View style={[styles.infoRow, { borderBottomWidth: 0 }]}>
              <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>Portfolio Weight</Text>
              <Text style={[styles.infoValue, { color: theme.text }]}>{weight.toFixed(1)}%</Text>
            </View>
          )}
        </View>

        {/* ── Broker Breakdown ──────────────────────────────────────────── */}
        {brokerBreakdown.length >= 2 && (
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.hairline }]}>
            <View style={[styles.infoRow, { borderBottomColor: theme.hairline }]}>
              <Text style={[styles.infoLabel, { fontFamily: "Archivo_600SemiBold", color: theme.text }]}>
                Broker Breakdown
              </Text>
            </View>
            {brokerBreakdown.map((b, idx) => (
              <View
                key={b.broker}
                style={[styles.infoRow, { borderBottomColor: theme.hairline, borderBottomWidth: idx === brokerBreakdown.length - 1 ? 0 : 1 }]}
              >
                <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>{b.broker}</Text>
                <Text style={[styles.infoValue, { color: theme.text }]}>{formatQuantity(b.units)} units</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* ── Bottom action bar ─────────────────────────────────────────────── */}
      <View style={[styles.actionBar, { paddingBottom: bottomPad, backgroundColor: theme.surface, borderTopColor: theme.divider }]}>
        <TouchableOpacity
          style={[styles.actionBtn, { borderColor: theme.accent, backgroundColor: theme.accent + "11" }]}
          onPress={() => setShowEdit(true)}
          activeOpacity={0.75}
        >
          <Feather name="edit-2" size={16} color={theme.accent} />
          <Text style={[styles.actionBtnText, { color: theme.accent }]}>Edit</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, { borderColor: theme.negative, backgroundColor: theme.negative + "11" }]}
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
  container: { flex: 1 },

  headerWrap: {
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  backBtn: { marginBottom: 14 },
  backBtnStandalone: { margin: 16 },

  headerContent: { gap: 4 },
  headerTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  tickerText: {
    fontSize: 32,
    fontFamily: "Archivo_800ExtraBold",
    letterSpacing: -1,
  },
  exchangeBadge: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 0,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
  },
  exchangeText: {
    fontSize: 11,
    fontFamily: "Archivo_600SemiBold",
    letterSpacing: 0.5,
  },
  nameText: {
    fontSize: 13,
    fontFamily: "Archivo_400Regular",
  },
  priceRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 6 },
  priceText: {
    fontSize: 28,
    fontFamily: "Archivo_800ExtraBold",
    letterSpacing: -0.5,
  },
  gainPill: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 0 },
  gainPillText: { fontSize: 12, fontFamily: "Archivo_600SemiBold" },

  priceStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 6,
  },
  liveLabel: { fontSize: 12, fontFamily: "Archivo_400Regular" },
  noPriceLabel: { fontSize: 12, fontFamily: "Archivo_400Regular" },
  refreshBtn: {
    padding: 6,
    borderRadius: 0,
  },

  content: { paddingHorizontal: 16, paddingTop: 16, gap: 12 },

  card: {
    borderRadius: 0,
    borderWidth: 1,
    overflow: "hidden",
  },

  metricRow: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  metricHDivider: { height: 1 },
  metricVDivider: { width: 1, marginHorizontal: 16 },
  metricCell: { flex: 1, gap: 5 },
  metricLabel: {
    fontSize: 11,
    fontFamily: "Archivo_600SemiBold",
    letterSpacing: 0.2,
  },
  metricValue: {
    fontSize: 16,
    fontFamily: "Archivo_800ExtraBold",
  },

  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  infoLabel: {
    fontSize: 13,
    fontFamily: "Archivo_400Regular",
  },
  infoValue: {
    fontSize: 13,
    fontFamily: "Archivo_600SemiBold",
  },
  infoSub: {
    fontSize: 12,
    fontFamily: "Archivo_400Regular",
  },

  actionBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    gap: 12,
    padding: 16,
    borderTopWidth: 2,
  },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 0,
    borderWidth: 1.5,
  },
  actionBtnText: { fontSize: 15, fontFamily: "Archivo_600SemiBold" },

  notFoundWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  notFoundText: { fontSize: 14, fontFamily: "Archivo_400Regular" },

  allocBarWrap: {
    position: "relative",
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 4,
    height: 8,
  },
  allocBarTrack: {
    height: 8,
    borderRadius: 0,
    overflow: "hidden",
  },
  allocBarFill: {
    height: 8,
    borderRadius: 0,
  },
  allocTargetMarker: {
    position: "absolute",
    top: -3,
    width: 2,
    height: 14,
    borderRadius: 0,
    marginLeft: -1,
  },
  allocBarLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginHorizontal: 16,
    marginBottom: 12,
  },
  allocBarLabel: {
    fontSize: 10,
    fontFamily: "Archivo_400Regular",
  },
});
