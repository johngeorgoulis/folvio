import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import {
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useTheme } from "@/context/ThemeContext";
import {
  PRICES,
  YEARLY_SAVINGS_PCT,
  requiredTierFor,
  useSubscription,
  type BillingPeriod,
  type SubscriptionTier,
} from "@/context/SubscriptionContext";
import { FREE_TIER_LIMIT } from "@/context/PortfolioContext";


// ─── Plan definitions ──────────────────────────────────────────────────────────

const FREE_FEATURES = [
  { icon: "layers"     as const, text: `Up to ${FREE_TIER_LIMIT} holdings` },
  { icon: "pie-chart"  as const, text: "Basic returns & allocation" },
  { icon: "bar-chart"  as const, text: "Portfolio overview & performance" },
];

const INVESTOR_FEATURES = [
  { icon: "layers"      as const, text: `Unlimited holdings (free: ${FREE_TIER_LIMIT} max)` },
  { icon: "book"        as const, text: "DCA log & contribution tracking" },
  { icon: "sliders"     as const, text: "Rebalancing alerts & suggestions" },
  { icon: "bar-chart-2" as const, text: "Benchmark comparison (MSCI World, S&P 500…)" },
  { icon: "clock"       as const, text: "Historical charts (1Y max)" },
  { icon: "upload"      as const, text: "CSV import (Trading 212, DEGIRO, IBKR, Trade Republic)" },
  { icon: "bell"        as const, text: "Push notifications (DCA reminders, drift alerts)" },
];

const PRO_FEATURES = [
  { icon: "check-circle" as const, text: "Everything in Investor" },
  { icon: "cpu"          as const, text: "AI Portfolio Insights (Claude AI)" },
  { icon: "activity"     as const, text: "Crisis Backtest (dot-com, 2008, COVID…)" },
  { icon: "trending-up"  as const, text: "Wealth Projections (Conservative & Optimistic)" },
  { icon: "bar-chart-2"  as const, text: "Full historical charts (all timeframes)" },
  { icon: "download"     as const, text: "Export portfolio to CSV" },
];

// ─── Trigger → human-readable copy ────────────────────────────────────────────

