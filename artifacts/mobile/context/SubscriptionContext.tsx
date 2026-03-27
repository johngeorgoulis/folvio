import AsyncStorage from "@react-native-async-storage/async-storage";
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

// ─── Pricing ───────────────────────────────────────────────────────────────────

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
  canAddUnlimitedHoldings:  boolean;
  canImportCSV:             boolean;
  canExportCSV:             boolean;
  canUseBenchmarkComparison: boolean;
  canUseFullRebalance:      boolean;
  canUseAllScenarios:       boolean;
  canUseDCALog:             boolean;
  canUsePushNotifications:  boolean;
}

function getFeatureGates(tier: SubscriptionTier): FeatureGates {
  const isInvestorOrHigher = tier === "investor" || tier === "pro";
  const isPro              = tier === "pro";
  return {
    canAddUnlimitedHoldings:    isInvestorOrHigher,
    canImportCSV:               isPro,
    canExportCSV:               isPro,
    canUseBenchmarkComparison:  isPro,
    canUseFullRebalance:        isInvestorOrHigher,
    canUseAllScenarios:         isInvestorOrHigher,
    canUseDCALog:               isInvestorOrHigher,
    canUsePushNotifications:    isInvestorOrHigher,
  };
}

// ─── Context ───────────────────────────────────────────────────────────────────

interface SubscriptionContextType extends FeatureGates {
  tier:          SubscriptionTier;
  billingPeriod: BillingPeriod | null;
  isLoaded:      boolean;

  // Paywall sheet
  paywallVisible: boolean;
  paywallTrigger: string | undefined;
  showPaywall:    (trigger?: string) => void;
  hidePaywall:    () => void;

  // Subscription management (stub — wire to RevenueCat before release)
  setSubscription:   (tier: SubscriptionTier, period: BillingPeriod) => Promise<void>;
  clearSubscription: () => Promise<void>;
}

const STORAGE_KEYS = {
  tier:    "folvio_subscription_tier",
  billing: "folvio_subscription_billing",
} as const;

const SubscriptionContext = createContext<SubscriptionContextType | null>(null);

// ─── Provider ──────────────────────────────────────────────────────────────────

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const [tier, _setTier]                 = useState<SubscriptionTier>("free");
  const [billingPeriod, _setBilling]     = useState<BillingPeriod | null>(null);
  const [isLoaded, setIsLoaded]          = useState(false);
  const [paywallVisible, setPaywallVisible] = useState(false);
  const [paywallTrigger, setPaywallTrigger] = useState<string | undefined>();

  // Load persisted subscription on mount
  useEffect(() => {
    (async () => {
      try {
        const [t, b] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEYS.tier),
          AsyncStorage.getItem(STORAGE_KEYS.billing),
        ]);
        if (t === "investor" || t === "pro") _setTier(t);
        if (b === "monthly"  || b === "yearly") _setBilling(b);
      } catch {}
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

  // TODO: Replace this with actual RevenueCat purchase flow before release.
  // This currently just persists the tier locally for UI testing purposes.
  const setSubscription = useCallback(
    async (newTier: SubscriptionTier, newPeriod: BillingPeriod) => {
      _setTier(newTier);
      _setBilling(newPeriod);
      await Promise.all([
        AsyncStorage.setItem(STORAGE_KEYS.tier,    newTier),
        AsyncStorage.setItem(STORAGE_KEYS.billing, newPeriod),
      ]);
    },
    []
  );

  const clearSubscription = useCallback(async () => {
    _setTier("free");
    _setBilling(null);
    await Promise.all([
      AsyncStorage.removeItem(STORAGE_KEYS.tier),
      AsyncStorage.removeItem(STORAGE_KEYS.billing),
    ]);
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

/** Human-readable tier label */
export function tierLabel(tier: SubscriptionTier): string {
  switch (tier) {
    case "investor": return "Folvio Investor";
    case "pro":      return "Folvio Pro";
    default:         return "Free";
  }
}

/** Which paid tier is required for a given feature trigger */
export function requiredTierFor(trigger?: string): SubscriptionTier {
  switch (trigger) {
    case "import":
    case "export":
    case "benchmark":
      return "pro";
    default:
      return "investor";
  }
}
