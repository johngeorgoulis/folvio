import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
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
import {
  fetchSymbolPrice,
  searchTickers,
  type SearchResult,
} from "@/services/priceService";

const theme = Colors.dark;

// ─── Static popular lists ────────────────────────────────────────────────────

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
  { symbol: "AAPL",     ticker: "AAPL",   name: "Apple Inc." },
  { symbol: "MSFT",     ticker: "MSFT",   name: "Microsoft Corp." },
  { symbol: "NVDA",     ticker: "NVDA",   name: "NVIDIA Corporation" },
  { symbol: "ASML.AS",  ticker: "ASML",   name: "ASML Holding N.V." },
  { symbol: "NOVO-B.CO",ticker: "NOVO-B", name: "Novo Nordisk A/S" },
  { symbol: "SAP.DE",   ticker: "SAP",    name: "SAP SE" },
  { symbol: "NESN.SW",  ticker: "NESN",   name: "Nestlé S.A." },
  { symbol: "MC.PA",    ticker: "MC",     name: "LVMH Moët Hennessy" },
];

type Filter = "All" | "ETF" | "Stock" | "Fund";

interface PopularPrice {
  price: number;
  changePct: number;
}

function getTypeBadge(quoteType: string): string {
  switch (quoteType) {
    case "ETF": return "ETF";
    case "EQUITY": return "Stock";
    case "MUTUALFUND": return "Fund";
    default: return quoteType.slice(0, 5);
  }
}

