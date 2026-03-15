import React from "react";
import { StyleSheet, Text, View, useColorScheme } from "react-native";
import Colors from "@/constants/colors";

interface ValueDisplayProps {
  label: string;
  value: string;
  subValue?: string;
  subValuePositive?: boolean;
  size?: "sm" | "md" | "lg" | "xl";
  align?: "left" | "center";
}

export function ValueDisplay({
  label,
  value,
  subValue,
  subValuePositive,
  size = "md",
  align = "left",
}: ValueDisplayProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const theme = isDark ? Colors.dark : Colors.light;

  const valueFontSize =
    size === "xl" ? 36 : size === "lg" ? 28 : size === "md" ? 22 : 16;
  const labelFontSize = size === "xl" ? 13 : size === "lg" ? 12 : 11;

  return (
    <View style={[styles.container, { alignItems: align === "center" ? "center" : "flex-start" }]}>
      <Text style={[styles.label, { color: theme.textSecondary, fontSize: labelFontSize }]}>
        {label}
      </Text>
      <Text
        style={[
          styles.value,
          { color: theme.text, fontSize: valueFontSize },
        ]}
      >
        {value}
      </Text>
      {subValue !== undefined && (
        <Text
          style={[
            styles.subValue,
            {
              color:
                subValuePositive === undefined
                  ? theme.textSecondary
                  : subValuePositive
                  ? theme.positive
                  : theme.negative,
            },
          ]}
        >
          {subValue}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 2,
  },
  label: {
    fontFamily: "Inter_500Medium",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  value: {
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
  },
  subValue: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
});
