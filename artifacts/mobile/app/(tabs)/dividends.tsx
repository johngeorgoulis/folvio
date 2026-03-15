import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useMemo, useState } from "react";
import {
  Alert,
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
import { AddDividendSheet } from "@/components/AddDividendSheet";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { usePortfolio } from "@/context/PortfolioContext";
import { formatEUR, formatShortDate } from "@/utils/format";

export default function DividendsScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const theme = isDark ? Colors.dark : Colors.light;
  const insets = useSafeAreaInsets();

  const { holdings, dividends, deleteDividend } = usePortfolio();
  const [showAdd, setShowAdd] = useState(false);

  const topPad = Platform.OS === "web" ? 24 : insets.top;

  const getHolding = (id: string) => holdings.find((h) => h.id === id);

  const year = new Date().getFullYear().toString();

  const ytdTotal = useMemo(
    () =>
      dividends
        .filter((d) => d.date.startsWith(year))
        .reduce((s, d) => s + d.amountReceived, 0),
    [dividends, year],
  );

  const thisMonth = new Date().toISOString().slice(0, 7);
  const thisMonthTotal = useMemo(
    () =>
      dividends
        .filter((d) => d.date.startsWith(thisMonth))
        .reduce((s, d) => s + d.amountReceived, 0),
    [dividends, thisMonth],
  );

  const allTimeTotal = useMemo(
    () => dividends.reduce((s, d) => s + d.amountReceived, 0),
    [dividends],
  );

  const perHoldingYTD = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of dividends.filter((d) => d.date.startsWith(year))) {
      map.set(d.holdingId, (map.get(d.holdingId) ?? 0) + d.amountReceived);
    }
    return map;
  }, [dividends, year]);

  const totalPortfolioValue = holdings.reduce(
    (s, h) => s + h.units * h.currentPrice,
    0,
  );

  const totalDividendYield = useMemo(() => {
    if (totalPortfolioValue === 0) return 0;
    return (ytdTotal / totalPortfolioValue) * 100;
  }, [ytdTotal, totalPortfolioValue]);

  const sorted = [...dividends].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );

  const handleDelete = (id: string) => {
    Alert.alert("Delete Dividend", "Remove this dividend entry?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          deleteDividend(id);
        },
      },
    ]);
  };

  const distHoldings = holdings.filter(
    (h) => h.shareClass === "DIST" || h.holdingType === "Stock",
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[
          styles.content,
          { paddingTop: topPad + 16, paddingBottom: Platform.OS === "web" ? 100 : 32 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <View>
            <Text style={[styles.screenTitle, { color: theme.text }]}>
              Dividends
            </Text>
            <Text style={[styles.screenSubtitle, { color: theme.textSecondary }]}>
              {dividends.length} record{dividends.length !== 1 ? "s" : ""}
            </Text>
          </View>
          {distHoldings.length > 0 && (
            <TouchableOpacity
              style={[styles.addBtn, { backgroundColor: theme.tint }]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                setShowAdd(true);
              }}
              activeOpacity={0.85}
            >
              <Feather name="plus" size={20} color="#fff" />
            </TouchableOpacity>
          )}
        </View>

        {dividends.length > 0 && (
          <>
            <Card padding={20}>
              <View style={styles.incomeRow}>
                <View
                  style={[
                    styles.incomeIconWrap,
                    { backgroundColor: "rgba(0, 208, 132, 0.12)" },
                  ]}
                >
                  <Feather name="trending-up" size={22} color={theme.positive} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.incomeLabel, { color: theme.textSecondary }]}>
                    DIVIDEND INCOME {year}
                  </Text>
                  <Text style={[styles.incomeValue, { color: theme.positive }]}>
                    {formatEUR(ytdTotal)}
                  </Text>
                  <Text style={[styles.incomeYield, { color: theme.textSecondary }]}>
                    {totalDividendYield.toFixed(2)}% yield on portfolio
                  </Text>
                </View>
              </View>
            </Card>

            <View style={styles.statsRow}>
              <Card style={{ flex: 1 }} padding={14}>
                <Text style={[styles.statLabel, { color: theme.textSecondary }]}>
                  THIS MONTH
                </Text>
                <Text style={[styles.statValue, { color: theme.text }]}>
                  {formatEUR(thisMonthTotal, true)}
                </Text>
              </Card>
              <Card style={{ flex: 1 }} padding={14}>
                <Text style={[styles.statLabel, { color: theme.textSecondary }]}>
                  ALL TIME
                </Text>
                <Text style={[styles.statValue, { color: theme.text }]}>
                  {formatEUR(allTimeTotal, true)}
                </Text>
              </Card>
            </View>

            {perHoldingYTD.size > 0 && (
              <Card padding={16}>
                <Text style={[styles.sectionTitle, { color: theme.text }]}>
                  Per Holding (YTD)
                </Text>
                {Array.from(perHoldingYTD.entries()).map(([hId, amount]) => {
                  const h = getHolding(hId);
                  const pct = ytdTotal > 0 ? (amount / ytdTotal) * 100 : 0;
                  return (
                    <View key={hId} style={styles.perHoldingRow}>
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[styles.phName, { color: theme.text }]}
                          numberOfLines={1}
                        >
                          {h?.name ?? "Unknown"}
                        </Text>
                        <View
                          style={[
                            styles.barBg,
                            { backgroundColor: isDark ? "#2A2A2A" : "#E5E7EB" },
                          ]}
                        >
                          <View
                            style={[
                              styles.barFill,
                              { width: `${pct}%` as any, backgroundColor: theme.positive },
                            ]}
                          />
                        </View>
                      </View>
                      <Text style={[styles.phAmount, { color: theme.text }]}>
                        {formatEUR(amount, true)}
                      </Text>
                    </View>
                  );
                })}
              </Card>
            )}
          </>
        )}

        {distHoldings.length === 0 && holdings.length > 0 ? (
          <Card padding={20}>
            <View style={styles.noDistRow}>
              <Feather name="info" size={16} color={theme.textSecondary} />
              <Text style={[styles.noDistText, { color: theme.textSecondary }]}>
                All your holdings are Accumulating (ACC). Add DIST ETFs or stocks to track dividends.
              </Text>
            </View>
          </Card>
        ) : dividends.length === 0 ? (
          <EmptyState
            icon="gift"
            title="No dividends yet"
            subtitle="Log dividend payments from your DIST ETFs and stocks."
            actionLabel={distHoldings.length > 0 ? "Log Dividend" : undefined}
            onAction={distHoldings.length > 0 ? () => setShowAdd(true) : undefined}
          />
        ) : (
          <View>
            <Text style={[styles.sectionTitle, { color: theme.text, marginBottom: 8 }]}>
              History
            </Text>
            {sorted.map((d) => {
              const h = getHolding(d.holdingId);
              return (
                <View
                  key={d.id}
                  style={[
                    styles.divRow,
                    { backgroundColor: theme.backgroundCard, borderColor: theme.border },
                  ]}
                >
                  <View
                    style={[
                      styles.divDate,
                      { backgroundColor: isDark ? "#1E1E1E" : "#F3F4F6" },
                    ]}
                  >
                    <Text style={[styles.divDateNum, { color: theme.textSecondary }]}>
                      {formatShortDate(d.date).split(" ")[0]}
                    </Text>
                    <Text style={[styles.divDateMon, { color: theme.textTertiary }]}>
                      {formatShortDate(d.date).split(" ")[1]}
                    </Text>
                  </View>
                  <View style={styles.divMain}>
                    <Text
                      style={[styles.divName, { color: theme.text }]}
                      numberOfLines={1}
                    >
                      {h?.name ?? "Unknown"}
                    </Text>
                    <Text style={[styles.divMeta, { color: theme.textSecondary }]}>
                      {d.currency} payment
                    </Text>
                  </View>
                  <View style={styles.divRight}>
                    <Text style={[styles.divAmount, { color: theme.positive }]}>
                      +{formatEUR(d.amountReceived)}
                    </Text>
                    <TouchableOpacity
                      onPress={() => handleDelete(d.id)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Feather name="trash-2" size={14} color={theme.textTertiary} />
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      <AddDividendSheet visible={showAdd} onClose={() => setShowAdd(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 12 },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 4,
  },
  screenTitle: { fontSize: 28, fontFamily: "Inter_700Bold", letterSpacing: -1 },
  screenSubtitle: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  addBtn: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  incomeRow: { flexDirection: "row", gap: 16, alignItems: "center" },
  incomeIconWrap: { width: 52, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  incomeLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.8 },
  incomeValue: { fontSize: 28, fontFamily: "Inter_700Bold", letterSpacing: -0.5, marginTop: 4 },
  incomeYield: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  statsRow: { flexDirection: "row", gap: 12 },
  statLabel: { fontSize: 10, fontFamily: "Inter_600SemiBold", letterSpacing: 0.8, textTransform: "uppercase" },
  statValue: { fontSize: 16, fontFamily: "Inter_700Bold", marginTop: 4 },
  sectionTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 12 },
  perHoldingRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 },
  phName: { fontSize: 13, fontFamily: "Inter_500Medium", marginBottom: 4 },
  barBg: { height: 4, borderRadius: 2, overflow: "hidden" },
  barFill: { height: 4, borderRadius: 2 },
  phAmount: { fontSize: 13, fontFamily: "Inter_700Bold", width: 70, textAlign: "right" },
  noDistRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  noDistText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1, lineHeight: 18 },
  divRow: {
    flexDirection: "row",
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
    overflow: "hidden",
    alignItems: "center",
  },
  divDate: { width: 48, alignItems: "center", paddingVertical: 14, gap: 2 },
  divDateNum: { fontSize: 18, fontFamily: "Inter_700Bold" },
  divDateMon: { fontSize: 10, fontFamily: "Inter_500Medium", textTransform: "uppercase" },
  divMain: { flex: 1, paddingVertical: 12, paddingHorizontal: 12, gap: 2 },
  divName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  divMeta: { fontSize: 12, fontFamily: "Inter_400Regular" },
  divRight: { paddingHorizontal: 14, alignItems: "flex-end", gap: 6 },
  divAmount: { fontSize: 14, fontFamily: "Inter_700Bold" },
});
