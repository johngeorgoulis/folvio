import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  ActivityIndicator,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { usePortfolio, FREE_TIER_LIMIT } from "@/context/PortfolioContext";
import { useAllocation, THRESHOLD_OPTIONS, type ThresholdOption } from "@/context/AllocationContext";
import { formatEUR } from "@/utils/format";
import PremiumModal from "@/components/PremiumModal";
import { fetchLivePrice, buildYahooSymbol } from "@/services/priceService";

const APP_VERSION = "1.0.0";

const BENCHMARKS = [
  { label: "S&P 500",        symbol: "^GSPC" },
  { label: "MSCI World",     symbol: "IWDA.AS" },
  { label: "Euro Stoxx 50",  symbol: "^STOXX50E" },
  { label: "FTSE All-World", symbol: "VWRL.AS" },
  { label: "DAX",            symbol: "^GDAXI" },
] as const;
type BenchmarkSymbol = typeof BENCHMARKS[number]["symbol"];

const ASYNC_KEYS = {
  showCostBasis: "fortis_show_cost_basis",
  showDividends: "fortis_show_dividends",
  defaultBenchmark: "fortis_default_benchmark",
  isPremium: "fortis_is_premium",
};

export default function SettingsScreen() {
  const theme = Colors.dark;
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 24 : insets.top;
  const bottomPad = Platform.OS === "web" ? 80 : insets.bottom + 80;

  const { holdings, holdingCount, totalPortfolioValue, totalInvested, isRefreshingPrices, refreshPrices, clearPrices } =
    usePortfolio();
  const { targets, rebalanceThreshold, setRebalanceThreshold, upsertTarget, removeTarget } =
    useAllocation();

  // ── Persisted settings ───────────────────────────────────────────────────
  const [showCostBasis, setShowCostBasis] = useState(true);
  const [showDividends, setShowDividends] = useState(true);
  const [defaultBenchmark, setDefaultBenchmark] = useState<BenchmarkSymbol>("^GSPC");
  const [isPremium, setIsPremium] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // ── UI state ─────────────────────────────────────────────────────────────
  const [showPremium, setShowPremium] = useState(false);
  const [editingTicker, setEditingTicker] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [addTicker, setAddTicker] = useState("");
  const [addPct, setAddPct] = useState("");
  const [showAddRow, setShowAddRow] = useState(false);
  const [refreshDone, setRefreshDone] = useState(false);

  const targetsSum = targets.reduce((s, t) => s + t.target_pct, 0);
  const sumOk = Math.abs(targetsSum - 100) < 0.01;

  // Load settings from AsyncStorage on mount
  useEffect(() => {
    (async () => {
      const [cb, sd, bm, ip] = await Promise.all([
        AsyncStorage.getItem(ASYNC_KEYS.showCostBasis),
        AsyncStorage.getItem(ASYNC_KEYS.showDividends),
        AsyncStorage.getItem(ASYNC_KEYS.defaultBenchmark),
        AsyncStorage.getItem(ASYNC_KEYS.isPremium),
      ]);
      if (cb !== null) setShowCostBasis(cb === "true");
      if (sd !== null) setShowDividends(sd === "true");
      if (bm !== null) {
        const validSymbols: string[] = BENCHMARKS.map((b) => b.symbol);
        if (validSymbols.includes(bm)) setDefaultBenchmark(bm as BenchmarkSymbol);
      }
      if (ip !== null) setIsPremium(ip === "true");
      setSettingsLoaded(true);
    })();
  }, []);

  async function persistToggle(key: string, val: boolean) {
    await AsyncStorage.setItem(key, val ? "true" : "false");
  }

  // ── Handlers ─────────────────────────────────────────────────────────────

  async function handleRefreshPrices() {
    await refreshPrices();
    setRefreshDone(true);
    setTimeout(() => setRefreshDone(false), 3000);
  }

  function handleClearCache() {
    Alert.alert(
      "Clear Price Cache",
      "This will remove all cached prices. Holdings will show their manually entered prices until new live data is fetched.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: async () => {
            await clearPrices();
            Alert.alert("Done", "Price cache cleared.");
          },
        },
      ]
    );
  }

  async function handleDebugPriceFetch() {
    const tests = [
      { ticker: "VWCE", exchange: "XETRA" },
      { ticker: "TDIV", exchange: "EURONEXT_AMS" },
      { ticker: "CSBGE7", exchange: "SIX" },
    ];
    const lines: string[] = [];
    for (const t of tests) {
      const sym = buildYahooSymbol(t.ticker, t.exchange);
      try {
        const result = await fetchLivePrice(t.ticker, t.exchange);
        if (result) {
          lines.push(`${sym} → €${result.priceEUR.toFixed(2)} (${result.currency}) ✅`);
        } else {
          lines.push(`${sym} → ❌ No data returned`);
        }
      } catch (e: any) {
        lines.push(`${sym} → ❌ ${e?.message ?? String(e)}`);
      }
    }
    Alert.alert("Price Fetch Test", lines.join("\n\n"));
  }

  function handleExportCSV() {
    if (!isPremium) {
      Alert.alert(
        "Premium Feature",
        "CSV export is available on Fortis Premium.",
        [
          { text: "Maybe Later", style: "cancel" },
          { text: "Upgrade", onPress: () => setShowPremium(true) },
        ]
      );
      return;
    }
    Alert.alert("Export CSV", "Export functionality coming soon.");
  }

  async function handleAddTarget() {
    const t = addTicker.trim().toUpperCase();
    const p = parseFloat(addPct.replace(",", "."));
    if (!t) return;
    if (isNaN(p) || p <= 0 || p > 100) {
      Alert.alert("Invalid %", "Enter a percentage between 0.1 and 100.");
      return;
    }
    await upsertTarget(t, p);
    setAddTicker("");
    setAddPct("");
    setShowAddRow(false);
  }

  async function handleEditSave(ticker: string) {
    const p = parseFloat(editingValue.replace(",", "."));
    if (isNaN(p) || p <= 0 || p > 100) {
      Alert.alert("Invalid %", "Enter a valid percentage.");
      return;
    }
    await upsertTarget(ticker, p);
    setEditingTicker(null);
  }

  function handleRemoveTarget(ticker: string) {
    Alert.alert("Remove Target", `Remove ${ticker} from your target allocations?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => removeTarget(ticker) },
    ]);
  }

  const inputStyle = [styles.input, { backgroundColor: theme.backgroundElevated, borderColor: theme.border, color: theme.text }];
  const labelStyle = [styles.sectionLabel, { color: theme.textSecondary }];

  // ─── Row helpers ──────────────────────────────────────────────────────────

  function Row({ label, children }: { label: string; children: React.ReactNode }) {
    return (
      <View style={[styles.settingRow, { borderBottomColor: theme.border }]}>
        <Text style={[styles.rowLabel, { color: theme.text }]}>{label}</Text>
        {children}
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.background }]}
      contentContainerStyle={[styles.content, { paddingTop: topPad + 12, paddingBottom: bottomPad }]}
      showsVerticalScrollIndicator={false}
    >
      <Text style={[styles.pageTitle, { color: theme.text }]}>Settings</Text>

      {/* ── 1. PORTFOLIO ─────────────────────────────────────────────────── */}
      <Text style={labelStyle}>PORTFOLIO</Text>
      <View style={[styles.section, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}>

        {/* Rebalancing threshold */}
        <View style={[styles.settingBlock, { borderBottomColor: theme.border, borderBottomWidth: 1 }]}>
          <Text style={[styles.rowLabel, { color: theme.text }]}>Rebalancing Threshold</Text>
          <View style={styles.chipRow}>
            {THRESHOLD_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt}
                style={[
                  styles.chip,
                  {
                    backgroundColor: rebalanceThreshold === opt ? theme.deepBlue : theme.backgroundElevated,
                    borderColor: rebalanceThreshold === opt ? theme.tint : theme.border,
                  },
                ]}
                onPress={() => setRebalanceThreshold(opt as ThresholdOption)}
              >
                <Text style={[styles.chipText, { color: rebalanceThreshold === opt ? theme.tint : theme.textSecondary }]}>
                  ±{opt}%
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Default Benchmark */}
        <View style={[styles.settingBlock, { borderBottomColor: theme.border, borderBottomWidth: 1 }]}>
          <Text style={[styles.rowLabel, { color: theme.text }]}>Default Benchmark</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }}>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {BENCHMARKS.map((bm) => (
                <TouchableOpacity
                  key={bm.symbol}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: defaultBenchmark === bm.symbol ? theme.deepBlue : theme.backgroundElevated,
                      borderColor: defaultBenchmark === bm.symbol ? theme.tint : theme.border,
                    },
                  ]}
                  onPress={async () => {
                    setDefaultBenchmark(bm.symbol);
                    await AsyncStorage.setItem(ASYNC_KEYS.defaultBenchmark, bm.symbol);
                  }}
                >
                  <Text style={[styles.chipText, { color: defaultBenchmark === bm.symbol ? theme.tint : theme.textSecondary }]}>
                    {bm.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>

        {/* Target Allocations editor */}
        <View style={styles.settingBlock}>
          <View style={styles.allocationHeader}>
            <View>
              <Text style={[styles.rowLabel, { color: theme.text }]}>Target Allocations</Text>
              <Text style={[styles.allocationSum, { color: sumOk ? theme.positive : theme.negative }]}>
                Sum: {targetsSum.toFixed(1)}%{sumOk ? " ✓" : " — must equal 100%"}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.addBtn, { backgroundColor: theme.tint + "22", borderColor: theme.tint + "44" }]}
              onPress={() => setShowAddRow(true)}
            >
              <Feather name="plus" size={16} color={theme.tint} />
            </TouchableOpacity>
          </View>

          {targets.map((t) => (
            <View key={t.ticker} style={[styles.allocationRow, { borderTopColor: theme.border }]}>
              <Text style={[styles.allocationTicker, { color: theme.text }]}>{t.ticker}</Text>
              {editingTicker === t.ticker ? (
                <View style={styles.editInline}>
                  <TextInput
                    style={[styles.editInput, { backgroundColor: theme.backgroundElevated, borderColor: theme.tint, color: theme.text }]}
                    value={editingValue}
                    onChangeText={setEditingValue}
                    keyboardType="decimal-pad"
                    autoFocus
                  />
                  <Text style={[styles.editPctSign, { color: theme.text }]}>%</Text>
                  <TouchableOpacity onPress={() => handleEditSave(t.ticker)}>
                    <Feather name="check" size={18} color={theme.positive} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setEditingTicker(null)}>
                    <Feather name="x" size={18} color={theme.textTertiary} />
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.allocationActions}>
                  <Text style={[styles.allocationPct, { color: theme.textSecondary }]}>
                    {t.target_pct.toFixed(1)}%
                  </Text>
                  <TouchableOpacity
                    onPress={() => {
                      setEditingTicker(t.ticker);
                      setEditingValue(t.target_pct.toString());
                    }}
                  >
                    <Feather name="edit-2" size={15} color={theme.tint} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => handleRemoveTarget(t.ticker)}>
                    <Feather name="trash-2" size={15} color={theme.negative} />
                  </TouchableOpacity>
                </View>
              )}
            </View>
          ))}

          {showAddRow && (
            <View style={[styles.addRow, { borderTopColor: theme.border }]}>
              <TextInput
                style={[inputStyle, { flex: 1, paddingVertical: 8 }]}
                placeholder="TICKER"
                placeholderTextColor={theme.textTertiary}
                value={addTicker}
                onChangeText={(t) => setAddTicker(t.toUpperCase())}
                autoCapitalize="characters"
              />
              <TextInput
                style={[inputStyle, { width: 70, paddingVertical: 8, textAlign: "right" }]}
                placeholder="0.0"
                placeholderTextColor={theme.textTertiary}
                value={addPct}
                onChangeText={setAddPct}
                keyboardType="decimal-pad"
              />
              <Text style={[styles.addPctSign, { color: theme.text }]}>%</Text>
              <TouchableOpacity onPress={handleAddTarget}>
                <Feather name="check" size={20} color={theme.positive} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { setShowAddRow(false); setAddTicker(""); setAddPct(""); }}>
                <Feather name="x" size={20} color={theme.textTertiary} />
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>

      {/* ── 2. DISPLAY ───────────────────────────────────────────────────── */}
      <Text style={labelStyle}>DISPLAY</Text>
      <View style={[styles.section, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}>
        <Row label="Show Cost Basis">
          <Switch
            value={showCostBasis}
            onValueChange={async (v) => {
              setShowCostBasis(v);
              await persistToggle(ASYNC_KEYS.showCostBasis, v);
            }}
            trackColor={{ false: theme.border, true: theme.tint + "88" }}
            thumbColor={showCostBasis ? theme.tint : theme.textTertiary}
          />
        </Row>
        <Row label="Show Estimated Dividends">
          <Switch
            value={showDividends}
            onValueChange={async (v) => {
              setShowDividends(v);
              await persistToggle(ASYNC_KEYS.showDividends, v);
            }}
            trackColor={{ false: theme.border, true: theme.tint + "88" }}
            thumbColor={showDividends ? theme.tint : theme.textTertiary}
          />
        </Row>
        <View style={[styles.settingRow, { borderBottomColor: "transparent" }]}>
          <Text style={[styles.rowLabel, { color: theme.text }]}>Number Format</Text>
          <Text style={[styles.rowValue, { color: theme.textSecondary }]}>1.234,56 €</Text>
        </View>
      </View>

      {/* ── 3. DATA ──────────────────────────────────────────────────────── */}
      <Text style={labelStyle}>DATA</Text>
      <View style={[styles.section, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}>
        {/* Export CSV */}
        <TouchableOpacity
          style={[styles.dataRow, { borderBottomColor: theme.border }]}
          onPress={handleExportCSV}
        >
          <View style={styles.dataRowLeft}>
            <Feather name="download" size={17} color={theme.tint} />
            <Text style={[styles.rowLabel, { color: theme.text }]}>Export to CSV</Text>
          </View>
          <View style={[styles.premiumPill, { backgroundColor: theme.tint + "22" }]}>
            <Text style={[styles.premiumPillText, { color: theme.tint }]}>Premium</Text>
          </View>
        </TouchableOpacity>

        {/* Refresh All Prices */}
        <TouchableOpacity
          style={[styles.dataRow, { borderBottomColor: theme.border }]}
          onPress={handleRefreshPrices}
          disabled={isRefreshingPrices}
        >
          <View style={styles.dataRowLeft}>
            <Feather name="refresh-cw" size={17} color={theme.tint} />
            <Text style={[styles.rowLabel, { color: theme.text }]}>Refresh All Prices</Text>
          </View>
          {isRefreshingPrices ? (
            <ActivityIndicator size="small" color={theme.tint} />
          ) : refreshDone ? (
            <Feather name="check" size={16} color={theme.positive} />
          ) : (
            <Feather name="chevron-right" size={16} color={theme.textTertiary} />
          )}
        </TouchableOpacity>

        {/* Clear Price Cache */}
        <TouchableOpacity
          style={[styles.dataRow, { borderBottomColor: theme.border }]}
          onPress={handleClearCache}
        >
          <View style={styles.dataRowLeft}>
            <Feather name="trash" size={17} color={theme.negative} />
            <Text style={[styles.rowLabel, { color: theme.negative }]}>Clear Price Cache</Text>
          </View>
          <Feather name="chevron-right" size={16} color={theme.textTertiary} />
        </TouchableOpacity>

        {/* Debug: Test Price Fetch */}
        <TouchableOpacity
          style={[styles.dataRow, { borderBottomColor: "transparent" }]}
          onPress={handleDebugPriceFetch}
        >
          <View style={styles.dataRowLeft}>
            <Feather name="terminal" size={17} color={theme.textSecondary} />
            <Text style={[styles.rowLabel, { color: theme.textSecondary }]}>Test Price Fetch (Debug)</Text>
          </View>
          <Feather name="chevron-right" size={16} color={theme.textTertiary} />
        </TouchableOpacity>
      </View>

      {/* ── 4. PREMIUM ───────────────────────────────────────────────────── */}
      <Text style={labelStyle}>PREMIUM</Text>
      <View style={[styles.section, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}>
        <View style={[styles.premiumBanner, { backgroundColor: theme.deepBlue }]}>
          <View style={styles.premiumBannerLeft}>
            <Text style={styles.premiumBannerTitle}>Fortis — Free Tier</Text>
            <Text style={styles.premiumBannerSub}>{holdingCount} of {FREE_TIER_LIMIT} holdings used</Text>
          </View>
          {!isPremium && (
            <TouchableOpacity
              style={[styles.upgradeBtn, { backgroundColor: theme.tint }]}
              onPress={() => setShowPremium(true)}
            >
              <Text style={styles.upgradeBtnText}>Upgrade</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.featureList}>
          <Text style={[styles.featureListTitle, { color: theme.text }]}>Premium features:</Text>
          {[
            "Unlimited holdings",
            "Benchmark comparison charts",
            "CSV export",
            "Priority support",
          ].map((f) => (
            <View key={f} style={styles.featureItem}>
              <Feather name="check-circle" size={14} color={theme.tint} />
              <Text style={[styles.featureText, { color: theme.textSecondary }]}>{f}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* ── 5. ABOUT ─────────────────────────────────────────────────────── */}
      <Text style={labelStyle}>ABOUT</Text>
      <View style={[styles.section, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}>
        <Row label="Version">
          <Text style={[styles.rowValue, { color: theme.textSecondary }]}>{APP_VERSION}</Text>
        </Row>
        <View style={[styles.settingRow, { borderBottomColor: theme.border }]}>
          <Text style={[styles.rowLabel, { color: theme.text }]}>Built for</Text>
          <Text style={[styles.rowValue, { color: theme.textSecondary }]}>European ETF investors</Text>
        </View>
        <TouchableOpacity
          style={[styles.settingRow, { borderBottomColor: "transparent" }]}
          onPress={() => Linking.openURL("https://fortis.app/privacy")}
        >
          <Text style={[styles.rowLabel, { color: theme.text }]}>Privacy Policy</Text>
          <Feather name="external-link" size={14} color={theme.textTertiary} />
        </TouchableOpacity>
      </View>

      <PremiumModal visible={showPremium} onClose={() => setShowPremium(false)} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 8 },
  pageTitle: { fontSize: 28, fontFamily: "Inter_700Bold", letterSpacing: -0.8, marginBottom: 8 },

  sectionLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
    marginTop: 10,
    marginBottom: 6,
    marginLeft: 4,
  },
  section: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: 4,
  },

  // Setting rows
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  settingBlock: {
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  rowLabel: { fontSize: 14, fontFamily: "Inter_500Medium" },
  rowValue: { fontSize: 14, fontFamily: "Inter_400Regular" },

  // Chips
  chipRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
  },
  chipText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  // Allocation editor
  allocationHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  allocationSum: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 3 },
  addBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  allocationRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderTopWidth: 1,
  },
  allocationTicker: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  allocationActions: { flexDirection: "row", alignItems: "center", gap: 12 },
  allocationPct: { fontSize: 14, fontFamily: "Inter_500Medium", marginRight: 4 },
  editInline: { flexDirection: "row", alignItems: "center", gap: 8 },
  editInput: {
    width: 64,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 5,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "right",
  },
  editPctSign: { fontSize: 14, fontFamily: "Inter_500Medium" },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingTop: 10,
    borderTopWidth: 1,
  },
  addPctSign: { fontSize: 14, fontFamily: "Inter_500Medium" },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },

  // Data rows
  dataRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  dataRowLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  premiumPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  premiumPillText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },

  // Premium banner
  premiumBanner: {
    margin: 12,
    borderRadius: 12,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  premiumBannerLeft: { gap: 3 },
  premiumBannerTitle: { color: "#FFFFFF", fontSize: 14, fontFamily: "Inter_700Bold" },
  premiumBannerSub: { color: "rgba(255,255,255,0.55)", fontSize: 12, fontFamily: "Inter_400Regular" },
  upgradeBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10 },
  upgradeBtnText: { color: "#0A0F1A", fontSize: 13, fontFamily: "Inter_700Bold" },
  featureList: { paddingHorizontal: 16, paddingBottom: 14, gap: 10 },
  featureListTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  featureItem: { flexDirection: "row", alignItems: "center", gap: 10 },
  featureText: { fontSize: 13, fontFamily: "Inter_400Regular" },
});
