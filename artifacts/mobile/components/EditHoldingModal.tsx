import { Feather } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
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
import { usePortfolio, type Holding } from "@/context/PortfolioContext";
import ExchangePicker, { getExchangeLabel } from "@/components/ExchangePicker";
import { fetchLivePrice } from "@/services/priceService";

interface Props {
  visible: boolean;
  holding: Holding;
  onClose: () => void;
}

const theme = Colors.dark;

export default function EditHoldingModal({ visible, holding, onClose }: Props) {
  const { updateHolding } = usePortfolio();

  const [ticker, setTicker] = useState(holding.ticker);
  const [isin, setIsin] = useState(holding.isin);
  const [name, setName] = useState(holding.name);
  const [exchange, setExchange] = useState(holding.exchange);
  const [quantity, setQuantity] = useState(holding.quantity.toString());
  const [avgCost, setAvgCost] = useState(holding.avg_cost_eur.toString());
  const [currentPrice, setCurrentPrice] = useState(
    holding.currentPrice > 0 ? holding.currentPrice.toString() : ""
  );
  const [yieldPct, setYieldPct] = useState(
    holding.yield_pct != null ? holding.yield_pct.toString() : ""
  );
  const [purchaseDate, setPurchaseDate] = useState(holding.purchase_date);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState<string | null>(null);
  const [fetchNotice, setFetchNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setTicker(holding.ticker);
      setIsin(holding.isin);
      setName(holding.name);
      setExchange(holding.exchange);
      setQuantity(holding.quantity.toString());
      setAvgCost(holding.avg_cost_eur.toString());
      setCurrentPrice(holding.currentPrice > 0 ? holding.currentPrice.toString() : "");
      setYieldPct(holding.yield_pct != null ? holding.yield_pct.toString() : "");
      setPurchaseDate(holding.purchase_date);
      setError("");
      setWarning(null);
      setFetchNotice(null);
    }
  }, [visible, holding]);

  async function handleSave() {
    setError("");
    setWarning(null);
    setFetchNotice(null);

    if (!ticker.trim()) return setError("Ticker is required.");
    if (!quantity.trim() || isNaN(Number(quantity)) || Number(quantity) <= 0)
      return setError("Enter a valid quantity.");
    if (!avgCost.trim() || isNaN(Number(avgCost)) || Number(avgCost) <= 0)
      return setError("Enter a valid average cost.");

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
        return setError("Enter a valid price, or clear the field to fetch automatically.");
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
      await updateHolding(
        holding.id,
        {
          ticker: ticker.trim().toUpperCase(),
          isin: isin.trim(),
          name: name.trim(),
          exchange,
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
        setTimeout(() => onClose(), 1500);
      } else if (warnMsg) {
        setWarning(warnMsg);
        setTimeout(() => onClose(), 2000);
      } else {
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
            <TouchableOpacity onPress={onClose} style={styles.cancelBtn}>
              <Text style={[styles.cancelText, { color: theme.textSecondary }]}>Cancel</Text>
            </TouchableOpacity>
            <Text style={[styles.headerTitle, { color: theme.text }]}>Edit Holding</Text>
            <TouchableOpacity
              onPress={handleSave}
              disabled={saving}
              style={[styles.saveBtn, { backgroundColor: saving ? theme.tint + "BB" : theme.tint }]}
            >
              {saving && <ActivityIndicator size="small" color="#0A0F1A" style={{ marginRight: 4 }} />}
              <Text style={styles.saveBtnText}>
                {saving ? (priceIsEmpty ? "Fetching…" : "Saving…") : "Save"}
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
                <Text style={labelStyle}>TICKER</Text>
                <TextInput
                  style={inputStyle}
                  value={ticker}
                  onChangeText={(t) => setTicker(t.toUpperCase())}
                  autoCapitalize="characters"
                  placeholderTextColor={theme.textTertiary}
                />
              </View>
              <View style={[styles.field, { flex: 1.4 }]}>
                <Text style={labelStyle}>ISIN</Text>
                <TextInput
                  style={inputStyle}
                  value={isin}
                  onChangeText={setIsin}
                  autoCapitalize="characters"
                  placeholderTextColor={theme.textTertiary}
                />
              </View>
            </View>

            <View style={styles.field}>
              <Text style={labelStyle}>NAME</Text>
              <TextInput
                style={inputStyle}
                value={name}
                onChangeText={setName}
                placeholderTextColor={theme.textTertiary}
              />
            </View>

            <View style={styles.field}>
              <Text style={labelStyle}>EXCHANGE</Text>
              <ExchangePicker value={exchange} onChange={setExchange} ticker={ticker} />
            </View>

            <View style={styles.row}>
              <View style={[styles.field, { flex: 1 }]}>
                <Text style={labelStyle}>QUANTITY</Text>
                <TextInput
                  style={inputStyle}
                  value={quantity}
                  onChangeText={setQuantity}
                  keyboardType="decimal-pad"
                  placeholderTextColor={theme.textTertiary}
                />
              </View>
              <View style={[styles.field, { flex: 1 }]}>
                <Text style={labelStyle}>AVG COST (€)</Text>
                <TextInput
                  style={inputStyle}
                  value={avgCost}
                  onChangeText={setAvgCost}
                  keyboardType="decimal-pad"
                  placeholderTextColor={theme.textTertiary}
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
                <Text style={labelStyle}>PURCHASE DATE</Text>
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
