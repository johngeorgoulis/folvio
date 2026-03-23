import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { usePortfolio } from "@/context/PortfolioContext";
import {
  fetchSymbolPrice,
  resolveISIN,
  searchTickers,
  type ISINResolveResult,
  type SearchResult,
} from "@/services/priceService";
import {
  initETFDatabase,
  searchETFDatabase,
  setUpdateCallback,
  type ETFSearchResult,
} from "@/services/etfDatabaseService";

const theme = Colors.dark;

// ─── Asset class badge colours ────────────────────────────────────────────────
const ASSET_CLASS_COLORS: Record<string, string> = {
  "Equity":       "#22C55E",
  "Bonds":        "#4A90D9",
  "Commodities":  "#F59E0B",
  "Real Estate":  "#A855F7",
  "Money Market": "#6B7280",
};

function getAssetClassColor(assetClass: string): string {
  return ASSET_CLASS_COLORS[assetClass] ?? "#8A9BB0";
}

// ─── Static popular lists ─────────────────────────────────────────────────────
const POPULAR_ETFS = [
  { symbol: "VWCE.DE", ticker: "VWCE", name: "Vanguard FTSE All-World Acc" },
  { symbol: "IWDA.AS", ticker: "IWDA", name: "iShares Core MSCI World" },
  { symbol: "VHYL.AS", ticker: "VHYL", name: "Vanguard FTSE All-World HY" },
  { symbol: "CSPX.L",  ticker: "CSPX", name: "iShares Core S&P 500" },
  { symbol: "SWDA.L",  ticker: "SWDA", name: "iShares Core MSCI World" },
  { symbol: "EUNL.DE", ticker: "EUNL", name: "iShares Core MSCI World" },
  { symbol: "TDIV.AS", ticker: "TDIV", name: "VanEck Morningstar Dev World" },
  { symbol: "VAGF.L",  ticker: "VAGF", name: "Vanguard Global Agg Bond" },
];

const POPULAR_STOCKS = [
  { symbol: "AAPL",      ticker: "AAPL",   name: "Apple Inc." },
  { symbol: "MSFT",      ticker: "MSFT",   name: "Microsoft Corp." },
  { symbol: "NVDA",      ticker: "NVDA",   name: "NVIDIA Corporation" },
  { symbol: "ASML.AS",   ticker: "ASML",   name: "ASML Holding N.V." },
  { symbol: "NOVO-B.CO", ticker: "NOVO-B", name: "Novo Nordisk A/S" },
  { symbol: "SAP.DE",    ticker: "SAP",    name: "SAP SE" },
  { symbol: "NESN.SW",   ticker: "NESN",   name: "Nestlé S.A." },
  { symbol: "MC.PA",     ticker: "MC",     name: "LVMH Moët Hennessy" },
];

const ISIN_REGEX = /^[A-Z]{2}[A-Z0-9]{10}$/;
function isISIN(q: string): boolean { return ISIN_REGEX.test(q.trim().toUpperCase()); }

type Filter = "All" | "ETF" | "Stock" | "Fund";

interface PopularPrice { price: number; changePct: number; }

function getTypeBadge(quoteType: string): string {
  switch (quoteType) {
    case "ETF":        return "ETF";
    case "EQUITY":     return "Stock";
    case "MUTUALFUND": return "Fund";
    default:           return quoteType.slice(0, 5);
  }
}
function formatPctChange(pct: number): string {
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
}
function formatPrice(price: number): string {
  if (price >= 1000) return `€${price.toFixed(0)}`;
  if (price >= 10)   return `€${price.toFixed(2)}`;
  return `€${price.toFixed(3)}`;
}

