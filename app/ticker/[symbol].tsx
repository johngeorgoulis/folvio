import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/context/ThemeContext";
import { usePortfolio } from "@/context/PortfolioContext";
import PriceChart from "@/components/PriceChart";
import {
  fetchEodhdChartHistory,
  fetchETFDataBySymbol,
  fetchETFDataFromServer,
  fetchETFFundamentals,
  fetchPeriodReturn,
  fetchTickerMeta,
  type ChartPoint,
  type ETFFundamentals,
  type ServerETFData,
  type TickerMeta,
} from "@/services/priceService";
import { useAllocation } from "@/context/AllocationContext";
import { getAssetClass, getTER } from "@/services/assetClassService";
import {
  initETFDatabase,
  lookupByISIN,
  lookupByTicker,
  type ETFEntry,
} from "@/services/etfDatabaseService";


const KNOWN_YIELDS_MAP: Record<string, number> = {
  "VHYL": 3.4, "TDIV": 3.8, "VWRL": 1.6, "VWCE": 0.0,
  "IWDA": 0.0, "EGLN": 0.0, "CSBGE7": 2.8, "ERNE": 3.9,
  "IEGE": 3.2, "VUAA": 0.0, "CSPX": 1.2, "SWDA": 0.0,
  "IDVY": 3.8, "IHYG": 5.8, "AGGH": 3.1, "VGOV": 2.1,
};
const SCREEN_W = Dimensions.get("window").width;
const CHART_W = SCREEN_W - 32;
const RANGES = ["1D", "1W", "1M", "3M", "6M", "YTD", "1Y", "3Y", "5Y", "All"] as const;
type Range = (typeof RANGES)[number];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number | undefined, decimals = 2, prefix = "€"): string {
  if (n == null || isNaN(n) || n === 0) return "—";
  return `${prefix}${n.toFixed(decimals)}`;
}

