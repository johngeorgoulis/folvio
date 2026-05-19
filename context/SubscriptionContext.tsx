import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type SubscriptionTier = "free" | "investor" | "pro";
export type BillingPeriod = "monthly" | "yearly";

// ─── Pricing (display only — real prices come from RevenueCat offerings) ───────

export const PRICES = {
  investor: { monthly: 4.99, yearly: 39.99 },
  pro:      { monthly: 8.99, yearly: 69.99 },
} as const;

export const YEARLY_SAVINGS_PCT = {
  investor: Math.round((1 - PRICES.investor.yearly / (PRICES.investor.monthly * 12)) * 100),
  pro:      Math.round((1 - PRICES.pro.yearly      / (PRICES.pro.monthly      * 12)) * 100),
} as const;

// ─── Feature gates ─────────────────────────────────────────────────────────────

export interface FeatureGates {
  canAddUnlimitedHoldings:   boolean;
  canUseFullRebalance:       boolean;
  canUseAllScenarios:        boolean;
  canUseDCALog:              boolean;
  canUsePushNotifications:   boolean;
  canUseBenchmarkComparison: boolean;
  canImportCSV:              boolean;
  canExportCSV:              boolean;
  canUseAIInsights:          boolean;
  canUseCrisisBacktest:      boolean;
  canUseWealthProjections:   boolean;
}

function getFeatureGates(tier: SubscriptionTier): FeatureGates {
  const isInvestorOrHigher = tier === "investor" || tier === "pro";
  const isPro              = tier === "pro";
  return {
    canAddUnlimitedHoldings:   isInvestorOrHigher,
    canUseFullRebalance:       isInvestorOrHigher,
    canUseAllScenarios:        isInvestorOrHigher,
    canUseDCALog:              isInvestorOrHigher,
    canUsePushNotifications:   isInvestorOrHigher,
    canUseBenchmarkComparison: isInvestorOrHigher,
    canImportCSV:              isInvestorOrHigher,
    canExportCSV:              isPro,
    canUseAIInsights:          isPro,
    canUseCrisisBacktest:      isPro,
    canUseWealthProjections:   isPro,
  };
}

// ─── RevenueCat helpers ────────────────────────────────────────────────────────

// RevenueCat entitlement IDs — must match what's configured in the RC dashboard.
const ENTITLEMENT_INVESTOR = "investor";
const ENTITLEMENT_PRO      = "pro";

// RevenueCat iOS public API key — safe to bundle (it's a publishable key, not a secret).
const RC_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? "";

let rcConfigured = false;

async function configureRevenueCat(): Promise<void> {
  if (Platform.OS === "web" || !RC_API_KEY || rcConfigured) return;
  try {
    const Purchases = (await import("react-native-purchases")).default;
    Purchases.configure({ apiKey: RC_API_KEY });
    rcConfigured = true;
  } catch (err) {
    console.warn("[RevenueCat] configure failed:", err);
  }
}

async function fetchTierFromRevenueCat(): Promise<SubscriptionTier> {
  if (Platform.OS === "web" || !RC_API_KEY) return "free";
  try {
    const Purchases = (await import("react-native-purchases")).default;
    const info = await Purchases.getCustomerInfo();
    if (info.entitlements.active[ENTITLEMENT_PRO])      return "pro";
    if (info.entitlements.active[ENTITLEMENT_INVESTOR]) return "investor";
    return "free";
  } catch (err) {
    console.warn("[RevenueCat] getCustomerInfo failed:", err);
    return "free";
  }
}

// ─── Dev-only AsyncStorage fallback (hidden behind __DEV__ at call sites) ──────

const DEV_STORAGE_KEYS = {
  tier:    "folvio_subscription_tier",
  billing: "folvio_subscription_billing",
} as const;

// ─── Context ───────────────────────────────────────────────────────────────────

interface SubscriptionContextType extends FeatureGates {
  tier:          SubscriptionTier;
  billingPeriod: BillingPeriod | null;
  isLoaded:      boolean;

  paywallVisible: boolean;
  paywallTrigger: string | undefined;
  showPaywall:    (trigger?: string) => void;
  hidePaywall:    () => void;

  refreshTier:       () => Promise<void>;
  // Dev-only overrides (guarded by __DEV__ at call sites)
  setSubscription:   (tier: SubscriptionTier, period: BillingPeriod) => Promise<void>;
  clearSubscription: () => Promise<void>;
}

