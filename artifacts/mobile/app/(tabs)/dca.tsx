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
import { AddContributionSheet } from "@/components/AddContributionSheet";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { usePortfolio } from "@/context/PortfolioContext";
import {
  formatEUR,
  formatShortDate,
  currentMonthKey,
  getMonthKey,
} from "@/utils/format";

export default function DCAScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const theme = isDark ? Colors.dark : Colors.light;
  const insets = useSafeAreaInsets();

  const { holdings, contributions, deleteContribution } = usePortfolio();
  const [showAdd, setShowAdd] = useState(false);

  const topPad = Platform.OS === "web" ? 24 : insets.top;

  const getHolding = (id: string) => holdings.find((h) => h.id === id);

  const thisMonthKey = currentMonthKey();

  const thisMonthTotal = useMemo(
    () =>
      contributions
        .filter((c) => c.date.startsWith(thisMonthKey))
        .reduce((s, c) => s + c.unitsPurchased * c.pricePerUnit, 0),
    [contributions, thisMonthKey],
  );

  const lastMonthKey = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return getMonthKey(d.toISOString());
  }, []);

  const lastMonthTotal = useMemo(
    () =>
      contributions
        .filter((c) => c.date.startsWith(lastMonthKey))
        .reduce((s, c) => s + c.unitsPurchased * c.pricePerUnit, 0),
    [contributions, lastMonthKey],
  );

  const allTimeTotal = useMemo(
    () =>
      contributions.reduce((s, c) => s + c.unitsPurchased * c.pricePerUnit, 0),
    [contributions],
  );

  const perHoldingTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of contributions) {
      const prev = map.get(c.holdingId) ?? 0;
      map.set(c.holdingId, prev + c.unitsPurchased * c.pricePerUnit);
    }
    return map;
  }, [contributions]);

  const sorted = [...contributions].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );

  const handleDelete = (id: string) => {
    Alert.alert("Delete Contribution", "Remove this DCA entry?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          deleteContribution(id);
        },
      },
    ]);
  };

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
              DCA Log
            </Text>
            <Text style={[styles.screenSubtitle, { color: theme.textSecondary }]}>
              {contributions.length} contribution{contributions.length !== 1 ? "s" : ""}
            </Text>
          </View>
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
        </View>

        {contributions.length > 0 && (
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
                LAST MONTH
              </Text>
              <Text style={[styles.statValue, { color: theme.text }]}>
                {formatEUR(lastMonthTotal, true)}
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
        )}

        {holdings.length > 0 && (
          <Card padding={16}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>
              Per Holding
            </Text>
            {holdings.map((h) => {
              const total = perHoldingTotals.get(h.id) ?? 0;
              const pct = allTimeTotal > 0 ? (total / allTimeTotal) * 100 : 0;
              return (
                <View key={h.id} style={styles.holdingStatRow}>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[styles.holdingStatName, { color: theme.text }]}
                      numberOfLines={1}
                    >
                      {h.name}
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
                          {
                            width: `${pct}%` as any,
                            backgroundColor: theme.tint,
                          },
                        ]}
                      />
                    </View>
                  </View>
                  <Text style={[styles.holdingStatAmount, { color: theme.text }]}>
                    {formatEUR(total, true)}
                  </Text>
                </View>
              );
            })}
          </Card>
        )}

        {contributions.length === 0 ? (
          <EmptyState
            icon="calendar"
            title="No contributions yet"
            subtitle="Log your monthly DCA contributions to track your cost basis over time."
            actionLabel="Log Contribution"
            onAction={() => setShowAdd(true)}
          />
        ) : (
          <View>
            <Text style={[styles.sectionTitle, { color: theme.text, marginBottom: 8 }]}>
              History
            </Text>
            {sorted.map((c) => {
              const h = getHolding(c.holdingId);
              const total = c.unitsPurchased * c.pricePerUnit;
              return (
                <View
                  key={c.id}
                  style={[
                    styles.contribRow,
                    { backgroundColor: theme.backgroundCard, borderColor: theme.border },
                  ]}
                >
                  <View
                    style={[
                      styles.contribDate,
                      { backgroundColor: isDark ? "#1E1E1E" : "#F3F4F6" },
                    ]}
                  >
                    <Text style={[styles.contribDateText, { color: theme.textSecondary }]}>
                      {formatShortDate(c.date).split(" ")[0]}
                    </Text>
                    <Text style={[styles.contribMonth, { color: theme.textTertiary }]}>
                      {formatShortDate(c.date).split(" ")[1]}
                    </Text>
                  </View>
                  <View style={styles.contribMain}>
                    <Text
                      style={[styles.contribName, { color: theme.text }]}
                      numberOfLines={1}
                    >
                      {h?.name ?? "Unknown"}
                    </Text>
                    <Text
                      style={[styles.contribMeta, { color: theme.textSecondary }]}
                    >
                      {c.unitsPurchased.toFixed(c.unitsPurchased % 1 === 0 ? 0 : 4)} units @{" "}
                      {formatEUR(c.pricePerUnit)}
                    </Text>
                    {c.notes ? (
                      <Text
                        style={[styles.contribNotes, { color: theme.textTertiary }]}
                        numberOfLines={1}
                      >
                        {c.notes}
                      </Text>
                    ) : null}
                  </View>
                  <View style={styles.contribRight}>
                    <Text style={[styles.contribAmount, { color: theme.text }]}>
                      {formatEUR(total)}
                    </Text>
                    <TouchableOpacity
                      onPress={() => handleDelete(c.id)}
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

      <AddContributionSheet visible={showAdd} onClose={() => setShowAdd(false)} />
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
  statsRow: { flexDirection: "row", gap: 8 },
  statLabel: { fontSize: 10, fontFamily: "Inter_600SemiBold", letterSpacing: 0.8, textTransform: "uppercase" },
  statValue: { fontSize: 16, fontFamily: "Inter_700Bold", marginTop: 4 },
  sectionTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 12 },
  holdingStatRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 },
  holdingStatName: { fontSize: 13, fontFamily: "Inter_500Medium", marginBottom: 4 },
  barBg: { height: 4, borderRadius: 2, overflow: "hidden" },
  barFill: { height: 4, borderRadius: 2 },
  holdingStatAmount: { fontSize: 13, fontFamily: "Inter_700Bold", width: 70, textAlign: "right" },
  contribRow: {
    flexDirection: "row",
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
    overflow: "hidden",
    alignItems: "center",
  },
  contribDate: {
    width: 48,
    alignItems: "center",
    paddingVertical: 14,
    gap: 2,
  },
  contribDateText: { fontSize: 18, fontFamily: "Inter_700Bold" },
  contribMonth: { fontSize: 10, fontFamily: "Inter_500Medium", textTransform: "uppercase" },
  contribMain: { flex: 1, paddingVertical: 12, paddingHorizontal: 12, gap: 2 },
  contribName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  contribMeta: { fontSize: 12, fontFamily: "Inter_400Regular" },
  contribNotes: { fontSize: 11, fontFamily: "Inter_400Regular" },
  contribRight: { paddingHorizontal: 14, alignItems: "flex-end", gap: 6 },
  contribAmount: { fontSize: 14, fontFamily: "Inter_700Bold" },
});
