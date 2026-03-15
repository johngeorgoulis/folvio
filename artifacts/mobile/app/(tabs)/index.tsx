import { Feather } from "@expo/vector-icons";
import React, { useMemo } from "react";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { usePortfolio } from "@/context/PortfolioContext";
import { formatEUR, formatPct, currentMonthLabel } from "@/utils/format";
import { DonutChart, CHART_COLORS } from "@/components/DonutChart";

export default function DashboardScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const theme = isDark ? Colors.dark : Colors.light;
  const insets = useSafeAreaInsets();

  const {
    holdings,
    isLoading,
    totalPortfolioValue,
    totalInvested,
    totalGain,
    totalGainPct,
  } = usePortfolio();

  const topPad = Platform.OS === "web" ? 24 : insets.top;
  const bottomPad = Platform.OS === "web" ? 80 : insets.bottom + 80;

  const donutSegments = useMemo(
    () =>
      holdings.map((h, i) => ({
        label: h.ticker,
        value: h.quantity * h.currentPrice,
        color: CHART_COLORS[i % CHART_COLORS.length],
      })),
    [holdings]
  );

  const dailyGainColor = totalGain >= 0 ? theme.positive : theme.negative;

  if (isLoading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: theme.background }]}>
        <ActivityIndicator color={theme.tint} />
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.background }]}
      contentContainerStyle={[styles.content, { paddingTop: topPad + 12, paddingBottom: bottomPad }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <View>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>{currentMonthLabel()}</Text>
          <Text style={[styles.title, { color: theme.text }]}>Fortis</Text>
        </View>
        <View style={[styles.badge, { backgroundColor: theme.deepBlue }]}>
          <Text style={styles.badgeText}>EU</Text>
        </View>
      </View>

      <View style={[styles.heroCard, { backgroundColor: theme.deepBlue }]}>
        <Text style={styles.heroLabel}>TOTAL PORTFOLIO VALUE</Text>
        <Text style={styles.heroValue}>{formatEUR(totalPortfolioValue)}</Text>
        <View style={styles.heroRow}>
          <View style={[styles.gainBadge, { backgroundColor: "rgba(255,255,255,0.12)" }]}>
            <Text style={[styles.gainText, { color: totalGain >= 0 ? "#6EE7B7" : "#FCA5A5" }]}>
              {totalGain >= 0 ? "+" : ""}{formatPct(totalGainPct)} all time
            </Text>
          </View>
          <Text style={styles.investedText}>
            {formatEUR(totalInvested)} invested
          </Text>
        </View>
      </View>

      {holdings.length > 0 && (
        <View style={[styles.card, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Allocation</Text>
          <View style={styles.donutRow}>
            <DonutChart
              segments={donutSegments}
              size={140}
              strokeWidth={20}
              centerLabel={formatEUR(totalPortfolioValue, true)}
              centerSublabel={`${holdings.length} holding${holdings.length !== 1 ? "s" : ""}`}
            />
            <View style={styles.legend}>
              {holdings.slice(0, 5).map((h, i) => {
                const val = h.quantity * h.currentPrice;
                const pct = totalPortfolioValue > 0 ? (val / totalPortfolioValue) * 100 : 0;
                const gain = (h.currentPrice - h.avg_cost_eur) / h.avg_cost_eur * 100;
                return (
                  <View key={h.id} style={styles.legendItem}>
                    <View style={[styles.dot, { backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.legendTicker, { color: theme.text }]}>{h.ticker}</Text>
                      <Text style={[styles.legendPct, { color: theme.textSecondary }]}>
                        {pct.toFixed(1)}%
                        {"  "}
                        <Text style={{ color: gain >= 0 ? theme.positive : theme.negative }}>
                          {gain >= 0 ? "+" : ""}{gain.toFixed(1)}%
                        </Text>
                      </Text>
                    </View>
                  </View>
                );
              })}
              {holdings.length > 5 && (
                <Text style={[styles.moreText, { color: theme.textSecondary }]}>
                  +{holdings.length - 5} more
                </Text>
              )}
            </View>
          </View>
        </View>
      )}

      {holdings.length === 0 && (
        <View style={[styles.emptyCard, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}>
          <View style={[styles.emptyIcon, { backgroundColor: theme.deepBlue + "22" }]}>
            <Feather name="briefcase" size={28} color={theme.tint} />
          </View>
          <Text style={[styles.emptyTitle, { color: theme.text }]}>Build your portfolio</Text>
          <Text style={[styles.emptySubtitle, { color: theme.textSecondary }]}>
            Add your UCITS ETFs and stocks in the Holdings tab to start tracking your European portfolio.
          </Text>
        </View>
      )}

      {holdings.length > 0 && (
        <View style={styles.statsGrid}>
          {[
            {
              label: "Holdings",
              value: holdings.length.toString(),
              icon: "layers" as const,
            },
            {
              label: "Total Gain",
              value: (totalGain >= 0 ? "+" : "") + formatEUR(totalGain, true),
              icon: totalGain >= 0 ? ("arrow-up-right" as const) : ("arrow-down-right" as const),
              valueColor: dailyGainColor,
            },
          ].map((stat) => (
            <View
              key={stat.label}
              style={[styles.statCard, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}
            >
              <Feather name={stat.icon} size={18} color={theme.tint} />
              <Text style={[styles.statValue, { color: stat.valueColor ?? theme.text }]}>
                {stat.value}
              </Text>
              <Text style={[styles.statLabel, { color: theme.textSecondary }]}>{stat.label}</Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 14 },
  loadingContainer: { flex: 1, justifyContent: "center", alignItems: "center" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 2,
  },
  subtitle: { fontSize: 12, fontFamily: "Inter_500Medium", letterSpacing: 0.3 },
  title: { fontSize: 30, fontFamily: "Inter_700Bold", letterSpacing: -1 },
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  badgeText: { color: "#C9A84C", fontSize: 12, fontFamily: "Inter_700Bold", letterSpacing: 1 },
  heroCard: {
    borderRadius: 20,
    padding: 24,
    gap: 8,
  },
  heroLabel: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 1,
  },
  heroValue: {
    color: "#FFFFFF",
    fontSize: 40,
    fontFamily: "Inter_700Bold",
    letterSpacing: -1.5,
  },
  heroRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
    marginTop: 4,
  },
  gainBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  gainText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  investedText: { color: "rgba(255,255,255,0.5)", fontSize: 12, fontFamily: "Inter_400Regular" },
  card: {
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
  },
  sectionTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 14 },
  donutRow: { flexDirection: "row", alignItems: "center", gap: 20 },
  legend: { flex: 1, gap: 10 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  legendTicker: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  legendPct: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
  moreText: { fontSize: 11, fontFamily: "Inter_400Regular" },
  emptyCard: {
    borderRadius: 16,
    padding: 32,
    borderWidth: 1,
    alignItems: "center",
    gap: 12,
    marginTop: 8,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_700Bold", textAlign: "center" },
  emptySubtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 21,
    maxWidth: 280,
  },
  statsGrid: { flexDirection: "row", gap: 12 },
  statCard: {
    flex: 1,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    gap: 6,
    alignItems: "flex-start",
  },
  statValue: { fontSize: 20, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  statLabel: { fontSize: 12, fontFamily: "Inter_400Regular" },
});
