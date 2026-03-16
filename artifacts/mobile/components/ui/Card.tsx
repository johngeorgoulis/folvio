import React from "react";
import {
  StyleSheet,
  View,
  ViewStyle,
} from "react-native";
import Colors from "@/constants/colors";

interface CardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  padding?: number;
}

const theme = Colors.dark;

export function Card({ children, style, padding = 16 }: CardProps) {
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.backgroundCard,
          borderColor: theme.border,
          shadowColor: theme.shadow,
          padding,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 2,
  },
});
