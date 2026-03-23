import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router, Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useRef, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import NotificationManager from "@/components/NotificationManager";
import OnboardingFlow, { ONBOARDING_KEY } from "@/components/OnboardingFlow";
import { PortfolioProvider } from "@/context/PortfolioContext";
import { AllocationProvider } from "@/context/AllocationContext";
import { configureNotificationHandler } from "@/services/notificationService";
import { loadAssetClassOverrides } from "@/services/assetClassService";

SplashScreen.preventAutoHideAsync();
configureNotificationHandler();

const queryClient = new QueryClient();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  // null = still checking, false = show onboarding, true = go straight to app
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);
  // When onboarding finishes with "Add My First Holding", navigate to search
  const pendingSearch = useRef(false);

  useEffect(() => {
    if (!fontsLoaded && !fontError) return;
    loadAssetClassOverrides().catch(() => {});
    AsyncStorage.getItem(ONBOARDING_KEY).then((v) => {
      setOnboardingDone(v === "true");
      SplashScreen.hideAsync();
    });
  }, [fontsLoaded, fontError]);

  // Fire search navigation once the Stack is mounted
  useEffect(() => {
    if (onboardingDone && pendingSearch.current) {
      pendingSearch.current = false;
      const t = setTimeout(() => {
        router.replace("/(tabs)/search" as never);
      }, 80);
      return () => clearTimeout(t);
    }
  }, [onboardingDone]);

  function handleOnboardingComplete(goToSearch: boolean) {
    pendingSearch.current = goToSearch;
    setOnboardingDone(true);
  }

  // Keep splash visible while fonts or AsyncStorage check is in progress
  if (!fontsLoaded && !fontError) return null;
  if (onboardingDone === null) return null;

  // ── Onboarding ─────────────────────────────────────────────────────────────
  if (!onboardingDone) {
    return (
      <SafeAreaProvider>
        <StatusBar style="light" />
        <OnboardingFlow onComplete={handleOnboardingComplete} />
      </SafeAreaProvider>
    );
  }

  // ── Main app ────────────────────────────────────────────────────────────────
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <KeyboardProvider>
              <PortfolioProvider>
                <AllocationProvider>
                  <NotificationManager />
                  <Stack screenOptions={{ headerShown: false }}>
                    <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                    <Stack.Screen
                      name="holding/[id]"
                      options={{ headerShown: false, animation: "slide_from_right" }}
                    />
                    <Stack.Screen
                      name="ticker/[symbol]"
                      options={{ headerShown: false, animation: "slide_from_right" }}
                    />
                    <Stack.Screen
                      name="rebalance"
                      options={{ headerShown: false, animation: "slide_from_right" }}
                    />
                    <Stack.Screen
                      name="import"
                      options={{
                        headerShown: true,
                        animation: "slide_from_bottom",
                        presentation: "modal",
                      }}
                    />
                  </Stack>
                </AllocationProvider>
              </PortfolioProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