function triggerMessage(trigger?: string): string {
  switch (trigger) {
    case "holdings":           return `Add more than ${FREE_TIER_LIMIT} holdings`;
    case "dca-log":            return "Log DCA contributions";
    case "all-scenarios":      return "Conservative & Optimistic projections";
    case "wealth-projections": return "Wealth Projections";
    case "notifications":      return "Push notifications";
    case "rebalance":          return "Rebalancing suggestions";
    case "import":             return "Import from CSV";
    case "export":             return "Export to CSV";
    case "benchmark":          return "Benchmark comparison";
    case "ai-insights":        return "AI Portfolio Insights";
    case "crisis-backtest":    return "Crisis Backtest";
    default:                   return "Unlock all Folvio features";
  }
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function FeatureRow({
  const { theme } = useTheme();
  icon,
  text,
  muted = false,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  text: string;
  muted?: boolean;
}) {
  return (
    <View style={styles.featureRow}>
      <View style={[styles.featureIconWrap, muted && styles.featureIconWrapMuted]}>
        <Feather name={icon} size={12} color={muted ? theme.textTertiary : theme.positive} />
      </View>
      <Text style={[styles.featureText, muted && { color: theme.textSecondary }]}>{text}</Text>
    </View>
  );
}

// Free tier card (no subscribe button — shows current plan)
function FreePlanCard() {
  const { theme } = useTheme();
  return (
    <View style={[styles.planCard, styles.planCardFree]}>
      <View style={styles.planHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.planName}>Free</Text>
          <Text style={styles.planTagline}>Current plan</Text>
        </View>
        <View style={styles.planPriceBlock}>
          <Text style={[styles.planPrice, { color: theme.textSecondary }]}>€0</Text>
          <Text style={styles.planPeriod}>/forever</Text>
        </View>
      </View>
      <View style={styles.featureList}>
        {FREE_FEATURES.map((f) => (
          <FeatureRow key={f.text} icon={f.icon} text={f.text} muted />
        ))}
      </View>
    </View>
  );
}

function PaidPlanCard({
  const { theme } = useTheme();
  tier,
  label,
  tagline,
  features,
  billing,
  highlighted,
  badge,
  badgeColor,
  onSubscribe,
}: {
  tier:        SubscriptionTier;
  label:       string;
  tagline:     string;
  features:    typeof INVESTOR_FEATURES;
  billing:     BillingPeriod;
  highlighted: boolean;
  badge?:      string;
  badgeColor?: string;
  onSubscribe: (tier: SubscriptionTier) => void;
}) {
  const price      = PRICES[tier as "investor" | "pro"][billing];
  const monthlyEq  = billing === "yearly"
    ? (PRICES[tier as "investor" | "pro"].yearly / 12).toFixed(2)
    : null;
  const accentColor = badgeColor ?? theme.accent;

  return (
    <View style={[styles.planCard, highlighted && { borderColor: accentColor, borderWidth: 1.5 }]}>
      {badge && (
        <View style={[styles.planBadgeWrap, { backgroundColor: accentColor + "22" }]}>
          <Text style={[styles.planBadgeText, { color: accentColor }]}>{badge}</Text>
        </View>
      )}

      <View style={styles.planHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.planName}>{label}</Text>
          <Text style={styles.planTagline}>{tagline}</Text>
        </View>
        <View style={styles.planPriceBlock}>
          <Text style={[styles.planPrice, { color: accentColor }]}>
            €{price.toFixed(2).replace(".", ",")}
          </Text>
          <Text style={styles.planPeriod}>/{billing === "monthly" ? "mo" : "yr"}</Text>
        </View>
      </View>

      {monthlyEq && (
        <Text style={styles.monthlyEq}>≈ €{monthlyEq.replace(".", ",")}/month</Text>
      )}

      <View style={styles.featureList}>
        {features.map((f) => (
          <FeatureRow key={f.text} icon={f.icon} text={f.text} />
        ))}
      </View>

      <TouchableOpacity
        style={[styles.cta, { backgroundColor: accentColor }]}
        onPress={() => onSubscribe(tier)}
        activeOpacity={0.85}
      >
        <Text style={styles.ctaText}>Subscribe to {label}</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Main modal ────────────────────────────────────────────────────────────────

interface Props {
  visible:  boolean;
  onClose:  () => void;
  trigger?: string;
}

export default function PaywallModal({ visible, onClose, trigger }: Props) {
  const { theme } = useTheme();
  const [billing, setBilling] = useState<BillingPeriod>("yearly");
  const { setSubscription, tier: currentTier } = useSubscription();
  const required = requiredTierFor(trigger);

  async function handleSubscribe(tier: SubscriptionTier) {
    const tierName = tier === "investor" ? "Investor" : "Pro";
    const price    = PRICES[tier as "investor" | "pro"][billing];

    // TODO: Replace with RevenueCat purchase call before release.
    Alert.alert(
      `Subscribe to ${tierName}`,
      `€${price.toFixed(2).replace(".", ",")}/${billing === "monthly" ? "month" : "year"}\n\nSubscription managed via App Store. Cancel anytime.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Confirm (Test)",
          onPress: async () => {
            await setSubscription(tier, billing);
            onClose();
          },
        },
      ]
    );
  }

  function handleRestorePurchase() {
    Alert.alert(
      "Restore Purchase",
      "Restoring purchases via App Store…\n\n(RevenueCat restore will be wired here before release.)",
      [{ text: "OK" }]
    );
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      transparent={false}
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        {/* Maybe later / dismiss */}
        <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
          <Feather name="x" size={22} color={theme.textSecondary} />
        </TouchableOpacity>

        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerIcon}>
              <Feather name="star" size={26} color={theme.accent} />
            </View>
            <Text style={styles.title}>Upgrade Folvio</Text>
            <Text style={styles.subtitle}>
              {triggerMessage(trigger)} requires a paid plan.
            </Text>
          </View>

          {/* Monthly / Annual toggle */}
          <View style={styles.billingToggle}>
            {(["monthly", "yearly"] as BillingPeriod[]).map((period) => (
              <TouchableOpacity
                key={period}
                style={[
                  styles.billingOption,
                  billing === period && styles.billingOptionActive,
                ]}
                onPress={() => setBilling(period)}
              >
                <Text
                  style={[
                    styles.billingOptionText,
                    billing === period && styles.billingOptionTextActive,
                  ]}
                >
                  {period === "monthly" ? "Monthly" : "Annual"}
                </Text>
                {period === "yearly" && (
                  <View style={styles.savingsBadge}>
                    <Text style={styles.savingsText}>
                      Save {YEARLY_SAVINGS_PCT.investor}%
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            ))}
          </View>

          {/* Free tier — only show when current tier is free */}
          {currentTier === "free" && <FreePlanCard />}

          {/* Investor plan */}
          <PaidPlanCard
            tier="investor"
            label="Investor"
            tagline="For serious ETF investors"
            features={INVESTOR_FEATURES}
            billing={billing}
            highlighted={required === "investor"}
            badge="RECOMMENDED"
            badgeColor="#3B82F6"
            onSubscribe={handleSubscribe}
          />

          {/* Pro plan */}
          <PaidPlanCard
            tier="pro"
            label="Pro"
            tagline="Full power + AI insights"
            features={PRO_FEATURES}
            billing={billing}
            highlighted={required === "pro"}
            badge="PRO"
            badgeColor={theme.accent}
            onSubscribe={handleSubscribe}
          />

          {/* Restore purchase */}
          <TouchableOpacity onPress={handleRestorePurchase} style={styles.restoreBtn}>
            <Text style={styles.restoreText}>Restore Purchase</Text>
          </TouchableOpacity>

          {/* Maybe later */}
          <TouchableOpacity onPress={onClose} style={styles.maybeLaterBtn}>
            <Text style={styles.maybeLaterText}>Maybe later</Text>
          </TouchableOpacity>

          <Text style={styles.fine}>
            Subscription managed via App Store. Cancel anytime.{"\n"}
            Prices in EUR incl. applicable taxes.
          </Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background, paddingTop: 12 },
  closeBtn:  { alignSelf: "flex-end", padding: 16 },

  scroll: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    gap: 14,
  },

  // Header
  header: { alignItems: "center", gap: 10, marginBottom: 4 },
  headerIcon: {
    width: 64,
    height: 64,
    borderRadius: 0,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.hairline,
    alignItems: "center",
    justifyContent: "center",
  },
  title:    { fontSize: 24, fontFamily: "Archivo_800ExtraBold",    color: theme.text,          letterSpacing: -0.5, textAlign: "center" },
  subtitle: { fontSize: 14, fontFamily: "Archivo_400Regular", color: theme.textSecondary, textAlign: "center", lineHeight: 20 },

  // Billing toggle
  billingToggle: {
    flexDirection: "row",
    backgroundColor: theme.surface,
    borderRadius: 0,
    padding: 4,
    borderWidth: 1,
    borderColor: theme.hairline,
  },
  billingOption: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 9,
    borderRadius: 0,
  },
  billingOptionActive: {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.hairline,
  },
  billingOptionText:       { fontSize: 13, fontFamily: "Archivo_600SemiBold", color: theme.textSecondary },
  billingOptionTextActive: { color: theme.text },
  savingsBadge: {
    backgroundColor: theme.positive + "22",
    borderRadius: 0,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  savingsText: { fontSize: 10, fontFamily: "Archivo_600SemiBold", color: theme.positive },

  // Plan card
  planCard: {
    backgroundColor: theme.surface,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: theme.hairline,
    padding: 18,
    gap: 14,
  },
  planCardFree: {
    opacity: 0.7,
  },
  planBadgeWrap: {
    alignSelf: "flex-start",
    borderRadius: 0,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  planBadgeText: { fontSize: 10, fontFamily: "Archivo_800ExtraBold", letterSpacing: 0.5 },

  planHeader:   { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  planName:     { fontSize: 18, fontFamily: "Archivo_800ExtraBold",    color: theme.text },
  planTagline:  { fontSize: 12, fontFamily: "Archivo_400Regular", color: theme.textSecondary, marginTop: 2 },

  planPriceBlock: { alignItems: "flex-end", gap: 1 },
  planPrice:      { fontSize: 22, fontFamily: "Archivo_800ExtraBold",    color: theme.accent },
  planPeriod:     { fontSize: 12, fontFamily: "Archivo_400Regular", color: theme.textSecondary },
  monthlyEq:      { fontSize: 11, fontFamily: "Archivo_400Regular", color: theme.textTertiary, marginTop: -8 },

  featureList:     { gap: 10 },
  featureRow:      { flexDirection: "row", alignItems: "center", gap: 10 },
  featureIconWrap: {
    width: 22,
    height: 22,
    borderRadius: 0,
    backgroundColor: theme.positive + "18",
    alignItems: "center",
    justifyContent: "center",
  },
  featureIconWrapMuted: {
    backgroundColor: theme.surface,
  },
  featureText: { fontSize: 13, fontFamily: "Archivo_400Regular", color: theme.text, flex: 1 },

  // CTA
  cta: {
    paddingVertical: 14,
    borderRadius: 0,
    alignItems: "center",
  },
  ctaText: { fontSize: 15, fontFamily: "Archivo_800ExtraBold", color: "#0A0F1E" },

  // Restore / Maybe later
  restoreBtn: { alignItems: "center", paddingVertical: 4 },
  restoreText: { fontSize: 13, fontFamily: "Archivo_600SemiBold", color: theme.textSecondary, textDecorationLine: "underline" },

  maybeLaterBtn: { alignItems: "center", paddingVertical: 4 },
  maybeLaterText: { fontSize: 13, fontFamily: "Archivo_400Regular", color: theme.textTertiary },

  // Fine print
  fine: {
    fontSize: 11,
    fontFamily: "Archivo_400Regular",
    color: theme.textTertiary,
    textAlign: "center",
    lineHeight: 16,
    marginTop: 4,
  },
});
