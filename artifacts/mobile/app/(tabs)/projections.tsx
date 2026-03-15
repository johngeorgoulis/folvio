import { Feather } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
  useColorScheme,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { Card } from "@/components/ui/Card";
import { LineChart } from "@/components/LineChart";
import { usePortfolio } from "@/context/PortfolioContext";
import { formatEUR } from "@/utils/format";

function StepperInput({
  label,
  value,
  onChange,
  step = 1,
  suffix = "%",
  min = 0,
  max = 100,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  suffix?: string;
  min?: number;
  max?: number;
}) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const theme = isDark ? Colors.dark : Colors.light;
  return (
    <View style={stepStyles.container}>
      <Text style={[stepStyles.label, { color: theme.textSecondary }]}>{label}</Text>
      <View style={[stepStyles.row, { backgroundColor: isDark ? "#1E1E1E" : "#F3F4F6", borderColor: theme.border }]}>
        <TouchableOpacity
          style={stepStyles.btn}
          onPress={() => onChange(Math.max(min, value - step))}
        >
          <Feather name="minus" size={16} color={theme.text} />
        </TouchableOpacity>
        <Text style={[stepStyles.value, { color: theme.text }]}>
          {value}
          {suffix}
        </Text>
        <TouchableOpacity
          style={stepStyles.btn}
          onPress={() => onChange(Math.min(max, value + step))}
        >
          <Feather name="plus" size={16} color={theme.text} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const stepStyles = StyleSheet.create({
  container: { gap: 6 },
  label: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 1,
    overflow: "hidden",
  },
  btn: { padding: 12, alignItems: "center" },
  value: {
    flex: 1,
    textAlign: "center",
    fontSize: 15,
    fontFamily: "Inter_700Bold",
  },
});

function computeProjection(
  startValue: number,
  monthlyDca: number,
  annualReturn: number,
  escalationPct: number,
  years: number,
) {
  const monthlyRate = annualReturn / 100 / 12;
  const escalationMonthly = escalationPct / 100 / 12;
  let value = startValue;
  let dca = monthlyDca;
  const results: { year: number; value: number }[] = [
    { year: 0, value: startValue },
  ];

  for (let y = 1; y <= years; y++) {
    for (let m = 0; m < 12; m++) {
      value = value * (1 + monthlyRate) + dca;
      dca = dca * (1 + escalationMonthly);
    }
    if (y === 10 || y === 20 || y === 30 || y === years) {
      results.push({ year: y, value });
    }
  }
  return results;
}