function formatPctChange(pct: number): string {
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

function formatPrice(price: number): string {
  if (price >= 1000) return `€${price.toFixed(0)}`;
  if (price >= 10) return `€${price.toFixed(2)}`;
  return `€${price.toFixed(3)}`;
}

// ─── Popular Card ─────────────────────────────────────────────────────────────

function PopularCard({
  ticker,
  name,
  symbol,
  price,
}: {
  ticker: string;
  name: string;
  symbol: string;
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
        {price === undefined && (
          <ActivityIndicator size="small" color={theme.textTertiary} />
        )}
      </View>
      <Text style={styles.popularName} numberOfLines={2}>{name}</Text>
      <View style={styles.popularPriceRow}>
        {price != null ? (
          <>
            <Text style={styles.popularPrice}>{formatPrice(price.price)}</Text>
            <Text style={[styles.popularChange, { color: changeColor }]}>
              {formatPctChange(price.changePct)}
            </Text>
          </>
        ) : price === null ? (
          <Text style={{ color: theme.textTertiary, fontSize: 12 }}>—</Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

// ─── Result Row ───────────────────────────────────────────────────────────────

function ResultRow({ item }: { item: SearchResult }) {
  const badgeLabel = getTypeBadge(item.quoteType);
  const badgeColor =
    item.quoteType === "ETF"
      ? theme.tint
      : item.quoteType === "EQUITY"
      ? "#4A90D9"
      : "#8A9BB0";

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
  const [results, setResults] = useState<SearchResult[]>([]);
  const [filter, setFilter] = useState<Filter>("All");
  const [isSearching, setIsSearching] = useState(false);
  const [popularPrices, setPopularPrices] = useState<
    Record<string, PopularPrice | null>
  >({});
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    const all = [...POPULAR_ETFS, ...POPULAR_STOCKS];
    Promise.allSettled(all.map((item) => fetchSymbolPrice(item.symbol))).then(
      (settled) => {
        const map: Record<string, PopularPrice | null> = {};
        all.forEach((item, i) => {
          const res = settled[i];
          map[item.symbol] = res.status === "fulfilled" ? res.value : null;
        });
        setPopularPrices(map);
      }
    );
  }, []);

  const runSearch = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults([]);
      return;
    }
    setIsSearching(true);
    const r = await searchTickers(q);
    setResults(r);
    setIsSearching(false);
  }, []);

  function handleQueryChange(text: string) {
    setQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(text.trim()), 300);
  }

  const filteredResults = results.filter((r) => {
    if (filter === "All") return true;
    if (filter === "ETF") return r.quoteType === "ETF";
    if (filter === "Stock") return r.quoteType === "EQUITY";
    if (filter === "Fund") return r.quoteType === "MUTUALFUND";
    return true;
  });

  const showHome = query.length < 2;
  const FILTERS: Filter[] = ["All", "ETF", "Stock", "Fund"];

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: topPad + 12, paddingBottom: bottomPad }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Explore</Text>
          <Text style={styles.subtitle}>Search ETFs, funds & stocks</Text>
        </View>

        {/* Search bar */}
        <View style={[styles.searchBar, { backgroundColor: theme.backgroundCard, borderColor: query.length > 0 ? theme.tint : theme.border }]}>
          <Feather name="search" size={18} color={theme.textSecondary} style={{ marginRight: 8 }} />
          <TextInput
            ref={inputRef}
            style={styles.searchInput}
            value={query}
            onChangeText={handleQueryChange}
            placeholder="Search ticker or name..."
            placeholderTextColor={theme.textTertiary}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="characters"
            clearButtonMode="never"
          />
          {query.length > 0 && (
            <TouchableOpacity
              onPress={() => { setQuery(""); setResults([]); }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Feather name="x" size={16} color={theme.textSecondary} />
            </TouchableOpacity>
          )}
        </View>

        {/* ── Home: Popular ETFs + Stocks ─────────────────────────────── */}
        {showHome && (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Popular ETFs</Text>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalList}
              keyboardShouldPersistTaps="handled"
            >
              {POPULAR_ETFS.map((item) => (
                <PopularCard
                  key={item.symbol}
                  {...item}
                  price={
                    item.symbol in popularPrices
                      ? popularPrices[item.symbol]
                      : undefined
                  }
                />
              ))}
            </ScrollView>

            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Major Stocks</Text>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalList}
              keyboardShouldPersistTaps="handled"
            >
              {POPULAR_STOCKS.map((item) => (
                <PopularCard
                  key={item.symbol}
                  {...item}
                  price={
                    item.symbol in popularPrices
                      ? popularPrices[item.symbol]
                      : undefined
                  }
                />
              ))}
            </ScrollView>
          </>
        )}

        {/* ── Search Results ────────────────────────────────────────────── */}
        {!showHome && (
          <>
            {/* Filter tabs */}
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
                  <Text
                    style={[
                      styles.filterChipText,
                      { color: filter === f ? "#0A0F1A" : theme.textSecondary },
                    ]}
                  >
                    {f}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Loading */}
            {isSearching && (
              <View style={styles.loadingRow}>
                <ActivityIndicator color={theme.tint} />
                <Text style={{ color: theme.textSecondary, marginLeft: 10, fontSize: 14 }}>
                  Searching…
                </Text>
              </View>
            )}

            {/* No results */}
            {!isSearching && filteredResults.length === 0 && query.length >= 2 && (
              <View style={styles.emptyResults}>
                <Feather name="search" size={28} color={theme.textTertiary} />
                <Text style={{ color: theme.textSecondary, marginTop: 10, fontSize: 14 }}>
                  No results for "{query}"
                </Text>
              </View>
            )}

            {/* Results */}
            {filteredResults.map((item) => (
              <ResultRow key={item.symbol} item={item} />
            ))}
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
  title: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    color: theme.text,
    letterSpacing: -0.8,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: theme.textSecondary,
    marginTop: 2,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    fontFamily: "Inter_400Regular",
    color: theme.text,
    padding: 0,
  },
  sectionHeader: { marginTop: 16, marginBottom: 10 },
  sectionTitle: {
    fontSize: 17,
    fontFamily: "Inter_700Bold",
    color: theme.text,
    letterSpacing: -0.3,
  },
  horizontalList: {
    paddingRight: 4,
    gap: 10,
    flexDirection: "row",
  },
  popularCard: {
    width: 138,
    backgroundColor: theme.backgroundCard,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 14,
    gap: 4,
  },
  popularCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  popularTicker: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
    color: theme.tint,
    letterSpacing: 0.3,
  },
  popularName: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: theme.textSecondary,
    lineHeight: 15,
  },
  popularPriceRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
    marginTop: 6,
  },
  popularPrice: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: theme.text,
  },
  popularChange: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  filterRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 10,
    marginBottom: 8,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
  },
  filterChipText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 24,
    justifyContent: "center",
  },
  emptyResults: {
    alignItems: "center",
    paddingVertical: 48,
  },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.backgroundCard,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 14,
    marginBottom: 8,
  },
  resultLeft: { flex: 1 },
  resultTickerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 3,
  },
  resultSymbol: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
    color: theme.text,
  },
  typeBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  typeBadgeText: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.3,
  },
  resultName: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: theme.textSecondary,
  },
  resultExch: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: theme.textTertiary,
    marginLeft: 8,
  },
});
