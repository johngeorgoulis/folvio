import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  ScrollView as RNScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import Colors from "@/constants/colors";
import { EXCHANGE_OPTIONS } from "@/components/ExchangePicker";

function searchUrl(q: string): string {
  if (Platform.OS === "web") {
    const domain = process.env.EXPO_PUBLIC_DOMAIN ?? "";
    return `https://${domain}/api/yahoo/search?q=${encodeURIComponent(q)}`;
  }
  return `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0&listsCount=0`;
}

const theme = Colors.dark;

const SUFFIX_MAP: Record<string, string> = Object.fromEntries(
  EXCHANGE_OPTIONS.map((e) => [e.suffix, e.value])
);

const EXCHANGE_SHORT: Record<string, string> = {
  XETRA: "DE",
  EURONEXT_AMS: "AMS",
  EURONEXT_PAR: "PAR",
  LSE: "LSE",
  BORSA_IT: "IT",
  SIX: "CH",
};

interface Quote {
  symbol: string;
  shortname?: string;
  longname?: string;
  exchDisp?: string;
  typeDisp?: string;
}

export interface TickerSelection {
  ticker: string;
  name: string;
  exchange: string;
}

interface Props {
  value: string;
  onChange: (text: string) => void;
  onSelect: (sel: TickerSelection) => void;
  inputStyle?: object;
}

function parseSymbol(symbol: string): { ticker: string; exchange: string } {
  for (const [suffix, exchange] of Object.entries(SUFFIX_MAP)) {
    if (symbol.endsWith(suffix)) {
      return { ticker: symbol.slice(0, -suffix.length), exchange };
    }
  }
  return { ticker: symbol, exchange: "XETRA" };
}

export default function TickerSearchInput({ value, onChange, onSelect, inputStyle }: Props) {
  const [results, setResults] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [noResults, setNoResults] = useState(false);
  const [inputHeight, setInputHeight] = useState(44);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSearch = useCallback(async (q: string) => {
    setLoading(true);
    setNoResults(false);
    try {
      const url = searchUrl(q);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      let res: Response;
      try {
        res = await fetch(url, { signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();

      const rawQuotes: Quote[] =
        data?.finance?.result?.[0]?.quotes ?? data?.quotes ?? [];

      const etfs = rawQuotes.filter(
        (r) =>
          r.typeDisp?.toLowerCase().includes("etf") ||
          r.typeDisp?.toLowerCase().includes("fund")
      );
      const quotes = etfs.length > 0 ? etfs : rawQuotes;
      const final = quotes.slice(0, 6);

      setResults(final);
      setNoResults(final.length === 0);
      setShowDropdown(true);
    } catch {
      setResults([]);
      setShowDropdown(false);
    } finally {
      setLoading(false);
    }
  }, []);

  function handleChange(text: string) {
    const upper = text.toUpperCase();
    onChange(upper);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!upper.trim() || upper.length < 2) {
      setResults([]);
      setShowDropdown(false);
      setNoResults(false);
      return;
    }

    debounceRef.current = setTimeout(() => doSearch(upper), 300);
  }

  function handleSelect(quote: Quote) {
    const { ticker, exchange } = parseSymbol(quote.symbol);
    const name = quote.shortname || quote.longname || "";
    onChange(ticker);
    onSelect({ ticker, name, exchange });
    setShowDropdown(false);
    setResults([]);
  }

  function closeDropdown() {
    setTimeout(() => setShowDropdown(false), 100);
  }

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <View style={styles.wrapper}>
      <View
        style={[styles.inputWrap, inputStyle]}
        onLayout={(e) => setInputHeight(e.nativeEvent.layout.height)}
      >
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={handleChange}
          onBlur={closeDropdown}
          placeholder="e.g. VWCE"
          placeholderTextColor={theme.textTertiary}
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="done"
        />
        {loading ? (
          <ActivityIndicator size="small" color={theme.textTertiary} style={styles.adornment} />
        ) : value.length >= 2 && !showDropdown ? null : value.length >= 2 ? (
          <TouchableOpacity onPress={() => setShowDropdown(false)} style={styles.adornment}>
            <Feather name="x" size={14} color={theme.textTertiary} />
          </TouchableOpacity>
        ) : null}
      </View>

      {showDropdown && (
        <View style={[styles.dropdown, { top: inputHeight + 4 }]}>
          <RNScrollView
            keyboardShouldPersistTaps="always"
            bounces={false}
            showsVerticalScrollIndicator={false}
            style={{ maxHeight: 240 }}
          >
            {noResults ? (
              <View style={styles.emptyRow}>
                <Feather name="search" size={14} color={theme.textTertiary} />
                <Text style={styles.emptyText}>No results for "{value}"</Text>
              </View>
            ) : (
              results.map((quote, idx) => {
                const { ticker, exchange } = parseSymbol(quote.symbol);
                const exShort = EXCHANGE_SHORT[exchange] ?? quote.exchDisp ?? "";
                const isLast = idx === results.length - 1;
                return (
                  <TouchableOpacity
                    key={quote.symbol}
                    style={[styles.dropRow, isLast && { borderBottomWidth: 0 }]}
                    onPress={() => handleSelect(quote)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.dropLeft}>
                      <Text style={styles.dropTicker}>{ticker}</Text>
                      {exShort ? (
                        <View style={styles.exBadge}>
                          <Text style={styles.exBadgeText}>{exShort}</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={styles.dropName} numberOfLines={1}>
                      {quote.shortname || quote.longname || "—"}
                    </Text>
                  </TouchableOpacity>
                );
              })
            )}
          </RNScrollView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: "relative",
    zIndex: 100,
  },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.backgroundElevated,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.border,
  },
  input: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: theme.text,
  },
  adornment: {
    paddingRight: 10,
  },
  dropdown: {
    position: "absolute",
    left: 0,
    right: 0,
    backgroundColor: theme.backgroundCard,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
    zIndex: 9999,
    elevation: 30,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    overflow: "hidden",
  },
  dropRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    gap: 8,
  },
  dropLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    width: 90,
    flexShrink: 0,
  },
  dropTicker: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
    color: theme.text,
  },
  exBadge: {
    backgroundColor: "rgba(201,168,76,0.18)",
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: "rgba(201,168,76,0.3)",
  },
  exBadgeText: {
    fontSize: 9,
    fontFamily: "Inter_600SemiBold",
    color: "#C9A84C",
    letterSpacing: 0.3,
  },
  dropName: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: theme.textSecondary,
    flex: 1,
  },
  emptyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 14,
  },
  emptyText: {
    fontSize: 13,
    color: theme.textSecondary,
    fontFamily: "Inter_400Regular",
  },
});
