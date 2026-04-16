import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { usePortfolio } from "@/context/PortfolioContext";
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
          <Text style={[aiStyles.errorText, { color: theme.textSecondary }]}>
            {error.includes("not configured")
              ? "Add EXPO_PUBLIC_ANTHROPIC_API_KEY to enable AI insights."
              : `Could not load insights. Tap ↻ to retry.\n\n${error}`}
          </Text>
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
  errorText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
});

// ─── Main Screen ───────────────────────────────────────────────────────────────

export default function InsightsScreen() {
  const theme = Colors.dark;
  const insets = useSafeAreaInsets();
  const topPad    = Platform.OS === "web" ? 24 : insets.top;
  const bottomPad = Platform.OS === "web" ? 80 : insets.bottom + 80;

  const { holdings, totalPortfolioValue } = usePortfolio();

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

      {/* ── AI Portfolio Insights ─────────────────────────────────────────── */}
      <AIInsightsSection holdings={holdings} totalPortfolioValue={totalPortfolioValue} />

      {/* ── Risk Profile ─────────────────────────────────────────────────── */}
      {riskProfile && <RiskProfileCard profile={riskProfile} />}

      {/* ── Crisis Backtest ───────────────────────────────────────────────── */}
      <CrisisBacktestSection />

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
