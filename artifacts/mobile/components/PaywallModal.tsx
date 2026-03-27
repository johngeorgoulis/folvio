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
import Colors from "@/constants/colors";
import {
  PRICES,
  YEARLY_SAVINGS_PCT,
  requiredTierFor,
  useSubscription,
  type BillingPeriod,
  type SubscriptionTier,
} from "@/context/SubscriptionContext";
import { FREE_TIER_LIMIT } from "@/context/PortfolioContext";

const theme = Colors.dark;

// ─── Plan definitions ──────────────────────────────────────────────────────────

const INVESTOR_FEATURES = [
  { icon: "layers"      as const, text: `Unlimited holdings (free: ${FREE_TIER_LIMIT} max)` },
  { icon: "book"        as const, text: "DCA contribution log" },
  { icon: "trending-up" as const, text: "All projection scenarios (Conservative & Optimistic)" },
  { icon: "bell"        as const, text: "Push notifications (DCA reminders, drift alerts)" },
  { icon: "sliders"     as const, text: "Rebalancing suggestions (DCA & full)" },
];

const PRO_FEATURES = [
  { icon: "check-circle" as const, text: "Everything in Investor" },
  { icon: "upload"       as const, text: "CSV import from 10+ brokers" },
  { icon: "download"     as const, text: "Export portfolio to CSV" },
  { icon: "bar-chart-2"  as const, text: "Benchmark comparison (S&P 500, MSCI World…)" },
];

// ─── Trigger → human-readable copy ────────────────────────────────────────────