function fmtLarge(n: number | undefined): string {
  if (n == null || isNaN(n) || n === 0) return "—";
  if (n >= 1e12) return `€${(n / 1e12).toFixed(1)}T`;
  if (n >= 1e9) return `€${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `€${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `€${(n / 1e3).toFixed(0)}K`;
  return `€${n.toFixed(0)}`;
}

function fmtVol(n: number | undefined): string {
  if (n == null || n === 0) return "—";
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return n.toLocaleString();
}

function fmtPct(n: number | undefined): string {
  if (n == null || isNaN(n)) return "—";
  return `${(n * 100).toFixed(2)}%`;
}

function staleBadge(ageMs: number): string {
  const s = Math.floor(ageMs / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

function symbolToTicker(symbol: string): string {
  const dot = symbol.lastIndexOf(".");
  return dot > 0 ? symbol.slice(0, dot) : symbol;
}

function capitalize(s: string | null | undefined): string {
  if (!s) return "—";
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function symbolToExchange(symbol: string): string {
  const dot = symbol.lastIndexOf(".");
  if (dot < 0) return "XETRA";
  const suffix = symbol.slice(dot + 1).toUpperCase();
  const MAP: Record<string, string> = {
    XETRA: "XETRA", DE: "XETRA", F: "XETRA",
    LSE: "LSE", L: "LSE",
    AMS: "EURONEXT_AMS", AS: "EURONEXT_AMS",
    PAR: "EURONEXT_PAR", PA: "EURONEXT_PAR",
    MI: "BORSA_IT", MIL: "BORSA_IT",
    SW: "SIX", CH: "SIX",
    BRU: "EURONEXT_BRU", BR: "EURONEXT_BRU",
    MC: "BME",
    HE: "NASDAQ_HEL",
    ST: "NASDAQ_STO",
    OL: "OSLO",
    CO: "NASDAQ_CPH",
  };
  return MAP[suffix] ?? "XETRA";
}


/** Derive change from chart data when fetchPeriodReturn returns null. */
function deriveChangeFromChart(
  chart: ChartPoint[],
  currentPriceEUR: number | undefined
): { abs: number; pct: number } | null {
  if (!chart || chart.length < 1 || !currentPriceEUR || currentPriceEUR <= 0) return null;
  const startPrice = chart[0].priceEUR;
  if (!startPrice || startPrice <= 0) return null;
  const abs = currentPriceEUR - startPrice;
  const pct = (abs / startPrice) * 100;
  return { abs, pct };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCell({ label, value }: { label: string; value: string }) {
  const { theme } = useTheme();
  const styles = makeStyles(theme);
  return (
    <View style={styles.statCell}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function PerfCard({
  label, changePct }: { label: string; changePct: number | null }) {
  const { theme } = useTheme();
  const styles = makeStyles(theme);
  const color =
    changePct == null ? theme.textSecondary : changePct >= 0 ? theme.positive : theme.negative;
  const text =
    changePct == null
      ? "—"
      : `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%`;
  return (
    <View style={[styles.perfCard, { borderColor: color + "33", backgroundColor: color + "11" }]}>
      <Text style={styles.perfLabel}>{label}</Text>
      <Text style={[styles.perfValue, { color }]}>{text}</Text>
    </View>
  );
}

/** ETF characteristics card shown when live price data failed to load but
 *  local-DB / EODHD-fundamentals data is still available. */
function ETFCharacteristicsFallback({
  styles, displayISIN, displayAssetClass, effectiveTER,
  displayDistribution, displayReplication, displayDomicile, displayInception,
}: {
  styles: ReturnType<typeof makeStyles>;
  displayISIN: string;
  displayAssetClass: string;
  effectiveTER: number | null;
  displayDistribution: string | null;
  displayReplication: string | null;
  displayDomicile: string | null;
  displayInception: string | null;
}) {
  return (
    <View style={styles.sectionCard}>
      <Text style={styles.sectionTitle}>ETF Profile</Text>
      <View style={styles.statsGrid}>
        {!!displayISIN && <StatCell label="ISIN" value={displayISIN} />}
        <StatCell label="Asset Class" value={displayAssetClass} />
        {effectiveTER !== null && (
          <StatCell label="TER (Annual Fee)" value={`${effectiveTER.toFixed(2)}%`} />
        )}
        {displayDistribution && (
          <StatCell label="Distribution" value={capitalize(displayDistribution)} />
        )}
        {displayReplication && (
          <StatCell label="Replication" value={capitalize(displayReplication)} />
        )}
        {displayDomicile && (
          <StatCell label="Domicile" value={capitalize(displayDomicile)} />
        )}
        {displayInception && (
          <StatCell label="Inception" value={displayInception} />
        )}
      </View>
    </View>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function TickerDetailScreen() {
  const { theme } = useTheme();
  const styles = makeStyles(theme);
  const { symbol } = useLocalSearchParams<{ symbol: string }>();
  const insets = useSafeAreaInsets();
  const { holdings } = usePortfolio();

  const [meta, setMeta] = useState<TickerMeta | null>(null);
  const [yearData, setYearData] = useState<ChartPoint[]>([]);
  const [chartData, setChartData] = useState<ChartPoint[]>([]);
  const [range, setRange] = useState<Range>("1M");
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [loadingChart, setLoadingChart] = useState(false);
  const [metaError, setMetaError] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const [now, setNow] = useState(Date.now());
  const [rangePerf, setRangePerf] = useState<number | null>(null);
  const [rangeChange, setRangeChange] = useState<{ abs: number; pct: number } | null>(null);
  const [perfCards, setPerfCards] = useState<{ w: number | null; m: number | null; m3: number | null; y: number | null }>({ w: null, m: null, m3: null, y: null });
  const [etfData, setEtfData] = useState<ServerETFData | null>(null);
  const [etfFund, setEtfFund] = useState<ETFFundamentals | null>(null);
  const [localETF, setLocalETF] = useState<ETFEntry | null>(null);

  const { targets, rebalanceThreshold } = useAllocation();

  const safeSymbol = symbol ?? "";

  const ticker = symbolToTicker(safeSymbol);
  const inPortfolio = holdings.some(
    (h) => h.ticker.toUpperCase() === ticker.toUpperCase()
  );
  const existingHolding = holdings.find(
    (h) => h.ticker.toUpperCase() === ticker.toUpperCase()
  );

  // ── Local ETF DB pre-population ───────────────────────────────────────────
  useEffect(() => {
    initETFDatabase().then(() => {
      const bare = symbolToTicker(safeSymbol);
      const found = lookupByTicker(bare);
      if (found) { setLocalETF(found); return; }
      // Also try portfolio ISIN
      const portISIN = holdings.find(h => h.ticker.toUpperCase() === bare.toUpperCase())?.isin;
      if (portISIN) {
        const byISIN = lookupByISIN(portISIN);
        if (byISIN) setLocalETF(byISIN);
      }
    });
  }, [safeSymbol]);

  const loadMeta = useCallback(async () => {
    setLoadingMeta(true);
    setMetaError(false);
    try {
      // All network calls fire in parallel to minimise total load time.
      const [m, yd, monthData, initPerf, r1w, r3m, r1y] = await Promise.all([
        fetchTickerMeta(safeSymbol),
        fetchEodhdChartHistory(safeSymbol, "1Y"),
        fetchEodhdChartHistory(safeSymbol, "1M"),
        fetchPeriodReturn(safeSymbol, "1M"),   // initial range display (1M selected by default)
        fetchPeriodReturn(safeSymbol, "1W"),   // perf card
        fetchPeriodReturn(safeSymbol, "3M"),   // perf card
        fetchPeriodReturn(safeSymbol, "1Y"),   // perf card
      ]);
      setMeta(m);
      setYearData(yd);
      setChartData(monthData);
      setFetchedAt(new Date());

      // Prefer fetchPeriodReturn result; fall back to chart-derived change.
      const initChange = initPerf
        ? { abs: initPerf.changeAbs, pct: initPerf.changePct }
        : deriveChangeFromChart(monthData, m?.regularMarketPrice);
      setRangePerf(initChange?.pct ?? null);
      setRangeChange(initChange);
      setPerfCards({
        w:  r1w?.changePct  ?? null,
        m:  initPerf?.changePct ?? null,
        m3: r3m?.changePct  ?? null,
        y:  r1y?.changePct  ?? null,
      });
    } catch {
      setMetaError(true);
    } finally {
      setLoadingMeta(false);
    }
  }, [safeSymbol]);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  async function handleRangeChange(r: Range) {
    setRange(r);
    // Premium ranges — show lock immediately, no network call
    if (r === "3Y" || r === "5Y" || r === "All") {
      setChartData([]);
      setRangePerf(null);
      setRangeChange(null);
      setLoadingChart(false);
      return;
    }
    setLoadingChart(true);
    try {
      // For 1Y we already have year data in state — reuse it.
      const chartPromise: Promise<ChartPoint[]> = r === "1Y"
        ? Promise.resolve(yearData)
        : fetchEodhdChartHistory(safeSymbol, r);

      const returnPromise = fetchPeriodReturn(
        safeSymbol,
        r,
        r === "1D" && meta
          ? { previousCloseEUR: meta.previousClose, currentPriceEUR: meta.regularMarketPrice }
          : undefined
      );

      const [d, result] = await Promise.all([chartPromise, returnPromise]);
      setChartData(d);

      // Prefer fetchPeriodReturn result; fall back to chart-derived change.
      // 1D special case: use meta change fields (vs prev. close).
      const resolvedChange = result
        ? { abs: result.changeAbs, pct: result.changePct }
        : r === "1D" && meta
          ? { abs: meta.regularMarketChange, pct: meta.regularMarketChangePercent }
          : deriveChangeFromChart(d, meta?.regularMarketPrice);
      setRangePerf(resolvedChange?.pct ?? null);
      setRangeChange(resolvedChange);
    } catch {
      setRangePerf(null);
      setRangeChange(null);
    } finally {
      setLoadingChart(false);
    }
  }

  function handleAddToPortfolio() {
    router.push({
      pathname: "/(tabs)/holdings",
      params: {
        prefillTicker: ticker,
        prefillName: meta?.shortName ?? "",
        prefillExchange: symbolToExchange(safeSymbol),
      },
    });
  }

  function handleViewHolding() {
    if (existingHolding) {
      router.push({ pathname: "/holding/[id]", params: { id: existingHolding.id } });
    }
  }

  const isETF = meta?.quoteType === "ETF" || meta?.quoteType === "MUTUALFUND";
  const cleanTicker = symbolToTicker(safeSymbol);
  const ter = getTER(cleanTicker);
  const assetClass = getAssetClass(cleanTicker);
  const knownYield = KNOWN_YIELDS_MAP[cleanTicker.toUpperCase()];
  const portfolioISIN = holdings.find(h => h.ticker.toUpperCase() === cleanTicker.toUpperCase())?.isin ?? "";

  // Data priority: EODHD fundamentals > local DB > server ETF data
  const effectiveTER =
    (etfFund?.ter != null ? etfFund.ter : null) ??
    etfData?.ter ?? localETF?.ter ?? ter;
  const displayISIN =
    portfolioISIN || etfFund?.isin || (meta?.isin ?? "") || localETF?.isin || etfData?.isin || "";
  const displayDistribution =
    etfFund?.distributionPolicy || etfData?.distributionPolicy || localETF?.distribution || null;
  const displayReplication =
    etfFund?.replicationMethod || etfData?.replicationMethod || localETF?.replication || null;
  const displayDomicile =
    etfFund?.domicile || etfData?.domicile || localETF?.domicile || null;
  const displayInception =
    etfFund?.inceptionDate || etfData?.launchDate || localETF?.inceptionDate || null;
  const displayAssetClass   = assetClass !== "Unknown" ? assetClass : (localETF?.assetClass ?? "—");
  const displayFundSizeMil  = localETF?.fundSize ?? null;  // in millions EUR
  const displayAUM = etfFund?.aum ?? null;  // in USD from EODHD
  const displayHoldingsCount = etfFund?.holdingsCount ?? etfData?.numberOfHoldings ?? null;
  const displayYield =
    etfFund?.yield != null && etfFund.yield > 0
      ? etfFund.yield
      : (knownYield !== undefined && knownYield > 0 ? knownYield : null);

  // ETF data enrichment — runs as soon as meta is available
  useEffect(() => {
    if (!safeSymbol || loadingMeta) return;
    // EODHD fundamentals — primary rich data source (top holdings, sector, etc.)
    fetchETFFundamentals(cleanTicker, symbolToExchange(safeSymbol))
      .then(d => { if (d) setEtfFund(d); });
    // Server ETF data (JustETF) — secondary, for description field mostly
    if (portfolioISIN) {
      fetchETFDataFromServer(portfolioISIN).then(d => { if (d) setEtfData(d); });
    } else if (meta?.isin) {
      fetchETFDataFromServer(meta.isin).then(d => { if (d) setEtfData(d); });
    } else {
      fetchETFDataBySymbol(safeSymbol).then(d => { if (d) setEtfData(d); });
    }
  }, [safeSymbol, portfolioISIN, meta?.isin, loadingMeta, cleanTicker]);

  const topPad = Platform.OS === "web" ? 20 : insets.top;
  const bottomPad = Platform.OS === "web" ? 24 : insets.bottom + 24;

  const ageMs = fetchedAt ? now - fetchedAt.getTime() : null;

  const perf1W = perfCards.w;
  const perf1M = perfCards.m;
  const perf3M = perfCards.m3;
  const perf1Y = perfCards.y;

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loadingMeta) {
    return (
      <View style={[styles.loadingScreen, { backgroundColor: theme.background, paddingTop: topPad }]}>
        <TouchableOpacity style={[styles.backBtn, { top: topPad + 4 }]} onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={theme.text} />
        </TouchableOpacity>
        <ActivityIndicator color={theme.accent} size="large" />
        <Text style={{ color: theme.textSecondary, marginTop: 16, fontSize: 14 }}>
          Loading {safeSymbol}…
        </Text>
      </View>
    );
  }

  // ── Error — show local holding data if available, otherwise full error ─────
  if (metaError || !meta) {
    if (existingHolding) {
      const hVal = existingHolding.quantity * existingHolding.currentPrice;
      const hInv = existingHolding.quantity * existingHolding.avg_cost_eur;
      const hGain = hVal - hInv;
      const hGainPct = hInv > 0 ? (hGain / hInv) * 100 : 0;
      const hPositive = hGain >= 0;
      return (
        <View style={[styles.root, { backgroundColor: theme.background }]}>
          <ScrollView
            contentContainerStyle={[styles.scroll, { paddingTop: topPad, paddingBottom: 32 }]}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.topBar}>
              <TouchableOpacity onPress={() => router.back()} style={styles.backBtnInline}>
                <Feather name="arrow-left" size={22} color={theme.text} />
              </TouchableOpacity>
              <TouchableOpacity onPress={loadMeta} style={styles.refreshBtnInline}>
                <Feather name="refresh-cw" size={18} color={theme.accent} />
              </TouchableOpacity>
            </View>
            {/* Stale header card */}
            <View style={styles.headerCard}>
              <View style={styles.headerTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.symbolText}>{ticker}</Text>
                  <Text style={styles.nameText} numberOfLines={1}>{existingHolding.name || ticker}</Text>
                </View>
                <View style={[styles.exchBadge, { backgroundColor: theme.surface }]}>
                  <Text style={[styles.exchBadgeText, { color: theme.textTertiary }]}>Last close price unavailable</Text>
                </View>
              </View>
              <Text style={styles.priceText}>
                {existingHolding.hasPrice ? `€${existingHolding.currentPrice.toFixed(2)}` : `€${existingHolding.avg_cost_eur.toFixed(2)}`}
              </Text>
              <Text style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", fontFamily: "Archivo_400Regular", marginTop: 4 }}>
                {existingHolding.hasPrice ? "Last known price — live data unavailable" : "Avg cost shown — no price data"}
              </Text>
            </View>
            {/* Local holding metrics */}
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Your Position</Text>
              <View style={styles.statsGrid}>
                <StatCell label="Quantity" value={`${existingHolding.quantity} units`} />
                <StatCell label="Avg Cost" value={`€${existingHolding.avg_cost_eur.toFixed(2)}`} />
                <StatCell label="Total Invested" value={`€${hInv.toFixed(2)}`} />
                <StatCell label="Current Value" value={existingHolding.hasPrice ? `€${hVal.toFixed(2)}` : "—"} />
                <StatCell
                  label="Return (€)"
                  value={existingHolding.hasPrice ? `${hPositive ? "+" : ""}€${Math.abs(hGain).toFixed(2)}` : "—"}
                />
                <StatCell
                  label="Return (%)"
                  value={existingHolding.hasPrice ? `${hPositive ? "+" : ""}${hGainPct.toFixed(2)}%` : "—"}
                />
              </View>
            </View>
            <ETFCharacteristicsFallback
              styles={styles}
              displayISIN={displayISIN}
              displayAssetClass={displayAssetClass}
              effectiveTER={effectiveTER}
              displayDistribution={displayDistribution}
              displayReplication={displayReplication}
              displayDomicile={displayDomicile}
              displayInception={displayInception}
            />
            <TouchableOpacity style={styles.retryBtn} onPress={loadMeta}>
              <Feather name="refresh-cw" size={14} color={theme.accent} />
              <Text style={styles.retryText}>Retry loading live data</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      );
    }
    const hasAnyETFData = !!(localETF || etfFund || etfData);
    return (
      <View style={[styles.root, { backgroundColor: theme.background }]}>
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingTop: topPad, paddingBottom: 32 }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.topBar}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtnInline}>
              <Feather name="arrow-left" size={22} color={theme.text} />
            </TouchableOpacity>
          </View>
          <View style={{ alignItems: "center", paddingVertical: 24 }}>
            <Feather name="wifi-off" size={36} color={theme.textTertiary} />
            <Text style={{ color: theme.text, marginTop: 14, fontSize: 16, fontFamily: "Archivo_600SemiBold" }}>
              Live price unavailable
            </Text>
            <Text style={{ color: theme.textSecondary, marginTop: 6, fontSize: 13, textAlign: "center", paddingHorizontal: 32 }}>
              Could not load live data for {safeSymbol}{hasAnyETFData ? ", showing what we know about this ETF." : ". Check your connection and try again."}
            </Text>
          </View>
          {hasAnyETFData && (
            <ETFCharacteristicsFallback
              styles={styles}
              displayISIN={displayISIN}
              displayAssetClass={displayAssetClass}
              effectiveTER={effectiveTER}
              displayDistribution={displayDistribution}
              displayReplication={displayReplication}
              displayDomicile={displayDomicile}
              displayInception={displayInception}
            />
          )}
          <TouchableOpacity style={styles.retryBtn} onPress={loadMeta}>
            <Feather name="refresh-cw" size={14} color={theme.accent} />
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  const changePositive = meta.regularMarketChange >= 0;
  const changeColor = changePositive ? theme.positive : theme.negative;

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: topPad, paddingBottom: bottomPad + 72 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Top Bar ───────────────────────────────────────────────────── */}
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtnInline}>
            <Feather name="arrow-left" size={22} color={theme.text} />
          </TouchableOpacity>
          <TouchableOpacity onPress={loadMeta} style={styles.refreshBtnInline}>
            <Feather name="refresh-cw" size={18} color={theme.accent} />
          </TouchableOpacity>
        </View>

        {/* ── Header Card ───────────────────────────────────────────────── */}
        <View style={styles.headerCard}>
          <View style={styles.headerTop}>
            <View style={{ flex: 1 }}>
              <Text style={styles.symbolText}>{symbolToTicker(safeSymbol)}</Text>
              <Text style={styles.nameText} numberOfLines={2}>{meta.longName || meta.shortName}</Text>
            </View>
            <View style={styles.badgeGroup}>
              <View style={styles.exchBadge}>
                <Text style={styles.exchBadgeText}>{meta.exchangeName || "—"}</Text>
              </View>
              <View style={styles.currBadge}>
                <Text style={styles.currBadgeText}>{meta.currency}</Text>
              </View>
            </View>
          </View>

          <Text style={styles.priceText}>
            {meta.regularMarketPrice > 0
              ? `€${meta.regularMarketPrice.toFixed(2)}`
              : "—"}
          </Text>

          <View style={styles.changeRow}>
            <Feather
              name={(rangeChange?.pct ?? meta.regularMarketChangePercent) >= 0 ? "trending-up" : "trending-down"}
              size={15}
              color={(rangeChange?.pct ?? meta.regularMarketChangePercent) >= 0 ? theme.positive : theme.negative}
            />
            <Text style={[styles.changeText, {
              color: (rangeChange?.pct ?? meta.regularMarketChangePercent) >= 0 ? theme.positive : theme.negative
            }]}>
              {rangeChange
                ? `${rangeChange.pct >= 0 ? "+" : ""}${rangeChange.abs.toFixed(2)} (${rangeChange.pct >= 0 ? "+" : ""}${rangeChange.pct.toFixed(2)}%) ${range}`
                : `${meta.regularMarketChange >= 0 ? "+" : ""}${meta.regularMarketChange.toFixed(2)} (${meta.regularMarketChangePercent >= 0 ? "+" : ""}${meta.regularMarketChangePercent.toFixed(2)}%) vs prev. close`
              }
            </Text>
          </View>

          <View style={styles.liveRow}>
            <View style={[styles.liveDot, { backgroundColor: ageMs != null && ageMs < 60_000 ? theme.positive : theme.accent }]} />
            <Text style={styles.liveText}>
              {ageMs != null ? `Updated ${staleBadge(ageMs)}` : "Live"}
            </Text>
          </View>
        </View>

        {/* ── Chart ─────────────────────────────────────────────────────── */}
        <View style={[styles.chartCard]}>
          {/* Range selector */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.rangeRow}
            style={{ marginBottom: 4 }}
          >
            {RANGES.map((r) => (
              <TouchableOpacity
                key={r}
                style={[
                  styles.rangeBtn,
                  range === r && { backgroundColor: theme.accent },
                ]}
                onPress={() => handleRangeChange(r)}
              >
                <Text style={[styles.rangeBtnText, { color: range === r ? "#0A0F1A" : theme.textSecondary }]}>
                  {r}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {(range === "3Y" || range === "5Y" || range === "All") ? (
            <View style={{ height: 200, alignItems: "center", justifyContent: "center", gap: 10 }}>
              <Feather name="lock" size={28} color={theme.textTertiary} />
              <Text style={{ fontSize: 14, fontFamily: "Archivo_600SemiBold", color: theme.textSecondary }}>
                Upgrade to Pro
              </Text>
              <Text style={{ fontSize: 12, fontFamily: "Archivo_400Regular", color: theme.textTertiary, textAlign: "center", paddingHorizontal: 24 }}>
                Extended history requires a Pro subscription
              </Text>
            </View>
          ) : loadingChart ? (
            <View style={{ height: 200, alignItems: "center", justifyContent: "center" }}>
              <ActivityIndicator color={theme.accent} />
            </View>
          ) : (
            <PriceChart
              data={chartData}
              width={CHART_W - 32}
              height={200}
              range={range}
              avgCostEUR={existingHolding?.avg_cost_eur}
            />
          )}
          {rangePerf !== null && (
            <View style={{ alignItems: "center", marginTop: 8 }}>
              <View style={[styles.exchBadge, {
                backgroundColor: rangePerf >= 0 ? theme.positive + "22" : theme.negative + "22",
                paddingHorizontal: 14, paddingVertical: 6,
              }]}>
                <Text style={{ fontSize: 14, fontFamily: "Archivo_600SemiBold", color: rangePerf >= 0 ? theme.positive : theme.negative }}>
                  {rangePerf >= 0 ? "+" : ""}{rangePerf.toFixed(2)}% this {range}
                </Text>
              </View>
            </View>
          )}
        </View>

        {/* ── ETF Profile ───────────────────────────────────────────────── */}
        {isETF && (
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>ETF Profile</Text>
            <View style={styles.statsGrid}>
              {!!displayISIN && <StatCell label="ISIN" value={displayISIN} />}
              <StatCell label="Asset Class" value={displayAssetClass} />
              {effectiveTER !== null && (
                <StatCell label="TER (Annual Fee)" value={`${effectiveTER.toFixed(2)}%`} />
              )}
              {displayYield != null && (
                <StatCell label="Dividend Yield" value={`${displayYield.toFixed(2)}%`} />
              )}
              {displayDistribution && (
                <StatCell label="Distribution" value={capitalize(displayDistribution)} />
              )}
              {displayReplication && (
                <StatCell label="Replication" value={capitalize(displayReplication)} />
              )}
              {displayDomicile && (
                <StatCell label="Domicile" value={capitalize(displayDomicile)} />
              )}
              {displayInception && (
                <StatCell label="Inception" value={displayInception} />
              )}
              <StatCell label="Currency" value={meta.currency || "—"} />
              {displayHoldingsCount != null && (
                <StatCell label="# Holdings" value={displayHoldingsCount.toString()} />
              )}
              {/* AUM — prefer EODHD (USD), fall back to local DB (EUR millions) */}
              {(displayAUM != null || displayFundSizeMil != null) && (
                <StatCell
                  label="Fund Size"
                  value={
                    displayAUM != null
                      ? displayAUM >= 1e9
                        ? `$${(displayAUM / 1e9).toFixed(1)}B`
                        : `$${(displayAUM / 1e6).toFixed(0)}M`
                      : displayFundSizeMil! >= 1000
                        ? `€${(displayFundSizeMil! / 1000).toFixed(1)}B`
                        : `€${displayFundSizeMil!}M`
                  }
                />
              )}
            </View>
          </View>
        )}

        {/* ── Top Holdings ──────────────────────────────────────────────── */}
        {isETF && etfFund?.topHoldings && etfFund.topHoldings.length > 0 && (
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Top Holdings</Text>
            <View style={{ gap: 8 }}>
              {etfFund.topHoldings.slice(0, 8).map((h, i) => (
                <View key={i} style={{ gap: 3 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Text style={{ fontSize: 13, fontFamily: "Archivo_600SemiBold", color: theme.text, flex: 1 }} numberOfLines={1}>
                      {h.name}
                    </Text>
                    <Text style={{ fontSize: 13, fontFamily: "Archivo_800ExtraBold", color: theme.accent, marginLeft: 8, minWidth: 48, textAlign: "right" }}>
                      {h.weightPct.toFixed(2)}%
                    </Text>
                  </View>
                  <View style={{ height: 3, backgroundColor: theme.hairline, overflow: "hidden" }}>
                    <View style={{
                      width: `${Math.min(h.weightPct / (etfFund.topHoldings![0].weightPct || 1) * 100, 100)}%`,
                      height: "100%",
                      backgroundColor: theme.accent + "88",
                    }} />
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* ── Sector Breakdown ──────────────────────────────────────────── */}
        {isETF && etfFund?.sectorWeights && etfFund.sectorWeights.length > 0 && (
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Sector Breakdown</Text>
            <View style={{ gap: 8 }}>
              {etfFund.sectorWeights.map((s, i) => (
                <View key={i} style={{ gap: 3 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Text style={{ fontSize: 12, fontFamily: "Archivo_400Regular", color: theme.textSecondary, flex: 1 }} numberOfLines={1}>
                      {s.sector}
                    </Text>
                    <Text style={{ fontSize: 12, fontFamily: "Archivo_600SemiBold", color: theme.text, marginLeft: 8, minWidth: 40, textAlign: "right" }}>
                      {s.weightPct.toFixed(1)}%
                    </Text>
                  </View>
                  <View style={{ height: 3, backgroundColor: theme.hairline, overflow: "hidden" }}>
                    <View style={{
                      width: `${Math.min(s.weightPct / (etfFund.sectorWeights![0].weightPct || 1) * 100, 100)}%`,
                      height: "100%",
                      backgroundColor: theme.positive + "88",
                    }} />
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* ── Country Breakdown ─────────────────────────────────────────── */}
        {isETF && etfFund?.countryWeights && etfFund.countryWeights.length > 0 && (
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Country Breakdown</Text>
            <View style={{ gap: 8 }}>
              {etfFund.countryWeights.slice(0, 8).map((c, i) => (
                <View key={i} style={{ gap: 3 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Text style={{ fontSize: 12, fontFamily: "Archivo_400Regular", color: theme.textSecondary, flex: 1 }} numberOfLines={1}>
                      {c.country}
                    </Text>
                    <Text style={{ fontSize: 12, fontFamily: "Archivo_600SemiBold", color: theme.text, marginLeft: 8, minWidth: 40, textAlign: "right" }}>
                      {c.weightPct.toFixed(1)}%
                    </Text>
                  </View>
                  <View style={{ height: 3, backgroundColor: theme.hairline, overflow: "hidden" }}>
                    <View style={{
                      width: `${Math.min(c.weightPct / (etfFund.countryWeights![0].weightPct || 1) * 100, 100)}%`,
                      height: "100%",
                      backgroundColor: theme.accent + "55",
                    }} />
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* ── Market Data ───────────────────────────────────────────────── */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>{isETF ? "Market Data" : "Key Statistics"}</Text>
          <View style={styles.statsGrid}>
            <StatCell label="52W High" value={fmt(meta.fiftyTwoWeekHigh)} />
            <StatCell label="52W Low"  value={fmt(meta.fiftyTwoWeekLow)} />
            {meta.fiftyTwoWeekHigh > 0 && meta.regularMarketPrice > 0 && (
              <StatCell
                label="From 52W High"
                value={`${(((meta.regularMarketPrice - meta.fiftyTwoWeekHigh) / meta.fiftyTwoWeekHigh) * 100).toFixed(1)}%`}
              />
            )}
            {meta.fiftyTwoWeekLow > 0 && meta.regularMarketPrice > 0 && (
              <StatCell
                label="From 52W Low"
                value={`+${(((meta.regularMarketPrice - meta.fiftyTwoWeekLow) / meta.fiftyTwoWeekLow) * 100).toFixed(1)}%`}
              />
            )}
            {!isETF && <StatCell label="Asset Class" value={displayAssetClass} />}
            {!isETF && <StatCell label="Currency" value={meta.currency || "—"} />}
            {!isETF && effectiveTER !== null && (
              <StatCell label="TER (Fee)" value={`${effectiveTER.toFixed(2)}%/yr`} />
            )}
            {!isETF && knownYield !== undefined && knownYield > 0 && (
              <StatCell label="Div. Yield" value={`${knownYield.toFixed(1)}%`} />
            )}
          </View>
        </View>

        {/* ── Performance ───────────────────────────────────────────────── */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Performance</Text>
          <View style={styles.perfRow}>
            <PerfCard label="1W" changePct={perf1W} />
            <PerfCard label="1M" changePct={perf1M} />
            <PerfCard label="3M" changePct={perf3M} />
            <PerfCard label="1Y" changePct={perf1Y} />
          </View>
        </View>

        {/* ── Your Position ─────────────────────────────────────────────── */}
        {existingHolding && (() => {
          const hVal = existingHolding.quantity * existingHolding.currentPrice;
          const hInv = existingHolding.quantity * existingHolding.avg_cost_eur;
          const hGain = hVal - hInv;
          const hGainPct = hInv > 0 ? (hGain / hInv) * 100 : 0;
          const hPositive = hGain >= 0;
          const totalValue = holdings.reduce((s, h) => s + h.quantity * h.currentPrice, 0);
          const allocationPct = totalValue > 0 ? (hVal / totalValue) * 100 : 0;

          return (
            <View style={styles.sectionCard}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={styles.sectionTitle}>Your Position</Text>
                <TouchableOpacity onPress={handleViewHolding}>
                  <Text style={{ fontSize: 12, fontFamily: "Archivo_600SemiBold", color: theme.accent }}>
                    Full details →
                  </Text>
                </TouchableOpacity>
              </View>
              {/* P&L summary row */}
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
                <View>
                  <Text style={{ fontSize: 11, fontFamily: "Archivo_600SemiBold", color: theme.textSecondary }}>VALUE</Text>
                  <Text style={{ fontSize: 22, fontFamily: "Archivo_800ExtraBold", color: theme.text, letterSpacing: -0.5 }}>
                    {existingHolding.hasPrice ? `€${hVal.toFixed(2)}` : "—"}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={{ fontSize: 11, fontFamily: "Archivo_600SemiBold", color: theme.textSecondary }}>RETURN</Text>
                  <Text style={{ fontSize: 22, fontFamily: "Archivo_800ExtraBold", color: hPositive ? theme.positive : theme.negative, letterSpacing: -0.5 }}>
                    {existingHolding.hasPrice ? `${hPositive ? "+" : ""}${hGainPct.toFixed(2)}%` : "—"}
                  </Text>
                </View>
              </View>
              <View style={styles.statsGrid}>
                <StatCell label="Quantity" value={`${existingHolding.quantity} units`} />
                <StatCell label="Avg Cost" value={`€${existingHolding.avg_cost_eur.toFixed(2)}`} />
                <StatCell label="Invested" value={`€${hInv.toFixed(2)}`} />
                <StatCell
                  label="Gain / Loss"
                  value={existingHolding.hasPrice ? `${hPositive ? "+" : ""}€${Math.abs(hGain).toFixed(2)}` : "—"}
                />
                <StatCell label="Portfolio Weight" value={`${allocationPct.toFixed(1)}%`} />
                {existingHolding.purchase_date ? (
                  <StatCell label="Since" value={existingHolding.purchase_date} />
                ) : null}
              </View>
            </View>
          );
        })()}

        {/* ── Target Allocation ─────────────────────────────────────── */}
        {(() => {
          if (!existingHolding) return null;
          const targetRow = targets.find(t => t.ticker.toUpperCase() === ticker.toUpperCase());
          if (!targetRow) return null;

          const totalValue = holdings.reduce((s, h) => s + h.quantity * h.currentPrice, 0);
          const holdingValue = existingHolding.quantity * existingHolding.currentPrice;
          const currentPct = totalValue > 0 ? (holdingValue / totalValue) * 100 : 0;
          const targetPct  = targetRow.target_pct;
          const drift      = currentPct - targetPct;
          const absDrift   = Math.abs(drift);
          const beyondThreshold = absDrift > rebalanceThreshold;
          const driftColor = beyondThreshold ? theme.accent : theme.positive;
          const barFill = Math.min(currentPct / Math.max(targetPct * 1.5, 1), 1);
          const targetFill = Math.min(targetPct / Math.max(targetPct * 1.5, 1), 1);

          return (
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Target Allocation</Text>
              <View style={{ gap: 10 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <View style={{ gap: 2 }}>
                    <Text style={{ fontSize: 11, fontFamily: "Archivo_600SemiBold", color: theme.textSecondary }}>CURRENT</Text>
                    <Text style={{ fontSize: 18, fontFamily: "Archivo_800ExtraBold", color: theme.text }}>{currentPct.toFixed(1)}%</Text>
                  </View>
                  <View style={{ gap: 2, alignItems: "center" }}>
                    <Text style={{ fontSize: 11, fontFamily: "Archivo_600SemiBold", color: theme.textSecondary }}>TARGET</Text>
                    <Text style={{ fontSize: 18, fontFamily: "Archivo_800ExtraBold", color: theme.text }}>{targetPct.toFixed(1)}%</Text>
                  </View>
                  <View style={{ gap: 2, alignItems: "flex-end" }}>
                    <Text style={{ fontSize: 11, fontFamily: "Archivo_600SemiBold", color: theme.textSecondary }}>DRIFT</Text>
                    <Text style={{ fontSize: 18, fontFamily: "Archivo_800ExtraBold", color: driftColor }}>
                      {drift >= 0 ? "+" : ""}{drift.toFixed(1)}%
                    </Text>
                  </View>
                </View>
                <View style={{ height: 6, backgroundColor: theme.surface, borderRadius: 0, overflow: "hidden" }}>
                  <View style={{
                    position: "absolute", left: `${targetFill * 100}%`,
                    width: 2, height: "100%", backgroundColor: theme.textTertiary,
                  }} />
                  <View style={{
                    width: `${barFill * 100}%`, height: "100%",
                    backgroundColor: driftColor, borderRadius: 0,
                  }} />
                </View>
                {beyondThreshold && (
                  <Text style={{ fontSize: 11, fontFamily: "Archivo_400Regular", color: theme.accent }}>
                    {absDrift.toFixed(1)}% outside {rebalanceThreshold}% threshold — consider rebalancing
                  </Text>
                )}
              </View>
            </View>
          );
        })()}

        {etfData?.description && (
          <View style={[styles.sectionCard, { gap: 6 }]}>
            <Text style={[styles.sectionTitle, { fontSize: 13 }]}>About</Text>
            <Text style={{ fontSize: 12, fontFamily: "Archivo_400Regular", color: theme.textSecondary, lineHeight: 18 }}>
              {etfData.description}
            </Text>
          </View>
        )}

        {!!displayISIN && (
          <TouchableOpacity
            style={[styles.sectionCard, { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }]}
            onPress={() => Linking.openURL(`https://www.justetf.com/en/etf-profile.html?isin=${displayISIN}`)}
          >
            <Text style={{ fontSize: 13, fontFamily: "Archivo_400Regular", color: theme.textSecondary }}>View on JustETF</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Text style={{ fontSize: 13, fontFamily: "Archivo_600SemiBold", color: theme.accent }}>justetf.com</Text>
              <Feather name="external-link" size={12} color={theme.accent} />
            </View>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* ── Fixed Action Button ────────────────────────────────────────── */}
      <View
        style={[
          styles.actionBar,
          {
            paddingBottom: Platform.OS === "web" ? 16 : insets.bottom + 16,
            backgroundColor: theme.background,
            borderTopColor: theme.hairline,
          },
        ]}
      >
        {inPortfolio ? (
          <View style={{ flexDirection: "row", gap: 10 }}>
            <TouchableOpacity
              style={[styles.actionBtnOutlined, { borderColor: theme.hairline, flex: 1 }]}
              onPress={handleAddToPortfolio}
              activeOpacity={0.8}
            >
              <Feather name="plus" size={16} color={theme.text} />
              <Text style={[styles.actionBtnOutlinedText, { color: theme.text, fontSize: 14 }]}>
                Add More
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: theme.accent, flex: 2 }]}
              onPress={handleViewHolding}
              activeOpacity={0.8}
            >
              <Feather name="briefcase" size={16} color="#0A0F1A" />
              <Text style={styles.actionBtnText}>View Full Holding</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: theme.accent }]}
            onPress={handleAddToPortfolio}
            activeOpacity={0.8}
          >
            <Feather name="plus" size={18} color="#0A0F1A" />
            <Text style={styles.actionBtnText}>Add to Portfolio</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function makeStyles(theme: any) { return StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 16, gap: 12 },
  loadingScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  backBtn: {
    position: "absolute",
    left: 16,
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  backBtnInline: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 0,
    backgroundColor: theme.surface,
  },
  refreshBtnInline: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 0,
    backgroundColor: theme.surface,
  },
  headerCard: {
    backgroundColor: theme.surface,
    borderRadius: 0,
    padding: 20,
    gap: 6,
  },
  headerTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginBottom: 8,
  },
  symbolText: {
    fontSize: 26,
    fontFamily: "Archivo_800ExtraBold",
    color: theme.text,
    letterSpacing: -0.5,
  },
  nameText: {
    fontSize: 13,
    fontFamily: "Archivo_400Regular",
    color: "rgba(255,255,255,0.7)",
    marginTop: 2,
    lineHeight: 18,
  },
  badgeGroup: { gap: 6, alignItems: "flex-end" },
  exchBadge: {
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: 0,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  exchBadgeText: {
    fontSize: 11,
    fontFamily: "Archivo_600SemiBold",
    color: "rgba(255,255,255,0.8)",
    letterSpacing: 0.3,
  },
  currBadge: {
    backgroundColor: theme.accent + "33",
    borderRadius: 0,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: theme.accent + "66",
  },
  currBadgeText: {
    fontSize: 11,
    fontFamily: "Archivo_600SemiBold",
    color: theme.accent,
    letterSpacing: 0.3,
  },
  priceText: {
    fontSize: 42,
    fontFamily: "Archivo_800ExtraBold",
    color: theme.text,
    letterSpacing: -1,
  },
  changeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  changeText: {
    fontSize: 16,
    fontFamily: "Archivo_600SemiBold",
  },
  liveRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 0,
  },
  liveText: {
    fontSize: 12,
    fontFamily: "Archivo_400Regular",
    color: "rgba(255,255,255,0.55)",
  },
  chartCard: {
    backgroundColor: theme.surface,
    borderRadius: 0,
    padding: 16,
    borderWidth: 1,
    borderColor: theme.hairline,
  },
  rangeRow: {
    flexDirection: "row",
    gap: 4,
    paddingBottom: 8,
  },
  rangeBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 0,
  },
  rangeBtnText: {
    fontSize: 12,
    fontFamily: "Archivo_600SemiBold",
  },
  sectionCard: {
    backgroundColor: theme.surface,
    borderRadius: 0,
    padding: 16,
    borderWidth: 1,
    borderColor: theme.hairline,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 15,
    fontFamily: "Archivo_800ExtraBold",
    color: theme.text,
    letterSpacing: -0.2,
  },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 0,
  },
  statCell: {
    width: "50%",
    paddingVertical: 10,
    paddingRight: 8,
    borderBottomWidth: 1,
    borderBottomColor: theme.hairline,
  },
  statLabel: {
    fontSize: 11,
    fontFamily: "Archivo_600SemiBold",
    color: theme.textSecondary,
    letterSpacing: 0.2,
  },
  statValue: {
    fontSize: 15,
    fontFamily: "Archivo_800ExtraBold",
    color: theme.text,
    marginTop: 3,
  },
  perfRow: {
    flexDirection: "row",
    gap: 8,
  },
  perfCard: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 12,
    borderRadius: 0,
    borderWidth: 1,
  },
  perfLabel: {
    fontSize: 11,
    fontFamily: "Archivo_600SemiBold",
    color: theme.textSecondary,
    letterSpacing: 0.3,
  },
  perfValue: {
    fontSize: 14,
    fontFamily: "Archivo_800ExtraBold",
    marginTop: 4,
  },
  actionBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 16,
    borderRadius: 0,
  },
  actionBtnText: {
    fontSize: 16,
    fontFamily: "Archivo_800ExtraBold",
    color: "#0A0F1A",
  },
  actionBtnOutlined: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 16,
    borderRadius: 0,
    borderWidth: 2,
  },
  actionBtnOutlinedText: {
    fontSize: 16,
    fontFamily: "Archivo_800ExtraBold",
  },
  retryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 20,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: theme.accent + "55",
  },
  retryText: {
    color: theme.accent,
    fontSize: 14,
    fontFamily: "Archivo_600SemiBold",
  },
}); }
