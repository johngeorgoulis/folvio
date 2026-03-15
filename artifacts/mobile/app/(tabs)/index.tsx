import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useMemo } from "react";
import {
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
import { Card } from "@/components/ui/Card";
import { ValueDisplay } from "@/components/ui/ValueDisplay";
import { DonutChart, CHART_COLORS } from "@/components/DonutChart";
import { usePortfolio } from "@/context/PortfolioContext";
import {
  formatEUR,
  formatPct,
  currentMonthLabel,
  currentMonthKey,
} from "@/utils/format";

export default function DashboardScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const theme = isDark ? Colors.dark : Colors.light;
  const insets = useSafeAreaInsets();

  const {
    holdings,
    contributions,
    dividends,
    surplusConfig,
    totalPortfolioValue,
    totalInvested,
    totalGain,
    totalGainPct,
  } = usePortfolio();

  const topPad = Platform.OS === "web" ? 24 : insets.top;

  const donutSegments = useMemo(
    () =>
      holdings.map((h, i) => ({
        label: h.name,
        value: h.units * h.currentPrice,
        color: CHART_COLORS[i % CHART_COLORS.length],
      })),
    [holdings],
  );

  const driftAlerts = useMemo(() => {
    return holdings
      .filter((h) => {
        if (!h.targetAllocationPct) return false;
        const actual =
          totalPortfolioValue > 0
            ? (h.units * h.currentPrice / totalPortfolioValue) * 100
            : 0;
        return Math.abs(actual - h.targetAllocationPct) >= 5;
      })
      .map((h) => {
        const actual =
          totalPortfolioValue > 0
            ? (h.units * h.currentPrice / totalPortfolioValue) * 100
            : 0;
        const drift = actual - h.targetAllocationPct;
        return { holding: h, drift };
      });
  }, [holdings, totalPortfolioValue]);

  const thisMonthKey = currentMonthKey();

  const thisMonthDCA = useMemo(
    () =>
      contributions
        .filter((c) => c.date.startsWith(thisMonthKey.replace("-", "-")))
        .reduce((sum, c) => sum + c.unitsPurchased * c.pricePerUnit, 0),
    [contributions, thisMonthKey],
  );

  const ytdDividends = useMemo(() => {
    const year = new Date().getFullYear().toString();
    return dividends
      .filter((d) => d.date.startsWith(year))
      .reduce((sum, d) => sum + d.amountReceived, 0);
  }, [dividends]);

  const investableSurplus =
    surplusConfig.monthlyIncome -
    surplusConfig.fixedCosts.reduce((s, c) => s + c.amount, 0);

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.background }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: topPad + 16, paddingBottom: Platform.OS === "web" ? 100 : 24 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.headerRow}>
        <View>
          <Text style={[styles.greeting, { color: theme.textSecondary }]}>
            {currentMonthLabel()}
          </Text>
          <Text style={[styles.appName, { color: theme.text }]}>Fortis</Text>
        </View>
        <View
          style={[
            styles.logoCircle,
            { backgroundColor: isDark ? "#1E1E1E" : "#F0FDF8" },
          ]}
        >
          <Feather name="trending-up" size={22} color={theme.tint} />
        </View>
      </View>

      <Card style={styles.heroCard} padding={20}>
        <Text style={[styles.heroLabel, { color: theme.textSecondary }]}>
          TOTAL PORTFOLIO
        </Text>
        <Text style={[styles.heroValue, { color: theme.text }]}>
          {formatEUR(totalPortfolioValue)}
        </Text>
        <View style={styles.heroSubRow}>
          <Text
            style={[
              styles.heroGain,
              { color: totalGain >= 0 ? theme.positive : theme.negative },
            ]}
          >
            {totalGain >= 0 ? "+" : ""}
            {formatEUR(totalGain)} ({formatPct(totalGainPct)})
          </Text>
          <Text style={[styles.heroInvested, { color: theme.textSecondary }]}>
            of {formatEUR(totalInvested)} invested
          </Text>
        </View>
      </Card>

      {holdings.length > 0 && (
        <Card padding={20}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>
            Allocation
          </Text>
          <View style={styles.donutRow}>
            <DonutChart
              segments={donutSegments}
              size={150}
              strokeWidth={22}
              centerLabel={formatEUR(totalPortfolioValue, true)}
              centerSublabel={`${holdings.length} holdings`}
            />
            <View style={styles.legend}>
              {holdings.slice(0, 6).map((h, i) => {
                const value = h.units * h.currentPrice;
                const pct =
                  totalPortfolioValue > 0
                    ? (value / totalPortfolioValue) * 100
                    : 0;
                return (
                  <View key={h.id} style={styles.legendItem}>
                    <View
                      style={[
                        styles.legendDot,
                        { backgroundColor: CHART_COLORS[i % CHART_COLORS.length] },
                      ]}
                    />
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[styles.legendName, { color: theme.text }]}
                        numberOfLines={1}
                      >
                        {h.name}
                      </Text>
                      <Text
                        style={[styles.legendPct, { color: theme.textSecondary }]}
                      >
                        {pct.toFixed(1)}%
                        {h.targetAllocationPct > 0 &&
                          ` / ${h.targetAllocationPct}%`}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        </Card>
      )}

      {driftAlerts.length > 0 && (
        <View style={styles.alertsSection}>
          {driftAlerts.map(({ holding, drift }) => (
            <View
              key={holding.id}
              style={[
                styles.alertCard,
                { backgroundColor: isDark ? "#1A1208" : "#FFF8F0", borderColor: "#FF9F0A33" },
              ]}
            >
              <Feather name="alert-triangle" size={14} color={theme.warning} />
              <Text style={[styles.alertText, { color: theme.text }]}>
                <Text style={{ fontFamily: "Inter_600SemiBold" }}>{holding.name}</Text>
                {drift < 0
                  ? ` is ${Math.abs(drift).toFixed(1)}% below target — consider buying`
                  : ` is ${drift.toFixed(1)}% above target`}
              </Text>
            </View>
          ))}
        </View>
      )}

      <View style={styles.statsGrid}>
        <Card style={{ flex: 1 }} padding={16}>
          <ValueDisplay
            label="DCA This Month"
            value={formatEUR(thisMonthDCA, true)}
            size="md"
          />
        </Card>
        <Card style={{ flex: 1 }} padding={16}>
          <ValueDisplay
            label="Dividends YTD"
            value={formatEUR(ytdDividends, true)}
            size="md"
          />
        </Card>
      </View>

      {investableSurplus > 0 && (
        <Card padding={16}>
          <View style={styles.surplusRow}>
            <View>
              <Text style={[styles.surplusLabel, { color: theme.textSecondary }]}>
                INVESTABLE SURPLUS
              </Text>
              <Text style={[styles.surplusValue, { color: theme.positive }]}>
                {formatEUR(investableSurplus)}
              </Text>
              <Text style={[styles.surplusHint, { color: theme.textSecondary }]}>
                available to invest this month
              </Text>
            </View>
            <View
              style={[
                styles.surplusIcon,
                { backgroundColor: "rgba(0, 208, 132, 0.12)" },
              ]}
            >
              <Feather name="dollar-sign" size={20} color={theme.positive} />
            </View>
          </View>
        </Card>
      )}

      {holdings.length === 0 && (
        <View style={[styles.emptyHero, { backgroundColor: isDark ? "#161616" : "#F0FDF8", borderColor: "rgba(0,208,132,0.2)" }]}>
          <Feather name="trending-up" size={32} color={theme.tint} />
          <Text style={[styles.emptyTitle, { color: theme.text }]}>
            Welcome to Fortis
          </Text>
          <Text style={[styles.emptySubtitle, { color: theme.textSecondary }]}>
            Add your first holding in the Portfolio tab to get started tracking your European ETF portfolio.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 12 },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  greeting: { fontSize: 12, fontFamily: "Inter_500Medium", letterSpacing: 0.3 },
  appName: { fontSize: 28, fontFamily: "Inter_700Bold", letterSpacing: -1 },
  logoCircle: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  heroCard: {},
  heroLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  heroValue: {
    fontSize: 38,
    fontFamily: "Inter_700Bold",
    letterSpacing: -1.5,
  },
  heroSubRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" },
  heroGain: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  heroInvested: { fontSize: 13, fontFamily: "Inter_400Regular" },
  sectionTitle: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    marginBottom: 16,
  },
  donutRow: { flexDirection: "row", alignItems: "center", gap: 20 },
  legend: { flex: 1, gap: 8 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 8 },
  legendDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  legendName: { fontSize: 12, fontFamily: "Inter_500Medium" },
  legendPct: { fontSize: 11, fontFamily: "Inter_400Regular" },
  alertsSection: { gap: 8 },
  alertCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  alertText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1, lineHeight: 18 },
  statsGrid: { flexDirection: "row", gap: 12 },
  surplusRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  surplusLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.8 },
  surplusValue: { fontSize: 24, fontFamily: "Inter_700Bold", letterSpacing: -0.5, marginTop: 4 },
  surplusHint: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  surplusIcon: { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  emptyHero: {
    alignItems: "center",
    padding: 32,
    borderRadius: 16,
    borderWidth: 1,
    gap: 12,
    marginTop: 8,
  },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_700Bold", textAlign: "center" },
  emptySubtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 20,
  },
});
