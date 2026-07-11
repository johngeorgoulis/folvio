import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/context/ThemeContext";

interface BadgeProps {
  label: string;
  variant?: "acc" | "dist" | "etf" | "stock" | "default" | "positive" | "negative";
}

export function Badge({ label, variant = "default" }: BadgeProps) {
  const { theme } = useTheme();

  const getColors = () => {
    switch (variant) {
      case "acc":
        return { bg: "rgba(0, 208, 132, 0.15)", text: theme.positive };
      case "dist":
        return { bg: "rgba(10, 132, 255, 0.15)", text: theme.accent };
      case "etf":
        return { bg: "rgba(0, 208, 132, 0.12)", text: theme.positive };
      case "stock":
        return { bg: theme.surface, text: theme.textSecondary };
      case "positive":
        return { bg: "rgba(0, 208, 132, 0.15)", text: theme.positive };
      case "negative":
        return { bg: "rgba(255, 59, 48, 0.15)", text: theme.negative };
      default:
        return { bg: theme.surface, text: theme.textSecondary };
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
    borderRadius: 0,
    alignSelf: "flex-start",
  },
  label: {
    fontSize: 11,
    fontFamily: "Archivo_600SemiBold",
    letterSpacing: 0.3,
  },
});
