import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
  useColorScheme,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { usePortfolio, FREE_TIER_LIMIT } from "@/context/PortfolioContext";
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
  const [showCostBasis, setShowCostBasis] = useState(true);
  const [showPremium, setShowPremium] = useState(false);

  function handleExportCSV() {
    Alert.alert("Export CSV", "CSV export is a Premium feature. Upgrade to Fortis Premium to export your portfolio data.", [
      { text: "Maybe Later", style: "cancel" },
      { text: "Upgrade", onPress: () => setShowPremium(true) },
    ]);
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.background }]}
      contentContainerStyle={[styles.content, { paddingTop: topPad + 12, paddingBottom: bottomPad }]}
      showsVerticalScrollIndicator={false}
    >
      <Text style={[styles.pageTitle, { color: theme.text }]}>Settings</Text>

      <View style={[styles.premiumBanner, { backgroundColor: theme.deepBlue }]}>
        <View>
          <Text style={styles.premiumTitle}>Fortis — Free Tier</Text>
          <Text style={styles.premiumSubtitle}>
            {holdingCount} of {FREE_TIER_LIMIT} holdings used
          </Text>
        </View>
        <TouchableOpacity
          style={styles.upgradeBtn}
          onPress={() => setShowPremium(true)}
        >
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
          ].map((item, i) => (
            <View key={item.label} style={styles.summaryItem}>
              <Text style={[styles.summaryLabel, { color: theme.textSecondary }]}>{item.label}</Text>
              <Text style={[styles.summaryValue, { color: theme.text }]}>{item.value}</Text>
            </View>
          ))}
        </View>
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
            <Text style={[styles.settingDesc, { color: theme.textSecondary }]}>
              EUR only in v1
            </Text>
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
        Prices are manually entered. Not financial advice.
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
  upgradeBtn: {
    backgroundColor: "#C9A84C",
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 10,
  },
  upgradeBtnText: { color: "#0A0F1A", fontSize: 13, fontFamily: "Inter_700Bold" },
  section: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    gap: 0,
  },
  sectionHeader: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
    marginBottom: 14,
  },
  summaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
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
  divider: { height: 1, marginVertical: 6 },
  currencyBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
  },
  currencyText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 4,
  },
  actionLabel: { fontSize: 14, fontFamily: "Inter_500Medium" },
  actionDesc: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  premiumTag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  premiumTagText: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  footer: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 18,
    marginTop: 4,
    marginBottom: 8,
  },
});
