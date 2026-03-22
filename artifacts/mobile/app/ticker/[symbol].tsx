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
import Colors from "@/constants/colors";
import { usePortfolio } from "@/context/PortfolioContext";
import PriceChart from "@/components/PriceChart";
import {
  fetchChartHistory,
  fetchTickerMeta,
  type ChartPoint,
  type TickerMeta,
} from "@/services/priceService";
import { getAssetClass, getTER } from "@/services/assetClassService";

const theme = Colors.dark;

const KNOWN_YIELDS_MAP: Record<string, number> = {
  "VHYL": 3.4, "TDIV": 3.8, "VWRL": 1.6, "VWCE": 0.0,
  "IWDA": 0.0, "EGLN": 0.0, "CSBGE7": 2.8, "ERNE": 3.9,
  "IEGE": 3.2, "VUAA": 0.0, "CSPX": 1.2, "SWDA": 0.0,
  "IDVY": 3.8, "IHYG": 5.8, "AGGH": 3.1, "VGOV": 2.1,
};
const SCREEN_W = Dimensions.get("window").width;
const CHART_W = SCREEN_W - 32;
const RANGES = ["1D", "1W", "1M", "3M", "6M", "1Y", "All"] as const;
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
  return symbol.split(".")[0];
}

function symbolToExchange(symbol: string): string {
  if (symbol.endsWith(".DE")) return "XETRA";
  if (symbol.endsWith(".AS")) return "EURONEXT_AMS";
  if (symbol.endsWith(".PA")) return "EURONEXT_PAR";
  if (symbol.endsWith(".L"))  return "LSE";
  if (symbol.endsWith(".MI")) return "BORSA_IT";
  if (symbol.endsWith(".SW")) return "SIX";
  return "XETRA";
}

