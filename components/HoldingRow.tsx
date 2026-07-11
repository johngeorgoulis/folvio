import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React from "react";
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useTheme } from "@/context/ThemeContext";
import { Badge } from "@/components/ui/Badge";
import type { Holding } from "@/context/PortfolioContext";
import { CHART_COLORS } from "@/components/DonutChart";
import { formatEUR, formatPct, formatQuantity } from "@/utils/format";

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
  const { theme } = useTheme();

  const currentValue = holding.quantity * holding.currentPrice;
  const invested = holding.quantity * holding.avg_cost_eur;
  const gain = currentValue - invested;
  const gainPct = invested > 0 ? (gain / invested) * 100 : 0;
  const isPositive = gain >= 0;

  const actualAllocationPct =
    totalPortfolioValue > 0 ? (currentValue / totalPortfolioValue) * 100 : 0;

  const color = CHART_COLORS[index % CHART_COLORS.length];

  return (
    <TouchableOpacity
      style={[
        styles.container,
        { backgroundColor: theme.surface, borderColor: theme.hairline },
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
          <Text
            style={[styles.name, { color: theme.text }]}
            numberOfLines={1}
          >
            {holding.name || holding.ticker}
          </Text>
          <Text style={[styles.value, { color: theme.text }]}>
            {formatEUR(currentValue)}
          </Text>
        </View>

        <View style={styles.middle}>
          <View style={styles.tagRow}>
            {!!holding.exchange && (
              <Text style={[styles.tag, { color: theme.textMuted, borderColor: theme.hairline }]}>
                {holding.exchange}
              </Text>
            )}
            <Text style={[styles.tag, { color: theme.textMuted, borderColor: theme.hairline }]}>
              {holding.ticker}
            </Text>
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
            {formatQuantity(holding.quantity)} units · avg {formatEUR(holding.avg_cost_eur)}
          </Text>
          <View style={styles.allocationRow}>
            <Text style={[styles.meta, { color: theme.textSecondary }]}>
              {actualAllocationPct.toFixed(1)}%
            </Text>
            <View
              style={[styles.allocationBar, { backgroundColor: theme.surface }]}
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
    borderRadius: 0,
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
  name: {
    fontSize: 15,
    fontFamily: "Archivo_600SemiBold",
    flex: 1,
    marginRight: 8,
  },
  value: {
    fontSize: 15,
    fontFamily: "Archivo_800ExtraBold",
  },
  middle: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
  },
  tagRow: {
    flexDirection: "row",
    gap: 4,
  },
  tag: {
    fontSize: 11,
    fontFamily: "Archivo_600SemiBold",
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
    letterSpacing: 0.3,
  },
  gain: {
    fontSize: 12,
    fontFamily: "Archivo_600SemiBold",
  },
  bottom: {
    gap: 4,
  },
  meta: {
    fontSize: 12,
    fontFamily: "Archivo_400Regular",
  },
  allocationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  allocationBar: {
    flex: 1,
    height: 3,
    borderRadius: 0,
    overflow: "hidden",
  },
  allocationFill: {
    height: 3,
    borderRadius: 0,
  },
  deleteBtn: {
    padding: 14,
    justifyContent: "center",
  },
});
