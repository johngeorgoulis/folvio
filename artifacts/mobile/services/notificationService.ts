import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

// ── Identifiers ───────────────────────────────────────────────────────────────
export const NOTIF_ID = {
  DCA_REMINDER: "fortis_dca_reminder",
  DRIFT_ALERT: "fortis_drift_alert",
  WEEKLY_SUMMARY: "fortis_weekly_summary",
} as const;

// ── AsyncStorage keys ─────────────────────────────────────────────────────────
export const NOTIF_KEY = {
  PERMISSION_ASKED: "fortis_notif_permission_asked",
  PERMISSION_STATUS: "fortis_notif_permission_status",
  DCA_ENABLED: "fortis_notif_dca_enabled",
  DRIFT_ENABLED: "fortis_notif_drift_enabled",
  WEEKLY_ENABLED: "fortis_notif_weekly_enabled",
  DCA_DAY: "fortis_dca_day",
  LAST_DRIFT_NOTIF: "fortis_last_drift_notification",
  // DCA amount is shared with projections screen
  DCA_AMOUNT: "fortis_forecast_dca",
} as const;

// ── Foreground handler ────────────────────────────────────────────────────────
export function configureNotificationHandler() {
  if (Platform.OS === "web") return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

// ── Permissions ───────────────────────────────────────────────────────────────
export async function checkPermissionStatus(): Promise<"granted" | "denied" | "undetermined"> {
  if (Platform.OS === "web") return "denied";
  const { status } = await Notifications.getPermissionsAsync();
  return status as "granted" | "denied" | "undetermined";
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  await AsyncStorage.setItem(NOTIF_KEY.PERMISSION_ASKED, "true");

  const existing = await Notifications.getPermissionsAsync();
  if (existing.status === "granted") {
    await AsyncStorage.setItem(NOTIF_KEY.PERMISSION_STATUS, "granted");
    return true;
  }

  const { status } = await Notifications.requestPermissionsAsync();
  await AsyncStorage.setItem(NOTIF_KEY.PERMISSION_STATUS, status);
  return status === "granted";
}

export async function hasAskedPermission(): Promise<boolean> {
  const v = await AsyncStorage.getItem(NOTIF_KEY.PERMISSION_ASKED);
  return v === "true";
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function isEnabled(key: string, defaultVal = true): Promise<boolean> {
  const v = await AsyncStorage.getItem(key);
  if (v === null) return defaultVal;
  return v === "true";
}

// ── DCA Reminder ─────────────────────────────────────────────────────────────
/**
 * Schedule a monthly notification 5 days before the user's DCA day.
 * dcaDay: 1-28 (day of month the user invests)
 * monthlyAmount: e.g. 500 (euros)
 */
export async function scheduleDCAReminder(dcaDay: number, monthlyAmount: number): Promise<void> {
  if (Platform.OS === "web") return;
  await cancelDCAReminder();

  // Fire 5 days before DCA day. If that lands on ≤0 wrap to last-ish days of prior month.
  let reminderDay = dcaDay - 5;
  if (reminderDay <= 0) {
    // e.g. DCA on 3rd → remind on 26th (safe for all months)
    reminderDay = 28 + reminderDay; // -2 → 26, -1 → 27, 0 → 28
  }
  reminderDay = Math.max(1, Math.min(28, reminderDay));

  const amountStr = monthlyAmount > 0 ? `€${monthlyAmount.toFixed(0)}` : "your";
  const body = `Your ${amountStr} monthly investment is due in 5 days. Time to prepare your transfer.`;

  await Notifications.scheduleNotificationAsync({
    identifier: NOTIF_ID.DCA_REMINDER,
    content: {
      title: "💰 DCA Reminder",
      body,
      data: { screen: "forecast" },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.MONTHLY,
      day: reminderDay,
      hour: 9,
      minute: 0,
    },
  });
}

export async function cancelDCAReminder(): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    await Notifications.cancelScheduledNotificationAsync(NOTIF_ID.DCA_REMINDER);
  } catch {
    // notification may not exist — safe to ignore
  }
}