// ─── Popular Card ─────────────────────────────────────────────────────────────
function PopularCard({ ticker, name, symbol, price }: {
  ticker: string; name: string; symbol: string;
  price: PopularPrice | null | undefined;
}) {
  const isPos = price ? price.changePct >= 0 : true;
  const changeColor = isPos ? theme.positive : theme.negative;
  return (
    <TouchableOpacity
      style={styles.popularCard}
      onPress={() => router.push({ pathname: "/ticker/[symbol]", params: { symbol } })}
      activeOpacity={0.75}
    >
      <View style={styles.popularCardHeader}>
        <Text style={styles.popularTicker}>{ticker}</Text>
        {price === undefined && <ActivityIndicator size="small" color={theme.textTertiary} />}
      </View>
      <Text style={styles.popularName} numberOfLines={2}>{name}</Text>
      <View style={styles.popularPriceRow}>
        {price != null ? (
          <>
            <Text style={styles.popularPrice}>{formatPrice(price.price)}</Text>
            <Text style={[styles.popularChange, { color: changeColor }]}>{formatPctChange(price.changePct)}</Text>
          </>
        ) : price === null ? (
          <Text style={{ color: theme.textTertiary, fontSize: 12 }}>—</Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

// ─── Local ETF Result Row (from database) ─────────────────────────────────────
function LocalETFRow({ item }: { item: ETFSearchResult }) {
  const acColor = getAssetClassColor(item.assetClass);
  const distLabel = item.distribution
    ? item.distribution === "Accumulating" ? "Acc" : "Dist"
    : null;

  return (
    <TouchableOpacity
      style={styles.resultRow}
      onPress={() =>
        router.push({
          pathname: "/ticker/[symbol]",
          params: { symbol: item.primaryTicker },
        })
      }
      activeOpacity={0.75}
    >
      <View style={styles.resultLeft}>
        <View style={styles.resultTickerRow}>
          <Text style={styles.resultSymbol}>{item.ticker}</Text>
          {/* Asset class badge */}
          <View style={[styles.typeBadge, { backgroundColor: acColor + "22", borderColor: acColor + "55" }]}>
            <Text style={[styles.typeBadgeText, { color: acColor }]}>{item.assetClass}</Text>
          </View>
          {/* Acc / Dist badge */}
          {distLabel && (
            <View style={[styles.typeBadge, { backgroundColor: theme.tint + "22", borderColor: theme.tint + "44" }]}>
              <Text style={[styles.typeBadgeText, { color: theme.tint }]}>{distLabel}</Text>
            </View>
          )}
        </View>
        <Text style={styles.resultName} numberOfLines={1}>{item.shortName || item.name}</Text>
        <Text style={styles.resultISIN} numberOfLines={1}>{item.isin}</Text>
      </View>
      <View style={styles.resultRight}>
        {item.ter !== null && (
          <Text style={styles.resultTER}>{item.ter.toFixed(2)}%</Text>
        )}
        <Feather name="chevron-right" size={15} color={theme.textTertiary} />
      </View>
    </TouchableOpacity>
  );
}

// ─── Yahoo Finance Result Row ─────────────────────────────────────────────────
function YahooResultRow({ item }: { item: SearchResult }) {
  const badgeLabel = getTypeBadge(item.quoteType);
  const badgeColor =
    item.quoteType === "ETF" ? theme.tint :
    item.quoteType === "EQUITY" ? "#4A90D9" : "#8A9BB0";
  return (
    <TouchableOpacity
      style={styles.resultRow}
      onPress={() => router.push({ pathname: "/ticker/[symbol]", params: { symbol: item.symbol } })}
      activeOpacity={0.75}
    >
      <View style={styles.resultLeft}>
        <View style={styles.resultTickerRow}>
          <Text style={styles.resultSymbol}>{item.symbol}</Text>
          <View style={[styles.typeBadge, { backgroundColor: badgeColor + "22", borderColor: badgeColor + "55" }]}>
            <Text style={[styles.typeBadgeText, { color: badgeColor }]}>{badgeLabel}</Text>
          </View>
        </View>
        <Text style={styles.resultName} numberOfLines={1}>{item.shortName}</Text>
      </View>
      <Text style={styles.resultExch}>{item.exchDisp || item.exchange}</Text>
    </TouchableOpacity>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────
export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 24 : insets.top;
  const bottomPad = Platform.OS === "web" ? 80 : insets.bottom + 80;

  const [query, setQuery] = useState("");
  const [localResults, setLocalResults] = useState<ETFSearchResult[]>([]);
  const [yahooResults, setYahooResults] = useState<SearchResult[]>([]);
  const [filter, setFilter] = useState<Filter>("All");
  const [isSearchingYahoo, setIsSearchingYahoo] = useState(false);
  const [popularPrices, setPopularPrices] = useState<Record<string, PopularPrice | null>>({});
  const [isinResolving, setIsinResolving] = useState(false);
  const [isinResult, setIsinResult] = useState<ISINResolveResult | null>(null);
  const [isinError, setIsinError] = useState(false);
  const [updateToast, setUpdateToast] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const yahooDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<TextInput>(null);

  const { holdings } = usePortfolio();

  // ── Init ETF database ────────────────────────────────────────────────────
  useEffect(() => {
    setUpdateCallback((msg) => {
      setUpdateToast(msg);
      setTimeout(() => setUpdateToast(null), 3000);
    });
    initETFDatabase();
  }, []);

  // ── Popular prices ────────────────────────────────────────────────────────
  useEffect(() => {
    const all = [...POPULAR_ETFS, ...POPULAR_STOCKS];
    Promise.allSettled(all.map((item) => fetchSymbolPrice(item.symbol))).then((settled) => {
      const map: Record<string, PopularPrice | null> = {};
      all.forEach((item, i) => {
        const res = settled[i];
        map[item.symbol] = res.status === "fulfilled" ? res.value : null;
      });
      setPopularPrices(map);
    });
  }, []);

  const userETFs = useMemo(() => {
    return holdings.map((h) => ({
      symbol: h.ticker + (
        h.exchange === "XETRA"        ? ".DE" :
        h.exchange === "EURONEXT_AMS" ? ".AS" :
        h.exchange === "EURONEXT_PAR" ? ".PA" :
        h.exchange === "LSE"          ? ".L"  :
        h.exchange === "BORSA_IT"     ? ".MI" :
        h.exchange === "SIX"          ? ".SW" : ""
      ),
      ticker: h.ticker,
      name: h.name || h.ticker,
      isInPortfolio: true,
    }));
  }, [holdings]);

  const displayETFs = useMemo(() => {
    const userTickers = new Set(userETFs.map((e) => e.ticker));
    const extra = POPULAR_ETFS.filter((e) => !userTickers.has(e.ticker));
    return [...userETFs, ...extra].slice(0, 8);
  }, [userETFs]);

  // ── Search logic ──────────────────────────────────────────────────────────
  function handleQueryChange(text: string) {
    setQuery(text);
    setIsinResult(null);
    setIsinError(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (yahooDebounceRef.current) clearTimeout(yahooDebounceRef.current);

    const trimmed = text.trim();

    if (trimmed.length < 2) {
      setLocalResults([]);
      setYahooResults([]);
      return;
    }

    if (isISIN(trimmed)) {
      setLocalResults([]);
      setYahooResults([]);
      debounceRef.current = setTimeout(() => handleISINResolve(trimmed), 400);
      return;
    }

    // 1. Instant local search — no debounce needed (synchronous)
    const local = searchETFDatabase(trimmed, 10);
    setLocalResults(local);

    // 2. Yahoo Finance fallback — debounced, only if local gives < 5 results
    if (local.length < 5) {
      setIsSearchingYahoo(true);
      yahooDebounceRef.current = setTimeout(async () => {
        const r = await searchTickers(trimmed);
        setYahooResults(r);
        setIsSearchingYahoo(false);
      }, 500);
    } else {
      setYahooResults([]);
      setIsSearchingYahoo(false);
    }
  }

  const runLocalSearch = useCallback((q: string) => {
    const local = searchETFDatabase(q, 10);
    setLocalResults(local);
    return local;
  }, []);

  async function handleISINResolve(isin: string) {
    setIsinResolving(true);
    setIsinResult(null);
    setIsinError(false);
    try {
      const result = await resolveISIN(isin.toUpperCase());
      if (result && result.candidates.length > 0) {
        setIsinResult(result);
      } else {
        setIsinError(true);
      }
    } catch {
      setIsinError(true);
    } finally {
      setIsinResolving(false);
    }
  }

  // Filter Yahoo results
  const filteredYahoo = yahooResults.filter((r) => {
    if (filter === "All") return true;
    if (filter === "ETF")   return r.quoteType === "ETF";
    if (filter === "Stock") return r.quoteType === "EQUITY";
    if (filter === "Fund")  return r.quoteType === "MUTUALFUND";
    return true;
  });

  const queryTrimmed = query.trim();
  const queryIsISIN = isISIN(queryTrimmed);
  const showHome = queryTrimmed.length < 2;
  const hasLocalResults = localResults.length > 0;
  const showYahooSection = !hasLocalResults || filteredYahoo.length > 0;
  const FILTERS: Filter[] = ["All", "ETF", "Stock", "Fund"];

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {/* ── Update toast ───────────────────────────────────────────────────── */}
      {updateToast && (
        <View style={[styles.toast, { top: topPad + 8 }]}>
          <Feather name="database" size={13} color={theme.tint} />
          <Text style={styles.toastText}>{updateToast}</Text>
        </View>
      )}

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: topPad + 12, paddingBottom: bottomPad }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Explore</Text>
          <Text style={styles.subtitle}>Search ETFs, funds &amp; stocks</Text>
        </View>

        {/* Search bar */}
        <View style={[
          styles.searchBar,
          { backgroundColor: theme.backgroundCard, borderColor: query.length > 0 ? theme.tint : theme.border },
        ]}>
          <Feather name="search" size={18} color={theme.textSecondary} style={{ marginRight: 8 }} />
          <TextInput
            ref={inputRef}
            style={styles.searchInput}
            value={query}
            onChangeText={handleQueryChange}
            placeholder="Ticker, name or ISIN..."
            placeholderTextColor={theme.textTertiary}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="characters"
            clearButtonMode="never"
          />
          {query.length > 0 && (
            <TouchableOpacity
              onPress={() => {
                setQuery(""); setLocalResults([]); setYahooResults([]);
                setIsinResult(null); setIsinError(false);
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Feather name="x" size={16} color={theme.textSecondary} />
            </TouchableOpacity>
          )}
        </View>

        {/* ── Home: Popular ETFs + Stocks ────────────────────────────────── */}
        {showHome && (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{userETFs.length > 0 ? "Your ETFs" : "Popular ETFs"}</Text>
            </View>
            <ScrollView
              horizontal showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalList}
              keyboardShouldPersistTaps="handled"
            >
              {displayETFs.map((item) => (
                <PopularCard
                  key={item.symbol} {...item}
                  price={item.symbol in popularPrices ? popularPrices[item.symbol] : undefined}
                />
              ))}
            </ScrollView>

            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Major Stocks</Text>
            </View>
            <ScrollView
              horizontal showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalList}
              keyboardShouldPersistTaps="handled"
            >
              {POPULAR_STOCKS.map((item) => (
                <PopularCard
                  key={item.symbol} {...item}
                  price={item.symbol in popularPrices ? popularPrices[item.symbol] : undefined}
                />
              ))}
            </ScrollView>
          </>
        )}

        {/* ── Search Results ─────────────────────────────────────────────── */}
        {!showHome && (
          <>
            {/* ISIN badge */}
            {queryIsISIN && (
              <View style={styles.isinBadgeRow}>
                <Feather name="hash" size={13} color={theme.tint} />
                <Text style={styles.isinBadgeText}>ISIN detected</Text>
              </View>
            )}

            {/* Filter tabs — hidden for ISIN queries */}
            {!queryIsISIN && !hasLocalResults && (
              <View style={styles.filterRow}>
                {FILTERS.map((f) => (
                  <TouchableOpacity
                    key={f}
                    style={[
                      styles.filterChip,
                      {
                        backgroundColor: filter === f ? theme.tint : theme.backgroundCard,
                        borderColor: filter === f ? theme.tint : theme.border,
                      },
                    ]}
                    onPress={() => setFilter(f)}
                  >
                    <Text style={[styles.filterChipText, { color: filter === f ? "#0A0F1A" : theme.textSecondary }]}>
                      {f}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* ISIN: resolving */}
            {queryIsISIN && isinResolving && (
              <View style={styles.loadingRow}>
                <ActivityIndicator color={theme.tint} />
                <Text style={{ color: theme.textSecondary, marginLeft: 10, fontSize: 14 }}>
                  Looking up ISIN…
                </Text>
              </View>
            )}

            {/* ISIN: candidates */}
            {queryIsISIN && !isinResolving && isinResult && (
              <View style={{ gap: 8, marginTop: 8 }}>
                <Text style={{ color: theme.textSecondary, fontSize: 12, fontFamily: "Inter_400Regular" }}>
                  Select an exchange listing:
                </Text>
                {isinResult.candidates.map((sym) => (
                  <TouchableOpacity
                    key={sym} style={styles.resultRow}
                    onPress={() => router.push({ pathname: "/ticker/[symbol]", params: { symbol: sym } })}
                    activeOpacity={0.75}
                  >
                    <View style={styles.resultLeft}>
                      <View style={styles.resultTickerRow}>
                        <Text style={styles.resultSymbol}>{sym}</Text>
                        <View style={[styles.typeBadge, { backgroundColor: theme.tint + "22", borderColor: theme.tint + "55" }]}>
                          <Text style={[styles.typeBadgeText, { color: theme.tint }]}>ETF</Text>
                        </View>
                      </View>
                      {isinResult.etfData?.description ? (
                        <Text style={styles.resultName} numberOfLines={1}>
                          {isinResult.etfData.description.substring(0, 60)}
                        </Text>
                      ) : null}
                    </View>
                    <Feather name="chevron-right" size={16} color={theme.textTertiary} />
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* ISIN: not found */}
            {queryIsISIN && !isinResolving && isinError && (
              <View style={styles.emptyResults}>
                <Feather name="alert-circle" size={28} color={theme.textTertiary} />
                <Text style={{ color: theme.textSecondary, marginTop: 10, fontSize: 14 }}>
                  Could not resolve ISIN
                </Text>
                <Text style={{ color: theme.textTertiary, marginTop: 4, fontSize: 12, textAlign: "center", paddingHorizontal: 24 }}>
                  This ISIN is not listed on JustETF or is not available.
                </Text>
              </View>
            )}

            {/* ── Local DB results (instant) ─────────────────────────────── */}
            {!queryIsISIN && hasLocalResults && (
              <>
                <View style={styles.sectionDivider}>
                  <Feather name="database" size={11} color={theme.textTertiary} />
                  <Text style={styles.sectionDividerText}>UCITS ETF Database</Text>
                </View>
                {localResults.map((item) => (
                  <LocalETFRow key={item.isin} item={item} />
                ))}
              </>
            )}

            {/* ── Yahoo Finance results (fallback / supplement) ──────────── */}
            {!queryIsISIN && (
              <>
                {isSearchingYahoo && !hasLocalResults && (
                  <View style={styles.loadingRow}>
                    <ActivityIndicator color={theme.tint} />
                    <Text style={{ color: theme.textSecondary, marginLeft: 10, fontSize: 14 }}>
                      Searching…
                    </Text>
                  </View>
                )}

                {filteredYahoo.length > 0 && (
                  <>
                    <View style={styles.sectionDivider}>
                      <Feather name="trending-up" size={11} color={theme.textTertiary} />
                      <Text style={styles.sectionDividerText}>
                        {hasLocalResults ? "More results (Yahoo Finance)" : "Yahoo Finance"}
                      </Text>
                    </View>
                    {filteredYahoo.map((item) => (
                      <YahooResultRow key={item.symbol} item={item} />
                    ))}
                  </>
                )}

                {/* No results at all */}
                {!hasLocalResults && !isSearchingYahoo && filteredYahoo.length === 0 && queryTrimmed.length >= 2 && (
                  <View style={styles.emptyResults}>
                    <Feather name="search" size={28} color={theme.textTertiary} />
                    <Text style={{ color: theme.textSecondary, marginTop: 10, fontSize: 14 }}>
                      No results for "{query}"
                    </Text>
                  </View>
                )}
              </>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingHorizontal: 16, gap: 4 },
  header: { marginBottom: 14 },
  title: { fontSize: 28, fontFamily: "Inter_700Bold", color: theme.text, letterSpacing: -0.8 },
  subtitle: { fontSize: 14, fontFamily: "Inter_400Regular", color: theme.textSecondary, marginTop: 2 },
  searchBar: {
    flexDirection: "row", alignItems: "center", borderRadius: 14,
    borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 8,
  },
  searchInput: { flex: 1, fontSize: 16, fontFamily: "Inter_400Regular", color: theme.text, padding: 0 },
  sectionHeader: { marginTop: 16, marginBottom: 10 },
  sectionTitle: { fontSize: 17, fontFamily: "Inter_700Bold", color: theme.text, letterSpacing: -0.3 },
  sectionDivider: {
    flexDirection: "row", alignItems: "center", gap: 5,
    marginTop: 12, marginBottom: 6, paddingHorizontal: 2,
  },
  sectionDividerText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: theme.textTertiary, letterSpacing: 0.3 },
  horizontalList: { paddingRight: 4, gap: 10, flexDirection: "row" },
  popularCard: {
    width: 138, backgroundColor: theme.backgroundCard, borderRadius: 14,
    borderWidth: 1, borderColor: theme.border, padding: 14, gap: 4,
  },
  popularCardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  popularTicker: { fontSize: 15, fontFamily: "Inter_700Bold", color: theme.tint, letterSpacing: 0.3 },
  popularName: { fontSize: 11, fontFamily: "Inter_400Regular", color: theme.textSecondary, lineHeight: 15 },
  popularPriceRow: { flexDirection: "row", alignItems: "baseline", gap: 6, marginTop: 6 },
  popularPrice: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: theme.text },
  popularChange: { fontSize: 12, fontFamily: "Inter_500Medium" },
  filterRow: { flexDirection: "row", gap: 8, marginTop: 10, marginBottom: 8 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  filterChipText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  loadingRow: { flexDirection: "row", alignItems: "center", paddingVertical: 24, justifyContent: "center" },
  emptyResults: { alignItems: "center", paddingVertical: 48 },
  resultRow: {
    flexDirection: "row", alignItems: "center", backgroundColor: theme.backgroundCard,
    borderRadius: 12, borderWidth: 1, borderColor: theme.border, padding: 14, marginBottom: 8,
  },
  resultLeft: { flex: 1 },
  resultRight: { flexDirection: "row", alignItems: "center", gap: 8, marginLeft: 8 },
  resultTickerRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 3, flexWrap: "wrap" },
  resultSymbol: { fontSize: 15, fontFamily: "Inter_700Bold", color: theme.text },
  typeBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, borderWidth: 1 },
  typeBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold", letterSpacing: 0.3 },
  resultName: { fontSize: 12, fontFamily: "Inter_400Regular", color: theme.textSecondary },
  resultISIN: { fontSize: 10, fontFamily: "Inter_400Regular", color: theme.textTertiary, marginTop: 1 },
  resultTER: { fontSize: 11, fontFamily: "Inter_500Medium", color: theme.textSecondary },
  resultExch: { fontSize: 11, fontFamily: "Inter_400Regular", color: theme.textTertiary, marginLeft: 8 },
  isinBadgeRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 8, marginBottom: 4, paddingHorizontal: 4 },
  isinBadgeText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: theme.tint, letterSpacing: 0.2 },
  toast: {
    position: "absolute", left: 16, right: 16, zIndex: 100,
    backgroundColor: theme.backgroundElevated ?? "#1E2C3A",
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
    flexDirection: "row", alignItems: "center", gap: 8,
    borderWidth: 1, borderColor: theme.tint + "44",
  },
  toastText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: theme.text },
});
