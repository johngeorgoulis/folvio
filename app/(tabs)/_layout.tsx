import { Tabs } from "expo-router";
import { Feather } from "@expo/vector-icons";
import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/context/ThemeContext";

const TAB_H = 60;

type FeatherName = React.ComponentProps<typeof Feather>["name"];

interface TabIconProps {
  name: FeatherName;
  label: string;
  color: string;
  focused: boolean;
  accentColor: string;
}

function TabIcon({ name, label, focused, color, accentColor }: TabIconProps) {
  return (
    <View style={styles.tabItem}>
      <Feather name={name} size={18} color={color} />
      <Text style={[styles.tabLabel, { color }]} numberOfLines={1}>
        {label}
      </Text>
      {focused && <View style={[styles.tabUnderline, { backgroundColor: accentColor }]} />}
    </View>
  );
}

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarActiveTintColor: theme.text,
        tabBarInactiveTintColor: theme.textMuted,
        tabBarStyle: {
          position: "absolute",
          height: TAB_H + insets.bottom,
          paddingBottom: insets.bottom,
          backgroundColor: theme.background,
          borderTopWidth: 2,
          borderTopColor: theme.text,
          elevation: 0,
        },
        tabBarBackground: () => (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.background }]} />
        ),
        tabBarItemStyle: {
          height: TAB_H,
          justifyContent: "center",
          alignItems: "center",
          borderRightWidth: Platform.OS === "web" ? 0 : 0,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="home" label="HOME" color={color} focused={focused} accentColor={theme.accent} />
          ),
        }}
      />
      <Tabs.Screen
        name="holdings"
        options={{
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="briefcase" label="HOLDINGS" color={color} focused={focused} accentColor={theme.accent} />
          ),
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="search" label="EXPLORE" color={color} focused={focused} accentColor={theme.accent} />
          ),
        }}
      />
      <Tabs.Screen
        name="performance"
        options={{
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="bar-chart-2" label="RETURNS" color={color} focused={focused} accentColor={theme.accent} />
          ),
        }}
      />
      <Tabs.Screen
        name="insights"
        options={{
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="zap" label="INSIGHTS" color={color} focused={focused} accentColor={theme.accent} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{ tabBarButton: () => null, tabBarItemStyle: { width: 0, flex: 0 } }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabItem: {
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    position: "relative",
    paddingBottom: 4,
  },
  tabLabel: {
    fontSize: 9,
    fontFamily: "Archivo_800ExtraBold",
    letterSpacing: 0.6,
  },
  tabUnderline: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 2,
  },
});
