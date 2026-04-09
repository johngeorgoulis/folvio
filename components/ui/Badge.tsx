import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Colors from "@/constants/colors";

interface BadgeProps {
  label: string;
  variant?: "acc" | "dist" | "etf" | "stock" | "default" | "positive" | "negative";
}

const theme = Colors.dark;

export function Badge({ label, variant = "default" }: BadgeProps) {
  const getColors = () => {
    switch (variant) {
      case "acc":
        return { bg: "rgba(0, 208, 132, 0.15)", text: theme.positive };
      case "dist":
        return { bg: "rgba(10, 132, 255, 0.15)", text: theme.accent };
      case "etf":
        return { bg: "rgba(0, 208, 132, 0.12)", text: theme.positive };
      case "stock":
        return { bg: "rgba(255, 159, 10, 0.15)", text: theme.warning };
      case "positive":
        return { bg: "rgba(0, 208, 132, 0.15)", text: theme.positive };
      case "negative":
        return { bg: "rgba(255, 59, 48, 0.15)", text: theme.negative };
      default:
        return { bg: theme.backgroundElevated, text: theme.textSecondary };
    }
  };

  const { bg, text } = getColors();

  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.label, { color: text }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: "flex-start",
  },
  label: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.3,
  },
});
