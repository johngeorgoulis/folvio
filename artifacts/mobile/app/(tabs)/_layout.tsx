import { BlurView } from "expo-blur";
import { Tabs } from "expo-router";
import { Feather } from "@expo/vector-icons";
import React from "react";
import { Platform, StyleSheet, View, useColorScheme } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";
  const safeAreaInsets = useSafeAreaInsets();
  const theme = isDark ? Colors.dark : Colors.light;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: theme.tint,
        tabBarInactiveTintColor: theme.tabIconDefault,
        headerShown: false,
        tabBarStyle: {
          position: "absolute",
          backgroundColor: isIOS ? "transparent" : isDark ? Colors.dark.background : "#fff",
          borderTopWidth: isWeb ? 1 : 0.5,
          borderTopColor: theme.border,
          elevation: 0,
          paddingBottom: isWeb ? 0 : safeAreaInsets.bottom,
          ...(isWeb ? { height: 60 } : {}),
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={90}
              tint={isDark ? "dark" : "extraLight"}
              style={StyleSheet.absoluteFill}
            />
          ) : isWeb ? (
            <View
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: isDark ? Colors.dark.background : "#fff" },
              ]}
            />
          ) : null,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Dashboard",
          tabBarIcon: ({ color }) => <Feather name="home" size={21} color={color} />,
        }}
      />
      <Tabs.Screen
        name="holdings"
        options={{
          title: "Holdings",
          tabBarIcon: ({ color }) => <Feather name="briefcase" size={21} color={color} />,
        }}
      />
      <Tabs.Screen
        name="performance"
        options={{
          title: "Performance",
          tabBarIcon: ({ color }) => <Feather name="trending-up" size={21} color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color }) => <Feather name="settings" size={21} color={color} />,
        }}
      />
    </Tabs>
  );
}
