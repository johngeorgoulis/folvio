import { Feather } from "@expo/vector-icons";
import React from "react";
import {
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useColorScheme,
} from "react-native";
import Colors from "@/constants/colors";
import { FREE_TIER_LIMIT } from "@/context/PortfolioContext";

interface Props {
  visible: boolean;
  onClose: () => void;
}

const FEATURES = [
  { icon: "layers" as const, text: `Unlimited holdings (free: ${FREE_TIER_LIMIT} max)` },
  { icon: "download" as const, text: "Export portfolio to CSV" },
  { icon: "bar-chart-2" as const, text: "Benchmark comparison (VWCE)" },
  { icon: "bell" as const, text: "Rebalancing alerts" },
  { icon: "refresh-cw" as const, text: "Automatic price updates" },
];

export default function PremiumModal({ visible, onClose }: Props) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const theme = isDark ? Colors.dark : Colors.light;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" transparent={false} onRequestClose={onClose}>
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
          <Feather name="x" size={22} color={theme.textSecondary} />
        </TouchableOpacity>

        <View style={styles.inner}>
          <View style={[styles.iconWrap, { backgroundColor: theme.deepBlue }]}>
            <Feather name="star" size={28} color="#C9A84C" />
          </View>

          <Text style={[styles.title, { color: theme.text }]}>Fortis Premium</Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
            Built for serious European passive investors.
          </Text>

          <View style={[styles.featureList, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}>
            {FEATURES.map((f, i) => (
              <View key={i} style={styles.featureRow}>
                <View style={[styles.featureIcon, { backgroundColor: theme.deepBlue + "33" }]}>
                  <Feather name={f.icon} size={15} color={theme.tint} />
                </View>
                <Text style={[styles.featureText, { color: theme.text }]}>{f.text}</Text>
              </View>
            ))}
          </View>

          <View style={[styles.priceBox, { backgroundColor: theme.deepBlue }]}>
            <Text style={styles.priceLabel}>Monthly</Text>
            <Text style={styles.price}>€4,99 / month</Text>
            <Text style={styles.priceSub}>Cancel anytime · No commitment</Text>
          </View>

          <TouchableOpacity style={[styles.cta, { backgroundColor: theme.tint }]} onPress={onClose}>
            <Text style={styles.ctaText}>Coming Soon — Stay Tuned</Text>
          </TouchableOpacity>

          <Text style={[styles.fine, { color: theme.textTertiary }]}>
            Premium features via in-app purchase on iOS & Android.
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 20 },
  closeBtn: { alignSelf: "flex-end", padding: 16 },
  inner: { flex: 1, paddingHorizontal: 24, alignItems: "center", gap: 16 },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  title: { fontSize: 26, fontFamily: "Inter_700Bold", textAlign: "center", letterSpacing: -0.5 },
  subtitle: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20, marginTop: -4 },
  featureList: {
    width: "100%",
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  featureRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  featureIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  featureText: { fontSize: 14, fontFamily: "Inter_400Regular", flex: 1 },
  priceBox: {
    width: "100%",
    borderRadius: 16,
    padding: 20,
    alignItems: "center",
    gap: 4,
  },
  priceLabel: { color: "rgba(255,255,255,0.55)", fontSize: 12, fontFamily: "Inter_400Regular", letterSpacing: 0.5 },
  price: { color: "#C9A84C", fontSize: 28, fontFamily: "Inter_700Bold" },
  priceSub: { color: "rgba(255,255,255,0.5)", fontSize: 12, fontFamily: "Inter_400Regular" },
  cta: {
    width: "100%",
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: "center",
  },
  ctaText: { color: "#0A0F1A", fontSize: 16, fontFamily: "Inter_700Bold" },
  fine: { fontSize: 11, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 16 },
});
