import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import Svg, { Path, Line, Text as SvgText } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { usePortfolio } from "@/context/PortfolioContext";
import { useSubscription } from "@/context/SubscriptionContext";
import { formatEUR } from "@/utils/format";
import { getAssetClass } from "@/services/assetClassService";
import {
  generatePortfolioInsights,
  getCachedInsights,
  saveInsightsToCache,
  clearInsightsCache,
  type AIInsight,
} from "@/services/anthropicService";

// ─── Portfolio Risk Profile ────────────────────────────────────────────────────

const ETF_HISTORICAL_METRICS: Record<string, { annualReturn: number; volatility: number; maxDrawdown: number }> = {
  VWCE:             { annualReturn: 11.2, volatility: 14.8, maxDrawdown: -33.8 },
  TDIV:             { annualReturn:  8.4, volatility: 12.1, maxDrawdown: -28.4 },
  VHYL:             { annualReturn:  7.9, volatility: 11.8, maxDrawdown: -27.6 },
  ERNE:             { annualReturn:  9.1, volatility: 16.2, maxDrawdown: -31.2 },
  IEGE:             { annualReturn:  8.7, volatility: 13.4, maxDrawdown: -29.8 },
  VUAA:             { annualReturn: 12.8, volatility: 15.2, maxDrawdown: -33.9 },
  IWDA:             { annualReturn: 11.1, volatility: 14.6, maxDrawdown: -33.4 },
  CSBGE7:           { annualReturn:  1.2, volatility:  4.8, maxDrawdown: -18.2 },
  AGGH:             { annualReturn:  0.8, volatility:  5.2, maxDrawdown: -19.1 },
  IEAG:             { annualReturn:  1.1, volatility:  4.9, maxDrawdown: -18.8 },
  EGLN:             { annualReturn:  6.2, volatility: 15.8, maxDrawdown: -28.4 },
  DEFAULT_EQUITY:   { annualReturn:  9.5, volatility: 14.0, maxDrawdown: -32.0 },
  DEFAULT_BOND:     { annualReturn:  1.0, volatility:  5.0, maxDrawdown: -18.0 },
  DEFAULT_COMMODITY:{ annualReturn:  5.0, volatility: 15.0, maxDrawdown: -25.0 },
};

function getETFMetrics(ticker: string, isin?: string) {
  const key = ticker.toUpperCase();
  if (ETF_HISTORICAL_METRICS[key]) return ETF_HISTORICAL_METRICS[key];
  const ac = getAssetClass(ticker, isin);
  if (ac === "Bond")      return ETF_HISTORICAL_METRICS.DEFAULT_BOND;
  if (ac === "Commodity") return ETF_HISTORICAL_METRICS.DEFAULT_COMMODITY;
  return ETF_HISTORICAL_METRICS.DEFAULT_EQUITY;
}

interface RiskProfile {
  annualReturn: number;
  volatility: number;
  maxDrawdown: number;
  sharpe: number;
}

function computeRiskProfile(
  holdings: { ticker: string; isin?: string | null; quantity: number; currentPrice: number; hasPrice: boolean }[]
): RiskProfile | null {
  const totalValue = holdings.reduce(
    (sum, h) => sum + (h.hasPrice ? h.quantity * h.currentPrice : 0), 0
  );
  if (totalValue === 0) return null;

  let annualReturn = 0, volatility = 0, maxDrawdown = 0;
  for (const h of holdings) {
    if (!h.hasPrice) continue;
    const weight = (h.quantity * h.currentPrice) / totalValue;
    const m = getETFMetrics(h.ticker, h.isin ?? undefined);
    annualReturn += weight * m.annualReturn;
    volatility   += weight * m.volatility;
    maxDrawdown  += weight * m.maxDrawdown;
  }
  const sharpe = volatility > 0 ? (annualReturn - 2.5) / volatility : 0;
  return { annualReturn, volatility, maxDrawdown, sharpe };
}

function RiskProfileCard({ profile }: { profile: RiskProfile }) {
  const theme = Colors.dark;

  const sharpeColor =
    profile.sharpe > 0.5 ? theme.positive :
    profile.sharpe >= 0.3 ? "#FBBF24" : theme.negative;

  const volatilityColor = profile.volatility > 15 ? "#FBBF24" : theme.text;

  const sentence =
    profile.sharpe > 0.5
      ? "Your portfolio has a favorable risk-adjusted return profile."
      : profile.sharpe >= 0.3
      ? "Your portfolio balances growth and stability reasonably well."
      : "Your portfolio is conservatively positioned — lower returns but reduced volatility.";

  function showInfo() {
    Alert.alert(
      "About Risk Profile",
      "Based on 10-year historical averages for each ETF in your portfolio. Past performance does not guarantee future results.",
      [{ text: "Got it" }]
    );
  }

  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}>
      <View style={riskStyles.header}>
        <Text style={[styles.sectionTitle, { color: theme.text, marginBottom: 0 }]}>Portfolio Risk Profile</Text>
        <TouchableOpacity onPress={showInfo} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="info" size={15} color={theme.textTertiary} />
        </TouchableOpacity>
      </View>
      <Text style={[riskStyles.sub, { color: theme.textSecondary }]}>Based on your current allocation</Text>

      <View style={riskStyles.grid}>
        <View style={[riskStyles.cell, { borderColor: theme.border }]}>
          <Text style={[riskStyles.cellLabel, { color: theme.textSecondary }]}>Est. Annual Return</Text>
          <Text style={[riskStyles.cellValue, { color: theme.positive }]}>
            +{profile.annualReturn.toFixed(1)}%
          </Text>
        </View>
        <View style={[riskStyles.cell, riskStyles.cellRight, { borderColor: theme.border }]}>
          <Text style={[riskStyles.cellLabel, { color: theme.textSecondary }]}>Volatility</Text>
          <Text style={[riskStyles.cellValue, { color: volatilityColor }]}>
            {profile.volatility.toFixed(1)}%
          </Text>
        </View>
        <View style={[riskStyles.cell, riskStyles.cellBottom, { borderColor: theme.border }]}>
          <Text style={[riskStyles.cellLabel, { color: theme.textSecondary }]}>Max Drawdown</Text>
          <Text style={[riskStyles.cellValue, { color: theme.negative }]}>
            {profile.maxDrawdown.toFixed(1)}%
          </Text>
        </View>
        <View style={[riskStyles.cell, riskStyles.cellRight, riskStyles.cellBottom, { borderColor: theme.border }]}>
          <Text style={[riskStyles.cellLabel, { color: theme.textSecondary }]}>Sharpe Ratio</Text>
          <Text style={[riskStyles.cellValue, { color: sharpeColor }]}>
            {profile.sharpe.toFixed(2)}
          </Text>
        </View>
      </View>

      <Text style={[riskStyles.sentence, { color: theme.textSecondary }]}>{sentence}</Text>
    </View>
  );
}

