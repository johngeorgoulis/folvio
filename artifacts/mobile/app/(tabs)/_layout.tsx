import { BlurView } from "expo-blur";
import { Tabs } from "expo-router";
import { Feather } from "@expo/vector-icons";
import React from "react";
import { Platform, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";

const theme = Colors.dark;

export default function TabLayout() {
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";
  const safeAreaInsets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: theme.tint,
        tabBarInactiveTintColor: theme.tabIconDefault,
        headerShown: false,
        tabBarStyle: {
          position: "absolute",
          backgroundColor: isIOS ? "transparent" : theme.background,
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
              tint="dark"
              style={StyleSheet.absoluteFill}
            />
          ) : isWeb ? (
            <View
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: theme.background },
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
        name="search"
        options={{
          title: "Search",
          tabBarIcon: ({ color }) => <Feather name="search" size={21} color={color} />,
        }}
      />
      <Tabs.Screen
        name="performance"
        options={{
          title: "Returns",
          tabBarIcon: ({ color }) => <Feather name="trending-up" size={21} color={color} />,
        }}
      />
      <Tabs.Screen
        name="projections"
        options={{
          title: "Forecast",
          tabBarIcon: ({ color }) => <Feather name="trending-up" size={22} color={color} />,
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
