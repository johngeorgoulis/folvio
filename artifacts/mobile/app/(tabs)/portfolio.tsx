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
import { AddHoldingSheet } from "@/components/AddHoldingSheet";
import { HoldingRow } from "@/components/HoldingRow";
import { EmptyState } from "@/components/ui/EmptyState";
import { usePortfolio } from "@/context/PortfolioContext";
import { formatEUR, formatPct } from "@/utils/format";

export default function PortfolioScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const theme = isDark ? Colors.dark : Colors.light;
  const insets = useSafeAreaInsets();

  const {
    holdings,
    deleteHolding,
    totalPortfolioValue,
    totalInvested,
    totalGain,
    totalGainPct,
  } = usePortfolio();

  const [showAdd, setShowAdd] = useState(false);

  const topPad = Platform.OS === "web" ? 24 : insets.top;

  const totalAlloc = holdings.reduce((s, h) => s + h.targetAllocationPct, 0);
  const allocValid = Math.abs(totalAlloc - 100) <= 0.5 || totalAlloc === 0;

  const brokerGroups = useMemo(() => {
    const map = new Map<string, typeof holdings>();
    for (const h of holdings) {
      const arr = map.get(h.broker) ?? [];
      arr.push(h);
      map.set(h.broker, arr);
    }
    return map;
  }, [holdings]);

  const handleDelete = (id: string, name: string) => {
    Alert.alert("Delete Holding", `Remove "${name}" from your portfolio?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          deleteHolding(id);
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
              Portfolio
            </Text>
            <Text style={[styles.screenSubtitle, { color: theme.textSecondary }]}>
              {holdings.length} holding{holdings.length !== 1 ? "s" : ""} across{" "}
              {brokerGroups.size} broker{brokerGroups.size !== 1 ? "s" : ""}
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

        {holdings.length > 0 && (
          <View
            style={[
              styles.summaryRow,
              { backgroundColor: theme.backgroundCard, borderColor: theme.border },
            ]}
          >
            <View style={styles.summaryItem}>
              <Text style={[styles.sumLabel, { color: theme.textSecondary }]}>
                Value
              </Text>
              <Text style={[styles.sumValue, { color: theme.text }]}>
                {formatEUR(totalPortfolioValue, true)}
              </Text>
            </View>
            <View style={[styles.divider, { backgroundColor: theme.border }]} />
            <View style={styles.summaryItem}>
              <Text style={[styles.sumLabel, { color: theme.textSecondary }]}>
                Invested
              </Text>
              <Text style={[styles.sumValue, { color: theme.text }]}>
                {formatEUR(totalInvested, true)}
              </Text>
            </View>
            <View style={[styles.divider, { backgroundColor: theme.border }]} />
            <View style={styles.summaryItem}>
              <Text style={[styles.sumLabel, { color: theme.textSecondary }]}>
                Gain
              </Text>
              <Text
                style={[
                  styles.sumValue,
                  { color: totalGain >= 0 ? theme.positive : theme.negative },
                ]}
              >
                {formatPct(totalGainPct)}
              </Text>
            </View>
          </View>
        )}

        {!allocValid && totalAlloc > 0 && (
          <View
            style={[
              styles.warningBanner,
              { backgroundColor: "rgba(255, 59, 48, 0.1)", borderColor: "rgba(255, 59, 48, 0.3)" },
            ]}
          >
            <Feather name="alert-circle" size={14} color={theme.negative} />
            <Text style={[styles.warningText, { color: theme.negative }]}>
              Target allocations sum to {totalAlloc.toFixed(1)}% (should be 100%)
            </Text>
          </View>
        )}

        {holdings.length === 0 ? (
          <EmptyState
            icon="pie-chart"
            title="No holdings yet"
            subtitle="Add your ETFs and stocks to start tracking your UCITS portfolio."
            actionLabel="Add First Holding"
            onAction={() => setShowAdd(true)}
          />
        ) : (
          Array.from(brokerGroups.entries()).map(([broker, bHoldings]) => (
            <View key={broker} style={{ gap: 0 }}>
              <Text
                style={[styles.brokerLabel, { color: theme.textSecondary }]}
              >
                {broker.toUpperCase()}
              </Text>
              {bHoldings.map((h, i) => {
                const globalIndex = holdings.indexOf(h);
                return (
                  <HoldingRow
                    key={h.id}
                    holding={h}
                    index={globalIndex}
                    totalPortfolioValue={totalPortfolioValue}
                    onDelete={() => handleDelete(h.id, h.name)}
                  />
                );
              })}
            </View>
          ))
        )}
      </ScrollView>

      <AddHoldingSheet visible={showAdd} onClose={() => setShowAdd(false)} />
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
  screenSubtitle: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  addBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  summaryRow: {
    flexDirection: "row",
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
  },
  summaryItem: { flex: 1, alignItems: "center", paddingVertical: 14 },
  sumLabel: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  sumValue: { fontSize: 16, fontFamily: "Inter_700Bold", marginTop: 4 },
  divider: { width: 1, marginVertical: 8 },
  warningBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  warningText: { fontSize: 13, fontFamily: "Inter_500Medium", flex: 1 },
  brokerLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 1,
    marginBottom: 8,
    marginTop: 4,
  },
});
