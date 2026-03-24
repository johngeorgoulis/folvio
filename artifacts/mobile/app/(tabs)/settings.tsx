import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  ActivityIndicator,
  Linking,
  Modal,
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
import {
  NOTIF_KEY,
  checkPermissionStatus,
  requestNotificationPermission,
  toggleDCAReminder,
  toggleDriftAlert,
  toggleWeeklySummary,
} from "@/services/notificationService";

const APP_VERSION = "1.0.0";

const BENCHMARKS = [
  { label: "S&P 500",        symbol: "^GSPC" },
  { label: "MSCI World",     symbol: "URTH" },
  { label: "Euro Stoxx 50",  symbol: "^STOXX50E" },
  { label: "FTSE All-World", symbol: "VWRL.L" },
  { label: "DAX",            symbol: "^GDAXI" },
] as const;
type BenchmarkSymbol = typeof BENCHMARKS[number]["symbol"];

const ASYNC_KEYS = {
  showCostBasis: "folvio_show_cost_basis",
  showDividends: "folvio_show_dividends",
  defaultBenchmark: "folvio_default_benchmark",
  isPremium: "folvio_is_premium",
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

  // ── Notification state ────────────────────────────────────────────────────
  const [notifPermission, setNotifPermission] = useState<"granted" | "denied" | "undetermined">("undetermined");
  const [dcaNotifEnabled, setDcaNotifEnabled] = useState(true);
  const [driftNotifEnabled, setDriftNotifEnabled] = useState(true);
  const [weeklyNotifEnabled, setWeeklyNotifEnabled] = useState(true);
  const [dcaDay, setDcaDay] = useState<number | null>(null);
  const [dcaAmount, setDcaAmount] = useState<number>(0);
  const [showDcaDayPicker, setShowDcaDayPicker] = useState(false);

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
      const [cb, sd, bm, ip, dcaE, driftE, weeklyE, dcaDayStr, dcaAmtStr] = await Promise.all([
        AsyncStorage.getItem(ASYNC_KEYS.showCostBasis),
        AsyncStorage.getItem(ASYNC_KEYS.showDividends),
        AsyncStorage.getItem(ASYNC_KEYS.defaultBenchmark),
        AsyncStorage.getItem(ASYNC_KEYS.isPremium),
        AsyncStorage.getItem(NOTIF_KEY.DCA_ENABLED),
        AsyncStorage.getItem(NOTIF_KEY.DRIFT_ENABLED),
        AsyncStorage.getItem(NOTIF_KEY.WEEKLY_ENABLED),
        AsyncStorage.getItem(NOTIF_KEY.DCA_DAY),
        AsyncStorage.getItem(NOTIF_KEY.DCA_AMOUNT),
      ]);
      if (cb !== null) setShowCostBasis(cb === "true");
      if (sd !== null) setShowDividends(sd === "true");
      if (bm !== null) {
        const validSymbols: string[] = BENCHMARKS.map((b) => b.symbol);
        if (validSymbols.includes(bm)) setDefaultBenchmark(bm as BenchmarkSymbol);
      }
      if (ip !== null) setIsPremium(ip === "true");

      // Notification preferences (default: all ON)
      if (dcaE !== null) setDcaNotifEnabled(dcaE === "true");
      if (driftE !== null) setDriftNotifEnabled(driftE === "true");
      if (weeklyE !== null) setWeeklyNotifEnabled(weeklyE === "true");
      if (dcaDayStr !== null) setDcaDay(parseInt(dcaDayStr, 10));
      if (dcaAmtStr !== null) setDcaAmount(parseFloat(dcaAmtStr) || 0);

      // Check actual permission status
      if (Platform.OS !== "web") {
        const perm = await checkPermissionStatus();
        setNotifPermission(perm);
      }

      setSettingsLoaded(true);
    })();
  }, []);

  async function persistToggle(key: string, val: boolean) {
    await AsyncStorage.setItem(key, val ? "true" : "false");
  }

  // ── Notification handlers ─────────────────────────────────────────────────

  async function ensurePermissionForToggle(): Promise<boolean> {
    if (Platform.OS === "web") return false;
    if (notifPermission === "granted") return true;
    if (notifPermission === "denied") {
      Alert.alert(
        "Notifications Disabled",
        "To receive notifications, please enable them in your device Settings.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Open Settings", onPress: () => Linking.openSettings() },
        ]
      );
      return false;
    }
    const granted = await requestNotificationPermission();
    const status = await checkPermissionStatus();
    setNotifPermission(status as any);
    return granted;
  }

  async function handleDcaNotifToggle(val: boolean) {
    if (val) {
      const ok = await ensurePermissionForToggle();
      if (!ok) return;
    }
    setDcaNotifEnabled(val);
    await AsyncStorage.setItem(NOTIF_KEY.DCA_ENABLED, val ? "true" : "false");
    if (val && !dcaDay) {
      // Prompt user to set a DCA day if none configured
      setShowDcaDayPicker(true);
      return;
    }
    await toggleDCAReminder(val, dcaDay ?? 10, dcaAmount);
  }

  async function handleDriftNotifToggle(val: boolean) {
    if (val) {
      const ok = await ensurePermissionForToggle();
      if (!ok) return;
    }
    setDriftNotifEnabled(val);
    await AsyncStorage.setItem(NOTIF_KEY.DRIFT_ENABLED, val ? "true" : "false");
    await toggleDriftAlert(val);
  }

  async function handleWeeklyNotifToggle(val: boolean) {
    if (val) {
      const ok = await ensurePermissionForToggle();
      if (!ok) return;
    }
    setWeeklyNotifEnabled(val);
    await AsyncStorage.setItem(NOTIF_KEY.WEEKLY_ENABLED, val ? "true" : "false");
    await toggleWeeklySummary(val);
  }

  async function handleDcaDaySelect(day: number) {
    setDcaDay(day);
    setShowDcaDayPicker(false);
    await AsyncStorage.setItem(NOTIF_KEY.DCA_DAY, String(day));

    if (dcaNotifEnabled && notifPermission === "granted") {
      await toggleDCAReminder(true, day, dcaAmount);

      // Compute the actual notification day (5 days before DCA day)
      let notifDay = day - 5;
      if (notifDay <= 0) notifDay = 28 + notifDay;
      notifDay = Math.max(1, Math.min(28, notifDay));

      Alert.alert(
        "DCA Reminder Updated",
        `You'll be notified on the ${ordinalSuffix(notifDay)} of each month at 9:00 AM.`
      );
    }
  }

  function ordinalSuffix(n: number): string {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
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

  function handleExportCSV() {
    if (!isPremium) {
      Alert.alert(
        "Premium Feature",
        "CSV export is available on Folvio Premium.",
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

      {/* ── 3. NOTIFICATIONS ─────────────────────────────────────────────── */}
      <Text style={labelStyle}>NOTIFICATIONS</Text>

      {/* Permission denied banner */}
      {notifPermission === "denied" && Platform.OS !== "web" && (
        <View style={[styles.permDeniedBanner, { backgroundColor: theme.backgroundElevated, borderColor: theme.border }]}>
          <Feather name="bell-off" size={15} color={theme.textSecondary} style={{ marginRight: 8 }} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.permDeniedText, { color: theme.textSecondary }]}>
              Notifications are disabled. Enable them in your device settings to receive DCA reminders and portfolio alerts.
            </Text>
            <TouchableOpacity onPress={() => Linking.openSettings()}>
              <Text style={[styles.permDeniedLink, { color: theme.tint }]}>Open Settings →</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <View style={[styles.section, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}>

        {/* DCA Reminder */}
        <View style={[styles.notifRow, { borderBottomColor: theme.border }]}>
          <View style={styles.notifRowLeft}>
            <Text style={[styles.notifRowTitle, { color: theme.text }]}>DCA Reminder</Text>
            <Text style={[styles.notifRowSub, { color: theme.textSecondary }]}>
              5 days before your DCA date
            </Text>
          </View>
          <Switch
            value={dcaNotifEnabled && notifPermission !== "denied"}
            onValueChange={handleDcaNotifToggle}
            trackColor={{ false: theme.border, true: theme.tint + "88" }}
            thumbColor={dcaNotifEnabled ? theme.tint : theme.textTertiary}
          />
        </View>

        {/* Drift Alert */}
        <View style={[styles.notifRow, { borderBottomColor: theme.border }]}>
          <View style={styles.notifRowLeft}>
            <Text style={[styles.notifRowTitle, { color: theme.text }]}>Drift Alert</Text>
            <Text style={[styles.notifRowSub, { color: theme.textSecondary }]}>
              When a holding exceeds ±{rebalanceThreshold}% drift
            </Text>
          </View>
          <Switch
            value={driftNotifEnabled && notifPermission !== "denied"}
            onValueChange={handleDriftNotifToggle}
            trackColor={{ false: theme.border, true: theme.tint + "88" }}
            thumbColor={driftNotifEnabled ? theme.tint : theme.textTertiary}
          />
        </View>

        {/* Weekly Summary */}
        <View style={[styles.notifRow, { borderBottomColor: theme.border }]}>
          <View style={styles.notifRowLeft}>
            <Text style={[styles.notifRowTitle, { color: theme.text }]}>Weekly Summary</Text>
            <Text style={[styles.notifRowSub, { color: theme.textSecondary }]}>
              Every Monday at 9:00 AM
            </Text>
          </View>
          <Switch
            value={weeklyNotifEnabled && notifPermission !== "denied"}
            onValueChange={handleWeeklyNotifToggle}
            trackColor={{ false: theme.border, true: theme.tint + "88" }}
            thumbColor={weeklyNotifEnabled ? theme.tint : theme.textTertiary}
          />
        </View>

        {/* DCA Date */}
        <TouchableOpacity
          style={[styles.notifRow, { borderBottomColor: "transparent" }]}
          onPress={() => setShowDcaDayPicker(true)}
        >
          <View style={styles.notifRowLeft}>
            <Text style={[styles.notifRowTitle, { color: theme.text }]}>DCA Date</Text>
            <Text style={[styles.notifRowSub, { color: theme.textSecondary }]}>
              {dcaDay ? `${ordinalSuffix(dcaDay)} of each month` : "Tap to set your investment day"}
            </Text>
          </View>
          <View style={styles.dcaDayBadge}>
            <Text style={[styles.dcaDayBadgeText, { color: theme.tint }]}>
              {dcaDay ? ordinalSuffix(dcaDay) : "Set"}
            </Text>
            <Feather name="chevron-right" size={14} color={theme.textTertiary} style={{ marginLeft: 4 }} />
          </View>
        </TouchableOpacity>
      </View>

      {/* DCA Day Picker Modal */}
      <Modal
        visible={showDcaDayPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDcaDayPicker(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Select Your DCA Day</Text>
            <Text style={[styles.modalSub, { color: theme.textSecondary }]}>
              Which day of the month do you invest?
            </Text>
            <ScrollView style={styles.dayGrid} showsVerticalScrollIndicator={false}>
              <View style={styles.dayGridInner}>
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                  <TouchableOpacity
                    key={d}
                    style={[
                      styles.dayCell,
                      {
                        backgroundColor: dcaDay === d ? theme.deepBlue : theme.backgroundElevated,
                        borderColor: dcaDay === d ? theme.tint : theme.border,
                      },
                    ]}
                    onPress={() => handleDcaDaySelect(d)}
                  >
                    <Text style={[styles.dayCellText, { color: dcaDay === d ? theme.tint : theme.text }]}>
                      {d}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
            <TouchableOpacity
              style={[styles.modalCancel, { borderColor: theme.border }]}
              onPress={() => setShowDcaDayPicker(false)}
            >
              <Text style={[styles.modalCancelText, { color: theme.textSecondary }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── 4. DATA ──────────────────────────────────────────────────────── */}
      <Text style={labelStyle}>DATA</Text>
      <View style={[styles.section, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}>
        {/* Import from CSV */}
        <TouchableOpacity
          style={[styles.dataRow, { borderBottomColor: theme.border }]}
          onPress={() => router.push("/import" as never)}
        >
          <View style={styles.dataRowLeft}>
            <Feather name="upload" size={17} color={theme.tint} />
            <Text style={[styles.rowLabel, { color: theme.text }]}>Import from CSV</Text>
          </View>
          <View style={[styles.premiumPill, { backgroundColor: theme.tint + "22" }]}>
            <Text style={[styles.premiumPillText, { color: theme.tint }]}>Premium</Text>
          </View>
        </TouchableOpacity>

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
          style={[styles.dataRow, { borderBottomColor: "transparent" }]}
          onPress={handleClearCache}
        >
          <View style={styles.dataRowLeft}>
            <Feather name="trash" size={17} color={theme.negative} />
            <Text style={[styles.rowLabel, { color: theme.negative }]}>Clear Price Cache</Text>
          </View>
          <Feather name="chevron-right" size={16} color={theme.textTertiary} />
        </TouchableOpacity>

      </View>

      {/* ── 4. PREMIUM ───────────────────────────────────────────────────── */}
      <Text style={labelStyle}>PREMIUM</Text>
      <View style={[styles.section, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}>
        <View style={[styles.premiumBanner, { backgroundColor: theme.deepBlue }]}>
          <View style={styles.premiumBannerLeft}>
            <Text style={styles.premiumBannerTitle}>Folvio — Free Tier</Text>
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
          onPress={() => Linking.openURL("https://folvio.app/privacy")}
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

  // Notification rows
  notifRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: 1,
  },
  notifRowLeft: { flex: 1, marginRight: 12 },
  notifRowTitle: { fontSize: 14, fontFamily: "Inter_500Medium" },
  notifRowSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  dcaDayBadge: { flexDirection: "row", alignItems: "center" },
  dcaDayBadgeText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  // Permission denied banner
  permDeniedBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginBottom: 4,
  },
  permDeniedText: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  permDeniedLink: { fontSize: 12, fontFamily: "Inter_600SemiBold", marginTop: 6 },

  // DCA Day picker modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalCard: {
    width: "100%",
    maxHeight: "75%",
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
  },
  modalTitle: { fontSize: 17, fontFamily: "Inter_700Bold", marginBottom: 4 },
  modalSub: { fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 16 },
  dayGrid: { maxHeight: 240 },
  dayGridInner: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  dayCell: {
    width: 52,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  dayCellText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  modalCancel: {
    marginTop: 16,
    borderTopWidth: 1,
    paddingTop: 14,
    alignItems: "center",
  },
  modalCancelText: { fontSize: 14, fontFamily: "Inter_500Medium" },
});
