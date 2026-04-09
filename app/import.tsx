import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { router, Stack } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { usePortfolio, FREE_TIER_LIMIT } from "@/context/PortfolioContext";
import {
  BROKER_CONFIGS,
  parseCSV,
  type BrokerConfig,
  type ParsedHolding,
} from "@/services/csvImport";
import { useSubscription } from "@/context/SubscriptionContext";
import { resolveExchangeFromISIN } from "@/services/priceService";

type DuplicateAction = "skip" | "merge" | "replace";

interface ImportItem {
  holding: ParsedHolding & { resolvedExchange: string };
  editedTicker: string;
  isDuplicate: boolean;
  existingId?: string;
  duplicateAction: DuplicateAction;
}

const theme = Colors.dark;

// ─── Progress Indicator ────────────────────────────────────────────────────────

function StepProgress({ step }: { step: 1 | 2 | 3 }) {
  return (
    <View style={prog.row}>
      {([1, 2, 3] as const).map((s) => (
        <React.Fragment key={s}>
          <View
            style={[
              prog.dot,
              { backgroundColor: step >= s ? theme.tint : theme.border },
            ]}
          />
          {s < 3 && (
            <View
              style={[
                prog.line,
                { backgroundColor: step > s ? theme.tint : theme.border },
              ]}
            />
          )}
        </React.Fragment>
      ))}
    </View>
  );
}
const prog = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  line: { flex: 1, height: 2, maxWidth: 60 },
});

// ─── Step 1: Broker Grid ───────────────────────────────────────────────────────

function BrokerCard({
  broker,
  selected,
  onPress,
}: {
  broker: BrokerConfig;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.brokerCard,
        {
          borderColor: selected ? theme.tint : theme.border,
          backgroundColor: selected ? theme.deepBlue : theme.backgroundCard,
        },
      ]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      {selected && (
        <View style={styles.checkBadge}>
          <Feather name="check" size={12} color="#000" />
        </View>
      )}
      <Text style={styles.brokerEmoji}>{broker.emoji}</Text>
      <Text
        style={[
          styles.brokerName,
          { color: selected ? theme.tint : theme.text },
        ]}
      >
        {broker.name}
      </Text>
      <Text style={[styles.brokerLabel, { color: theme.textSecondary }]}>
        {broker.label}
      </Text>
    </TouchableOpacity>
  );
}

// ─── Step 2: Upload Area ───────────────────────────────────────────────────────