const riskStyles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  sub: { fontSize: 11, fontFamily: "Inter_400Regular", marginBottom: 16 },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    borderWidth: 1,
    borderRadius: 12,
    overflow: "hidden",
    borderColor: "#1E3A5F",
    marginBottom: 14,
  },
  cell: {
    width: "50%",
    padding: 14,
    borderRightWidth: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  cellRight: { borderLeftWidth: StyleSheet.hairlineWidth },
  cellBottom: { borderBottomWidth: 0 },
  cellLabel: { fontSize: 10, fontFamily: "Inter_500Medium", letterSpacing: 0.2, marginBottom: 6 },
  cellValue: { fontSize: 22, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  sentence: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18, fontStyle: "italic" },
});

// ─── Crisis Backtest Section ───────────────────────────────────────────────────

const CRISES = [
  {
    id: "dotcom" as const,
    name: "Dot-com",
    dateRange: "Mar '00–Oct '02",
    durationMonths: 31,
    drawdowns: { equity: -48, bond: 8, gold: 12 },
    msciDrawdown: -49,
    msciRecoveryMonths: 56,
  },
  {
    id: "financial" as const,
    name: "Financial Crisis",
    dateRange: "Oct '07–Mar '09",
    durationMonths: 17,
    drawdowns: { equity: -52, bond: 6, gold: 25 },
    msciDrawdown: -54,
    msciRecoveryMonths: 49,
  },
  {
    id: "covid" as const,
    name: "COVID Crash",
    dateRange: "Feb–Mar 2020",
    durationMonths: 2,
    drawdowns: { equity: -32, bond: 3, gold: 5 },
    msciDrawdown: -34,
    msciRecoveryMonths: 5,
  },
  {
    id: "rate2022" as const,
    name: "2022 Rate Hike",
    dateRange: "Jan–Oct 2022",
    durationMonths: 9,
    drawdowns: { equity: -24, bond: -18, gold: -3 },
    msciDrawdown: -25,
    msciRecoveryMonths: 18,
  },
];
type CrisisId = typeof CRISES[number]["id"];

function classifyETF(ticker: string): "equity" | "bond" | "gold" | null {
  const t = ticker.toUpperCase();
  if (["VWCE", "TDIV", "VHYL", "ERNE", "IEGE"].includes(t)) return "equity";
  if (["CSBGE7"].includes(t)) return "bond";
  if (["EGLN"].includes(t)) return "gold";
  return null;
}

