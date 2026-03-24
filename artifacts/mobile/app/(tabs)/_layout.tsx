import { BlurView } from "expo-blur";
import { Tabs } from "expo-router";
import { Feather } from "@expo/vector-icons";
import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";

const theme = Colors.dark;
const GOLD  = "#F59E0B";
const MUTED = "#475569";

const TAB_HEIGHT = 64;

interface TabIconProps {
  name: React.ComponentProps<typeof Feather>["name"];
  label: string;
  color: string;
  focused: boolean;
  size?: number;
}

function TabIcon({ name, label, color, focused, size = 21 }: TabIconProps) {
  return (
    <View style={styles.tabItem}>
      <Feather name={name} size={size} color={color} />
      {focused && (
        <Text style={[styles.tabLabel, { color }]}>{label}</Text>
      )}
    </View>
  );
}

export default function TabLayout() {
  const isIOS  = Platform.OS === "ios";
  const isWeb  = Platform.OS === "web";
  const insets = useSafeAreaInsets();

  const tabBarHeight = TAB_HEIGHT + insets.bottom;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarActiveTintColor: GOLD,
        tabBarInactiveTintColor: MUTED,
        tabBarStyle: {
          position: "absolute",
          height: tabBarHeight,
          paddingBottom: insets.bottom,
          backgroundColor: isIOS ? "transparent" : theme.background,
          borderTopWidth: 1,
          borderTopColor: theme.border,
          elevation: 0,
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={95}
              tint="dark"
              style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(10,15,30,0.85)" }]}
            />
          ) : (
            <View
              style={[StyleSheet.absoluteFill, { backgroundColor: theme.background }]}
            />
          ),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="home" label="Dashboard" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="holdings"
        options={{
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="briefcase" label="Holdings" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="search" label="Search" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="performance"
        options={{
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="bar-chart-2" label="Returns" color={color} focused={focused} size={22} />
          ),
        }}
      />
      <Tabs.Screen
        name="projections"
        options={{
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="clock" label="Forecast" color={color} focused={focused} size={22} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="settings" label="Settings" color={color} focused={focused} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabItem: {
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    minWidth: 44,
  },
  tabLabel: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.2,
  },
});