const SubscriptionContext = createContext<SubscriptionContextType | null>(null);

// ─── Provider ──────────────────────────────────────────────────────────────────

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const [tier, _setTier]                   = useState<SubscriptionTier>("free");
  const [billingPeriod, _setBilling]       = useState<BillingPeriod | null>(null);
  const [isLoaded, setIsLoaded]            = useState(false);
  const [paywallVisible, setPaywallVisible] = useState(false);
  const [paywallTrigger, setPaywallTrigger] = useState<string | undefined>();

  const refreshTier = useCallback(async () => {
    const resolved = await fetchTierFromRevenueCat();
    _setTier(resolved);
  }, []);

  useEffect(() => {
    (async () => {
      await configureRevenueCat();

      if (Platform.OS !== "web" && RC_API_KEY) {
        // Live path: read from RevenueCat
        const resolved = await fetchTierFromRevenueCat();
        _setTier(resolved);

        // Subscribe to real-time entitlement changes (e.g. after purchase)
        try {
          const Purchases = (await import("react-native-purchases")).default;
          Purchases.addCustomerInfoUpdateListener((info) => {
            if (info.entitlements.active[ENTITLEMENT_PRO])      _setTier("pro");
            else if (info.entitlements.active[ENTITLEMENT_INVESTOR]) _setTier("investor");
            else _setTier("free");
          });
        } catch {}
      } else if (__DEV__) {
        // Dev fallback: read from AsyncStorage override
        try {
          const [t, b] = await Promise.all([
            AsyncStorage.getItem(DEV_STORAGE_KEYS.tier),
            AsyncStorage.getItem(DEV_STORAGE_KEYS.billing),
          ]);
          if (t === "investor" || t === "pro") _setTier(t);
          if (b === "monthly"  || b === "yearly") _setBilling(b);
        } catch {}
      }

      setIsLoaded(true);
    })();
  }, []);

  const showPaywall = useCallback((trigger?: string) => {
    setPaywallTrigger(trigger);
    setPaywallVisible(true);
  }, []);

  const hidePaywall = useCallback(() => {
    setPaywallVisible(false);
    setPaywallTrigger(undefined);
  }, []);

  // Dev-only: bypass RevenueCat via AsyncStorage
  const setSubscription = useCallback(
    async (newTier: SubscriptionTier, newPeriod: BillingPeriod) => {
      _setTier(newTier);
      _setBilling(newPeriod);
      if (__DEV__) {
        await Promise.all([
          AsyncStorage.setItem(DEV_STORAGE_KEYS.tier,    newTier),
          AsyncStorage.setItem(DEV_STORAGE_KEYS.billing, newPeriod),
        ]);
      }
    },
    []
  );

  const clearSubscription = useCallback(async () => {
    _setTier("free");
    _setBilling(null);
    if (__DEV__) {
      await Promise.all([
        AsyncStorage.removeItem(DEV_STORAGE_KEYS.tier),
        AsyncStorage.removeItem(DEV_STORAGE_KEYS.billing),
      ]);
    }
  }, []);

  const gates = getFeatureGates(tier);

  return (
    <SubscriptionContext.Provider
      value={{
        tier,
        billingPeriod,
        isLoaded,
        ...gates,
        paywallVisible,
        paywallTrigger,
        showPaywall,
        hidePaywall,
        refreshTier,
        setSubscription,
        clearSubscription,
      }}
    >
      {children}
    </SubscriptionContext.Provider>
  );
}

// ─── Hook ──────────────────────────────────────────────────────────────────────

export function useSubscription(): SubscriptionContextType {
  const ctx = useContext(SubscriptionContext);
  if (!ctx) throw new Error("useSubscription must be used inside SubscriptionProvider");
  return ctx;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

export function tierLabel(tier: SubscriptionTier): string {
  switch (tier) {
    case "investor": return "Folvio Investor";
    case "pro":      return "Folvio Pro";
    default:         return "Free";
  }
}

export function requiredTierFor(trigger?: string): SubscriptionTier {
  switch (trigger) {
    case "ai-insights":
    case "crisis-backtest":
    case "wealth-projections":
    case "export":
      return "pro";
    default:
      return "investor";
  }
}
