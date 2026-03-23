import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { usePortfolio } from "@/context/PortfolioContext";
import { useAllocation, THRESHOLD_OPTIONS } from "@/context/AllocationContext";
import {
  calculateAllocations,
  calculateDCARebalance,
  calculateFullRebalance,
  validateTargets,
  getPortfolioTotalEUR,
  type AllocationRow,
  type RebalanceResult,
} from "@/services/allocationService";
import { buildYahooSymbol } from "@/services/priceService";
import { formatEUR } from "@/utils/format";

const ETF_COLORS = [
  "#C9A84C",
  "#34D399",
  "#60A5FA",
  "#F472B6",
  "#A78BFA",
  "#FB923C",
  "#38BDF8",
  "#4ADE80",
  "#F87171",
  "#E879F9",
];

function getColor(index: number): string {
  return ETF_COLORS[index % ETF_COLORS.length];
}

function StatusBadge({ status }: { status: AllocationRow["status"] }) {
  const configs = {
    ok:          { label: "OK",    dot: "#2ECC71", bg: "#2ECC7122", text: "#2ECC71" },
    overweight:  { label: "Over",  dot: "#F39C12", bg: "#F39C1222", text: "#F39C12" },
    underweight: { label: "Under", dot: "#F39C12", bg: "#F39C1222", text: "#F39C12" },
    untracked:   { label: "—",     dot: "#64748B", bg: "#64748B22", text: "#64748B" },
    no_price:    { label: "N/A",   dot: "#E74C3C", bg: "#E74C3C22", text: "#E74C3C" },
  };
  const c = configs[status];
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      <View style={[styles.badgeDot, { backgroundColor: c.dot }]} />
      <Text style={[styles.badgeText, { color: c.text }]}>{c.label}</Text>
    </View>
  );
}

function AllocationBar({ rows }: { rows: AllocationRow[] }) {
  const pricedRows = rows.filter((r) => r.actualPct > 0);
  const totalShown = pricedRows.reduce((s, r) => s + r.actualPct, 0);
  if (totalShown === 0) return null;

  return (
    <View style={styles.barContainer}>
      {pricedRows.map((r, i) => (
        <View
          key={r.ticker}
          style={[
            styles.barSegment,
            {
              flex: r.actualPct / totalShown,
              backgroundColor: getColor(i),
              borderRadius: i === 0 ? 4 : i === pricedRows.length - 1 ? 4 : 0,
              marginLeft: i === 0 ? 0 : 1,
            },
          ]}
        />
      ))}
    </View>
  );
}

function AllocationLegend({ rows }: { rows: AllocationRow[] }) {
  const pricedRows = rows.filter((r) => r.actualPct > 0);
  return (
    <View style={styles.legendGrid}>
      {pricedRows.map((r, i) => (
        <View key={r.ticker} style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: getColor(i) }]} />
          <Text style={styles.legendText}>{r.ticker}</Text>
        </View>
      ))}
    </View>
  );
}