function CrisisBacktestSection() {
  const theme = Colors.dark;
  const { holdings } = usePortfolio();
  const [selectedId, setSelectedId] = useState<CrisisId>("financial");
  const [dca, setDca] = useState(400);

  useEffect(() => {
    AsyncStorage.getItem("folvio_forecast_dca").then(v => {
      if (v) setDca(parseFloat(v) || 400);
    });
  }, []);

  const crisis = CRISES.find(c => c.id === selectedId)!;

  const analysis = useMemo(() => {
    const priced = holdings.filter(h => h.hasPrice && h.currentPrice > 0 && h.quantity > 0);
    if (priced.length === 0) return null;

    const totalValue = priced.reduce((s, h) => s + h.quantity * h.currentPrice, 0);
    if (totalValue <= 0) return null;

    const classified = priced.map(h => ({
      ticker: h.ticker,
      weight: (h.quantity * h.currentPrice) / totalValue,
      type: classifyETF(h.ticker),
    }));

    const unknownTickers = classified.filter(w => w.type === null).map(w => w.ticker);
    const known = classified.filter(w => w.type !== null) as { ticker: string; weight: number; type: "equity" | "bond" | "gold" }[];

    const knownTotalWeight = known.reduce((s, w) => s + w.weight, 0);
    if (knownTotalWeight <= 0) {
      return { unknownTickers, portfolioDrawdown: 0, defensiveWeight: 0, recoveryMonths: 0, dcaAdvantage: 0, capital: 0, lumpSumFinal: 0, dcaFinal: 0, pctDiff: 0, drawdownDiff: 0 };
    }

    const normalized = known.map(w => ({ ...w, normWeight: w.weight / knownTotalWeight }));

    let portfolioDrawdown = 0;
    let defensiveWeight = 0;
    for (const w of normalized) {
      const dd = w.type === "equity" ? crisis.drawdowns.equity
        : w.type === "bond" ? crisis.drawdowns.bond
        : crisis.drawdowns.gold;
      portfolioDrawdown += w.normWeight * dd;
      if (w.type === "bond" || w.type === "gold") defensiveWeight += w.normWeight;
    }

    const defensiveAdj = 1 - defensiveWeight * 0.3;
    const recoveryMonths = portfolioDrawdown === 0
      ? crisis.msciRecoveryMonths
      : Math.max(1, Math.round(
          crisis.msciRecoveryMonths
          * (Math.abs(portfolioDrawdown) / Math.abs(crisis.msciDrawdown))
          * defensiveAdj
        ));

    const depressedFactor = 1 + portfolioDrawdown / 100;
    const dcaAdvantage = depressedFactor > 0 && depressedFactor < 1
      ? (1 / depressedFactor - 1) * 100
      : 0;

    const capital = dca * crisis.durationMonths;
    const drawdownFraction = portfolioDrawdown / 100;
    const lumpSumFinal = capital * (1 + drawdownFraction) * (1 - drawdownFraction);
    const avgPriceFactor = 1 + drawdownFraction * 0.5;
    const dcaFinal = avgPriceFactor > 0 ? capital / avgPriceFactor : capital;
    const pctDiff = lumpSumFinal > 0 ? ((dcaFinal - lumpSumFinal) / Math.abs(lumpSumFinal)) * 100 : 0;

    const drawdownDiff = Math.abs(portfolioDrawdown) - Math.abs(crisis.msciDrawdown);

    return { unknownTickers, portfolioDrawdown, defensiveWeight, recoveryMonths, dcaAdvantage, capital, lumpSumFinal, dcaFinal, pctDiff, drawdownDiff };
  }, [holdings, crisis, dca]);

  if (holdings.length === 0) {
    return (
      <View style={[styles.card, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}>
        <Text style={[styles.sectionTitle, { color: theme.text }]}>Crisis Backtest</Text>
        <Text style={[crisisStyles.emptyHint, { color: theme.textSecondary }]}>
          Add holdings to your portfolio to see crisis analysis.
        </Text>
      </View>
    );
  }

  const pDrawdown = analysis?.portfolioDrawdown ?? 0;
  const cushioned = analysis ? analysis.drawdownDiff <= 0 : false;
  const diffAbs = Math.abs(analysis?.drawdownDiff ?? 0);

  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}>
      <Text style={[styles.sectionTitle, { color: theme.text }]}>Crisis Backtest</Text>
      <Text style={[crisisStyles.subtitle, { color: theme.textSecondary }]}>
        How would your portfolio have behaved during major market crises?
      </Text>

      {/* Crisis selector */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={crisisStyles.selectorScroll}>
        <View style={crisisStyles.selectorRow}>
          {CRISES.map(c => (
            <TouchableOpacity
              key={c.id}
              style={[
                crisisStyles.crisisChip,
                {
                  backgroundColor: selectedId === c.id ? theme.tint + "22" : theme.backgroundElevated,
                  borderColor: selectedId === c.id ? theme.tint : theme.border,
                },
              ]}
              onPress={() => setSelectedId(c.id)}
            >
              <Text style={[crisisStyles.crisisName, { color: selectedId === c.id ? theme.tint : theme.text }]}>
                {c.name}
              </Text>
              <Text style={[crisisStyles.crisisDate, { color: selectedId === c.id ? theme.tint + "BB" : theme.textTertiary }]}>
                {c.dateRange}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {analysis === null ? (
        <Text style={[crisisStyles.emptyHint, { color: theme.textSecondary }]}>
          No classifiable ETFs found. Add VWCE, TDIV, VHYL, ERNE, IEGE, CSBGE7, or EGLN.
        </Text>
      ) : (
        <>
          {analysis.unknownTickers.length > 0 && (
            <View style={[crisisStyles.warningBox, { backgroundColor: "#FBBF2411", borderColor: "#FBBF2433" }]}>
              <Feather name="alert-triangle" size={12} color="#FBBF24" />
              <Text style={[crisisStyles.warningText, { color: "#FBBF24" }]}>
                {analysis.unknownTickers.join(", ")} not classified — excluded from calculations.
              </Text>
            </View>
          )}

          {/* Block 1 — Drawdown */}
          <View style={[crisisStyles.metricBlock, { backgroundColor: theme.backgroundElevated }]}>
            <Text style={[crisisStyles.metricTitle, { color: theme.textSecondary }]}>Estimated Max Drawdown</Text>
            <View style={crisisStyles.metricRow}>
              <View style={crisisStyles.metricHalf}>
                <Text style={[crisisStyles.metricBig, { color: pDrawdown < 0 ? theme.negative : theme.positive }]}>
                  {pDrawdown >= 0 ? "+" : ""}{pDrawdown.toFixed(1)}%
                </Text>
                <Text style={[crisisStyles.metricSmall, { color: theme.textTertiary }]}>Your Portfolio</Text>
              </View>
              <View style={[crisisStyles.metricDivider, { backgroundColor: theme.border }]} />
              <View style={crisisStyles.metricHalf}>
                <Text style={[crisisStyles.metricBig, { color: theme.negative }]}>
                  {crisis.msciDrawdown.toFixed(1)}%
                </Text>
                <Text style={[crisisStyles.metricSmall, { color: theme.textTertiary }]}>MSCI World</Text>
              </View>
            </View>
            <Text style={[crisisStyles.metricNote, { color: cushioned ? theme.positive : theme.negative }]}>
              {cushioned
                ? `Your allocation cushioned the drawdown by ${diffAbs.toFixed(1)}%`
                : `Your allocation amplified the drawdown by ${diffAbs.toFixed(1)}%`}
            </Text>
          </View>

          {/* Block 2 — Recovery Time */}
          <View style={[crisisStyles.metricBlock, { backgroundColor: theme.backgroundElevated }]}>
            <Text style={[crisisStyles.metricTitle, { color: theme.textSecondary }]}>Estimated Recovery</Text>
            <Text style={[crisisStyles.metricBig, { color: theme.positive, textAlign: "center" }]}>
              ~{analysis.recoveryMonths} months
            </Text>
            <Text style={[crisisStyles.metricNote, { color: theme.textTertiary, textAlign: "center" }]}>
              Based on {(analysis.defensiveWeight * 100).toFixed(0)}% defensive allocation
              {" "}(MSCI World: {crisis.msciRecoveryMonths} months)
            </Text>
          </View>

          {/* Block 3 — DCA Effect */}
          <View style={[crisisStyles.metricBlock, { backgroundColor: theme.backgroundElevated }]}>
            <Text style={[crisisStyles.metricTitle, { color: theme.textSecondary }]}>DCA Effect</Text>
            <Text style={[crisisStyles.metricBig, { color: theme.positive, textAlign: "center" }]}>
              +{analysis.dcaAdvantage.toFixed(1)}% more units
            </Text>
            <Text style={[crisisStyles.metricNote, { color: theme.textTertiary, textAlign: "center" }]}>
              Continuing {formatEUR(dca)}/month DCA during this crisis would have bought ~{analysis.dcaAdvantage.toFixed(1)}% more units at depressed prices
            </Text>
          </View>

          {/* Block 4 — Lump Sum vs DCA */}
          <View style={[crisisStyles.metricBlock, { backgroundColor: theme.backgroundElevated }]}>
            <Text style={[crisisStyles.metricTitle, { color: theme.textSecondary }]}>Lump Sum vs DCA</Text>
            <Text style={[crisisStyles.metricCaption, { color: theme.textTertiary }]}>
              Capital: {formatEUR(analysis.capital)} ({formatEUR(dca)}/mo × {crisis.durationMonths} months)
            </Text>
            <View style={crisisStyles.metricRow}>
              <View style={crisisStyles.metricHalf}>
                <Text style={[crisisStyles.metricBig, { color: theme.text }]}>
                  {formatEUR(analysis.lumpSumFinal)}
                </Text>
                <Text style={[crisisStyles.metricSmall, { color: theme.textTertiary }]}>Lump Sum</Text>
              </View>
              <View style={[crisisStyles.metricDivider, { backgroundColor: theme.border }]} />
              <View style={crisisStyles.metricHalf}>
                <Text style={[crisisStyles.metricBig, { color: theme.positive }]}>
                  {formatEUR(analysis.dcaFinal)}
                </Text>
                <Text style={[crisisStyles.metricSmall, { color: theme.textTertiary }]}>DCA</Text>
              </View>
            </View>
            {analysis.pctDiff > 0 && (
              <Text style={[crisisStyles.metricNote, { color: theme.positive }]}>
                DCA would have resulted in +{analysis.pctDiff.toFixed(1)}% more value than lump sum at peak
              </Text>
            )}
          </View>

          <Text style={[styles.disclaimer, { color: theme.textTertiary }]}>
            Simulated results based on historical index data and your current portfolio allocation. Past performance does not guarantee future results.
          </Text>
        </>
      )}
    </View>
  );
}

const crisisStyles = StyleSheet.create({
  subtitle: { fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 16, lineHeight: 18 },
  selectorScroll: { marginBottom: 16 },
  selectorRow: { flexDirection: "row", gap: 8 },
  crisisChip: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderWidth: 1, minWidth: 120 },
  crisisName: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  crisisDate: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 2 },
  warningBox: { flexDirection: "row", alignItems: "flex-start", gap: 6, borderWidth: 1, borderRadius: 8, padding: 10, marginBottom: 12 },
  warningText: { fontSize: 11, fontFamily: "Inter_400Regular", flex: 1, lineHeight: 16 },
  metricBlock: { borderRadius: 12, padding: 14, gap: 10, marginBottom: 10 },
  metricTitle: { fontSize: 11, fontFamily: "Inter_500Medium", letterSpacing: 0.3 },
  metricRow: { flexDirection: "row", alignItems: "center" },
  metricHalf: { flex: 1, alignItems: "center", gap: 4 },
  metricDivider: { width: 1, height: 40, marginHorizontal: 8 },
  metricBig: { fontSize: 22, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  metricSmall: { fontSize: 11, fontFamily: "Inter_400Regular" },
  metricNote: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
  metricCaption: { fontSize: 11, fontFamily: "Inter_400Regular" },
  emptyHint: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", padding: 20 },
});

// ─── AI Insights ───────────────────────────────────────────────────────────────

function insightIcon(type: AIInsight["type"]): { name: React.ComponentProps<typeof Feather>["name"]; color: string } {
  if (type === "positive") return { name: "check-circle", color: "#34D399" };
  if (type === "warning")  return { name: "alert-triangle", color: "#FBBF24" };
  return { name: "info", color: "#60A5FA" };
}

function InsightCard({ insight }: { insight: AIInsight }) {
  const theme = Colors.dark;
  const { name, color } = insightIcon(insight.type);
  return (
    <View style={[aiStyles.insightCard, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}>
      <View style={[aiStyles.insightIcon, { backgroundColor: color + "18" }]}>
        <Feather name={name} size={16} color={color} />
      </View>
      <View style={aiStyles.insightBody}>
        <Text style={[aiStyles.insightTitle, { color: theme.text }]}>{insight.title}</Text>
        <Text style={[aiStyles.insightText, { color: theme.textSecondary }]}>{insight.body}</Text>
      </View>
    </View>
  );
}

function SkeletonCard() {
  const theme = Colors.dark;
  return (
    <View style={[aiStyles.insightCard, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}>
      <View style={[aiStyles.insightIcon, { backgroundColor: theme.backgroundElevated }]} />
      <View style={aiStyles.insightBody}>
        <View style={[aiStyles.skeletonLine, { width: "55%", backgroundColor: theme.backgroundElevated }]} />
        <View style={[aiStyles.skeletonLine, { width: "90%", backgroundColor: theme.backgroundElevated, marginTop: 8 }]} />
        <View style={[aiStyles.skeletonLine, { width: "70%", backgroundColor: theme.backgroundElevated, marginTop: 4 }]} />
      </View>
    </View>
  );
}

function AIInsightsSection({
  holdings,
  totalPortfolioValue,
}: {
  holdings: Parameters<typeof generatePortfolioInsights>[0];
  totalPortfolioValue: number;
}) {
  const theme = Colors.dark;
  const [insights, setInsights]   = useState<AIInsight[] | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [dcaAmount, setDcaAmount] = useState(400);

  useEffect(() => {
    AsyncStorage.getItem("folvio_forecast_dca").then(v => {
      if (v) setDcaAmount(parseFloat(v) || 400);
    });
  }, []);

  const load = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    try {
      if (!forceRefresh) {
        const cached = await getCachedInsights();
        if (cached) {
          setInsights(cached);
          setLoading(false);
          return;
        }
      } else {
        await clearInsightsCache();
      }

      if (holdings.length === 0) {
        setInsights([]);
        setLoading(false);
        return;
      }

      const result = await generatePortfolioInsights(holdings, totalPortfolioValue, dcaAmount);
      await saveInsightsToCache(result);
      setInsights(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate insights");
    } finally {
      setLoading(false);
    }
  }, [holdings, totalPortfolioValue, dcaAmount]);

  useEffect(() => { load(); }, [load]);

  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}>
      {/* Header */}
      <View style={aiStyles.header}>
        <View style={aiStyles.headerLeft}>
          <View style={[aiStyles.claudeBadge, { backgroundColor: theme.tint + "18" }]}>
            <Feather name="cpu" size={12} color={theme.tint} />
            <Text style={[aiStyles.claudeLabel, { color: theme.tint }]}>Claude AI</Text>
          </View>
          <Text style={[styles.sectionTitle, { color: theme.text, marginBottom: 0 }]}>Portfolio Insights</Text>
        </View>
        <TouchableOpacity
          onPress={() => load(true)}
          disabled={loading}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Feather name="refresh-cw" size={16} color={loading ? theme.textTertiary : theme.tint} />
        </TouchableOpacity>
      </View>

      <Text style={[aiStyles.subtext, { color: theme.textSecondary }]}>
        Personalised analysis based on your current holdings
      </Text>

      {/* Content */}
      {loading ? (
        <View style={aiStyles.cards}>
          {[0, 1, 2, 3].map(i => <SkeletonCard key={i} />)}
        </View>
      ) : error ? (
        <View style={[aiStyles.errorBox, { backgroundColor: theme.backgroundElevated, borderColor: theme.border }]}>
          <Feather name="alert-circle" size={18} color={theme.negative} />
          <View style={{ flex: 1 }}>
            <Text style={[aiStyles.errorText, { color: theme.textSecondary }]}>
              {error.includes("not configured")
                ? "ANTHROPIC_API_KEY is not set on the server. Contact support."
                : `Could not load insights. Tap ↻ to retry.\n\n${error}`}
            </Text>
            <Text style={[aiStyles.debugText, { color: theme.textTertiary }]}>
              API_SERVER_URL: {process.env.EXPO_PUBLIC_API_SERVER_URL ?? "(not set)"}
            </Text>
          </View>
        </View>
      ) : holdings.length === 0 ? (
        <Text style={[crisisStyles.emptyHint, { color: theme.textSecondary }]}>
          Add holdings to your portfolio to get AI-powered insights.
        </Text>
      ) : (
        <View style={aiStyles.cards}>
          {(insights ?? []).map((ins, i) => (
            <InsightCard key={i} insight={ins} />
          ))}
        </View>
      )}

      <Text style={[styles.disclaimer, { color: theme.textTertiary }]}>
        AI-generated analysis. Not financial advice. Cached for 24 hours.
      </Text>
    </View>
  );
}

const aiStyles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 4 },
  headerLeft: { gap: 6 },
  claudeBadge: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  claudeLabel: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.3 },
  subtext: { fontSize: 11, fontFamily: "Inter_400Regular", marginBottom: 16 },
  cards: { gap: 10 },
  insightCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  insightIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  insightBody: { flex: 1 },
  insightTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginBottom: 4, lineHeight: 18 },
  insightText: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
  skeletonLine: { height: 12, borderRadius: 6 },
  errorBox: { flexDirection: "row", alignItems: "flex-start", gap: 10, borderRadius: 12, borderWidth: 1, padding: 14 },
  errorText: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
  debugText: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 6 },
});

