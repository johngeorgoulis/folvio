import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  ScrollView as RNScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useTheme } from "@/context/ThemeContext";
import { EXCHANGE_OPTIONS } from "@/components/ExchangePicker";

function searchUrl(q: string): string {
  const key = process.env.EXPO_PUBLIC_EODHD_API_KEY ?? "";
  return `https://eodhd.com/api/search/${encodeURIComponent(q)}?api_token=${key}&fmt=json&limit=10`;
}


const SUFFIX_MAP: Record<string, string> = Object.fromEntries(
  EXCHANGE_OPTIONS.map((e) => [e.suffix, e.value])
);

const EXCHANGE_SHORT: Record<string, string> = {
  XETRA: "DE", F: "DE",
  EURONEXT_AMS: "AMS", AS: "AMS",
  EURONEXT_PAR: "PAR", PA: "PAR",
  LSE: "LSE", L: "LSE",
  BORSA_IT: "IT", MI: "IT",
  SIX: "CH", SW: "CH",
  EURONEXT_BRU: "BRU", BR: "BRU",
  BME: "MC",
};

interface Quote {
  symbol: string;   // "{CODE}.{EXCHANGE}" e.g. "VWCE.XETRA"
  shortname?: string;
  longname?: string;
  exchDisp?: string;
  typeDisp?: string;
}

interface EodhdResult {
  Code: string;
  Name: string;
  Exchange: string;
  Type: string;
  ISIN?: string;
}

const EODHD_EXCHANGE_MAP: Record<string, string> = {
  "XETRA": "XETRA", "F": "XETRA",
  "AS": "EURONEXT_AMS",
  "PA": "EURONEXT_PAR",
  "LSE": "LSE", "L": "LSE",
  "MI": "BORSA_IT", "MIL": "BORSA_IT",
  "SW": "SIX",
  "BR": "EURONEXT_BRU",
  "MC": "BME",
  "HE": "NASDAQ_HEL",
  "ST": "NASDAQ_STO",
  "OL": "OSLO",
  "CO": "NASDAQ_CPH",
};

function normalizeEodhdResults(raw: EodhdResult[]): Quote[] {
  return raw
    .filter(r => r.Code && r.Exchange)
    .map(r => ({
      symbol: `${r.Code}.${r.Exchange}`,
      shortname: r.Name,
      exchDisp: r.Exchange,
      typeDisp: r.Type,
    }));
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
  const dotIdx = symbol.lastIndexOf(".");
  if (dotIdx > 0) {
    const ticker = symbol.slice(0, dotIdx);
    const exchCode = symbol.slice(dotIdx + 1).toUpperCase();
    const exchange = EODHD_EXCHANGE_MAP[exchCode] ?? SUFFIX_MAP[`.${exchCode}`] ?? "XETRA";
    return { ticker, exchange };
  }
  return { ticker: symbol, exchange: "XETRA" };
}

export default function TickerSearchInput({ value, onChange, onSelect, inputStyle }: Props) {
  const { theme } = useTheme();
  const styles = makeStyles(theme);
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
      const data: EodhdResult[] = await res.json();
      const rawQuotes = normalizeEodhdResults(Array.isArray(data) ? data : []);

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

function makeStyles(theme: any) { return StyleSheet.create({
  wrapper: {
    position: "relative",
    zIndex: 100,
  },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.surface,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: theme.hairline,
  },
  input: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
    fontFamily: "Archivo_400Regular",
    color: theme.text,
  },
  adornment: {
    paddingRight: 10,
  },
  dropdown: {
    position: "absolute",
    left: 0,
    right: 0,
    backgroundColor: theme.surface,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: theme.hairline,
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
    borderBottomColor: theme.hairline,
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
    fontFamily: "Archivo_800ExtraBold",
    color: theme.text,
  },
  exBadge: {
    backgroundColor: "rgba(201,168,76,0.18)",
    borderRadius: 0,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: "rgba(201,168,76,0.3)",
  },
  exBadgeText: {
    fontSize: 9,
    fontFamily: "Archivo_600SemiBold",
    color: "#C9A84C",
    letterSpacing: 0.3,
  },
  dropName: {
    fontSize: 12,
    fontFamily: "Archivo_400Regular",
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
    fontFamily: "Archivo_400Regular",
  },
}); }