export default function ProjectionsScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const theme = isDark ? Colors.dark : Colors.light;
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const topPad = Platform.OS === "web" ? 24 : insets.top;

  const {
    totalPortfolioValue,
    projectionsConfig,
    updateProjectionsConfig,
  } = usePortfolio();

  const {
    conservativePct,
    basePct,
    optimisticPct,
    monthlyDca,
    escalationPct,
  } = projectionsConfig;

  const startValue = totalPortfolioValue;

  const years = 30;

  const conservative = useMemo(
    () =>
      computeProjection(startValue, monthlyDca, conservativePct, escalationPct, years),
    [startValue, monthlyDca, conservativePct, escalationPct],
  );
  const base = useMemo(
    () =>
      computeProjection(startValue, monthlyDca, basePct, escalationPct, years),
    [startValue, monthlyDca, basePct, escalationPct],
  );
  const optimistic = useMemo(
    () =>
      computeProjection(startValue, monthlyDca, optimisticPct, escalationPct, years),
    [startValue, monthlyDca, optimisticPct, escalationPct],
  );

  const chartWidth = width - 48;

  const tableYears = [10, 20, 30];

  const getAtYear = (arr: { year: number; value: number }[], y: number) =>
    arr.find((p) => p.year === y)?.value ?? 0;

  const [extraDCA, setExtraDCA] = useState(0);
  const enhancedBase = useMemo(
    () =>
      computeProjection(
        startValue,
        monthlyDca + extraDCA,
        basePct,
        escalationPct,
        years,
      ),
    [startValue, monthlyDca, extraDCA, basePct, escalationPct],
  );

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.background }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: topPad + 16, paddingBottom: Platform.OS === "web" ? 100 : 32 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.headerRow}>
        <Text style={[styles.screenTitle, { color: theme.text }]}>
          Projections
        </Text>
        <Text style={[styles.screenSubtitle, { color: theme.textSecondary }]}>
          30-year scenarios
        </Text>
      </View>

      <Card padding={16}>
        <Text style={[styles.cardTitle, { color: theme.text }]}>Settings</Text>
        <View style={styles.settingsGrid}>
          <StepperInput
            label="MONTHLY DCA"
            value={monthlyDca}
            onChange={(v) => updateProjectionsConfig({ monthlyDca: v })}
            step={50}
            suffix="€"
            max={10000}
          />
          <StepperInput
            label="DCA ESCALATION"
            value={escalationPct}
            onChange={(v) => updateProjectionsConfig({ escalationPct: v })}
            step={1}
            suffix="%"
            max={20}
          />
        </View>
        <View style={[styles.settingsGrid, { marginTop: 12 }]}>
          <StepperInput
            label="CONSERVATIVE"
            value={conservativePct}
            onChange={(v) => updateProjectionsConfig({ conservativePct: v })}
            step={1}
            suffix="%"
            max={50}
          />
          <StepperInput
            label="BASE"
            value={basePct}
            onChange={(v) => updateProjectionsConfig({ basePct: v })}
            step={1}
            suffix="%"
            max={50}
          />
          <StepperInput
            label="OPTIMISTIC"
            value={optimisticPct}
            onChange={(v) => updateProjectionsConfig({ optimisticPct: v })}
            step={1}
            suffix="%"
            max={50}
          />
        </View>
      </Card>

      <Card padding={16}>
        <Text style={[styles.cardTitle, { color: theme.text }]}>
          Portfolio Growth
        </Text>
        <View style={styles.legendRow}>
          <View style={styles.legendItem}>
            <View style={[styles.legendLine, { backgroundColor: theme.positive }]} />
            <Text style={[styles.legendLabel, { color: theme.textSecondary }]}>
              Base ({basePct}%)
            </Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendLine, { backgroundColor: "rgba(0,208,132,0.5)", borderStyle: "dashed" }]} />
            <Text style={[styles.legendLabel, { color: theme.textSecondary }]}>
              Optimistic ({optimisticPct}%)
            </Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendLine, { backgroundColor: isDark ? "#4B5563" : "#D1D5DB" }]} />
            <Text style={[styles.legendLabel, { color: theme.textSecondary }]}>
              Conservative ({conservativePct}%)
            </Text>
          </View>
        </View>
        <LineChart
          conservative={conservative}
          base={base}
          optimistic={optimistic}
          width={chartWidth}
          height={200}
        />
        <Text style={[styles.startValue, { color: theme.textSecondary }]}>
          Starting: {formatEUR(startValue)} · DCA: {formatEUR(monthlyDca)}/mo
        </Text>
      </Card>

      <Card padding={16}>
        <Text style={[styles.cardTitle, { color: theme.text }]}>Milestones</Text>
        <View style={[styles.tableHeader, { borderBottomColor: theme.border }]}>
          <Text style={[styles.tableHeaderText, { color: theme.textSecondary }]}>
            YEAR
          </Text>
          <Text style={[styles.tableHeaderText, { color: theme.textSecondary }]}>
            CONSERVATIVE
          </Text>
          <Text style={[styles.tableHeaderText, { color: theme.textSecondary }]}>
            BASE
          </Text>
          <Text style={[styles.tableHeaderText, { color: theme.textSecondary }]}>
            OPTIMISTIC
          </Text>
        </View>
        {tableYears.map((y) => (
          <View
            key={y}
            style={[styles.tableRow, { borderBottomColor: theme.borderLight }]}
          >
            <Text style={[styles.tableYear, { color: theme.text }]}>{y}yr</Text>
            <Text style={[styles.tableCell, { color: theme.textSecondary }]}>
              {formatEUR(getAtYear(conservative, y), true)}
            </Text>
            <Text style={[styles.tableCell, { color: theme.positive }]}>
              {formatEUR(getAtYear(base, y), true)}
            </Text>
            <Text style={[styles.tableCell, { color: theme.textSecondary }]}>
              {formatEUR(getAtYear(optimistic, y), true)}
            </Text>
          </View>
        ))}
      </Card>

      <Card padding={16}>
        <Text style={[styles.cardTitle, { color: theme.text }]}>
          What if I add extra DCA?
        </Text>
        <Text style={[styles.whatIfSub, { color: theme.textSecondary }]}>
          Extra {formatEUR(extraDCA)}/mo → base 30yr: {formatEUR(getAtYear(enhancedBase, 30), true)}
        </Text>
        <View style={styles.extraDCARow}>
          {[0, 50, 100, 200, 500].map((v) => (
            <TouchableOpacity
              key={v}
              style={[
                styles.extraChip,
                {
                  backgroundColor:
                    extraDCA === v
                      ? theme.tint
                      : isDark
                      ? "#1E1E1E"
                      : "#F3F4F6",
                  borderColor:
                    extraDCA === v ? theme.tint : theme.border,
                },
              ]}
              onPress={() => setExtraDCA(v)}
            >
              <Text
                style={[
                  styles.extraChipText,
                  { color: extraDCA === v ? "#fff" : theme.text },
                ]}
              >
                {v === 0 ? "None" : `+€${v}`}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        {extraDCA > 0 && (
          <View style={styles.extraImpactGrid}>
            {tableYears.map((y) => (
              <View
                key={y}
                style={[
                  styles.extraImpactCard,
                  { backgroundColor: isDark ? "#1E1E1E" : "#F0FDF8" },
                ]}
              >
                <Text style={[styles.extraImpactYear, { color: theme.textSecondary }]}>
                  {y}yr
                </Text>
                <Text style={[styles.extraImpactVal, { color: theme.positive }]}>
                  {formatEUR(getAtYear(enhancedBase, y), true)}
                </Text>
                <Text style={[styles.extraImpactDiff, { color: theme.textTertiary }]}>
                  +{formatEUR(getAtYear(enhancedBase, y) - getAtYear(base, y), true)}
                </Text>
              </View>
            ))}
          </View>
        )}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 12 },
  headerRow: { marginBottom: 4 },
  screenTitle: { fontSize: 28, fontFamily: "Inter_700Bold", letterSpacing: -1 },
  screenSubtitle: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  cardTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 14 },
  settingsGrid: { flexDirection: "row", gap: 12, flexWrap: "wrap" },
  legendRow: { flexDirection: "row", gap: 12, marginBottom: 12, flexWrap: "wrap" },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendLine: { width: 16, height: 2, borderRadius: 1 },
  legendLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
  startValue: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 8, textAlign: "center" },
  tableHeader: {
    flexDirection: "row",
    paddingBottom: 8,
    borderBottomWidth: 1,
    marginBottom: 4,
  },
  tableHeaderText: {
    flex: 1,
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.5,
    textAlign: "center",
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  tableYear: { flex: 1, fontSize: 14, fontFamily: "Inter_700Bold", textAlign: "center" },
  tableCell: { flex: 1, fontSize: 12, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  whatIfSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 12 },
  extraDCARow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  extraChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  extraChipText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  extraImpactGrid: { flexDirection: "row", gap: 8, marginTop: 16 },
  extraImpactCard: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 12,
    borderRadius: 10,
    gap: 4,
  },
  extraImpactYear: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  extraImpactVal: { fontSize: 14, fontFamily: "Inter_700Bold" },
  extraImpactDiff: { fontSize: 10, fontFamily: "Inter_500Medium" },
});
