import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useColorScheme,
} from "react-native";
import Colors from "@/constants/colors";
import { usePortfolio, EXCHANGES } from "@/context/PortfolioContext";
import { todayISO } from "@/utils/format";

interface Props {
  visible: boolean;
  onClose: () => void;
}

export default function AddHoldingModal({ visible, onClose }: Props) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const theme = isDark ? Colors.dark : Colors.light;

  const { addHolding } = usePortfolio();

  const [ticker, setTicker] = useState("");
  const [isin, setIsin] = useState("");
  const [name, setName] = useState("");
  const [exchange, setExchange] = useState<string>("XETRA");
  const [quantity, setQuantity] = useState("");
  const [avgCost, setAvgCost] = useState("");
  const [currentPrice, setCurrentPrice] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(todayISO());
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function reset() {
    setTicker("");
    setIsin("");
    setName("");
    setExchange("XETRA");
    setQuantity("");
    setAvgCost("");
    setCurrentPrice("");
    setPurchaseDate(todayISO());
    setError("");
    setSaving(false);
  }

  async function handleSave() {
    setError("");
    if (!ticker.trim()) return setError("Ticker is required.");
    if (!quantity.trim() || isNaN(Number(quantity)) || Number(quantity) <= 0)
      return setError("Enter a valid quantity.");
    if (!avgCost.trim() || isNaN(Number(avgCost)) || Number(avgCost) <= 0)
      return setError("Enter a valid average cost in EUR.");
    if (!currentPrice.trim() || isNaN(Number(currentPrice)) || Number(currentPrice) <= 0)
      return setError("Enter a valid current price in EUR.");

    setSaving(true);
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
        },
        Number(currentPrice)
      );
      reset();
      onClose();
    } catch (e) {
      setError("Failed to save. Please try again.");
      setSaving(false);
    }
  }

  const inputStyle = [styles.input, { backgroundColor: theme.backgroundElevated, borderColor: theme.border, color: theme.text }];
  const labelStyle = [styles.label, { color: theme.textSecondary }];

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={[styles.container, { backgroundColor: theme.background }]}>
          <View style={[styles.header, { borderBottomColor: theme.border }]}>
            <TouchableOpacity onPress={() => { reset(); onClose(); }} style={styles.cancelBtn}>
              <Text style={[styles.cancelText, { color: theme.textSecondary }]}>Cancel</Text>
            </TouchableOpacity>
            <Text style={[styles.headerTitle, { color: theme.text }]}>Add Holding</Text>
            <TouchableOpacity
              onPress={handleSave}
              disabled={saving}
              style={[styles.saveBtn, { backgroundColor: theme.tint }]}
            >
              <Text style={styles.saveBtnText}>{saving ? "Saving…" : "Add"}</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.form} showsVerticalScrollIndicator={false}>
            {error ? (
              <View style={[styles.errorBox, { backgroundColor: theme.negative + "22", borderColor: theme.negative + "44" }]}>
                <Feather name="alert-circle" size={14} color={theme.negative} />
                <Text style={[styles.errorText, { color: theme.negative }]}>{error}</Text>
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
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.exchangeRow}>
                {EXCHANGES.map((ex) => (
                  <Pressable
                    key={ex}
                    style={[
                      styles.exchangeChip,
                      {
                        backgroundColor: exchange === ex ? theme.deepBlue : theme.backgroundElevated,
                        borderColor: exchange === ex ? theme.tint : theme.border,
                      },
                    ]}
                    onPress={() => setExchange(ex)}
                  >
                    <Text style={[styles.exchangeChipText, { color: exchange === ex ? theme.tint : theme.textSecondary }]}>
                      {ex}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
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
              <Text style={labelStyle}>CURRENT PRICE (€) *</Text>
              <TextInput
                style={inputStyle}
                value={currentPrice}
                onChangeText={setCurrentPrice}
                placeholder="0.00"
                placeholderTextColor={theme.textTertiary}
                keyboardType="decimal-pad"
              />
              <Text style={[styles.hint, { color: theme.textTertiary }]}>
                Enter price manually — automatic price fetching coming soon.
              </Text>
            </View>

            <View style={styles.field}>
              <Text style={labelStyle}>PURCHASE DATE *</Text>
              <TextInput
                style={inputStyle}
                value={purchaseDate}
                onChangeText={setPurchaseDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={theme.textTertiary}
              />
            </View>
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
  exchangeRow: { flexDirection: "row", gap: 8 },
  exchangeChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  exchangeChipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  errorText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
});