function computePerf(data: ChartPoint[], daysBack: number): number | null {
  if (data.length < 2) return null;
  const now = data[data.length - 1];
  const targetTs = now.timestamp - daysBack * 86_400_000;
  let nearest = data[0];
  for (const pt of data) {
    if (Math.abs(pt.timestamp - targetTs) < Math.abs(nearest.timestamp - targetTs)) {
      nearest = pt;
    }
  }
  if (nearest.priceEUR === 0 || nearest === now) return null;
  return ((now.priceEUR - nearest.priceEUR) / nearest.priceEUR) * 100;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statCell}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function PerfCard({ label, changePct }: { label: string; changePct: number | null }) {
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

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function TickerDetailScreen() {
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

  const safeSymbol = symbol ?? "";

  const ticker = symbolToTicker(safeSymbol);
  const inPortfolio = holdings.some(
    (h) => h.ticker.toUpperCase() === ticker.toUpperCase()
  );
  const existingHolding = holdings.find(
    (h) => h.ticker.toUpperCase() === ticker.toUpperCase()
  );

  const loadMeta = useCallback(async () => {
    setLoadingMeta(true);
    setMetaError(false);
    try {
      const [m, yd] = await Promise.all([
        fetchTickerMeta(safeSymbol),
        fetchChartHistory(safeSymbol, "1Y"),
      ]);
      setMeta(m);
      setYearData(yd);
      setChartData(yd);
      setFetchedAt(new Date());
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
    setLoadingChart(true);
    const d = r === "1Y" ? yearData : await fetchChartHistory(safeSymbol, r);
    if (r !== "1Y") setChartData(d);
    else setChartData(yearData);
    const p = d.length >= 2
      ? ((d[d.length - 1].priceEUR - d[0].priceEUR) / d[0].priceEUR) * 100
      : null;
    const abs = d.length >= 2 ? d[d.length - 1].priceEUR - d[0].priceEUR : null;
    setRangePerf(p);
    setRangeChange(abs !== null && p !== null ? { abs, pct: p } : null);
    setLoadingChart(false);
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
  const isin = holdings.find(h => h.ticker.toUpperCase() === cleanTicker.toUpperCase())?.isin ?? "";
  const topPad = Platform.OS === "web" ? 20 : insets.top;
  const bottomPad = Platform.OS === "web" ? 24 : insets.bottom + 24;

  const ageMs = fetchedAt ? now - fetchedAt.getTime() : null;

  const perf1W = computePerf(yearData, 7);
  const perf1M = computePerf(yearData, 30);
  const perf3M = computePerf(yearData, 91);
  const perf1Y = yearData.length >= 2
    ? ((yearData[yearData.length - 1].priceEUR - yearData[0].priceEUR) / yearData[0].priceEUR) * 100
    : null;

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loadingMeta) {
    return (
      <View style={[styles.loadingScreen, { backgroundColor: theme.background, paddingTop: topPad }]}>
        <TouchableOpacity style={[styles.backBtn, { top: topPad + 4 }]} onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={theme.text} />
        </TouchableOpacity>
        <ActivityIndicator color={theme.tint} size="large" />
        <Text style={{ color: theme.textSecondary, marginTop: 16, fontSize: 14 }}>
          Loading {safeSymbol}…
        </Text>
      </View>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (metaError || !meta) {
    return (
      <View style={[styles.loadingScreen, { backgroundColor: theme.background, paddingTop: topPad }]}>
        <TouchableOpacity style={[styles.backBtn, { top: topPad + 4 }]} onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={theme.text} />
        </TouchableOpacity>
        <Feather name="wifi-off" size={36} color={theme.textTertiary} />
        <Text style={{ color: theme.text, marginTop: 14, fontSize: 16, fontFamily: "Inter_600SemiBold" }}>
          Data unavailable
        </Text>
        <Text style={{ color: theme.textSecondary, marginTop: 6, fontSize: 13, textAlign: "center", paddingHorizontal: 32 }}>
          Could not load data for {safeSymbol}. Check your connection and try again.
        </Text>
        <TouchableOpacity style={styles.retryBtn} onPress={loadMeta}>
          <Feather name="refresh-cw" size={14} color={theme.tint} />
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
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
            <Feather name="refresh-cw" size={18} color={theme.tint} />
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
                : `${meta.regularMarketChange >= 0 ? "+" : ""}${meta.regularMarketChange.toFixed(2)} (${meta.regularMarketChangePercent >= 0 ? "+" : ""}${meta.regularMarketChangePercent.toFixed(2)}%) today`
              }
            </Text>
          </View>

          <View style={styles.liveRow}>
            <View style={[styles.liveDot, { backgroundColor: ageMs != null && ageMs < 60_000 ? theme.positive : "#F59E0B" }]} />
            <Text style={styles.liveText}>
              {ageMs != null ? `Updated ${staleBadge(ageMs)}` : "Live"}
            </Text>
          </View>
        </View>

        {/* ── Chart ─────────────────────────────────────────────────────── */}
        <View style={[styles.chartCard]}>
          {/* Range selector */}
          <View style={styles.rangeRow}>
            {RANGES.map((r) => (
              <TouchableOpacity
                key={r}
                style={[
                  styles.rangeBtn,
                  range === r && { backgroundColor: theme.tint },
                ]}
                onPress={() => handleRangeChange(r)}
              >
                <Text style={[styles.rangeBtnText, { color: range === r ? "#0A0F1A" : theme.textSecondary }]}>
                  {r}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {loadingChart ? (
            <View style={{ height: 200, alignItems: "center", justifyContent: "center" }}>
              <ActivityIndicator color={theme.tint} />
            </View>
          ) : (
            <PriceChart data={chartData} width={CHART_W - 32} height={200} range={range} />
          )}
          {rangePerf !== null && (
            <View style={{ alignItems: "center", marginTop: 8 }}>
              <View style={[styles.exchBadge, {
                backgroundColor: rangePerf >= 0 ? theme.positive + "22" : theme.negative + "22",
                paddingHorizontal: 14, paddingVertical: 6,
              }]}>
                <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: rangePerf >= 0 ? theme.positive : theme.negative }}>
                  {rangePerf >= 0 ? "+" : ""}{rangePerf.toFixed(2)}% this {range}
                </Text>
              </View>
            </View>
          )}
        </View>

        {/* ── Key Stats ─────────────────────────────────────────────────── */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Key Statistics</Text>
          <View style={styles.statsGrid}>
            <StatCell label="52W High" value={fmt(meta.fiftyTwoWeekHigh)} />
            <StatCell label="52W Low"  value={fmt(meta.fiftyTwoWeekLow)} />
            <StatCell label="Asset Class" value={assetClass} />
            <StatCell label="Currency" value={meta.currency || "—"} />
            {ter !== null && (
              <StatCell label="TER (Fee)" value={`${ter.toFixed(2)}%/yr`} />
            )}
            {knownYield !== undefined && knownYield > 0 && (
              <StatCell label="Div. Yield" value={`${knownYield.toFixed(1)}%`} />
            )}
            {!isETF && (
              <>
                <StatCell label="Market Cap" value={fmtLarge(meta.marketCap)} />
                <StatCell label="P/E Ratio" value={meta.trailingPE != null ? meta.trailingPE.toFixed(1) : "—"} />
              </>
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

        {!!isin && (
          <TouchableOpacity
            style={[styles.sectionCard, { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }]}
            onPress={() => Linking.openURL(`https://www.justetf.com/en/etf-profile.html?isin=${isin}`)}
          >
            <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: theme.textSecondary }}>View on JustETF</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: theme.tint }}>justetf.com</Text>
              <Feather name="external-link" size={12} color={theme.tint} />
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
            borderTopColor: theme.border,
          },
        ]}
      >
        {inPortfolio ? (
          <TouchableOpacity
            style={[styles.actionBtnOutlined, { borderColor: theme.tint }]}
            onPress={handleViewHolding}
            activeOpacity={0.8}
          >
            <Feather name="check-circle" size={18} color={theme.tint} />
            <Text style={[styles.actionBtnOutlinedText, { color: theme.tint }]}>
              In Portfolio — View Holding
            </Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: theme.tint }]}
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

const styles = StyleSheet.create({
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
    borderRadius: 12,
    backgroundColor: theme.backgroundCard,
  },
  refreshBtnInline: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: theme.backgroundCard,
  },
  headerCard: {
    backgroundColor: theme.deepBlue,
    borderRadius: 16,
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
    fontFamily: "Inter_700Bold",
    color: theme.text,
    letterSpacing: -0.5,
  },
  nameText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.7)",
    marginTop: 2,
    lineHeight: 18,
  },
  badgeGroup: { gap: 6, alignItems: "flex-end" },
  exchBadge: {
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  exchBadgeText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: "rgba(255,255,255,0.8)",
    letterSpacing: 0.3,
  },
  currBadge: {
    backgroundColor: theme.tint + "33",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: theme.tint + "66",
  },
  currBadgeText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: theme.tint,
    letterSpacing: 0.3,
  },
  priceText: {
    fontSize: 42,
    fontFamily: "Inter_700Bold",
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
    fontFamily: "Inter_600SemiBold",
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
    borderRadius: 4,
  },
  liveText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.55)",
  },
  chartCard: {
    backgroundColor: theme.backgroundCard,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: theme.border,
  },
  rangeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  rangeBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  rangeBtnText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  sectionCard: {
    backgroundColor: theme.backgroundCard,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: theme.border,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
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
    borderBottomColor: theme.border,
  },
  statLabel: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    color: theme.textSecondary,
    letterSpacing: 0.2,
  },
  statValue: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
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
    borderRadius: 12,
    borderWidth: 1,
  },
  perfLabel: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    color: theme.textSecondary,
    letterSpacing: 0.3,
  },
  perfValue: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
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
    borderRadius: 16,
  },
  actionBtnText: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    color: "#0A0F1A",
  },
  actionBtnOutlined: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 16,
    borderRadius: 16,
    borderWidth: 2,
  },
  actionBtnOutlinedText: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
  },
  retryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 20,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.tint + "55",
  },
  retryText: {
    color: theme.tint,
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
});