function triggerMessage(trigger?: string): string {
  switch (trigger) {
    case "holdings":      return `Add more than ${FREE_TIER_LIMIT} holdings`;
    case "dca-log":       return "Log DCA contributions";
    case "all-scenarios": return "Conservative & Optimistic projections";
    case "notifications": return "Push notifications";
    case "rebalance":     return "Rebalancing suggestions";
    case "import":        return "Import from CSV";
    case "export":        return "Export to CSV";
    case "benchmark":     return "Benchmark comparison";
    default:              return "Unlock all Folvio features";
  }
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function FeatureRow({ icon, text }: { icon: React.ComponentProps<typeof Feather>["name"]; text: string }) {
  return (
    <View style={styles.featureRow}>
      <View style={styles.featureIconWrap}>
        <Feather name={icon} size={13} color={theme.positive} />
      </View>
      <Text style={styles.featureText}>{text}</Text>
    </View>
  );
}

function PlanCard({
  tier,
  label,
  tagline,
  features,
  billing,
  highlighted,
  badge,
  onSubscribe,
}: {
  tier:        SubscriptionTier;
  label:       string;
  tagline:     string;
  features:    typeof INVESTOR_FEATURES;
  billing:     BillingPeriod;
  highlighted: boolean;
  badge?:      string;
  onSubscribe: (tier: SubscriptionTier) => void;
}) {
  const price    = PRICES[tier as "investor" | "pro"][billing];
  const monthlyEq = billing === "yearly" ? (PRICES[tier as "investor" | "pro"].yearly / 12).toFixed(2) : null;

  return (
    <View style={[styles.planCard, highlighted && styles.planCardHighlighted]}>
      {badge && (
        <View style={styles.planBadgeWrap}>
          <Text style={styles.planBadgeText}>{badge}</Text>
        </View>
      )}

      <View style={styles.planHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.planName}>{label}</Text>
          <Text style={styles.planTagline}>{tagline}</Text>
        </View>
        <View style={styles.planPriceBlock}>
          <Text style={styles.planPrice}>
            €{price.toFixed(2).replace(".", ",")}
          </Text>
          <Text style={styles.planPeriod}>
            /{billing === "monthly" ? "mo" : "yr"}
          </Text>
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
        style={[styles.cta, highlighted ? styles.ctaPrimary : styles.ctaSecondary]}
        onPress={() => onSubscribe(tier)}
        activeOpacity={0.85}
      >
        <Text style={[styles.ctaText, !highlighted && { color: theme.text }]}>
          Get {label}
        </Text>
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
  const [billing, setBilling] = useState<BillingPeriod>("yearly");
  const { setSubscription } = useSubscription();
  const required = requiredTierFor(trigger);

  async function handleSubscribe(tier: SubscriptionTier) {
    const tierName = tier === "investor" ? "Investor" : "Pro";
    const price    = PRICES[tier as "investor" | "pro"][billing];

    // TODO: Replace with RevenueCat purchase call before release.
    // The Alert below simulates the purchase flow for development/testing.
    Alert.alert(
      `Subscribe to ${tierName}`,
      `€${price.toFixed(2).replace(".", ",")}/${billing === "monthly" ? "month" : "year"}\n\nRevenueCat in-app purchase will be triggered here before release.`,
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

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      transparent={false}
      onRequestClose={onClose}
    >
      <View style={styles.container}>
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
              <Feather name="star" size={26} color={theme.tint} />
            </View>
            <Text style={styles.title}>Upgrade Folvio</Text>
            <Text style={styles.subtitle}>
              {triggerMessage(trigger)} requires a paid plan.
            </Text>
          </View>

          {/* Billing toggle */}
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
                  {period === "monthly" ? "Monthly" : "Yearly"}
                </Text>
                {period === "yearly" && (
                  <View style={styles.savingsBadge}>
                    <Text style={styles.savingsText}>
                      Save {YEARLY_SAVINGS_PCT.pro}%
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            ))}
          </View>

          {/* Investor plan */}
          <PlanCard
            tier="investor"
            label="Investor"
            tagline="For serious ETF investors"
            features={INVESTOR_FEATURES}
            billing={billing}
            highlighted={required === "investor"}
            onSubscribe={handleSubscribe}
          />

          {/* Pro plan */}
          <PlanCard
            tier="pro"
            label="Pro"
            tagline="Full power, unlimited"
            features={PRO_FEATURES}
            billing={billing}
            highlighted={required === "pro"}
            badge="BEST VALUE"
            onSubscribe={handleSubscribe}
          />

          <Text style={styles.fine}>
            Subscriptions auto-renew. Cancel anytime via App Store or Google Play.
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
    gap: 16,
  },

  // Header
  header: { alignItems: "center", gap: 10, marginBottom: 4 },
  headerIcon: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: theme.backgroundElevated,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: "center",
    justifyContent: "center",
  },
  title:    { fontSize: 24, fontFamily: "Inter_700Bold",    color: theme.text,          letterSpacing: -0.5, textAlign: "center" },
  subtitle: { fontSize: 14, fontFamily: "Inter_400Regular", color: theme.textSecondary, textAlign: "center", lineHeight: 20 },

  // Billing toggle
  billingToggle: {
    flexDirection: "row",
    backgroundColor: theme.backgroundElevated,
    borderRadius: 12,
    padding: 4,
    borderWidth: 1,
    borderColor: theme.border,
  },
  billingOption: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 9,
    borderRadius: 9,
  },
  billingOptionActive: {
    backgroundColor: theme.deepBlue,
    borderWidth: 1,
    borderColor: theme.border,
  },
  billingOptionText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: theme.textSecondary,
  },
  billingOptionTextActive: { color: theme.text },
  savingsBadge: {
    backgroundColor: theme.positive + "22",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  savingsText: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: theme.positive },

  // Plan card
  planCard: {
    backgroundColor: theme.backgroundCard,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 18,
    gap: 14,
  },
  planCardHighlighted: {
    borderColor: theme.tint,
    borderWidth: 1.5,
  },
  planBadgeWrap: {
    alignSelf: "flex-start",
    backgroundColor: theme.tint + "22",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  planBadgeText: { fontSize: 10, fontFamily: "Inter_700Bold", color: theme.tint, letterSpacing: 0.5 },

  planHeader: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  planName:   { fontSize: 18, fontFamily: "Inter_700Bold",    color: theme.text },
  planTagline: { fontSize: 12, fontFamily: "Inter_400Regular", color: theme.textSecondary, marginTop: 2 },

  planPriceBlock: { alignItems: "flex-end", gap: 1 },
  planPrice:  { fontSize: 22, fontFamily: "Inter_700Bold",    color: theme.tint },
  planPeriod: { fontSize: 12, fontFamily: "Inter_400Regular", color: theme.textSecondary },
  monthlyEq:  { fontSize: 11, fontFamily: "Inter_400Regular", color: theme.textTertiary, marginTop: -8 },

  featureList: { gap: 10 },
  featureRow:  { flexDirection: "row", alignItems: "center", gap: 10 },
  featureIconWrap: {
    width: 22,
    height: 22,
    borderRadius: 6,
    backgroundColor: theme.positive + "18",
    alignItems: "center",
    justifyContent: "center",
  },
  featureText: { fontSize: 13, fontFamily: "Inter_400Regular", color: theme.text, flex: 1 },

  // CTAs
  cta: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  ctaPrimary:   { backgroundColor: theme.tint },
  ctaSecondary: { backgroundColor: theme.backgroundElevated, borderWidth: 1, borderColor: theme.border },
  ctaText: { fontSize: 15, fontFamily: "Inter_700Bold", color: theme.background },

  // Fine print
  fine: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: theme.textTertiary,
    textAlign: "center",
    lineHeight: 16,
    marginTop: 4,
  },
});
