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
const TAB_H = 64;

type FeatherName = React.ComponentProps<typeof Feather>["name"];

interface TabIconProps {
  name: FeatherName;
  label: string;
  color: string;
  focused: boolean;
}

function TabIcon({ name, label, color, focused }: TabIconProps) {
  return (
    <View style={styles.tabItem}>
      <Feather name={name} size={22} color={color} />
      {focused && (
        <Text
          style={[styles.tabLabel, { color }]}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {label}
        </Text>
      )}
    </View>
  );
}

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const isIOS  = Platform.OS === "ios";

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarActiveTintColor: GOLD,
        tabBarInactiveTintColor: MUTED,
        tabBarStyle: {
          position: "absolute",
          height: TAB_H + insets.bottom,
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
              style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(10,15,30,0.88)" }]}
            />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.background }]} />
          ),
        tabBarItemStyle: {
          height: TAB_H,
          justifyContent: "center",
          alignItems: "center",
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="home" label="Home" color={color} focused={focused} />
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
            <TabIcon name="bar-chart-2" label="Returns" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="projections"
        options={{
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="clock" label="Forecast" color={color} focused={focused} />
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
  },
  tabLabel: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.1,
  },
});
