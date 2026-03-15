import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useColorScheme,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { Card } from "@/components/ui/Card";
import { usePortfolio } from "@/context/PortfolioContext";
import { formatEUR } from "@/utils/format";

function generateId() {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

export default function SurplusScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const theme = isDark ? Colors.dark : Colors.light;
  const insets = useSafeAreaInsets();

  const { surplusConfig, updateSurplusConfig, projectionsConfig, updateProjectionsConfig } =
    usePortfolio();

  const [incomeText, setIncomeText] = useState(
    surplusConfig.monthlyIncome > 0 ? String(surplusConfig.monthlyIncome) : "",
  );
  const [newCostLabel, setNewCostLabel] = useState("");
  const [newCostAmount, setNewCostAmount] = useState("");

  const topPad = Platform.OS === "web" ? 24 : insets.top;

  const totalFixed = surplusConfig.fixedCosts.reduce((s, c) => s + c.amount, 0);
  const income = Number(incomeText) || 0;
  const surplus = income - totalFixed;

  const handleIncomeBlur = () => {
    const v = Number(incomeText);
    if (!isNaN(v) && v >= 0) {
      updateSurplusConfig({ monthlyIncome: v });
    }
  };

  const addCost = () => {
    if (!newCostLabel.trim()) {
      Alert.alert("Required", "Please enter a label.");
      return;
    }
    const amount = Number(newCostAmount);
    if (isNaN(amount) || amount <= 0) {
      Alert.alert("Required", "Please enter a valid amount.");
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    updateSurplusConfig({
      fixedCosts: [
        ...surplusConfig.fixedCosts,
        { id: generateId(), label: newCostLabel.trim(), amount },
      ],
    });
    setNewCostLabel("");
    setNewCostAmount("");
  };

  const removeCost = (id: string) => {
    updateSurplusConfig({
      fixedCosts: surplusConfig.fixedCosts.filter((c) => c.id !== id),
    });
  };

  const sendToDCA = () => {
    if (surplus <= 0) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    updateProjectionsConfig({ monthlyDca: Math.round(surplus) });
    Alert.alert(
      "DCA Updated",
      `Your monthly DCA has been set to ${formatEUR(Math.round(surplus))} in the Projections tab.`,
    );
  };

  const inputStyle = [
    styles.input,
    { backgroundColor: isDark ? "#1E1E1E" : "#F8F9FA", borderColor: theme.border, color: theme.text },
  ];
  const labelStyle = [styles.label, { color: theme.textSecondary }];

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        style={[styles.container, { backgroundColor: theme.background }]}
        contentContainerStyle={[
          styles.content,
          { paddingTop: topPad + 16, paddingBottom: Platform.OS === "web" ? 100 : 40 },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.headerRow}>
          <Text style={[styles.screenTitle, { color: theme.text }]}>
            Surplus
          </Text>
          <Text style={[styles.screenSubtitle, { color: theme.textSecondary }]}>
            How much can I invest?
          </Text>
        </View>

        <Card padding={20}>
          <Text style={labelStyle}>MONTHLY NET INCOME</Text>
          <View style={styles.incomeRow}>
            <View style={[styles.currencyBadge, { backgroundColor: isDark ? "#1E1E1E" : "#F3F4F6" }]}>
              <Text style={[styles.currencyText, { color: theme.textSecondary }]}>€</Text>
            </View>
            <TextInput
              style={[
                inputStyle,
                { flex: 1, borderTopLeftRadius: 0, borderBottomLeftRadius: 0 },
              ]}
              placeholder="e.g. 3000"
              placeholderTextColor={theme.textTertiary}
              value={incomeText}
              onChangeText={setIncomeText}
              onBlur={handleIncomeBlur}
              keyboardType="decimal-pad"
            />
          </View>
        </Card>

        <Card padding={16}>
          <Text style={[styles.cardTitle, { color: theme.text }]}>Fixed Monthly Costs</Text>
          {surplusConfig.fixedCosts.length === 0 && (
            <Text style={[styles.emptyCosts, { color: theme.textSecondary }]}>
              No fixed costs added yet.
            </Text>
          )}
          {surplusConfig.fixedCosts.map((cost) => (
            <View
              key={cost.id}
              style={[
                styles.costRow,
                { borderBottomColor: theme.borderLight },
              ]}
            >
              <View style={styles.costLeft}>
                <Feather name="minus-circle" size={16} color={theme.negative} />
                <Text style={[styles.costLabel, { color: theme.text }]}>
                  {cost.label}
                </Text>
              </View>
              <View style={styles.costRight}>
                <Text style={[styles.costAmount, { color: theme.text }]}>
                  {formatEUR(cost.amount)}
                </Text>
                <TouchableOpacity
                  onPress={() => removeCost(cost.id)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Feather name="x" size={16} color={theme.textTertiary} />
                </TouchableOpacity>
              </View>
            </View>
          ))}

          <View style={[styles.addCostRow, { marginTop: 12 }]}>
            <TextInput
              style={[inputStyle, { flex: 2 }]}
              placeholder="e.g. Rent"
              placeholderTextColor={theme.textTertiary}
              value={newCostLabel}
              onChangeText={setNewCostLabel}
            />
            <TextInput
              style={[inputStyle, { flex: 1 }]}
              placeholder="€"
              placeholderTextColor={theme.textTertiary}
              value={newCostAmount}
              onChangeText={setNewCostAmount}
              keyboardType="decimal-pad"
            />
            <TouchableOpacity
              style={[styles.addCostBtn, { backgroundColor: theme.tint }]}
              onPress={addCost}
              activeOpacity={0.85}
            >
              <Feather name="plus" size={18} color="#fff" />
            </TouchableOpacity>
          </View>
        </Card>

        <Card padding={20}>
          <View style={styles.surplusSummary}>
            <View>
              <Text style={[styles.sumLine, { color: theme.textSecondary }]}>
                Income
              </Text>
              <Text style={[styles.sumLine, { color: theme.textSecondary }]}>
                Fixed Costs
              </Text>
              <View style={[styles.sumDivider, { backgroundColor: theme.border }]} />
              <Text style={[styles.sumLineResult, { color: theme.text }]}>
                Investable Surplus
              </Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={[styles.sumAmt, { color: theme.text }]}>
                {formatEUR(income)}
              </Text>
              <Text style={[styles.sumAmt, { color: theme.negative }]}>
                -{formatEUR(totalFixed)}
              </Text>
              <View style={[styles.sumDivider, { backgroundColor: theme.border }]} />
              <Text
                style={[
                  styles.sumAmtResult,
                  { color: surplus > 0 ? theme.positive : theme.negative },
                ]}
              >
                {formatEUR(surplus)}
              </Text>
            </View>
          </View>

          {surplus > 0 && (
            <TouchableOpacity
              style={[styles.dcaBtn, { backgroundColor: theme.tint }]}
              onPress={sendToDCA}
              activeOpacity={0.85}
            >
              <Feather name="send" size={16} color="#fff" />
              <Text style={styles.dcaBtnText}>
                Set {formatEUR(Math.round(surplus))} as Monthly DCA
              </Text>
            </TouchableOpacity>
          )}
        </Card>

        <Card padding={16}>
          <View style={styles.projRow}>
            <View
              style={[
                styles.projIcon,
                { backgroundColor: "rgba(0, 208, 132, 0.12)" },
              ]}
            >
              <Feather name="trending-up" size={18} color={theme.positive} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.projTitle, { color: theme.text }]}>
                Current DCA Budget
              </Text>
              <Text style={[styles.projValue, { color: theme.positive }]}>
                {formatEUR(projectionsConfig.monthlyDca)}/month
              </Text>
              <Text style={[styles.projHint, { color: theme.textSecondary }]}>
                Tap "Set Monthly DCA" to sync your surplus automatically.
              </Text>
            </View>
          </View>
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 12 },
  headerRow: { marginBottom: 4 },
  screenTitle: { fontSize: 28, fontFamily: "Inter_700Bold", letterSpacing: -1 },
  screenSubtitle: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  label: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.8, marginBottom: 8 },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  incomeRow: { flexDirection: "row" },
  currencyBadge: {
    paddingHorizontal: 14,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 12,
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
  },
  currencyText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  cardTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 12 },
  emptyCosts: { fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 8 },
  costRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  costLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  costLabel: { fontSize: 14, fontFamily: "Inter_400Regular" },
  costRight: { flexDirection: "row", alignItems: "center", gap: 12 },
  costAmount: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  addCostRow: { flexDirection: "row", gap: 8 },
  addCostBtn: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  surplusSummary: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  sumLine: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 28 },
  sumLineResult: { fontSize: 15, fontFamily: "Inter_700Bold", lineHeight: 32 },
  sumAmt: { fontSize: 14, fontFamily: "Inter_600SemiBold", lineHeight: 28 },
  sumAmtResult: { fontSize: 22, fontFamily: "Inter_700Bold", letterSpacing: -0.5, lineHeight: 32 },
  sumDivider: { height: 1, marginVertical: 8 },
  dcaBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
  },
  dcaBtnText: {
    color: "#fff",
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  projRow: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  projIcon: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  projTitle: { fontSize: 13, fontFamily: "Inter_500Medium" },
  projValue: { fontSize: 20, fontFamily: "Inter_700Bold", letterSpacing: -0.5, marginTop: 2 },
  projHint: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 4, lineHeight: 16 },
});