// ─── Forecast Section ──────────────────────────────────────────────────────────

const SCENARIOS = [
  { label: "Conservative", key: "conservative" as const, pct: 4,  color: "#8A9BB0" },
  { label: "Base",         key: "base"         as const, pct: 7,  color: "#C9A84C" },
  { label: "Optimistic",   key: "optimistic"   as const, pct: 10, color: "#34D399" },
];
const HORIZONS = [10, 15, 20, 25, 30];

// Supports optional annual DCA escalation (Pro feature)
function projectValue(
  start: number, monthly: number, annualPct: number,
  years: number, escalation = 0
): number {
  const r = annualPct / 100 / 12;
  let v = start, m = monthly;
  for (let y = 0; y < years; y++) {
    if (y > 0 && escalation > 0) m *= (1 + escalation / 100);
    for (let mo = 0; mo < 12; mo++) v = v * (1 + r) + m;
  }
  return v;
}

function projectYearly(
  start: number, monthly: number, annualPct: number,
  years: number, escalation = 0
): number[] {
  const r = annualPct / 100 / 12;
  let v = start, m = monthly;
  const pts = [start];
  for (let y = 0; y < years; y++) {
    if (y > 0 && escalation > 0) m *= (1 + escalation / 100);
    for (let mo = 0; mo < 12; mo++) v = v * (1 + r) + m;
    pts.push(v);
  }
  return pts;
}

