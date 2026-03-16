import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import Colors from "@/constants/colors";
import { usePortfolio } from "@/context/PortfolioContext";
import { todayISO } from "@/utils/format";
import ExchangePicker, { getExchangeLabel } from "@/components/ExchangePicker";
import { fetchLivePrice } from "@/services/priceService";

interface Props {
  visible: boolean;
  onClose: () => void;
}

const theme = Colors.dark;

export default function AddHoldingModal({ visible, onClose }: Props) {
  const { addHolding } = usePortfolio();

  const [ticker, setTicker] = useState("");
  const [isin, setIsin] = useState("");
  const [name, setName] = useState("");
  const [exchange, setExchange] = useState("XETRA");
  const [quantity, setQuantity] = useState("");
  const [avgCost, setAvgCost] = useState("");
  const [currentPrice, setCurrentPrice] = useState("");
  const [yieldPct, setYieldPct] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(todayISO());
  const [error, setError] = useState("");
  const [warning, setWarning] = useState<string | null>(null);
  const [fetchNotice, setFetchNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function reset() {
    setTicker("");
    setIsin("");
    setName("");
    setExchange("XETRA");
    setQuantity("");
    setAvgCost("");
    setCurrentPrice("");
    setYieldPct("");
    setPurchaseDate(todayISO());
    setError("");
    setWarning(null);
    setFetchNotice(null);
    setSaving(false);
  }

  async function handleSave() {
    setError("");
    setWarning(null);
    setFetchNotice(null);

    if (!ticker.trim()) return setError("Ticker is required.");
    if (!quantity.trim() || isNaN(Number(quantity)) || Number(quantity) <= 0)
      return setError("Enter a valid quantity.");
    if (!avgCost.trim() || isNaN(Number(avgCost)) || Number(avgCost) <= 0)
      return setError("Enter a valid average cost in EUR.");

    const parsedYield = yieldPct.trim() ? parseFloat(yieldPct.replace(",", ".")) : null;
    if (
      yieldPct.trim() &&
      (parsedYield === null || isNaN(parsedYield) || parsedYield < 0 || parsedYield > 100)
    ) {
      return setError("Enter a valid yield percentage (0–100), or leave blank.");
    }

    if (currentPrice.trim()) {
      const p = parseFloat(currentPrice.replace(",", "."));
      if (isNaN(p) || p < 0) {
        return setError("Enter a valid price, or leave the field empty to fetch automatically.");
      }
    }

    setSaving(true);

    let resolvedPrice = 0;
    let noticeMsg: string | null = null;
    let warnMsg: string | null = null;

    if (!currentPrice.trim()) {
      try {
        const result = await fetchLivePrice(ticker.trim().toUpperCase(), exchange);
        if (result) {
          resolvedPrice = result.priceEUR;
          const exLabel = getExchangeLabel(exchange).split(" (")[0];
          noticeMsg = `Fetched €${resolvedPrice.toFixed(2)} from ${exLabel}`;
        } else {
          warnMsg = "Price unavailable — update manually later.";
        }
      } catch {
        warnMsg = "Price unavailable — update manually later.";
      }
    } else {
      resolvedPrice = parseFloat(currentPrice.replace(",", "."));
    }

    try {
      await addHolding(
        {
          ticker: ticker.trim().toUpperCase(),
          isin: isin.trim(),
          exchange,
          name: name.trim(),
          quantity: Number(quantity),
          avg_cost_eur: Number(avgCost),
          purchase_date: purchaseDate,
          yield_pct: parsedYield,
        },
        resolvedPrice
      );

      setSaving(false);

      if (noticeMsg) {
        setFetchNotice(noticeMsg);
        setTimeout(() => { reset(); onClose(); }, 1500);
      } else if (warnMsg) {
        setWarning(warnMsg);
        setTimeout(() => { reset(); onClose(); }, 2000);
      } else {
        reset();
        onClose();
      }
    } catch {
      setError("Failed to save. Please try again.");
      setSaving(false);
    }
  }

  const priceIsEmpty = !currentPrice.trim();
  const inputStyle = [
    styles.input,
    { backgroundColor: theme.backgroundElevated, borderColor: theme.border, color: theme.text },
  ];
  const labelStyle = [styles.label, { color: theme.textSecondary }];

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <View style={[styles.container, { backgroundColor: theme.background }]}>
          <View style={[styles.header, { borderBottomColor: theme.border }]}>
            <TouchableOpacity onPress={() => { reset(); onClose(); }} style={styles.cancelBtn}>
              <Text style={[styles.cancelText, { color: theme.textSecondary }]}>Cancel</Text>
            </TouchableOpacity>
            <Text style={[styles.headerTitle, { color: theme.text }]}>Add Holding</Text>
            <TouchableOpacity
              onPress={handleSave}
              disabled={saving}
              style={[styles.saveBtn, { backgroundColor: saving ? theme.tint + "BB" : theme.tint }]}
            >
              {saving && <ActivityIndicator size="small" color="#0A0F1A" style={{ marginRight: 4 }} />}
              <Text style={styles.saveBtnText}>
                {saving ? (priceIsEmpty ? "Fetching…" : "Saving…") : "Add"}
              </Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.form} showsVerticalScrollIndicator={false}>
            {error ? (
              <View style={[styles.msgBox, { backgroundColor: theme.negative + "22", borderColor: theme.negative + "44" }]}>
                <Feather name="alert-circle" size={14} color={theme.negative} />
                <Text style={[styles.msgText, { color: theme.negative }]}>{error}</Text>
              </View>
            ) : null}

            {warning ? (
              <View style={[styles.msgBox, { backgroundColor: "#F39C1222", borderColor: "#F39C1244" }]}>
                <Feather name="alert-triangle" size={14} color="#F39C12" />
                <Text style={[styles.msgText, { color: "#F39C12" }]}>{warning}</Text>
              </View>
            ) : null}

            {fetchNotice ? (
              <View style={[styles.msgBox, { backgroundColor: theme.positive + "22", borderColor: theme.positive + "44" }]}>
                <Feather name="check-circle" size={14} color={theme.positive} />
                <Text style={[styles.msgText, { color: theme.positive }]}>{fetchNotice}</Text>
              </View>
            ) : null}

            <View style={styles.row}>
              <View style={[styles.field, { flex: 1 }]}>
                <Text style={labelStyle}>TICKER *</Text>
                <TextInput
                  style={inputStyle}
                  value={ticker}
                  onChangeText={(t) => setTicker(t.toUpperCase())}
                  placeholder="e.g. VWCE"
                  placeholderTextColor={theme.textTertiary}
                  autoCapitalize="characters"
                />
              </View>
              <View style={[styles.field, { flex: 1.4 }]}>
                <Text style={labelStyle}>ISIN</Text>
                <TextInput
                  style={inputStyle}
                  value={isin}
                  onChangeText={setIsin}
                  placeholder="IE00B3RBWM25"
                  placeholderTextColor={theme.textTertiary}
                  autoCapitalize="characters"
                />
              </View>
            </View>

            <View style={styles.field}>
              <Text style={labelStyle}>NAME / DESCRIPTION</Text>
              <TextInput
                style={inputStyle}
                value={name}
                onChangeText={setName}
                placeholder="e.g. Vanguard FTSE All-World"
                placeholderTextColor={theme.textTertiary}
              />
            </View>

            <View style={styles.field}>
              <Text style={labelStyle}>EXCHANGE *</Text>
              <ExchangePicker value={exchange} onChange={setExchange} ticker={ticker} />
            </View>

            <View style={styles.row}>
              <View style={[styles.field, { flex: 1 }]}>
                <Text style={labelStyle}>QUANTITY *</Text>
                <TextInput
                  style={inputStyle}
                  value={quantity}
                  onChangeText={setQuantity}
                  placeholder="0"
                  placeholderTextColor={theme.textTertiary}
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={[styles.field, { flex: 1 }]}>
                <Text style={labelStyle}>AVG COST (€) *</Text>
                <TextInput
                  style={inputStyle}
                  value={avgCost}
                  onChangeText={setAvgCost}
                  placeholder="0.00"
                  placeholderTextColor={theme.textTertiary}
                  keyboardType="decimal-pad"
                />
              </View>
            </View>

            <View style={styles.field}>
              <Text style={labelStyle}>CURRENT PRICE (€)</Text>
              <TextInput
                style={inputStyle}
                value={currentPrice}
                onChangeText={setCurrentPrice}
                placeholder="Leave empty to fetch automatically"
                placeholderTextColor={theme.textTertiary}
                keyboardType="decimal-pad"
              />
              <Text style={[styles.hint, { color: theme.textTertiary }]}>
                Live price will be fetched from Yahoo Finance
              </Text>
            </View>

            <View style={styles.row}>
              <View style={[styles.field, { flex: 1 }]}>
                <Text style={labelStyle}>TRAILING YIELD %</Text>
                <TextInput
                  style={inputStyle}
                  value={yieldPct}
                  onChangeText={setYieldPct}
                  placeholder="e.g. 1.4"
                  placeholderTextColor={theme.textTertiary}
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={[styles.field, { flex: 1 }]}>
                <Text style={labelStyle}>PURCHASE DATE *</Text>
                <TextInput
                  style={inputStyle}
                  value={purchaseDate}
                  onChangeText={setPurchaseDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={theme.textTertiary}
                />
              </View>
            </View>
            <Text style={[styles.hint, { color: theme.textTertiary, marginTop: -10 }]}>
              Trailing yield used for dividend income estimates. Optional.
            </Text>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  cancelBtn: { padding: 4 },
  cancelText: { fontSize: 15, fontFamily: "Inter_400Regular" },
  headerTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
  },
  saveBtnText: { color: "#0A0F1A", fontSize: 14, fontFamily: "Inter_700Bold" },
  form: { padding: 16, gap: 16, paddingBottom: 40 },
  field: { gap: 6 },
  row: { flexDirection: "row", gap: 12 },
  label: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.6 },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  hint: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 3 },
  msgBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  msgText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
});
