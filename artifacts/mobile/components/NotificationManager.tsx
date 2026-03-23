/**
 * NotificationManager
 * Rendered inside PortfolioProvider + AllocationProvider so it has access to
 * live holdings and targets for drift checking.
 *
 * Responsibilities:
 *  1. Request notification permission on first launch (after showing an Alert)
 *  2. Register a notification-tap listener and navigate to the correct screen
 *  3. Check portfolio drift on every app foreground and fire a notification if needed
 *  4. Reschedule the weekly summary with fresh portfolio data on Monday mornings
 */
import React, { useEffect, useRef } from "react";
import { Alert, AppState, AppStateStatus, Linking, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { usePortfolio } from "@/context/PortfolioContext";
import { useAllocation } from "@/context/AllocationContext";
import { calculateAllocations } from "@/services/allocationService";
import {
  NOTIF_KEY,
  checkPermissionStatus,
  hasAskedPermission,
  maybeSendDriftNotification,
  requestNotificationPermission,
  scheduleWeeklySummary,
  scheduleDCAReminder,
} from "@/services/notificationService";

// ── Navigation helper ─────────────────────────────────────────────────────────
function navigateToScreen(screen: string) {
  switch (screen) {
    case "forecast":
      router.push("/(tabs)/projections" as never);
      break;
    case "rebalance":
      router.push("/rebalance" as never);
      break;
    case "performance":
      router.push("/(tabs)/performance" as never);
      break;
    default:
      router.push("/(tabs)" as never);
  }
}

// ── Weekly summary body builder ───────────────────────────────────────────────
function buildWeeklySummaryBody(
  weeklyChangePct: number,
  weeklyChangeEUR: number,
  bestTicker: string | null,
  bestPct: number,
  dcaDaysUntil: number | null
): string {
  const sign = weeklyChangePct >= 0 ? "+" : "";
  const absEUR = Math.abs(weeklyChangeEUR);
  const eurStr = absEUR < 100 ? `€${absEUR.toFixed(2)}` : `€${absEUR.toFixed(0)}`;

  let body: string;
  if (weeklyChangePct >= 0) {
    body = `Your portfolio is up ${sign}${weeklyChangePct.toFixed(1)}% this week (+${eurStr}).`;
    if (bestTicker) body += ` Best performer: ${bestTicker} +${bestPct.toFixed(1)}%.`;
  } else {
    body = `Markets were tough this week. Your portfolio is down ${weeklyChangePct.toFixed(1)}% (-${eurStr}). Stay the course 💪`;
  }
  if (dcaDaysUntil !== null && dcaDaysUntil >= 0 && dcaDaysUntil <= 31) {
    body += ` Your DCA is due in ${dcaDaysUntil} days.`;
  }
  return body;
}

export default function NotificationManager() {
  const { holdings, totalPortfolioValue } = usePortfolio();
  const { targets, rebalanceThreshold } = useAllocation();
  const appState = useRef<AppStateStatus>(AppState.currentState);
  const hasRunDriftCheck = useRef(false);
  const lastValueRef = useRef<number | null>(null);

  // ── 1. Permission request on first launch ────────────────────────────────
  useEffect(() => {
    if (Platform.OS === "web") return;

    async function askPermission() {
      const alreadyAsked = await hasAskedPermission();
      if (alreadyAsked) return;

      // Small delay so the app UI is fully visible
      setTimeout(() => {
        Alert.alert(
          "Stay on top of your portfolio",
          "Fortis would like to send you reminders for your monthly DCA and portfolio alerts.",
          [
            { text: "Not now", style: "cancel" },
            {
              text: "Allow",
              onPress: async () => {
                await requestNotificationPermission();
                // After permission granted, schedule any enabled notifications
                await rescheduleEnabledNotifications();
              },
            },
          ]
        );
        // Mark as asked even if they tap "Not now"
        AsyncStorage.setItem(NOTIF_KEY.PERMISSION_ASKED, "true");
      }, 2000);
    }

    askPermission();
  }, []);

  // ── 2. Notification-tap listener ─────────────────────────────────────────
  useEffect(() => {
    if (Platform.OS === "web") return;

    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const screen = response.notification.request.content.data?.screen as string | undefined;
      if (screen) {
        // Small delay to let the app mount if it was in background
        setTimeout(() => navigateToScreen(screen), 300);
      }
    });
    return () => sub.remove();
  }, []);

  // ── 3. Drift check + weekly reschedule on foreground ─────────────────────
  useEffect(() => {
    if (Platform.OS === "web") return;

    async function runChecks() {
      await runDriftCheck();
      await maybeRescheduleWeekly();
    }

    // Run once on mount
    if (!hasRunDriftCheck.current) {
      hasRunDriftCheck.current = true;
      runChecks();
    }

    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (appState.current.match(/inactive|background/) && next === "active") {
        runChecks();
      }
      appState.current = next;
    });
    return () => sub.remove();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdings, targets, rebalanceThreshold]);

  // ── Drift calculation ─────────────────────────────────────────────────────
  async function runDriftCheck() {
    if (holdings.length === 0 || targets.length === 0) return;

    const driftEnabled = await AsyncStorage.getItem(NOTIF_KEY.DRIFT_ENABLED);
    if (driftEnabled === "false") return;

    const status = await checkPermissionStatus();
    if (status !== "granted") return;

    const allocations = calculateAllocations(holdings, targets, rebalanceThreshold);
    const drifting = allocations
      .filter(
        (r) =>
          r.status !== "no_price" &&
          r.status !== "untracked" &&
          Math.abs(r.drift) >= rebalanceThreshold
      )
      .map((r) => ({ ticker: r.ticker, drift: r.drift }));

    await maybeSendDriftNotification(drifting);
  }

  // ── Weekly summary reschedule (Monday mornings) ───────────────────────────
  async function maybeRescheduleWeekly() {
    const weeklyEnabled = await AsyncStorage.getItem(NOTIF_KEY.WEEKLY_ENABLED);
    if (weeklyEnabled === "false") return;

    const status = await checkPermissionStatus();
    if (status !== "granted") return;

    const today = new Date();
    const isMonday = today.getDay() === 1;
    const isBeforeNine = today.getHours() < 9;

    // Build the summary body with current portfolio data
    const dcaDayStr = await AsyncStorage.getItem(NOTIF_KEY.DCA_DAY);
    const dcaDay = dcaDayStr ? parseInt(dcaDayStr, 10) : null;
    let dcaDaysUntil: number | null = null;
    if (dcaDay !== null) {
      const now = new Date();
      const thisMonth = new Date(now.getFullYear(), now.getMonth(), dcaDay);
      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, dcaDay);
      const target = now <= thisMonth ? thisMonth : nextMonth;
      dcaDaysUntil = Math.ceil((target.getTime() - now.getTime()) / 86_400_000);
    }

    // Weekly change: compare to lastValueRef (simple approximation)
    const prev = lastValueRef.current ?? totalPortfolioValue;
    const weeklyChangeEUR = totalPortfolioValue - prev;
    const weeklyChangePct =
      prev > 0 ? (weeklyChangeEUR / prev) * 100 : 0;

    // Best performer this week (approximation using current gain %)
    const bestHolding = holdings
      .filter((h) => h.hasPrice && h.totalGainPct != null)
      .sort((a, b) => (b.totalGainPct ?? 0) - (a.totalGainPct ?? 0))[0];

    const body = buildWeeklySummaryBody(
      weeklyChangePct,
      weeklyChangeEUR,
      bestHolding?.ticker ?? null,
      bestHolding?.totalGainPct ?? 0,
      dcaDaysUntil
    );

    // Only reschedule on Monday before 9 AM (or always — weekly trigger handles the timing)
    if (isMonday && isBeforeNine) {
      lastValueRef.current = totalPortfolioValue;
    }

    await scheduleWeeklySummary(body);
  }

  // ── Reschedule all enabled notifications after permission grant ───────────
  async function rescheduleEnabledNotifications() {
    const [dcaEnabled, weeklyEnabled, dcaDayStr, dcaAmountStr] = await Promise.all([
      AsyncStorage.getItem(NOTIF_KEY.DCA_ENABLED),
      AsyncStorage.getItem(NOTIF_KEY.WEEKLY_ENABLED),
      AsyncStorage.getItem(NOTIF_KEY.DCA_DAY),
      AsyncStorage.getItem(NOTIF_KEY.DCA_AMOUNT),
    ]);

    if (dcaEnabled !== "false" && dcaDayStr) {
      const day = parseInt(dcaDayStr, 10);
      const amount = parseFloat(dcaAmountStr ?? "0") || 0;
      await scheduleDCAReminder(day, amount);
    }

    if (weeklyEnabled !== "false") {
      await scheduleWeeklySummary();
    }
  }

  // This component renders nothing — it's a logic-only side-effect component
  return null;
}
