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
import { usePortfolio } from "@/context/PortfolioContext";
import { useTheme } from "@/context/ThemeContext";
import type { MinimalTheme } from "@/constants/colors";
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

const POPULAR_ETFS = [
  { symbol: "VWCE.DE", ticker: "VWCE", name: "Vanguard FTSE All-World Acc" },
  { symbol: "IWDA.AS", ticker: "IWDA", name: "iShares Core MSCI World" },
  { symbol: "VUAA.AS", ticker: "VUAA", name: "iShares Core S&P 500 Acc" },
  { symbol: "CSPX.L",  ticker: "CSPX", name: "iShares Core S&P 500" },
  { symbol: "VHYL.AS", ticker: "VHYL", name: "Vanguard FTSE All-World HY" },
  { symbol: "TDIV.AS", ticker: "TDIV", name: "VanEck Morningstar Dev World" },
  { symbol: "EUNL.DE", ticker: "EUNL", name: "iShares Core MSCI World" },
  { symbol: "AGGH.AS", ticker: "AGGH", name: "iShares Core Global Agg Bond" },
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

function PopularCard({ ticker, name, symbol, price }: {
  ticker: string; name: string; symbol: string;
  price: PopularPrice | null | undefined;
}) {
  const { theme } = useTheme();
  const isPos = price ? price.changePct >= 0 : true;
  const changeColor = isPos ? theme.positive : theme.negative;
  return (
    <TouchableOpacity
      style={[popularCardStyles.card, { backgroundColor: theme.surface, borderColor: theme.hairline }]}
      onPress={() => router.push({ pathname: "/ticker/[symbol]", params: { symbol } })}
      activeOpacity={0.75}
    >
      <View style={popularCardStyles.header}>
        <Text style={[popularCardStyles.ticker, { color: theme.accent }]}>{ticker}</Text>
        {price === undefined && <ActivityIndicator size="small" color={theme.textMuted} />}
      </View>
      <Text style={[popularCardStyles.name, { color: theme.textMuted }]} numberOfLines={2}>{name}</Text>
      <View style={popularCardStyles.priceRow}>
        {price != null ? (
          <>
            <Text style={[popularCardStyles.price, { color: theme.text }]}>{formatPrice(price.price)}</Text>
            <Text style={[popularCardStyles.change, { color: changeColor }]}>{formatPctChange(price.changePct)}</Text>
          </>
        ) : price === null ? (
          <Text style={{ color: theme.textMuted, fontSize: 12 }}>—</Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

const popularCardStyles = StyleSheet.create({
  card: { width: 138, borderWidth: 1, padding: 14, gap: 4 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  ticker: { fontSize: 15, fontFamily: "Archivo_800ExtraBold", letterSpacing: 0.3 },
  name: { fontSize: 11, fontFamily: "Archivo_400Regular", lineHeight: 15 },
  priceRow: { flexDirection: "row", alignItems: "baseline", gap: 6, marginTop: 6 },
  price: { fontSize: 14, fontFamily: "Archivo_600SemiBold" },
  change: { fontSize: 12, fontFamily: "Archivo_600SemiBold" },
});

function LocalETFRow({ item }: { item: ETFSearchResult }) {
  const { theme } = useTheme();
  const acColor = getAssetClassColor(item.assetClass);
  const distLabel = item.distribution
    ? item.distribution === "Accumulating" ? "Acc" : "Dist"
    : null;

  return (
    <TouchableOpacity
      style={[rowStyles.row, { borderBottomColor: theme.hairline }]}
      onPress={() =>
        router.push({ pathname: "/ticker/[symbol]", params: { symbol: item.primaryTicker } })
      }
      activeOpacity={0.75}
    >
      <View style={rowStyles.left}>
        <View style={rowStyles.tickerRow}>
          <Text style={[rowStyles.symbol, { color: theme.text }]}>{item.ticker}</Text>
          <Text style={[rowStyles.tag, { color: acColor, borderColor: acColor + "55" }]}>{item.assetClass}</Text>
          {distLabel && (
            <Text style={[rowStyles.tag, { color: theme.accent, borderColor: theme.accent + "55" }]}>{distLabel}</Text>
          )}
        </View>
        <Text style={[rowStyles.name, { color: theme.textMuted }]} numberOfLines={1}>{item.shortName || item.name}</Text>
        <Text style={[rowStyles.isin, { color: theme.textMuted }]} numberOfLines={1}>{item.isin}</Text>
      </View>
      <View style={rowStyles.right}>
        {item.ter !== null && (
          <Text style={[rowStyles.ter, { color: theme.textMuted }]}>{item.ter.toFixed(2)}%</Text>
        )}
        <Feather name="chevron-right" size={15} color={theme.textMuted} />
      </View>
    </TouchableOpacity>
  );
}

function SearchResultRow({ item }: { item: SearchResult }) {
  const { theme } = useTheme();
  const badgeLabel = getTypeBadge(item.quoteType);
  const badgeColor =
    item.quoteType === "ETF" ? theme.accent :
    item.quoteType === "EQUITY" ? "#4A90D9" : "#8A9BB0";
  return (
    <TouchableOpacity
      style={[rowStyles.row, { borderBottomColor: theme.hairline }]}
      onPress={() => router.push({ pathname: "/ticker/[symbol]", params: { symbol: item.symbol } })}
      activeOpacity={0.75}
    >
      <View style={rowStyles.left}>
        <View style={rowStyles.tickerRow}>
          <Text style={[rowStyles.symbol, { color: theme.text }]}>{item.symbol}</Text>
          <Text style={[rowStyles.tag, { color: badgeColor, borderColor: badgeColor + "55" }]}>{badgeLabel}</Text>
        </View>
        <Text style={[rowStyles.name, { color: theme.textMuted }]} numberOfLines={1}>{item.shortName}</Text>
      </View>
      <Text style={[rowStyles.exch, { color: theme.textMuted }]}>{item.exchDisp || item.exchange}</Text>
    </TouchableOpacity>
  );
}

const rowStyles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: 1 },
  left: { flex: 1 },
  right: { flexDirection: "row", alignItems: "center", gap: 8, marginLeft: 8 },
  tickerRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 3, flexWrap: "wrap" },
  symbol: { fontSize: 15, fontFamily: "Archivo_800ExtraBold" },
  tag: { fontSize: 10, fontFamily: "Archivo_600SemiBold", borderWidth: 1, paddingHorizontal: 5, paddingVertical: 1 },
  name: { fontSize: 12, fontFamily: "Archivo_400Regular" },
  isin: { fontSize: 10, fontFamily: "Archivo_400Regular", marginTop: 1 },
  ter: { fontSize: 11, fontFamily: "Archivo_600SemiBold" },
  exch: { fontSize: 11, fontFamily: "Archivo_400Regular", marginLeft: 8 },
});

export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const topPad = Platform.OS === "web" ? 24 : insets.top;
  const bottomPad = Platform.OS === "web" ? 80 : insets.bottom + 80;

  const [query, setQuery] = useState("");
  const [localResults, setLocalResults] = useState<ETFSearchResult[]>([]);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [filter, setFilter] = useState<Filter>("All");
  const [isSearching, setIsSearching] = useState(false);
  const [popularPrices, setPopularPrices] = useState<Record<string, PopularPrice | null>>({});
  const [isinResolving, setIsinResolving] = useState(false);
  const [isinResult, setIsinResult] = useState<ISINResolveResult | null>(null);
  const [isinError, setIsinError] = useState(false);
  const [updateToast, setUpdateToast] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<TextInput>(null);

  const { holdings } = usePortfolio();

  useEffect(() => {
    setUpdateCallback((msg) => {
      setUpdateToast(msg);
      setTimeout(() => setUpdateToast(null), 3000);
    });
    initETFDatabase();
  }, []);

  useEffect(() => {
    const all = [...POPULAR_ETFS];
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
    }));
  }, [holdings]);

  function handleQueryChange(text: string) {
    setQuery(text);
    setIsinResult(null);
    setIsinError(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);

    const trimmed = text.trim();

    if (trimmed.length < 2) {
      setLocalResults([]);
      setSearchResults([]);
      return;
    }

    if (isISIN(trimmed)) {
      setLocalResults([]);
      setSearchResults([]);
      debounceRef.current = setTimeout(() => handleISINResolve(trimmed), 400);
      return;
    }

    const local = searchETFDatabase(trimmed, 10);
    setLocalResults(local);

    if (local.length < 5) {
      setIsSearching(true);
      searchDebounceRef.current = setTimeout(async () => {
        const r = await searchTickers(trimmed);
        setSearchResults(r);
        setIsSearching(false);
      }, 500);
    } else {
      setSearchResults([]);
      setIsSearching(false);
    }
  }

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

  const filteredYahoo = searchResults.filter((r) => {
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
  const FILTERS: Filter[] = ["All", "ETF", "Stock", "Fund"];

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      {updateToast && (
        <View style={[toastStyle.toast, { top: topPad + 8, backgroundColor: theme.surface, borderColor: theme.hairline }]}>
          <Feather name="database" size={13} color={theme.accent} />
          <Text style={[toastStyle.text, { color: theme.text }]}>{updateToast}</Text>
        </View>
      )}

      <ScrollView
        contentContainerStyle={[{ paddingHorizontal: 20, paddingTop: topPad + 12, paddingBottom: bottomPad, gap: 0 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <Text style={[hStyles.title, { color: theme.text }]}>EXPLORE</Text>
        <View style={[hStyles.divider, { backgroundColor: theme.text }]} />

        {/* Search input */}
        <View style={[hStyles.searchBar, { backgroundColor: theme.surface, borderColor: query.length > 0 ? theme.accent : theme.hairline }]}>
          <Feather name="search" size={16} color={theme.textMuted} style={{ marginRight: 8 }} />
          <TextInput
            ref={inputRef}
            style={[hStyles.searchInput, { color: theme.text }]}
            value={query}
            onChangeText={handleQueryChange}
            placeholder="Ticker, name or ISIN..."
            placeholderTextColor={theme.textMuted}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="characters"
            clearButtonMode="never"
          />
          {query.length > 0 && (
            <TouchableOpacity
              onPress={() => {
                setQuery(""); setLocalResults([]); setSearchResults([]);
                setIsinResult(null); setIsinError(false);
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Feather name="x" size={16} color={theme.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        {/* Home */}
        {showHome && (
          <>
            {userETFs.length > 0 && (
              <>
                <Text style={[hStyles.sectionLabel, { color: theme.textMuted }]}>YOUR ETFS</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, flexDirection: "row", paddingBottom: 8 }} keyboardShouldPersistTaps="handled">
                  {userETFs.map((item) => (
                    <PopularCard key={item.symbol} {...item} price={item.symbol in popularPrices ? popularPrices[item.symbol] : undefined} />
                  ))}
                </ScrollView>
              </>
            )}
            <Text style={[hStyles.sectionLabel, { color: theme.textMuted }]}>POPULAR</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, flexDirection: "row", paddingBottom: 8 }} keyboardShouldPersistTaps="handled">
              {POPULAR_ETFS.map((item) => (
                <PopularCard key={item.symbol} {...item} price={item.symbol in popularPrices ? popularPrices[item.symbol] : undefined} />
              ))}
            </ScrollView>
          </>
        )}

        {/* Search Results */}
        {!showHome && (
          <>
            {queryIsISIN && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 8 }}>
                <Feather name="hash" size={13} color={theme.accent} />
                <Text style={{ fontSize: 12, fontFamily: "Archivo_600SemiBold", color: theme.accent }}>ISIN detected</Text>
              </View>
            )}

            {!queryIsISIN && !hasLocalResults && (
              <View style={{ flexDirection: "row", gap: 8, paddingVertical: 10 }}>
                {FILTERS.map((f) => (
                  <TouchableOpacity
                    key={f}
                    style={[hStyles.filterChip, {
                      borderBottomWidth: filter === f ? 2 : 0,
                      borderBottomColor: filter === f ? theme.accent : "transparent",
                    }]}
                    onPress={() => setFilter(f)}
                  >
                    <Text style={[hStyles.filterChipText, { color: filter === f ? theme.text : theme.textMuted }]}>{f}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {queryIsISIN && isinResolving && (
              <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: 24, justifyContent: "center" }}>
                <ActivityIndicator color={theme.accent} />
                <Text style={{ color: theme.textMuted, marginLeft: 10, fontSize: 14, fontFamily: "Archivo_400Regular" }}>Looking up ISIN…</Text>
              </View>
            )}

            {queryIsISIN && !isinResolving && isinResult && (
              <View style={{ gap: 0 }}>
                <Text style={{ color: theme.textMuted, fontSize: 12, fontFamily: "Archivo_400Regular", paddingVertical: 8 }}>Select an exchange listing:</Text>
                {isinResult.candidates.map((sym) => (
                  <TouchableOpacity
                    key={sym}
                    style={[rowStyles.row, { borderBottomColor: theme.hairline }]}
                    onPress={() => router.push({ pathname: "/ticker/[symbol]", params: { symbol: sym } })}
                    activeOpacity={0.75}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[rowStyles.symbol, { color: theme.text }]}>{sym}</Text>
                      {isinResult.etfData?.description ? (
                        <Text style={[rowStyles.name, { color: theme.textMuted }]} numberOfLines={1}>
                          {isinResult.etfData.description.substring(0, 60)}
                        </Text>
                      ) : null}
                    </View>
                    <Feather name="chevron-right" size={16} color={theme.textMuted} />
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {queryIsISIN && !isinResolving && isinError && (
              <View style={{ alignItems: "center", paddingVertical: 48 }}>
                <Feather name="alert-circle" size={28} color={theme.textMuted} />
                <Text style={{ color: theme.textMuted, marginTop: 10, fontSize: 14, fontFamily: "Archivo_400Regular" }}>Could not resolve ISIN</Text>
              </View>
            )}

            {!queryIsISIN && hasLocalResults && (
              <>
                <View style={[hStyles.sectionDivider, { borderBottomColor: theme.hairline }]}>
                  <Feather name="database" size={11} color={theme.textMuted} />
                  <Text style={[hStyles.sectionDividerText, { color: theme.textMuted }]}>ETF DATABASE</Text>
                </View>
                {localResults.map((item) => (
                  <LocalETFRow key={item.isin} item={item} />
                ))}
              </>
            )}

            {!queryIsISIN && (
              <>
                {isSearching && !hasLocalResults && (
                  <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: 24, justifyContent: "center" }}>
                    <ActivityIndicator color={theme.accent} />
                    <Text style={{ color: theme.textMuted, marginLeft: 10, fontSize: 14, fontFamily: "Archivo_400Regular" }}>Searching…</Text>
                  </View>
                )}

                {filteredYahoo.length > 0 && (
                  <>
                    <View style={[hStyles.sectionDivider, { borderBottomColor: theme.hairline }]}>
                      <Feather name="trending-up" size={11} color={theme.textMuted} />
                      <Text style={[hStyles.sectionDividerText, { color: theme.textMuted }]}>
                        {hasLocalResults ? "MORE RESULTS" : "SEARCH RESULTS"}
                      </Text>
                    </View>
                    {filteredYahoo.map((item) => (
                      <SearchResultRow key={item.symbol} item={item} />
                    ))}
                  </>
                )}

                {!hasLocalResults && !isSearching && filteredYahoo.length === 0 && queryTrimmed.length >= 2 && (
                  <View style={{ alignItems: "center", paddingVertical: 48 }}>
                    <Feather name="search" size={28} color={theme.textMuted} />
                    <Text style={{ color: theme.textMuted, marginTop: 10, fontSize: 14, fontFamily: "Archivo_400Regular" }}>No results for "{query}"</Text>
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

const toastStyle = StyleSheet.create({
  toast: {
    position: "absolute", left: 16, right: 16, zIndex: 100,
    borderWidth: 1, borderRadius: 0,
    paddingHorizontal: 14, paddingVertical: 10,
    flexDirection: "row", alignItems: "center", gap: 8,
  },
  text: { fontSize: 13, fontFamily: "Archivo_600SemiBold" },
});

const hStyles = StyleSheet.create({
  title: { fontSize: 26, fontFamily: "Archivo_800ExtraBold", letterSpacing: -0.5, marginBottom: 12 },
  divider: { height: 2, marginBottom: 16 },
  searchBar: { flexDirection: "row", alignItems: "center", borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 16 },
  searchInput: { flex: 1, fontSize: 15, fontFamily: "Archivo_400Regular", padding: 0 },
  sectionLabel: { fontSize: 11, fontFamily: "Archivo_800ExtraBold", letterSpacing: 0.8, marginBottom: 10, marginTop: 8 },
  filterChip: { paddingVertical: 6, paddingHorizontal: 2, marginRight: 12 },
  filterChipText: { fontSize: 13, fontFamily: "Archivo_600SemiBold" },
  sectionDivider: { flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 10, borderBottomWidth: 1 },
  sectionDividerText: { fontSize: 11, fontFamily: "Archivo_800ExtraBold", letterSpacing: 0.6 },
});