export default function RebalanceScreen() {
  const theme = Colors.dark;
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 24 : insets.top;

  const { holdings } = usePortfolio();
  const { targets, rebalanceThreshold, isLoadingTargets } = useAllocation();

  const [mode, setMode] = useState<"dca" | "full">("dca");
  const [cashInput, setCashInput] = useState("");
  const [result, setResult] = useState<RebalanceResult | null>(null);
  const [calculating, setCalculating] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem("fortis_forecast_dca").then((val) => {
      if (val && parseFloat(val) > 0) setCashInput(val);
    });
  }, []);

  const totalEUR = useMemo(() => getPortfolioTotalEUR(holdings), [holdings]);

  const allocations = useMemo(
    () => calculateAllocations(holdings, targets, rebalanceThreshold),
    [holdings, targets, rebalanceThreshold]
  );

  const validation = useMemo(() => validateTargets(targets), [targets]);

  const worstOverweight = useMemo(() => {
    const hits = allocations.filter((r) => r.drift > 5).sort((a, b) => b.drift - a.drift);
    return hits[0] ?? null;
  }, [allocations]);

  function handleCalculate() {
    if (!validation.valid) {
      Alert.alert("Invalid Targets", validation.error);
      return;
    }
    if (mode === "dca") {
      const cash = parseFloat(cashInput.replace(",", "."));
      if (isNaN(cash) || cash <= 0) {
        Alert.alert("Invalid Amount", "Enter a valid cash amount to invest.");
        return;
      }
      setCalculating(true);
      setTimeout(() => {
        setResult(calculateDCARebalance(holdings, targets, cash));
        setCalculating(false);
      }, 0);
    } else {
      if (totalEUR === 0) {
        Alert.alert("Empty Portfolio", "Add holdings with prices first.");
        return;
      }
      setCalculating(true);
      setTimeout(() => {
        setResult(calculateFullRebalance(holdings, targets));
        setCalculating(false);
      }, 0);
    }
  }

  if (isLoadingTargets) {
    return (
      <View style={[styles.container, { backgroundColor: theme.background, justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator color={theme.tint} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={[styles.navBar, { paddingTop: topPad + 8, borderBottomColor: theme.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.navTitle, { color: theme.text }]}>Rebalance</Text>
        <TouchableOpacity
          onPress={() => router.push("/settings" as never)}
          style={styles.navAction}
        >
          <Feather name="sliders" size={18} color={theme.tint} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {totalEUR === 0 && (
          <View style={[styles.emptyCard, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}>
            <Text style={[styles.emptyTitle, { color: theme.text }]}>No portfolio data</Text>
            <Text style={[styles.emptySubtitle, { color: theme.textSecondary }]}>
              Add holdings with live prices to use the rebalance calculator.
            </Text>
          </View>
        )}

        {!validation.valid && (
          <View style={[styles.warningCard, { backgroundColor: "#FBBF2411", borderColor: "#FBBF2444" }]}>
            <Feather name="alert-triangle" size={16} color="#FBBF24" />
            <Text style={styles.warningText}>{validation.error}</Text>
          </View>
        )}

        <View style={[styles.card, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Allocation Overview</Text>
          <AllocationBar rows={allocations} />
          <AllocationLegend rows={allocations} />

          <View style={styles.tableHeader}>
            <Text style={[styles.thTicker, { color: theme.textSecondary }]}>TICKER</Text>
            <Text style={[styles.thNum, { color: theme.textSecondary }]}>TARGET</Text>
            <Text style={[styles.thNum, { color: theme.textSecondary }]}>ACTUAL</Text>
            <Text style={[styles.thNum, { color: theme.textSecondary }]}>DRIFT</Text>
            <Text style={[styles.thStatus, { color: theme.textSecondary }]}>STATUS</Text>
          </View>
          <View style={[styles.tableDivider, { backgroundColor: theme.border }]} />

          {allocations.map((row, i) => (
            <View key={row.ticker}>
              {i > 0 && <View style={[styles.rowDivider, { backgroundColor: theme.border }]} />}
              <View style={styles.tableRow}>
                <View style={styles.thTicker}>
                  <View style={[styles.colorDot, { backgroundColor: getColor(i) }]} />
                  <Text style={[styles.rowTicker, { color: theme.text }]}>{row.ticker}</Text>
                </View>
                <Text style={[styles.thNum, { color: theme.textSecondary }]}>
                  {row.targetPct > 0 ? `${row.targetPct.toFixed(0)}%` : "—"}
                </Text>
                <Text style={[styles.thNum, { color: theme.text }]}>
                  {row.actualPct > 0 ? `${row.actualPct.toFixed(1)}%` : "—"}
                </Text>
                <Text
                  style={[
                    styles.thNum,
                    {
                      color:
                        Math.abs(row.drift) < 0.1
                          ? theme.textSecondary
                          : row.drift > 0
                          ? "#FBBF24"
                          : "#60A5FA",
                    },
                  ]}
                >
                  {row.drift === 0 ? "—" : `${row.drift > 0 ? "+" : ""}${row.drift.toFixed(1)}%`}
                </Text>
                <View style={styles.thStatus}>
                  <StatusBadge status={row.status} />
                </View>
              </View>
            </View>
          ))}

          {allocations.length === 0 && (
            <Text style={[styles.emptySubtitle, { color: theme.textSecondary, textAlign: "center", paddingVertical: 12 }]}>
              No holdings yet.
            </Text>
          )}
        </View>

        <View style={[styles.card, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Rebalancing Calculator</Text>

          <View style={styles.modeToggle}>
            <TouchableOpacity
              style={[styles.modeBtn, { backgroundColor: mode === "dca" ? theme.tint + "22" : theme.backgroundElevated, borderColor: mode === "dca" ? theme.tint : theme.border }]}
              onPress={() => { setMode("dca"); setResult(null); }}
            >
              <Text style={[styles.modeBtnText, { color: mode === "dca" ? theme.tint : theme.textSecondary }]}>
                DCA Mode
              </Text>
              <Text style={[styles.modeSubText, { color: mode === "dca" ? theme.tint + "99" : theme.textTertiary }]}>
                Add new capital
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeBtn, { backgroundColor: mode === "full" ? theme.tint + "22" : theme.backgroundElevated, borderColor: mode === "full" ? theme.tint : theme.border }]}
              onPress={() => { setMode("full"); setResult(null); }}
            >
              <Text style={[styles.modeBtnText, { color: mode === "full" ? theme.tint : theme.textSecondary }]}>
                Full Rebalance
              </Text>
              <Text style={[styles.modeSubText, { color: mode === "full" ? theme.tint + "99" : theme.textTertiary }]}>
                Buy & sell
              </Text>
            </TouchableOpacity>
          </View>

          {mode === "dca" && (
            <View style={[styles.inputRow, { borderColor: theme.border, backgroundColor: theme.backgroundElevated }]}>
              <Text style={[styles.inputPrefix, { color: theme.textSecondary }]}>€</Text>
              <TextInput
                style={[styles.cashInput, { color: theme.text }]}
                placeholder="Amount to invest"
                placeholderTextColor={theme.textTertiary}
                keyboardType="decimal-pad"
                value={cashInput}
                onChangeText={(t) => { setCashInput(t); setResult(null); }}
              />
            </View>
          )}

          {mode === "full" && (
            <View style={[styles.fullRebalanceNote, { backgroundColor: "#F8717111", borderColor: "#F8717133" }]}>
              <Feather name="alert-circle" size={14} color="#F87171" />
              <Text style={styles.fullRebalanceNoteText}>
                Selling may trigger capital gains tax. Consult a tax advisor.
              </Text>
            </View>
          )}

          {mode === "dca" && worstOverweight && (
            <View style={[styles.overweightBanner, { backgroundColor: "#F39C1211", borderColor: "#F39C1244" }]}>
              <Feather name="alert-triangle" size={13} color="#F39C12" style={{ marginTop: 1 }} />
              <Text style={styles.overweightBannerText}>
                <Text style={{ fontFamily: "Inter_600SemiBold" }}>{worstOverweight.ticker}</Text>
                {" "}is significantly overweight ({worstOverweight.drift > 0 ? "+" : ""}{worstOverweight.drift.toFixed(1)}%). DCA mode will skip it, but consider a Full Rebalance to restore your target allocation.
              </Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.calcBtn, { backgroundColor: theme.tint, opacity: !validation.valid ? 0.5 : 1 }]}
            onPress={handleCalculate}
            disabled={!validation.valid || calculating}
          >
            {calculating ? (
              <ActivityIndicator color="#0A0F1A" />
            ) : (
              <Text style={styles.calcBtnText}>Calculate</Text>
            )}
          </TouchableOpacity>
        </View>

        {result && (
          <View style={[styles.card, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>Suggestions</Text>

            {result.warnings.map((w, i) => (
              <View key={i} style={[styles.warningRow, { borderColor: "#FBBF2444" }]}>
                <Feather name="alert-triangle" size={13} color="#FBBF24" />
                <Text style={styles.warningRowText}>{w}</Text>
              </View>
            ))}

            {result.suggestions.map((s, i) => {
              const symbol = buildYahooSymbol(s.ticker, s.exchange);
              const isBuy = s.action === "buy";
              const isSell = s.action === "sell";
              const isSkip = s.action === "skip";
              return (
                <View key={i}>
                  {i > 0 && <View style={[styles.rowDivider, { backgroundColor: theme.border }]} />}
                  <View style={styles.suggestionRow}>
                    <View
                      style={[
                        styles.actionBadge,
                        {
                          backgroundColor: isBuy
                            ? "#34D39922"
                            : isSell
                            ? "#F8717122"
                            : theme.backgroundElevated,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.actionText,
                          { color: isBuy ? "#34D399" : isSell ? "#F87171" : theme.textSecondary },
                        ]}
                      >
                        {s.action.toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      {isSkip ? (
                        <Text style={[styles.suggestionMain, { color: theme.textSecondary }]}>
                          {s.ticker} — {s.reason}
                        </Text>
                      ) : (
                        <Text style={[styles.suggestionMain, { color: theme.text }]}>
                          {s.units} × {symbol}
                        </Text>
                      )}
                    </View>
                    {!isSkip && (
                      <Text
                        style={[
                          styles.suggestionValue,
                          { color: isBuy ? "#34D399" : "#F87171" },
                        ]}
                      >
                        ≈ {formatEUR(s.estimatedValueEUR, true)}
                      </Text>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {result && (
          <View style={[styles.summaryCard, { backgroundColor: theme.deepBlue }]}>
            <Text style={styles.summaryTitle}>Summary</Text>
            <View style={styles.summaryGrid}>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryLabel}>Capital to Deploy</Text>
                <Text style={styles.summaryValue}>{formatEUR(result.totalToDeploy)}</Text>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryItem}>
                <Text style={styles.summaryLabel}>Transactions</Text>
                <Text style={styles.summaryValue}>{result.transactionCount}</Text>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryItem}>
                <Text style={styles.summaryLabel}>Mode</Text>
                <Text style={styles.summaryValue}>
                  {result.mode === "dca" ? "DCA" : "Full"}
                </Text>
              </View>
            </View>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  navBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  backBtn: { padding: 4, marginRight: 8 },
  navTitle: { flex: 1, fontSize: 18, fontFamily: "Inter_700Bold" },
  navAction: { padding: 8 },
  content: { paddingHorizontal: 16, paddingTop: 16, gap: 14 },
  emptyCard: {
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
  },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  emptySubtitle: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  warningCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  warningText: { flex: 1, fontSize: 13, color: "#FBBF24", fontFamily: "Inter_400Regular", lineHeight: 18 },
  card: { borderRadius: 16, padding: 16, borderWidth: 1, gap: 12 },
  sectionTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  barContainer: {
    flexDirection: "row",
    height: 20,
    borderRadius: 6,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  barSegment: { height: "100%" },
  legendGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 11, color: "#94A3B8", fontFamily: "Inter_500Medium" },
  tableHeader: { flexDirection: "row", alignItems: "center", marginTop: 4 },
  tableDivider: { height: 1, marginBottom: 2 },
  rowDivider: { height: 1 },
  thTicker: { flex: 2, flexDirection: "row", alignItems: "center", gap: 6 },
  thNum: { flex: 1, fontSize: 10, fontFamily: "Inter_500Medium", letterSpacing: 0.3, textAlign: "center" },
  thStatus: { flex: 1.5, alignItems: "flex-end" },
  tableRow: { flexDirection: "row", alignItems: "center", paddingVertical: 9 },
  colorDot: { width: 8, height: 8, borderRadius: 4 },
  rowTicker: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  badge: { flexDirection: "row", alignItems: "center", paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6, gap: 4 },
  badgeDot: { width: 5, height: 5, borderRadius: 3 },
  badgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  modeToggle: { flexDirection: "row", gap: 10 },
  modeBtn: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    gap: 2,
  },
  modeBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  modeSubText: { fontSize: 11, fontFamily: "Inter_400Regular" },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 0,
    height: 50,
  },
  inputPrefix: { fontSize: 18, fontFamily: "Inter_500Medium", marginRight: 6 },
  cashInput: { flex: 1, fontSize: 18, fontFamily: "Inter_500Medium", height: 50 },
  fullRebalanceNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  fullRebalanceNoteText: { flex: 1, fontSize: 12, color: "#F87171", fontFamily: "Inter_400Regular", lineHeight: 17 },
  overweightBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  overweightBannerText: { flex: 1, fontSize: 12, color: "#F39C12", fontFamily: "Inter_400Regular", lineHeight: 17 },
  calcBtn: {
    borderRadius: 12,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  calcBtnText: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#0A0F1A" },
  warningRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 7,
    paddingVertical: 6,
    borderBottomWidth: 1,
    paddingBottom: 8,
  },
  warningRowText: { flex: 1, fontSize: 12, color: "#FBBF24", fontFamily: "Inter_400Regular", lineHeight: 17 },
  suggestionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    gap: 10,
  },
  actionBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 7,
    minWidth: 46,
    alignItems: "center",
  },
  actionText: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  suggestionMain: { fontSize: 14, fontFamily: "Inter_500Medium" },
  suggestionValue: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  summaryCard: { borderRadius: 20, padding: 24 },
  summaryTitle: { color: "rgba(255,255,255,0.6)", fontSize: 11, fontFamily: "Inter_500Medium", letterSpacing: 0.5, marginBottom: 12 },
  summaryGrid: { flexDirection: "row", alignItems: "center" },
  summaryItem: { flex: 1, alignItems: "center", gap: 4 },
  summaryDivider: { width: 1, height: 40, backgroundColor: "rgba(255,255,255,0.15)", marginHorizontal: 8 },
  summaryLabel: { color: "rgba(255,255,255,0.55)", fontSize: 11, fontFamily: "Inter_400Regular" },
  summaryValue: { color: "#FFFFFF", fontSize: 18, fontFamily: "Inter_700Bold" },
});
