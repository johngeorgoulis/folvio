import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { Feather } from "@expo/vector-icons";
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
import PaywallModal from "@/components/PaywallModal";
import { PortfolioProvider } from "@/context/PortfolioContext";
import { AllocationProvider } from "@/context/AllocationContext";
import { SubscriptionProvider, useSubscription } from "@/context/SubscriptionContext";
import { configureNotificationHandler } from "@/services/notificationService";
import { loadAssetClassOverrides } from "@/services/assetClassService";
import { initDb } from "@/services/db";

SplashScreen.preventAutoHideAsync();
configureNotificationHandler();

const queryClient = new QueryClient();

// ─── Global paywall driven by SubscriptionContext ─────────────────────────────
// Rendered inside the provider tree so it can read/close the paywall state.
function GlobalPaywall() {
  const { paywallVisible, paywallTrigger, hidePaywall } = useSubscription();
  return (
    <PaywallModal
      visible={paywallVisible}
      onClose={hidePaywall}
      trigger={paywallTrigger}
    />
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    // Load Feather icon font explicitly — the tab bar renders at launch
    // (before any navigation), so the font must be ready on first paint.
    // Without this, Expo web shows grey squares instead of icons.
    ...Feather.font,
  });

  // null = still checking, false = show onboarding, true = go straight to app
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);
  // When onboarding finishes with "Add My First Holding", navigate to search
  const pendingSearch = useRef(false);

  useEffect(() => {
    if (!fontsLoaded && !fontError) return;
    (async () => {
      // Warm the database BEFORE any context mounts — prevents concurrent-init
      // race conditions that cause "Calling..." promise rejection errors.
      try {
        await initDb();
      } catch (e) {
        console.warn("[startup] DB init failed, proceeding anyway:", e);
      }
      loadAssetClassOverrides().catch(() => {});
      try {
        const v = await AsyncStorage.getItem(ONBOARDING_KEY);
        setOnboardingDone(v === "true");
      } catch {
        setOnboardingDone(true); // default to app if AsyncStorage fails
      }
      SplashScreen.hideAsync();
    })();
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
              <SubscriptionProvider>
                <PortfolioProvider>
                  <AllocationProvider>
                    <GlobalPaywall />
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
              </SubscriptionProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