// ─── Chart (shared scale across active + ghost lines) ──────────────────────────

function ForecastChart({
  width, activeLines, ghostLines, investedLine, years, locked, onUnlock,
}: {
  width: number;
  activeLines: { color: string; points: number[] }[];
  ghostLines:  { color: string; points: number[] }[];
  investedLine: number[];
  years: number;
  locked: boolean;
  onUnlock: () => void;
}) {
  const theme = Colors.dark;
  const H   = 200;
  const PAD = { top: 16, bottom: 32, left: 56, right: 8 };
  const iW  = width - PAD.left - PAD.right;
  const iH  = H - PAD.top - PAD.bottom;

  const allPts = [...activeLines, ...ghostLines].flatMap(s => s.points);
  const maxV = Math.max(...allPts);
  const minV = Math.min(...allPts, 0);
  const span = maxV - minV || 1;

  const toX = (i: number) => PAD.left + (i / years) * iW;
  const toY = (v: number) => PAD.top + (1 - (v - minV) / span) * iH;
  const path = (pts: number[]) =>
    pts.map((v, i) => `${i === 0 ? "M" : "L"}${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(" ");

  const yLabels = [maxV, maxV / 2, 0].map(v => ({
    v, y: toY(v),
    label: v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v.toFixed(0)}`,
  }));
  const xLabels = [0, Math.floor(years / 2), years].map(yr => ({
    yr, x: toX(yr), label: yr === 0 ? "Now" : `${yr}y`,
  }));

  return (
    <View>
      <Svg width={width} height={H}>
        {yLabels.map((l, i) => (
          <Line key={i} x1={PAD.left} y1={l.y} x2={PAD.left + iW} y2={l.y}
            stroke={theme.border} strokeWidth={1} strokeDasharray="4,4" />
        ))}
        {yLabels.map((l, i) => (
          <SvgText key={i} x={PAD.left - 4} y={l.y + 4} fontSize={9}
            fill={theme.textTertiary} textAnchor="end" fontFamily="Inter_400Regular">
            {l.label}
          </SvgText>
        ))}
        {xLabels.map((l, i) => (
          <SvgText key={i} x={l.x} y={H - 4} fontSize={9}
            fill={theme.textTertiary} textAnchor="middle" fontFamily="Inter_400Regular">
            {l.label}
          </SvgText>
        ))}
        {/* Ghost (locked) lines — faint */}
        {ghostLines.map((s, i) => (
          <Path key={`g${i}`} d={path(s.points)} stroke={s.color}
            strokeWidth={2} fill="none" opacity={0.18} />
        ))}
        {/* Active lines */}
        {activeLines.map((s, i) => (
          <Path key={`a${i}`} d={path(s.points)} stroke={s.color} strokeWidth={2} fill="none" />
        ))}
        {investedLine.length >= 2 && (
          <Path d={path(investedLine)} stroke="rgba(255,255,255,0.3)"
            strokeWidth={1.5} strokeDasharray="4,3" fill="none" />
        )}
      </Svg>

      {/* Lock overlay — sits over chart, leaves x-axis labels visible */}
      {locked && (
        <TouchableOpacity
          style={fcStyles.chartOverlay}
          onPress={onUnlock}
          activeOpacity={0.9}
        >
          <View style={[fcStyles.chartLockBadge, { backgroundColor: theme.backgroundElevated, borderColor: theme.border }]}>
            <Feather name="lock" size={13} color={theme.tint} />
            <Text style={[fcStyles.chartLockText, { color: theme.text }]}>Unlock all scenarios</Text>
            <View style={[fcStyles.chartLockPill, { backgroundColor: "#3B82F6" + "22" }]}>
              <Text style={[fcStyles.chartLockPillText, { color: "#3B82F6" }]}>INVESTOR</Text>
            </View>
          </View>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ─── DCA Escalation Slider (Pro only) ─────────────────────────────────────────

function DCAEscalationSlider({
  value, onChange, monthlyDCA,
}: {
  value: number;
  onChange: (v: number) => void;
  monthlyDCA: number;
}) {
  const theme = Colors.dark;
  const MIN = 0, MAX = 10, THUMB = 22;

  const trackRef    = useRef<View>(null);
  const trackPageX  = useRef(0);
  const trackWidthR = useRef(200);

  function clampedValue(pageX: number) {
    const x   = pageX - trackPageX.current;
    const raw = (x / trackWidthR.current) * (MAX - MIN) + MIN;
    return Math.round(Math.max(MIN, Math.min(MAX, raw)));
  }

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder:  () => true,
      onPanResponderGrant: e => onChange(clampedValue(e.nativeEvent.pageX)),
      onPanResponderMove:  e => onChange(clampedValue(e.nativeEvent.pageX)),
    })
  ).current;

  const fillPct = ((value - MIN) / (MAX - MIN)) * 100;

  return (
    <View style={[fcStyles.subCard, { backgroundColor: theme.backgroundElevated, borderColor: theme.border }]}>
      <View style={fcStyles.sliderHeader}>
        <Text style={[fcStyles.subCardTitle, { color: theme.textSecondary, marginBottom: 0 }]}>
          Annual DCA Escalation
        </Text>
        <Text style={[fcStyles.sliderValueText, { color: theme.tint }]}>
          {value === 0 ? "Off" : `+${value}% / yr`}
        </Text>
      </View>

      {/* Track */}
      <View style={{ height: THUMB, justifyContent: "center", marginTop: 10, marginBottom: 4 }}
        ref={trackRef}
        onLayout={() => {
          trackRef.current?.measureInWindow((x, _y, w) => {
            trackPageX.current  = x;
            trackWidthR.current = w;
          });
        }}
        {...pan.panHandlers}
      >
        <View style={[fcStyles.sliderTrack, { backgroundColor: theme.border }]} />
        <View style={[fcStyles.sliderFill,  { width: `${fillPct}%` as any, backgroundColor: theme.tint }]} />
        <View style={[fcStyles.sliderThumb, { left: `${fillPct}%` as any, marginLeft: -(THUMB / 2), backgroundColor: theme.tint }]} />
      </View>

      {/* Tap-to-set tick labels */}
      <View style={fcStyles.sliderTicks}>
        {[0, 2, 5, 7, 10].map(v => (
          <TouchableOpacity key={v} onPress={() => onChange(v)}
            hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}>
            <Text style={[fcStyles.sliderTick, { color: v === value ? theme.tint : theme.textTertiary }]}>
              {v}%
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {value > 0 && (
        <Text style={[fcStyles.subText, { color: theme.textTertiary, marginTop: 8 }]}>
          After 10 yr your monthly DCA grows to {formatEUR(monthlyDCA * Math.pow(1 + value / 100, 10))}/mo
        </Text>
      )}
    </View>
  );
}

// ─── Main Forecast Section ─────────────────────────────────────────────────────

function ForecastSection() {
  const theme = Colors.dark;
  const { width } = useWindowDimensions();
  const { totalPortfolioValue, totalInvested, totalGainPct, holdings } = usePortfolio();
  const { canUseAllScenarios, canUseWealthProjections, showPaywall } = useSubscription();
  // canUseAllScenarios    = Investor+ (all 3 scenario lines)
  // canUseWealthProjections = Pro    (custom rate editor + DCA escalation)

  const annualizedReturn = useMemo(() => {
    const dates = holdings.map(h => h.purchase_date).filter(Boolean).sort();
    if (dates.length === 0 || totalInvested === 0) return 7;
    const months = Math.max(1, Math.floor(
      (Date.now() - new Date(dates[0]!).getTime()) / (1000 * 60 * 60 * 24 * 30.44)
    ));
    return Math.round(Math.min(30, Math.max(1, (totalGainPct / months) * 12)) * 10) / 10;
  }, [holdings, totalGainPct, totalInvested]);

  const [monthlyDCA,    setMonthlyDCA]    = useState("400");
  const [years,         setYears]         = useState(30);
  const [escalation,    setEscalation]    = useState(0);
  const [scenarioPcts,  setScenarioPcts]  = useState({ conservative: 4, base: 7, optimistic: 10 });

  useEffect(() => {
    AsyncStorage.getItem("folvio_forecast_dca")
      .then(v => { if (v) setMonthlyDCA(v); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (annualizedReturn > 0) {
      setScenarioPcts({
        conservative: Math.max(1, Math.round((annualizedReturn - 3) * 10) / 10),
        base: annualizedReturn,
        optimistic: Math.round((annualizedReturn + 3) * 10) / 10,
      });
    }
  }, [annualizedReturn]);

  function handleDCAChange(v: string) {
    setMonthlyDCA(v);
    AsyncStorage.setItem("folvio_forecast_dca", v);
  }

  const start  = totalPortfolioValue > 0 ? totalPortfolioValue : 0;
  const dca    = parseFloat(monthlyDCA) || 0;
  const chartW = width - 68;
  const esc    = canUseWealthProjections ? escalation : 0;

  const scenarioData = useMemo(() =>
    SCENARIOS.map(s => ({
      ...s,
      pct:    scenarioPcts[s.key],
      points: projectYearly(start, dca, scenarioPcts[s.key], years, esc),
      final:  projectValue(start, dca, scenarioPcts[s.key], years, esc),
    })),
    [start, dca, years, scenarioPcts, esc]
  );

  const tableData = useMemo(() =>
    HORIZONS.map(h => ({
      years:  h,
      values: SCENARIOS.map(s => projectValue(start, dca, scenarioPcts[s.key], h, esc)),
    })),
    [start, dca, scenarioPcts, esc]
  );

  const investedLine = useMemo(() => {
    const pts = [start];
    let total = start;
    for (let y = 1; y <= years; y++) { total += dca * 12; pts.push(total); }
    return pts;
  }, [start, dca, years]);

  // Chart split: base always active; cons + opt are active (Investor+) or ghost (Free)
  const baseOnly    = scenarioData.filter(s => s.key === "base");
  const nonBase     = scenarioData.filter(s => s.key !== "base");
  const activeLines = canUseAllScenarios ? scenarioData : baseOnly;
  const ghostLines  = canUseAllScenarios ? []           : nonBase;

  // Table & legend: all 3 for Investor+, base only for Free
  const visibleScenarios = canUseAllScenarios ? SCENARIOS : SCENARIOS.filter(s => s.key === "base");

  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}>
      {/* Header with tier badge */}
      <View style={fcStyles.titleRow}>
        <Text style={[styles.sectionTitle, { color: theme.text, marginBottom: 0 }]}>Forecast</Text>
        {canUseWealthProjections && (
          <View style={[fcStyles.tierBadge, { backgroundColor: theme.tint + "22" }]}>
            <Text style={[fcStyles.tierBadgeText, { color: theme.tint }]}>PRO</Text>
          </View>
        )}
        {canUseAllScenarios && !canUseWealthProjections && (
          <View style={[fcStyles.tierBadge, { backgroundColor: "#3B82F6" + "22" }]}>
            <Text style={[fcStyles.tierBadgeText, { color: "#3B82F6" }]}>INVESTOR</Text>
          </View>
        )}
      </View>

      {/* Inputs */}
      <View style={[fcStyles.subCard, { backgroundColor: theme.backgroundElevated, borderColor: theme.border }]}>
        <View style={fcStyles.inputRow}>
          <Text style={[fcStyles.inputLabel, { color: theme.textSecondary }]}>Monthly DCA (€)</Text>
          <TextInput
            style={[fcStyles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundCard }]}
            value={monthlyDCA}
            onChangeText={handleDCAChange}
            keyboardType="numeric"
            placeholder="400"
            placeholderTextColor={theme.textTertiary}
          />
        </View>
        <View style={fcStyles.inputRow}>
          <Text style={[fcStyles.inputLabel, { color: theme.textSecondary }]}>Starting Value</Text>
          <Text style={[fcStyles.inputValue, { color: theme.tint }]}>{formatEUR(start)}</Text>
        </View>
        <Text style={[fcStyles.inputLabel, { color: theme.textSecondary, marginBottom: 8 }]}>Horizon</Text>
        <View style={fcStyles.segmented}>
          {HORIZONS.map(h => (
            <TouchableOpacity key={h}
              style={[fcStyles.segBtn, {
                backgroundColor: years === h ? theme.tint : theme.backgroundCard,
                borderColor:     years === h ? theme.tint : theme.border,
              }]}
              onPress={() => setYears(h)}
            >
              <Text style={[fcStyles.segBtnText, { color: years === h ? "#000" : theme.textSecondary }]}>{h}Y</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* DCA Escalation slider — Pro only */}
      {canUseWealthProjections && (
        <DCAEscalationSlider value={escalation} onChange={setEscalation} monthlyDCA={dca} />
      )}

      {/* Context summary */}
      <View style={[fcStyles.subCard, { backgroundColor: theme.backgroundElevated, borderColor: theme.border }]}>
        <Text style={[fcStyles.subCardTitle, { color: theme.textSecondary }]}>Over {years} years you will invest</Text>
        <Text style={[fcStyles.bigNumber, { color: theme.tint }]}>{formatEUR(dca * 12 * years + start)}</Text>
        <Text style={[fcStyles.subText, { color: theme.textSecondary }]}>
          {formatEUR(start)} starting + {formatEUR(dca * 12 * years)} contributions ({formatEUR(dca)}/mo × {years * 12} mo)
        </Text>
      </View>

      {/* Chart */}
      <Text style={[fcStyles.subCardTitle, { color: theme.textSecondary, marginBottom: 8 }]}>Growth Projection</Text>
      <ForecastChart
        width={chartW}
        activeLines={activeLines.map(sc => ({ color: sc.color, points: sc.points }))}
        ghostLines={ghostLines.map(sc => ({ color: sc.color, points: sc.points }))}
        investedLine={investedLine}
        years={years}
        locked={!canUseAllScenarios}
        onUnlock={() => showPaywall("all-scenarios")}
      />

      {/* Legend */}
      <View style={[fcStyles.legend, { marginTop: 10 }]}>
        {activeLines.map(sc => (
          <View key={sc.key} style={fcStyles.legendItem}>
            <View style={[fcStyles.legendDot, { backgroundColor: sc.color }]} />
            <Text style={[fcStyles.legendLabel, { color: theme.textSecondary }]}>{sc.label} ({sc.pct}%)</Text>
          </View>
        ))}
        {!canUseAllScenarios && nonBase.map(sc => (
          <View key={sc.key} style={[fcStyles.legendItem, { opacity: 0.35 }]}>
            <View style={[fcStyles.legendDot, { backgroundColor: sc.color }]} />
            <Text style={[fcStyles.legendLabel, { color: theme.textSecondary }]}>{sc.label} 🔒</Text>
          </View>
        ))}
        <View style={fcStyles.legendItem}>
          <View style={[fcStyles.legendDot, { backgroundColor: "rgba(255,255,255,0.3)" }]} />
          <Text style={[fcStyles.legendLabel, { color: theme.textSecondary }]}>Total Invested</Text>
        </View>
      </View>

      {/* Summary table */}
      <Text style={[fcStyles.subCardTitle, { color: theme.textSecondary, marginTop: 8, marginBottom: 8 }]}>Summary Table</Text>
      <View style={[fcStyles.subCard, { backgroundColor: theme.backgroundElevated, borderColor: theme.border, padding: 0, overflow: "hidden" }]}>
        <View style={[fcStyles.tableRow, { borderBottomColor: theme.border, backgroundColor: theme.backgroundCard }]}>
          <Text style={[fcStyles.tableHeader, { color: theme.textTertiary, flex: 1 }]}>Year</Text>
          {visibleScenarios.map(sc => (
            <Text key={sc.key} style={[fcStyles.tableHeader, { color: sc.color, flex: 2, textAlign: "right" }]}>{sc.label}</Text>
          ))}
        </View>
        {tableData.map(row => (
          <View key={row.years} style={[fcStyles.tableRow, { borderBottomColor: theme.border }]}>
            <Text style={[fcStyles.tableCell, { color: theme.text, flex: 1 }]}>{row.years}Y</Text>
            {visibleScenarios.map(sc => {
              const idx = SCENARIOS.findIndex(s => s.key === sc.key);
              const v   = row.values[idx];
              return (
                <Text key={sc.key} style={[fcStyles.tableCell, { color: sc.color, flex: 2, textAlign: "right" }]}>
                  {v >= 1_000_000 ? `€${(v / 1_000_000).toFixed(2)}M` : `€${(v / 1000).toFixed(1)}k`}
                </Text>
              );
            })}
          </View>
        ))}
      </View>

      {/* Custom return-rate editor — Pro only */}
      {canUseWealthProjections && (
        <>
          <Text style={[fcStyles.subCardTitle, { color: theme.textSecondary, marginTop: 12, marginBottom: 4 }]}>
            Return Assumptions
          </Text>
          <Text style={[fcStyles.subText, { color: theme.textTertiary, marginBottom: 10 }]}>
            Base uses your annualised return ({annualizedReturn}%/yr)
          </Text>
          {SCENARIOS.map(sc => (
            <View key={sc.key} style={[fcStyles.inputRow, { marginBottom: 10 }]}>
              <View style={[fcStyles.legendDot, { backgroundColor: sc.color, marginRight: 8 }]} />
              <Text style={[fcStyles.inputLabel, { color: theme.textSecondary, flex: 1 }]}>{sc.label}</Text>
              <TextInput
                style={[fcStyles.input, { color: sc.color, borderColor: sc.color + "44", backgroundColor: theme.backgroundElevated, width: 70 }]}
                value={String(scenarioPcts[sc.key])}
                onChangeText={v => setScenarioPcts(prev => ({ ...prev, [sc.key]: parseFloat(v) || 0 }))}
                keyboardType="numeric"
                maxLength={4}
              />
              <Text style={[fcStyles.inputLabel, { color: theme.textSecondary, marginLeft: 4, flex: 0 }]}>%/yr</Text>
            </View>
          ))}
        </>
      )}

      <Text style={[styles.disclaimer, { color: theme.textTertiary }]}>
        Projections are estimates only. Past performance does not guarantee future results.
        Does not account for taxes, fees, or inflation.
      </Text>
    </View>
  );
}

const fcStyles = StyleSheet.create({
  titleRow:     { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 14 },
  tierBadge:    { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  tierBadgeText:{ fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },

  subCard:      { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 12 },
  subCardTitle: { fontSize: 12, fontFamily: "Inter_600SemiBold", letterSpacing: 0.2, marginBottom: 2 },
  bigNumber:    { fontSize: 26, fontFamily: "Inter_700Bold", letterSpacing: -0.5, marginBottom: 2 },
  subText:      { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },

  inputRow:   { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  inputLabel: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  inputValue: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  input: {
    borderWidth: 1, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 6,
    fontSize: 14, fontFamily: "Inter_600SemiBold",
    minWidth: 80, textAlign: "right",
  },

  segmented: { flexDirection: "row", gap: 8 },
  segBtn:    { flex: 1, paddingVertical: 8, borderRadius: 10, borderWidth: 1, alignItems: "center" },
  segBtnText:{ fontSize: 13, fontFamily: "Inter_600SemiBold" },

  legend:     { flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: 12 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot:  { width: 8, height: 8, borderRadius: 4 },
  legendLabel:{ fontSize: 11, fontFamily: "Inter_400Regular" },

  tableRow:   { flexDirection: "row", paddingVertical: 10, paddingHorizontal: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  tableHeader:{ fontSize: 11, fontFamily: "Inter_600SemiBold" },
  tableCell:  { fontSize: 13, fontFamily: "Inter_500Medium" },

  // Chart lock overlay
  chartOverlay: {
    position: "absolute",
    top: 0, left: 0, right: 0,
    bottom: 32,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(10,15,30,0.72)",
    borderRadius: 8,
  },
  chartLockBadge: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 12, borderWidth: 1,
  },
  chartLockText:    { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  chartLockPill:    { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  chartLockPillText:{ fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },

  // DCA escalation slider
  sliderHeader:    { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sliderValueText: { fontSize: 15, fontFamily: "Inter_700Bold" },
  sliderTrack: {
    position: "absolute", left: 0, right: 0,
    height: 6, borderRadius: 3,
  },
  sliderFill: {
    position: "absolute", left: 0,
    height: 6, borderRadius: 3,
  },
  sliderThumb: {
    position: "absolute",
    width: 22, height: 22, borderRadius: 11, top: -8,
  },
  sliderTicks: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
  sliderTick:  { fontSize: 11, fontFamily: "Inter_500Medium" },
});

// ─── Pro locked placeholder ────────────────────────────────────────────────────

function ProLockedSection({
  icon,
  title,
  description,
  trigger,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  title: string;
  description: string;
  trigger: string;
}) {
  const theme = Colors.dark;
  const { showPaywall } = useSubscription();

  return (
    <TouchableOpacity
      style={[styles.card, lockedStyles.card, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}
      onPress={() => showPaywall(trigger)}
      activeOpacity={0.85}
    >
      <View style={lockedStyles.header}>
        <View style={[lockedStyles.iconWrap, { backgroundColor: theme.backgroundElevated }]}>
          <Feather name={icon} size={24} color={theme.tint} />
        </View>
        <View style={[lockedStyles.proBadge, { backgroundColor: theme.tint + "22" }]}>
          <Feather name="lock" size={10} color={theme.tint} />
          <Text style={[lockedStyles.proBadgeText, { color: theme.tint }]}>PRO</Text>
        </View>
      </View>
      <Text style={[lockedStyles.title, { color: theme.text }]}>{title}</Text>
      <Text style={[lockedStyles.desc, { color: theme.textSecondary }]}>{description}</Text>
      <View style={[lockedStyles.cta, { backgroundColor: theme.tint }]}>
        <Text style={lockedStyles.ctaText}>Unlock with Pro</Text>
      </View>
    </TouchableOpacity>
  );
}

const lockedStyles = StyleSheet.create({
  card: { gap: 12 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  proBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  proBadgeText: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  title: { fontSize: 16, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  desc: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },
  cta: {
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 4,
  },
  ctaText: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#0A0F1E" },
});

// ─── Main Screen ───────────────────────────────────────────────────────────────

export default function InsightsScreen() {
  const theme = Colors.dark;
  const insets = useSafeAreaInsets();
  const topPad    = Platform.OS === "web" ? 24 : insets.top;
  const bottomPad = Platform.OS === "web" ? 80 : insets.bottom + 80;

  const { holdings, totalPortfolioValue } = usePortfolio();
  const { canUseAIInsights, canUseCrisisBacktest } = useSubscription();

  const riskProfile = useMemo(() => computeRiskProfile(holdings), [holdings]);

  const estimatedAnnualDividend = useMemo(
    () =>
      holdings.reduce((sum, h) => {
        const y = h.yield_pct ?? 0;
        if (!y || !h.hasPrice) return sum;
        return sum + h.quantity * h.currentPrice * (y / 100);
      }, 0),
    [holdings]
  );

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.background }]}
      contentContainerStyle={[styles.content, { paddingTop: topPad + 12, paddingBottom: bottomPad }]}
      showsVerticalScrollIndicator={false}
    >
      <Text style={[styles.pageTitle, { color: theme.text }]}>Insights</Text>

      {/* ── AI Portfolio Insights (Pro) ───────────────────────────────────── */}
      {canUseAIInsights ? (
        <AIInsightsSection holdings={holdings} totalPortfolioValue={totalPortfolioValue} />
      ) : (
        <ProLockedSection
          icon="cpu"
          title="AI Portfolio Insights"
          description="Personalised analysis of your UCITS ETF portfolio powered by Claude AI — diversification score, drift warnings, and actionable suggestions."
          trigger="ai-insights"
        />
      )}

      {/* ── Risk Profile ─────────────────────────────────────────────────── */}
      {riskProfile && <RiskProfileCard profile={riskProfile} />}

      {/* ── Crisis Backtest (Pro) ─────────────────────────────────────────── */}
      {canUseCrisisBacktest ? (
        <CrisisBacktestSection />
      ) : (
        <ProLockedSection
          icon="activity"
          title="Crisis Backtest"
          description="See how your portfolio would have performed during the dot-com crash, 2008 financial crisis, COVID collapse, and 2022 rate hike cycle."
          trigger="crisis-backtest"
        />
      )}

      {/* ── Forecast / Wealth Projections ────────────────────────────────── */}
      <ForecastSection />

      {/* ── Dividend Estimate ─────────────────────────────────────────────── */}
      <View style={[styles.card, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}>
        <Text style={[styles.sectionTitle, { color: theme.text }]}>Dividend Estimate</Text>
        <View style={[divStyles.box, { backgroundColor: theme.backgroundElevated }]}>
          <Text style={[divStyles.label, { color: theme.textSecondary }]}>Estimated annual income</Text>
          <Text style={[divStyles.value, { color: "#C9A84C" }]}>
            {formatEUR(estimatedAnnualDividend)}/yr
          </Text>
        </View>
        {estimatedAnnualDividend === 0 && (
          <Text style={[divStyles.hint, { color: theme.textTertiary }]}>
            Add a trailing yield % to your holdings in the Holdings tab to see your estimated income.
          </Text>
        )}
        <Text style={[styles.disclaimer, { color: theme.textTertiary }]}>
          Based on trailing yield. Not guaranteed.
        </Text>
      </View>
    </ScrollView>
  );
}

const divStyles = StyleSheet.create({
  box: { borderRadius: 12, padding: 16, alignItems: "center", gap: 6, marginBottom: 10 },
  label: { fontSize: 12, fontFamily: "Inter_400Regular" },
  value: { fontSize: 28, fontFamily: "Inter_700Bold", letterSpacing: -0.8 },
  hint: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 18, marginBottom: 8 },
});

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 14 },
  pageTitle: { fontSize: 28, fontFamily: "Inter_700Bold", letterSpacing: -0.8, marginBottom: 2 },
  card: { borderRadius: 16, padding: 18, borderWidth: 1 },
  sectionTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 14 },
  disclaimer: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    fontStyle: "italic",
    textAlign: "center",
    lineHeight: 14,
    marginTop: 8,
  },
});