// ── Drift Alert ───────────────────────────────────────────────────────────────
export interface DriftingHolding {
  ticker: string;
  drift: number; // positive = overweight, negative = underweight
}

/**
 * Send an immediate drift notification if:
 *  - At least one holding exceeds the threshold
 *  - The last drift notification was >24h ago
 *  - The drift notification type is enabled
 */
export async function maybeSendDriftNotification(
  driftingHoldings: DriftingHolding[]
): Promise<void> {
  if (Platform.OS === "web") return;
  if (driftingHoldings.length === 0) return;

  const enabled = await isEnabled(NOTIF_KEY.DRIFT_ENABLED, true);
  if (!enabled) return;

  const granted = await checkPermissionStatus();
  if (granted !== "granted") return;

  // Cooldown: max one drift notification per 24 h
  const lastStr = await AsyncStorage.getItem(NOTIF_KEY.LAST_DRIFT_NOTIF);
  if (lastStr) {
    const hoursSince = (Date.now() - parseInt(lastStr, 10)) / 3_600_000;
    if (hoursSince < 24) return;
  }

  let body: string;
  if (driftingHoldings.length === 1) {
    const { ticker, drift } = driftingHoldings[0];
    const dir = drift > 0 ? "above" : "below";
    body = `${ticker} is ${Math.abs(drift).toFixed(1)}% ${dir} your target allocation. Consider adjusting your next DCA.`;
  } else {
    body = `${driftingHoldings.length} holdings are outside your target allocation. Check your Rebalance calculator.`;
  }

  await Notifications.scheduleNotificationAsync({
    identifier: NOTIF_ID.DRIFT_ALERT,
    content: {
      title: "⚖️ Portfolio Drift Alert",
      body,
      data: { screen: "rebalance" },
    },
    trigger: null, // immediate
  });

  await AsyncStorage.setItem(NOTIF_KEY.LAST_DRIFT_NOTIF, String(Date.now()));
}

// ── Weekly Summary ────────────────────────────────────────────────────────────
/**
 * Schedule (or reschedule) the weekly Monday 9:00 AM summary.
 * `summaryBody` is pre-computed from portfolio data and cached at scheduling time.
 */
export async function scheduleWeeklySummary(summaryBody?: string): Promise<void> {
  if (Platform.OS === "web") return;
  await cancelWeeklySummary();

  const body =
    summaryBody ??
    "Open Fortis to review your weekly portfolio performance and plan your next DCA.";

  await Notifications.scheduleNotificationAsync({
    identifier: NOTIF_ID.WEEKLY_SUMMARY,
    content: {
      title: "📊 Your Weekly Portfolio Summary",
      body,
      data: { screen: "performance" },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
      weekday: 2, // 1=Sunday, 2=Monday … 7=Saturday
      hour: 9,
      minute: 0,
    },
  });
}

export async function cancelWeeklySummary(): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    await Notifications.cancelScheduledNotificationAsync(NOTIF_ID.WEEKLY_SUMMARY);
  } catch {
    // safe to ignore
  }
}

// ── Bulk toggle helpers ───────────────────────────────────────────────────────
/** Called from Settings when DCA toggle changes */
export async function toggleDCAReminder(enabled: boolean, dcaDay: number, monthlyAmount: number) {
  if (enabled) {
    await scheduleDCAReminder(dcaDay, monthlyAmount);
  } else {
    await cancelDCAReminder();
  }
}

/** Called from Settings when drift toggle changes */
export async function toggleDriftAlert(enabled: boolean) {
  if (!enabled) {
    // Just mark disabled; no scheduled notification to cancel (they're immediate)
  }
  // When re-enabled, the next app-foreground drift check will fire automatically
}

/** Called from Settings when weekly toggle changes */
export async function toggleWeeklySummary(enabled: boolean, summaryBody?: string) {
  if (enabled) {
    await scheduleWeeklySummary(summaryBody);
  } else {
    await cancelWeeklySummary();
  }
}