async function readFile(uri: string): Promise<string> {
  if (Platform.OS === "web") {
    const res = await fetch(uri);
    return res.text();
  }
  const filename = uri.split("/").pop() ?? "import.csv";
  const dest = (FileSystem.cacheDirectory ?? "") + filename;
  try {
    await FileSystem.copyAsync({ from: uri, to: dest });
  } catch {
    // ignore copy errors
  }
  try {
    return await FileSystem.readAsStringAsync(dest, { encoding: "utf8" });
  } catch {
    const b64 = await FileSystem.readAsStringAsync(dest, { encoding: "base64" });
    return atob(b64);
  }
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Step 3: Holding Preview Row ───────────────────────────────────────────────

function DuplicateToggle({
  value,
  onChange,
}: {
  value: DuplicateAction;
  onChange: (v: DuplicateAction) => void;
}) {
  const options: { key: DuplicateAction; label: string }[] = [
    { key: "skip", label: "Skip" },
    { key: "merge", label: "Merge" },
    { key: "replace", label: "Replace" },
  ];
  return (
    <View style={styles.segmented}>
      {options.map((o) => (
        <TouchableOpacity
          key={o.key}
          style={[
            styles.segBtn,
            {
              backgroundColor:
                value === o.key ? theme.tint : theme.backgroundElevated,
            },
          ]}
          onPress={() => onChange(o.key)}
        >
          <Text
            style={[
              styles.segBtnText,
              { color: value === o.key ? "#000" : theme.textSecondary },
            ]}
          >
            {o.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function PreviewRow({
  item,
  onTickerChange,
  onActionChange,
}: {
  item: ImportItem;
  onTickerChange: (t: string) => void;
  onActionChange: (a: DuplicateAction) => void;
}) {
  const willImport = !item.isDuplicate || item.duplicateAction !== "skip";
  return (
    <View
      style={[
        styles.previewRow,
        {
          borderBottomColor: theme.border,
          opacity: !willImport && item.isDuplicate ? 0.5 : 1,
        },
      ]}
    >
      {/* Ticker */}
      <View style={styles.previewLeft}>
        {item.holding.needsTickerConfirmation ? (
          <View style={styles.tickerEditRow}>
            <Feather
              name="alert-triangle"
              size={12}
              color="#FBBF24"
              style={{ marginRight: 4 }}
            />
            <TextInput
              style={[
                styles.tickerInput,
                { color: theme.text, borderColor: theme.tint },
              ]}
              value={item.editedTicker}
              onChangeText={(t) => onTickerChange(t.toUpperCase())}
              autoCapitalize="characters"
              placeholder="TICKER"
              placeholderTextColor={theme.textTertiary}
              maxLength={12}
            />
          </View>
        ) : (
          <Text style={[styles.previewTicker, { color: theme.text }]}>
            {item.editedTicker}
          </Text>
        )}
        {item.holding.instrumentName &&
          item.holding.needsTickerConfirmation && (
            <Text
              style={[styles.previewInstrName, { color: theme.textTertiary }]}
              numberOfLines={1}
            >
              {item.holding.instrumentName}
            </Text>
          )}
        {item.holding.warning && (
          <Text
            style={[styles.previewWarning, { color: "#FBBF24" }]}
            numberOfLines={2}
          >
            ⚠ {item.holding.warning}
          </Text>
        )}
      </View>

      {/* Stats */}
      <View style={styles.previewMid}>
        <Text style={[styles.previewStat, { color: theme.textSecondary }]}>
          ×
          {item.holding.quantity % 1 === 0
            ? item.holding.quantity.toFixed(0)
            : item.holding.quantity.toFixed(4).replace(/\.?0+$/, "")}
        </Text>
        <Text style={[styles.previewStat, { color: theme.textSecondary }]}>
          €{item.holding.avgCostEUR.toFixed(2)}
        </Text>
        {item.holding.purchaseDate ? (
          <Text style={[styles.previewDate, { color: theme.textTertiary }]}>
            {fmtShortDate(item.holding.purchaseDate)}
          </Text>
        ) : null}
      </View>

      {/* Status */}
      <View style={styles.previewRight}>
        {item.isDuplicate ? (
          <View>
            <View
              style={[styles.statusBadge, { backgroundColor: "#FBBF2422" }]}
            >
              <Text style={[styles.statusText, { color: "#FBBF24" }]}>
                ⚠ Duplicate
              </Text>
            </View>
            <DuplicateToggle
              value={item.duplicateAction}
              onChange={onActionChange}
            />
          </View>
        ) : (
          <View
            style={[
              styles.statusBadge,
              { backgroundColor: theme.positive + "22" },
            ]}
          >
            <Text style={[styles.statusText, { color: theme.positive }]}>
              ✓ New
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

function fmtShortDate(iso: string): string {
  if (!iso || iso.length < 7) return iso;
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const [yyyy, mm] = iso.split("-");
  const m = parseInt(mm, 10) - 1;
  return `${months[m] ?? mm} ${yyyy}`;
}

// ─── Main Screen ───────────────────────────────────────────────────────────────

function guessExchangeFromISIN(isin: string, ticker?: string): string {
  // Ticker-specific overrides (known listings)
  const tickerOverrides: Record<string, string> = {
    "ERNE": "LSE",
    "IEGE": "BORSA_IT",
    "CSBGE7": "SIX",
    "EGLN": "LSE",
    "VHYL": "EURONEXT_AMS",
  };
  if (ticker && tickerOverrides[ticker.toUpperCase()]) {
    return tickerOverrides[ticker.toUpperCase()];
  }
  if (!isin) return "XETRA";
  const country = isin.substring(0, 2).toUpperCase();
  switch (country) {
    case "IE": return "XETRA";
    case "NL": return "EURONEXT_AMS";
    case "LU": return "EURONEXT_PAR";
    case "FR": return "EURONEXT_PAR";
    case "GB": return "LSE";
    case "DE": return "XETRA";
    default:   return "XETRA";
  }
}

export default function ImportScreen() {
  const insets = useSafeAreaInsets();
  const { holdings, holdingCount, addHolding, updateHolding, deleteHolding } =
    usePortfolio();

  const { canImportCSV, showPaywall } = useSubscription();

  // Redirect to paywall immediately if CSV import is not available on this tier
  React.useEffect(() => {
    if (!canImportCSV) {
      showPaywall("import");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedBroker, setSelectedBroker] = useState<BrokerConfig | null>(
    null,
  );
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState<number>(0);
  const [csvContent, setCsvContent] = useState<string>("");
  const [pickingFile, setPickingFile] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [importItems, setImportItems] = useState<ImportItem[]>([]);
  const [importing, setImporting] = useState(false);

  // ── File picking ────────────────────────────────────────────────────────────

  const handlePickFile = useCallback(async () => {
    try {
      setPickingFile(true);

      const result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: false,
        multiple: false,
      });

      console.log("PICKER RESULT:", JSON.stringify(result));

      if (result.canceled) return;

      const asset = result.assets
        ? result.assets[0]
        : (result as unknown as {
            uri: string;
            name: string;
            size?: number;
            mimeType?: string;
          });
      console.log("ASSET URI:", asset.uri);
      console.log("ASSET NAME:", asset.name);
      console.log("ASSET SIZE:", asset.size);
      console.log("ASSET MIME:", (asset as { mimeType?: string }).mimeType);

      let content: string;
      try {
        content = await readFile(asset.uri);
        console.log("CONTENT LENGTH:", content.length);
        console.log("FIRST 200 CHARS:", content.substring(0, 200));
      } catch (readErr: unknown) {
        const e = readErr as Error & { code?: string };
        console.log("READ ERROR:", e.message);
        throw readErr;
      }

      setFileName(asset.name);
      setFileSize((asset.size as number | undefined) ?? content.length);
      setCsvContent(content);
    } catch (err: unknown) {
      const e = err as Error & { code?: string };
      console.log("ERROR TYPE:", e.constructor?.name);
      console.log("ERROR MESSAGE:", e.message);
      console.log("ERROR CODE:", e.code);
      console.log("FULL ERROR:", JSON.stringify(err));
      Alert.alert("Debug", `URI: ${(err as any)?.uri ?? 'none'}\nMsg: ${(err as Error)?.message ?? String(err)}`);
    } finally {
      setPickingFile(false);
    }
  }, []);

  // ── Parse + build import items ───────────────────────────────────────────────

  const handlePreview = useCallback(async () => {
    if (!selectedBroker || !csvContent) return;
    try {
      setParsing(true);
      const parsed = parseCSV(selectedBroker.key, csvContent);

      // Resolve correct exchange for each holding via Yahoo Finance ISIN lookup
      const parsedWithExchange = await Promise.all(
        parsed.map(async (h) => ({
          ...h,
          resolvedExchange: await resolveExchangeFromISIN(h.isin ?? "", h.ticker),
        }))
      );

      const existingTickers = new Set(
        holdings.map((h) => h.ticker.toUpperCase()),
      );
      const items: ImportItem[] = parsedWithExchange.map((h) => {
        const upperTicker = h.ticker.toUpperCase();
        const existing = holdings.find(
          (eh) => eh.ticker.toUpperCase() === upperTicker,
        );
        return {
          holding: h,
          editedTicker: upperTicker,
          isDuplicate: !!existing,
          existingId: existing?.id,
          duplicateAction: "skip",
        };
      });
      setImportItems(items);
      setStep(3);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "EMPTY_FILE") {
        Alert.alert("Empty File", "No data found in this file.");
      } else if (msg === "NO_BUYS") {
        Alert.alert(
          "No Transactions Found",
          `No BUY transactions found.\n\nThis might not be a ${selectedBroker.name} CSV. Try selecting "Generic CSV" instead.`,
        );
      } else {
        Alert.alert(
          "Parse Error",
          `This doesn't look like a ${selectedBroker.name} CSV.\n\nTry selecting "Generic CSV" instead.`,
        );
      }
    } finally {
      setParsing(false);
    }
  }, [selectedBroker, csvContent, holdings]);

  // ── Import count logic ───────────────────────────────────────────────────────

  const importableCount = useMemo(() => {
    return importItems.filter(
      (item) => !item.isDuplicate || item.duplicateAction !== "skip",
    ).length;
  }, [importItems]);

  const newHoldingsCount = useMemo(() => {
    return importItems.filter((item) => !item.isDuplicate).length;
  }, [importItems]);

  // ── Actual import ────────────────────────────────────────────────────────────

  const handleImport = useCallback(async () => {
    if (importableCount === 0) {
      Alert.alert("Nothing to Import", "All holdings are set to Skip.");
      return;
    }

    // Free tier check: how many new holdings would be added?
    const newItemsCount = importItems.filter(
      (item) => !item.isDuplicate,
    ).length;
    const slotsRemaining = FREE_TIER_LIMIT - holdingCount;
    const TESTING_BYPASS = true; // TODO: set to false before release
    if (!TESTING_BYPASS && newItemsCount > slotsRemaining) {
      setShowPremium(true);
      return;
    }

    setImporting(true);
    let imported = 0;
    let failed = 0;

    for (const item of importItems) {
      if (item.isDuplicate && item.duplicateAction === "skip") continue;
      const ticker = item.editedTicker.trim().toUpperCase();
      if (!ticker) {
        failed++;
        continue;
      }

      const holdingData = {
        ticker,
        isin: item.holding.isin ?? "",
        exchange: item.holding.resolvedExchange ?? guessExchangeFromISIN(item.holding.isin ?? "", ticker),
        name: ticker,
        quantity: item.holding.quantity,
        avg_cost_eur: item.holding.avgCostEUR,
        purchase_date: item.holding.purchaseDate,
        yield_pct: null,
      };

      try {
        if (!item.isDuplicate) {
          await addHolding(holdingData, 0);
        } else if (item.duplicateAction === "replace") {
          if (item.existingId) await deleteHolding(item.existingId);
          await addHolding(holdingData, 0);
        } else if (item.duplicateAction === "merge") {
          const existing = holdings.find((h) => h.id === item.existingId);
          if (existing && item.existingId) {
            const newQty = existing.quantity + item.holding.quantity;
            const newAvg =
              (existing.quantity * existing.avg_cost_eur +
                item.holding.quantity * item.holding.avgCostEUR) /
              newQty;
            await updateHolding(item.existingId, {
              quantity: newQty,
              avg_cost_eur: Math.round(newAvg * 100) / 100,
            });
          }
        }
        imported++;
      } catch (err) {
        console.error("[import] failed for", ticker, err);
        failed++;
      }
    }

    setImporting(false);

    if (failed > 0) {
      Alert.alert(
        "Partial Import",
        `${imported} imported, ${failed} failed.\nYou can review your holdings in the Holdings tab.`,
        [
          {
            text: "OK",
            onPress: () => router.replace("/(tabs)/holdings" as never),
          },
        ],
      );
    } else {
      Alert.alert(
        "Import Complete",
        `✓ ${imported} holding${imported !== 1 ? "s" : ""} imported successfully`,
        [
          {
            text: "View Holdings",
            onPress: () => router.replace("/(tabs)/holdings" as never),
          },
        ],
      );
    }
  }, [
    importItems,
    importableCount,
    holdingCount,
    holdings,
    addHolding,
    updateHolding,
    deleteHolding,
  ]);

  // ── Item update helpers ──────────────────────────────────────────────────────

  function updateItemTicker(index: number, ticker: string) {
    setImportItems((prev) =>
      prev.map((item, i) =>
        i === index ? { ...item, editedTicker: ticker } : item,
      ),
    );
  }

  function updateItemAction(index: number, action: DuplicateAction) {
    setImportItems((prev) =>
      prev.map((item, i) =>
        i === index ? { ...item, duplicateAction: action } : item,
      ),
    );
  }

  const topPad = Platform.OS === "web" ? 0 : insets.top;
  const bottomPad = Platform.OS === "web" ? 24 : insets.bottom + 16;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <Stack.Screen
        options={{
          title: "Import Portfolio",
          headerStyle: { backgroundColor: theme.backgroundCard },
          headerTintColor: theme.text,
          headerTitleStyle: { fontFamily: "Inter_600SemiBold", fontSize: 17 },
          headerLeft: () => (
            <TouchableOpacity
              onPress={() =>
                step === 1
                  ? router.back()
                  : setStep((s) => (s - 1) as 1 | 2 | 3)
              }
              style={{ paddingRight: 8 }}
            >
              <Feather name="arrow-left" size={22} color={theme.text} />
            </TouchableOpacity>
          ),
        }}
      />

      {/* ── STEP 1: Broker selection ─────────────────────────────────────── */}
      {step === 1 && (
        <View style={{ flex: 1 }}>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={[
              styles.content,
              { paddingTop: 20, paddingBottom: bottomPad + 80 },
            ]}
            showsVerticalScrollIndicator={false}
          >
            <StepProgress step={1} />
            <Text style={[styles.stepTitle, { color: theme.text }]}>
              Select your broker
            </Text>
            <Text style={[styles.stepSub, { color: theme.textSecondary }]}>
              Choose the app or platform you exported from
            </Text>

            <View style={styles.brokerGrid}>
              {BROKER_CONFIGS.map((broker) => (
                <BrokerCard
                  key={broker.key}
                  broker={broker}
                  selected={selectedBroker?.key === broker.key}
                  onPress={() => setSelectedBroker(broker)}
                />
              ))}
            </View>
          </ScrollView>

          <View
            style={[
              styles.bottomBar,
              { paddingBottom: bottomPad, borderTopColor: theme.border },
            ]}
          >
            <TouchableOpacity
              style={[
                styles.primaryBtn,
                { backgroundColor: selectedBroker ? theme.tint : theme.border },
              ]}
              onPress={() => selectedBroker && setStep(2)}
              disabled={!selectedBroker}
              activeOpacity={0.8}
            >
              <Text
                style={[
                  styles.primaryBtnText,
                  { color: selectedBroker ? "#000" : theme.textTertiary },
                ]}
              >
                Next →
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── STEP 2: Instructions + Upload ────────────────────────────────── */}
      {step === 2 && selectedBroker && (
        <View style={{ flex: 1 }}>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={[
              styles.content,
              { paddingTop: 20, paddingBottom: bottomPad + 100 },
            ]}
            showsVerticalScrollIndicator={false}
          >
            <StepProgress step={2} />
            <Text style={[styles.stepTitle, { color: theme.text }]}>
              {selectedBroker.name}
            </Text>
            <Text style={[styles.stepSub, { color: theme.textSecondary }]}>
              Follow these steps to export your CSV
            </Text>

            {/* Instructions */}
            <View
              style={[
                styles.instructionsCard,
                {
                  backgroundColor: theme.backgroundCard,
                  borderColor: theme.border,
                },
              ]}
            >
              {selectedBroker.instructions.map((line, i) => (
                <View key={i} style={styles.instrRow}>
                  {/^\s/.test(line) ? (
                    <Text
                      style={[styles.instrCode, { color: theme.textSecondary }]}
                    >
                      {line}
                    </Text>
                  ) : (
                    <>
                      <View
                        style={[
                          styles.instrNum,
                          { backgroundColor: theme.tint + "22" },
                        ]}
                      >
                        <Text
                          style={[styles.instrNumText, { color: theme.tint }]}
                        >
                          {i + 1}
                        </Text>
                      </View>
                      <Text style={[styles.instrText, { color: theme.text }]}>
                        {line}
                      </Text>
                    </>
                  )}
                </View>
              ))}
            </View>

            {/* Upload box */}
            <TouchableOpacity
              style={[
                styles.uploadBox,
                {
                  borderColor: fileName ? theme.positive : theme.tint,
                  backgroundColor: fileName
                    ? theme.positive + "11"
                    : theme.backgroundCard,
                },
              ]}
              onPress={handlePickFile}
              disabled={pickingFile}
              activeOpacity={0.75}
            >
              {pickingFile ? (
                <ActivityIndicator size="small" color={theme.tint} />
              ) : fileName ? (
                <>
                  <Feather
                    name="check-circle"
                    size={32}
                    color={theme.positive}
                  />
                  <Text
                    style={[styles.uploadFileName, { color: theme.positive }]}
                  >
                    {fileName}
                  </Text>
                  <Text
                    style={[
                      styles.uploadFileSub,
                      { color: theme.textSecondary },
                    ]}
                  >
                    {fmtBytes(fileSize)} · tap to change
                  </Text>
                </>
              ) : (
                <>
                  <Feather name="paperclip" size={32} color={theme.tint} />
                  <Text style={[styles.uploadTitle, { color: theme.text }]}>
                    Tap to select CSV file
                  </Text>
                  <Text
                    style={[styles.uploadSub, { color: theme.textSecondary }]}
                  >
                    Supports .csv files up to 10 MB
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </ScrollView>

          <View
            style={[
              styles.bottomBar,
              { paddingBottom: bottomPad, borderTopColor: theme.border },
            ]}
          >
            <TouchableOpacity
              style={[
                styles.primaryBtn,
                {
                  backgroundColor:
                    fileName && !parsing ? theme.tint : theme.border,
                },
              ]}
              onPress={handlePreview}
              disabled={!fileName || parsing}
              activeOpacity={0.8}
            >
              {parsing ? (
                <ActivityIndicator size="small" color="#000" />
              ) : (
                <Text
                  style={[
                    styles.primaryBtnText,
                    { color: fileName ? "#000" : theme.textTertiary },
                  ]}
                >
                  Preview Import →
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── STEP 3: Preview & Confirm ─────────────────────────────────────── */}
      {step === 3 && (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={{ flex: 1 }}>
            <View
              style={[styles.content, { paddingTop: 20, paddingBottom: 0 }]}
            >
              <StepProgress step={3} />
              <Text style={[styles.stepTitle, { color: theme.text }]}>
                Review Import
              </Text>
              <Text style={[styles.stepSub, { color: theme.textSecondary }]}>
                {importItems.length} holding
                {importItems.length !== 1 ? "s" : ""} found — review before
                importing
              </Text>
              {importItems.some((i) => i.holding.needsTickerConfirmation) && (
                <View
                  style={[
                    styles.warnBanner,
                    { backgroundColor: "#FBBF2418", borderColor: "#FBBF2433" },
                  ]}
                >
                  <Feather name="alert-triangle" size={14} color="#FBBF24" />
                  <Text style={[styles.warnBannerText, { color: "#FBBF24" }]}>
                    Some tickers need confirmation — tap the field to edit
                  </Text>
                </View>
              )}
            </View>

            <FlatList
              data={importItems}
              keyExtractor={(_, i) => String(i)}
              renderItem={({ item, index }) => (
                <PreviewRow
                  item={item}
                  onTickerChange={(t) => updateItemTicker(index, t)}
                  onActionChange={(a) => updateItemAction(index, a)}
                />
              )}
              contentContainerStyle={{ paddingBottom: 120 }}
            />

            <View
              style={[
                styles.actionBar,
                {
                  paddingBottom: bottomPad,
                  borderTopColor: theme.border,
                  backgroundColor: theme.backgroundCard,
                },
              ]}
            >
              <TouchableOpacity
                style={[styles.cancelBtn, { borderColor: theme.border }]}
                onPress={() => router.back()}
              >
                <Text style={[styles.cancelBtnText, { color: theme.text }]}>
                  Cancel
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.importBtn,
                  {
                    backgroundColor:
                      importableCount > 0 ? theme.tint : theme.border,
                  },
                ]}
                onPress={handleImport}
                disabled={importing || importableCount === 0}
                activeOpacity={0.8}
              >
                {importing ? (
                  <ActivityIndicator size="small" color="#000" />
                ) : (
                  <Text
                    style={[
                      styles.importBtnText,
                      {
                        color:
                          importableCount > 0 ? "#000" : theme.textTertiary,
                      },
                    ]}
                  >
                    Import {importableCount} Holding
                    {importableCount !== 1 ? "s" : ""}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      )}

    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 16 },

  stepTitle: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  stepSub: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
    marginBottom: 20,
  },

  // Broker grid
  brokerGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  brokerCard: {
    width: "47%",
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 14,
    alignItems: "center",
    position: "relative",
  },
  checkBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#C9A84C",
    alignItems: "center",
    justifyContent: "center",
  },
  brokerEmoji: { fontSize: 28, marginBottom: 8 },
  brokerName: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
  },
  brokerLabel: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
    textAlign: "center",
  },

  // Instructions
  instructionsCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 14,
    marginBottom: 18,
  },
  instrRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  instrNum: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  instrNumText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  instrText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
    flex: 1,
  },
  instrCode: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    fontStyle: "italic",
    paddingLeft: 32,
  },

  // Upload box
  uploadBox: {
    borderRadius: 16,
    borderWidth: 1.5,
    borderStyle: "dashed",
    padding: 32,
    alignItems: "center",
    gap: 10,
    minHeight: 150,
    justifyContent: "center",
  },
  uploadTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  uploadSub: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  uploadFileName: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
  },
  uploadFileSub: { fontSize: 12, fontFamily: "Inter_400Regular" },

  // Bottom bars
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    backgroundColor: theme.background,
  },
  primaryBtn: {
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },

  // Preview rows
  previewRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  previewLeft: { flex: 1.2, gap: 2 },
  previewMid: { flex: 1, alignItems: "flex-end", gap: 2 },
  previewRight: { flex: 1.1, alignItems: "flex-end" },
  previewTicker: { fontSize: 15, fontFamily: "Inter_700Bold" },
  previewStat: { fontSize: 12, fontFamily: "Inter_400Regular" },
  previewDate: { fontSize: 11, fontFamily: "Inter_400Regular" },
  previewInstrName: { fontSize: 10, fontFamily: "Inter_400Regular" },
  previewWarning: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    lineHeight: 14,
  },

  tickerEditRow: { flexDirection: "row", alignItems: "center" },
  tickerInput: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 14,
    fontFamily: "Inter_700Bold",
    minWidth: 70,
  },

  // Status badges
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    alignItems: "center",
  },
  statusText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },

  // Duplicate segmented control
  segmented: {
    flexDirection: "row",
    borderRadius: 6,
    overflow: "hidden",
    marginTop: 6,
  },
  segBtn: { paddingHorizontal: 7, paddingVertical: 4 },
  segBtnText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },

  // Warning banner
  warnBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 8,
  },
  warnBannerText: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1 },

  // Action bar (step 3)
  actionBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  cancelBtn: {
    flex: 1,
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  importBtn: {
    flex: 2,
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  importBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
