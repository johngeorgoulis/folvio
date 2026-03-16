import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useColorScheme,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { usePortfolio, FREE_TIER_LIMIT } from "@/context/PortfolioContext";
import { useAllocation, THRESHOLD_OPTIONS, type ThresholdOption } from "@/context/AllocationContext";
import { formatEUR } from "@/utils/format";
import PremiumModal from "@/components/PremiumModal";

const APP_VERSION = "1.0.0";

export default function SettingsScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const theme = isDark ? Colors.dark : Colors.light;
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 24 : insets.top;
  const bottomPad = Platform.OS === "web" ? 80 : insets.bottom + 80;

  const { holdings, holdingCount, totalPortfolioValue, totalInvested } = usePortfolio();
  const {
    targets,
    rebalanceThreshold,
    setRebalanceThreshold,
    upsertTarget,
    removeTarget,
  } = useAllocation();

  const [showCostBasis, setShowCostBasis] = useState(true);
  const [showPremium, setShowPremium] = useState(false);

  const [editingTicker, setEditingTicker] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [addTicker, setAddTicker] = useState("");
  const [addPct, setAddPct] = useState("");
  const [showAddRow, setShowAddRow] = useState(false);

  const targetsSum = targets.reduce((s, t) => s + t.target_pct, 0);
  const sumOk = Math.abs(targetsSum - 100) < 0.01;

  function handleExportCSV() {
    Alert.alert(
      "Export CSV",
      "CSV export is a Premium feature. Upgrade to Fortis Premium to export your portfolio data.",
      [
        { text: "Maybe Later", style: "cancel" },
        { text: "Upgrade", onPress: () => setShowPremium(true) },
      ]
    );
  }

  async function handleSaveEdit(ticker: string) {
    const val = parseFloat(editingValue.replace(",", "."));
    if (isNaN(val) || val < 0 || val > 100) {
      Alert.alert("Invalid value", "Enter a number between 0 and 100.");
      return;
    }
    await upsertTarget(ticker, Math.round(val * 100) / 100);
    setEditingTicker(null);
    setEditingValue("");
  }

  async function handleRemove(ticker: string) {
    Alert.alert("Remove Target", `Remove target allocation for ${ticker}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => removeTarget(ticker),
      },
    ]);
  }

  async function handleAddTarget() {
    const t = addTicker.trim().toUpperCase();
    const p = parseFloat(addPct.replace(",", "."));
    if (!t) {
      Alert.alert("Invalid ticker", "Enter a ticker symbol.");
      return;
    }
    if (isNaN(p) || p < 0 || p > 100) {
      Alert.alert("Invalid percentage", "Enter a number between 0 and 100.");
      return;
    }
    if (targets.find((x) => x.ticker === t)) {
      Alert.alert("Duplicate", `${t} already has a target. Edit it below.`);
      return;
    }
    await upsertTarget(t, Math.round(p * 100) / 100);
    setAddTicker("");
    setAddPct("");
    setShowAddRow(false);
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.background }]}
      contentContainerStyle={[styles.content, { paddingTop: topPad + 12, paddingBottom: bottomPad }]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.pageTitle, { color: theme.text }]}>Settings</Text>

      <View style={[styles.premiumBanner, { backgroundColor: theme.deepBlue }]}>
        <View>
          <Text style={styles.premiumTitle}>Fortis — Free Tier</Text>
          <Text style={styles.premiumSubtitle}>
            {holdingCount} of {FREE_TIER_LIMIT} holdings used
          </Text>
        </View>
        <TouchableOpacity style={styles.upgradeBtn} onPress={() => setShowPremium(true)}>
          <Text style={styles.upgradeBtnText}>Upgrade</Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.section, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}>
        <Text style={[styles.sectionHeader, { color: theme.textSecondary }]}>PORTFOLIO SUMMARY</Text>
        <View style={styles.summaryGrid}>
          {[
            { label: "Holdings", value: holdingCount.toString() },
            { label: "Currency", value: "EUR" },
            { label: "Market Value", value: formatEUR(totalPortfolioValue, true) },
            { label: "Total Invested", value: formatEUR(totalInvested, true) },
          ].map((item) => (
            <View key={item.label} style={styles.summaryItem}>
              <Text style={[styles.summaryLabel, { color: theme.textSecondary }]}>{item.label}</Text>
              <Text style={[styles.summaryValue, { color: theme.text }]}>{item.value}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={[styles.section, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}>
        <Text style={[styles.sectionHeader, { color: theme.textSecondary }]}>REBALANCING</Text>

        <View style={styles.settingRow}>
          <Text style={[styles.settingLabel, { color: theme.text }]}>Drift Threshold</Text>
        </View>
        <View style={styles.thresholdRow}>
          {THRESHOLD_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt}
              style={[
                styles.thresholdBtn,
                {
                  backgroundColor: rebalanceThreshold === opt ? theme.tint + "22" : theme.backgroundElevated,
                  borderColor: rebalanceThreshold === opt ? theme.tint : theme.border,
                },
              ]}
              onPress={() => setRebalanceThreshold(opt)}
            >
              <Text
                style={[
                  styles.thresholdBtnText,
                  { color: rebalanceThreshold === opt ? theme.tint : theme.textSecondary },
                ]}
              >
                ±{opt}%
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={[styles.divider, { backgroundColor: theme.border }]} />

        <View style={styles.targetsHeader}>
          <View>
            <Text style={[styles.settingLabel, { color: theme.text }]}>Target Allocations</Text>
            <Text style={[styles.settingDesc, { color: sumOk ? theme.positive : "#F87171" }]}>
              Sum: {targetsSum.toFixed(1)}% {sumOk ? "✓" : "— must equal 100%"}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => setShowAddRow((v) => !v)}
            style={[styles.addTargetBtn, { borderColor: theme.tint }]}
          >
            <Feather name={showAddRow ? "x" : "plus"} size={15} color={theme.tint} />
          </TouchableOpacity>
        </View>

        {showAddRow && (
          <View style={[styles.addRow, { backgroundColor: theme.backgroundElevated, borderColor: theme.border }]}>
            <TextInput
              style={[styles.addTickerInput, { color: theme.text, borderColor: theme.border }]}
              placeholder="TICKER"
              placeholderTextColor={theme.textTertiary}
              value={addTicker}
              onChangeText={setAddTicker}
              autoCapitalize="characters"
              maxLength={10}
            />
            <TextInput
              style={[styles.addPctInput, { color: theme.text, borderColor: theme.border }]}
              placeholder="%"
              placeholderTextColor={theme.textTertiary}
              value={addPct}
              onChangeText={setAddPct}
              keyboardType="decimal-pad"
              maxLength={5}
            />
            <TouchableOpacity
              style={[styles.addConfirmBtn, { backgroundColor: theme.tint }]}
              onPress={handleAddTarget}
            >
              <Text style={styles.addConfirmText}>Add</Text>
            </TouchableOpacity>
          </View>
        )}

        {targets.map((t, i) => (
          <View key={t.ticker}>
            {i > 0 && <View style={[styles.divider, { backgroundColor: theme.border }]} />}
            <View style={styles.targetRow}>
              <Text style={[styles.targetTicker, { color: theme.text }]}>{t.ticker}</Text>
              {editingTicker === t.ticker ? (
                <View style={styles.editGroup}>
                  <TextInput
                    style={[styles.targetEditInput, { color: theme.text, borderColor: theme.tint }]}
                    value={editingValue}
                    onChangeText={setEditingValue}
                    keyboardType="decimal-pad"
                    autoFocus
                    maxLength={5}
                  />
                  <Text style={[styles.pctLabel, { color: theme.textSecondary }]}>%</Text>
                  <TouchableOpacity onPress={() => handleSaveEdit(t.ticker)} style={styles.editIconBtn}>
                    <Feather name="check" size={16} color="#34D399" />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setEditingTicker(null)} style={styles.editIconBtn}>
                    <Feather name="x" size={16} color={theme.textSecondary} />
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.editGroup}>
                  <Text style={[styles.targetPct, { color: theme.text }]}>{t.target_pct.toFixed(1)}%</Text>
                  <TouchableOpacity
                    onPress={() => { setEditingTicker(t.ticker); setEditingValue(String(t.target_pct)); }}
                    style={styles.editIconBtn}
                  >
                    <Feather name="edit-2" size={14} color={theme.tint} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => handleRemove(t.ticker)} style={styles.editIconBtn}>
                    <Feather name="trash-2" size={14} color={theme.negative} />
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </View>
        ))}

        {targets.length === 0 && (
          <Text style={[styles.emptyTargets, { color: theme.textSecondary }]}>
            No targets set. Add tickers above to start tracking allocations.
          </Text>
        )}
      </View>

      <View style={[styles.section, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}>
        <Text style={[styles.sectionHeader, { color: theme.textSecondary }]}>DISPLAY</Text>
        <View style={styles.settingRow}>
          <View>
            <Text style={[styles.settingLabel, { color: theme.text }]}>Show Cost Basis</Text>
            <Text style={[styles.settingDesc, { color: theme.textSecondary }]}>
              Display avg cost in Holdings view
            </Text>
          </View>
          <Switch
            value={showCostBasis}
            onValueChange={setShowCostBasis}
            trackColor={{ false: theme.border, true: theme.tint }}
            thumbColor="#FFFFFF"
          />
        </View>
        <View style={[styles.divider, { backgroundColor: theme.border }]} />
        <View style={styles.settingRow}>
          <View>
            <Text style={[styles.settingLabel, { color: theme.text }]}>Base Currency</Text>
            <Text style={[styles.settingDesc, { color: theme.textSecondary }]}>EUR only in v1</Text>
          </View>
          <View style={[styles.currencyBadge, { backgroundColor: theme.deepBlue + "33", borderColor: theme.deepBlue }]}>
            <Text style={[styles.currencyText, { color: theme.tint }]}>€ EUR</Text>
          </View>
        </View>
      </View>

      <View style={[styles.section, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}>
        <Text style={[styles.sectionHeader, { color: theme.textSecondary }]}>DATA</Text>
        <TouchableOpacity style={styles.actionRow} onPress={handleExportCSV}>
          <Feather name="download" size={18} color={theme.tint} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.actionLabel, { color: theme.text }]}>Export to CSV</Text>
            <Text style={[styles.actionDesc, { color: theme.textSecondary }]}>Premium feature</Text>
          </View>
          <View style={[styles.premiumTag, { backgroundColor: theme.tint + "22" }]}>
            <Text style={[styles.premiumTagText, { color: theme.tint }]}>PRO</Text>
          </View>
          <Feather name="chevron-right" size={16} color={theme.textTertiary} />
        </TouchableOpacity>
      </View>

      <View style={[styles.section, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}>
        <Text style={[styles.sectionHeader, { color: theme.textSecondary }]}>ABOUT</Text>
        <View style={styles.settingRow}>
          <Text style={[styles.settingLabel, { color: theme.text }]}>Version</Text>
          <Text style={[styles.settingValue, { color: theme.textSecondary }]}>{APP_VERSION}</Text>
        </View>
        <View style={[styles.divider, { backgroundColor: theme.border }]} />
        <View style={styles.settingRow}>
          <Text style={[styles.settingLabel, { color: theme.text }]}>Positioning</Text>
          <Text style={[styles.settingValue, { color: theme.textSecondary }]}>EU ETF</Text>
        </View>
      </View>

      <Text style={[styles.footer, { color: theme.textTertiary }]}>
        Fortis — Built for European passive investors.{"\n"}
        Prices via Yahoo Finance. Not financial advice.
      </Text>

      <PremiumModal visible={showPremium} onClose={() => setShowPremium(false)} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 14 },
  pageTitle: { fontSize: 28, fontFamily: "Inter_700Bold", letterSpacing: -0.8, marginBottom: 2 },
  premiumBanner: {
    borderRadius: 16,
    padding: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  premiumTitle: { color: "#FFFFFF", fontSize: 16, fontFamily: "Inter_700Bold" },
  premiumSubtitle: { color: "rgba(255,255,255,0.6)", fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 3 },
  upgradeBtn: { backgroundColor: "#C9A84C", paddingHorizontal: 16, paddingVertical: 9, borderRadius: 10 },
  upgradeBtnText: { color: "#0A0F1A", fontSize: 13, fontFamily: "Inter_700Bold" },
  section: { borderRadius: 16, padding: 16, borderWidth: 1 },
  sectionHeader: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.8, marginBottom: 14 },
  summaryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  summaryItem: { width: "47%" },
  summaryLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
  summaryValue: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginTop: 3 },
  settingRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
  },
  settingLabel: { fontSize: 14, fontFamily: "Inter_500Medium" },
  settingDesc: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  settingValue: { fontSize: 14, fontFamily: "Inter_400Regular" },
  divider: { height: 1, marginVertical: 8 },
  currencyBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1 },
  currencyText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  actionRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 4 },
  actionLabel: { fontSize: 14, fontFamily: "Inter_500Medium" },
  actionDesc: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  premiumTag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  premiumTagText: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  footer: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 18,
    marginTop: 4,
    marginBottom: 8,
  },
  thresholdRow: { flexDirection: "row", gap: 8, marginTop: 6, marginBottom: 4 },
  thresholdBtn: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 10,
    alignItems: "center",
  },
  thresholdBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  targetsHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginTop: 4,
  },
  addTargetBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 8,
    marginBottom: 4,
  },
  addTickerInput: {
    flex: 2,
    height: 38,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  addPctInput: {
    flex: 1,
    height: 38,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
  addConfirmBtn: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
  },
  addConfirmText: { fontSize: 13, fontFamily: "Inter_700Bold", color: "#0A0F1A" },
  targetRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 8,
  },
  targetTicker: { fontSize: 14, fontFamily: "Inter_600SemiBold", flex: 1 },
  editGroup: { flexDirection: "row", alignItems: "center", gap: 6 },
  targetPct: { fontSize: 14, fontFamily: "Inter_500Medium", minWidth: 44, textAlign: "right" },
  targetEditInput: {
    width: 60,
    height: 34,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    textAlign: "right",
  },
  pctLabel: { fontSize: 14, fontFamily: "Inter_400Regular" },
  editIconBtn: { padding: 4 },
  emptyTargets: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
    marginTop: 4,
    paddingVertical: 8,
  },
});
