import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React from "react";
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useColorScheme,
} from "react-native";
import Colors from "@/constants/colors";
import { Badge } from "@/components/ui/Badge";
import type { Holding } from "@/context/PortfolioContext";
import { CHART_COLORS } from "@/components/DonutChart";
import { formatEUR, formatPct } from "@/utils/format";

interface HoldingRowProps {
  holding: Holding;
  index: number;
  totalPortfolioValue: number;
  onPress?: () => void;
  onDelete?: () => void;
}

export function HoldingRow({
  holding,
  index,
  totalPortfolioValue,
  onPress,
  onDelete,
}: HoldingRowProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const theme = isDark ? Colors.dark : Colors.light;

  const currentValue = holding.units * holding.currentPrice;
  const invested = holding.units * holding.avgPurchasePrice;
  const gain = currentValue - invested;
  const gainPct = invested > 0 ? (gain / invested) * 100 : 0;
  const isPositive = gain >= 0;

  const actualAllocationPct =
    totalPortfolioValue > 0 ? (currentValue / totalPortfolioValue) * 100 : 0;
  const drift = actualAllocationPct - holding.targetAllocationPct;
  const hasDrift = Math.abs(drift) >= 5 && holding.targetAllocationPct > 0;

  const color = CHART_COLORS[index % CHART_COLORS.length];

  return (
    <TouchableOpacity
      style={[
        styles.container,
        { backgroundColor: theme.backgroundCard, borderColor: theme.border },
      ]}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress?.();
      }}
      activeOpacity={0.7}
    >
      <View style={[styles.colorBar, { backgroundColor: color }]} />
      <View style={styles.main}>
        <View style={styles.top}>
          <View style={styles.nameRow}>
            <Text
              style={[styles.name, { color: theme.text }]}
              numberOfLines={1}
            >
              {holding.name}
            </Text>
            {hasDrift && (
              <View
                style={[
                  styles.driftDot,
                  { backgroundColor: drift < 0 ? theme.negative : theme.warning },
                ]}
              />
            )}
          </View>
          <Text style={[styles.value, { color: theme.text }]}>
            {formatEUR(currentValue)}
          </Text>
        </View>

        <View style={styles.middle}>
          <View style={styles.badgeRow}>
            <Badge label={holding.broker} variant="default" />
            <Badge
              label={holding.holdingType}
              variant={holding.holdingType === "ETF" ? "etf" : "stock"}
            />
            <Badge
              label={holding.shareClass}
              variant={holding.shareClass === "ACC" ? "acc" : "dist"}
            />
          </View>
          <Text
            style={[
              styles.gain,
              { color: isPositive ? theme.positive : theme.negative },
            ]}
          >
            {isPositive ? "+" : ""}
            {formatEUR(gain)} ({formatPct(gainPct)})
          </Text>
        </View>

        <View style={styles.bottom}>
          <Text style={[styles.meta, { color: theme.textSecondary }]}>
            {holding.units.toFixed(holding.units % 1 === 0 ? 0 : 4)} units ·{" "}
            {holding.isin || holding.ticker}
          </Text>
          <View style={styles.allocationRow}>
            <Text style={[styles.meta, { color: theme.textSecondary }]}>
              {actualAllocationPct.toFixed(1)}%
              {holding.targetAllocationPct > 0 &&
                ` / ${holding.targetAllocationPct}% target`}
            </Text>
            <View
              style={[styles.allocationBar, { backgroundColor: isDark ? "#2A2A2A" : "#E5E7EB" }]}
            >
              <View
                style={[
                  styles.allocationFill,
                  {
                    backgroundColor: color,
                    width: `${Math.min(actualAllocationPct, 100)}%` as any,
                  },
                ]}
              />
            </View>
          </View>
        </View>
      </View>

      {onDelete && (
        <TouchableOpacity
          style={styles.deleteBtn}
          onPress={() => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            onDelete();
          }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Feather name="trash-2" size={16} color={theme.negative} />
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 10,
    flexDirection: "row",
    overflow: "hidden",
  },
  colorBar: {
    width: 4,
  },
  main: {
    flex: 1,
    padding: 14,
    gap: 8,
  },
  top: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flex: 1,
    marginRight: 8,
  },
  name: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    flex: 1,
  },
  driftDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  value: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
  },
  middle: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
  },
  badgeRow: {
    flexDirection: "row",
    gap: 4,
  },
  gain: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  bottom: {
    gap: 4,
  },
  meta: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  allocationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  allocationBar: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    overflow: "hidden",
  },
  allocationFill: {
    height: 3,
    borderRadius: 2,
  },
  deleteBtn: {
    padding: 14,
    justifyContent: "center",
  },
});
