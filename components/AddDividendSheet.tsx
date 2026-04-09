import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useColorScheme,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { usePortfolio } from "@/context/PortfolioContext";
import { todayISO } from "@/utils/format";

interface AddDividendSheetProps {
  visible: boolean;
  onClose: () => void;
}

export function AddDividendSheet({ visible, onClose }: AddDividendSheetProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const theme = isDark ? Colors.dark : Colors.light;
  const insets = useSafeAreaInsets();
  const { holdings, addDividend } = usePortfolio();

  const [selectedHoldingId, setSelectedHoldingId] = useState(holdings[0]?.id ?? "");
  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [exDate, setExDate] = useState("");
  const [paymentDate, setPaymentDate] = useState("");

  const inputStyle = [
    styles.input,
    { backgroundColor: isDark ? "#1E1E1E" : "#F8F9FA", borderColor: theme.border, color: theme.text },
  ];
  const labelStyle = [styles.label, { color: theme.textSecondary }];

  const reset = () => {
    setAmount("");
    setDate(todayISO());
    setExDate("");
    setPaymentDate("");
    setCurrency("EUR");
  };

  const handleSave = () => {
    if (!selectedHoldingId) {
      Alert.alert("Required", "Please select a holding.");
      return;
    }
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      Alert.alert("Required", "Please enter a valid dividend amount.");
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    addDividend({
      holdingId: selectedHoldingId,
      date,
      amountReceived: Number(amount),
      currency,
      exDate: exDate || date,
      paymentDate: paymentDate || date,
    });
    reset();
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View
          style={[
            styles.container,
            { backgroundColor: theme.background, paddingBottom: insets.bottom + 16 },
          ]}
        >
          <View style={[styles.header, { borderBottomColor: theme.border }]}>
            <TouchableOpacity onPress={() => { reset(); onClose(); }}>
              <Feather name="x" size={22} color={theme.textSecondary} />
            </TouchableOpacity>
            <Text style={[styles.headerTitle, { color: theme.text }]}>
              Log Dividend
            </Text>
            <TouchableOpacity onPress={handleSave}>
              <Text style={[styles.saveBtn, { color: theme.tint }]}>Save</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={labelStyle}>HOLDING</Text>
            <View style={[styles.holdingList, { borderColor: theme.border }]}>
              {holdings.filter((h) => h.shareClass === "DIST" || h.holdingType === "Stock").map((h) => (
                <TouchableOpacity
                  key={h.id}
                  style={[
                    styles.holdingItem,
                    { borderBottomColor: theme.borderLight },
                    selectedHoldingId === h.id && { backgroundColor: isDark ? "#1E1E1E" : "#F0FDF8" },
                  ]}
                  onPress={() => setSelectedHoldingId(h.id)}
                >
                  <View>
                    <Text
                      style={[
                        styles.holdingName,
                        {
                          color: selectedHoldingId === h.id ? theme.tint : theme.text,
                          fontFamily: selectedHoldingId === h.id ? "Inter_600SemiBold" : "Inter_400Regular",
                        },
                      ]}
                    >
                      {h.name}
                    </Text>
                    <Text style={[styles.holdingMeta, { color: theme.textSecondary }]}>
                      {h.broker} · {h.shareClass}
                    </Text>
                  </View>
                  {selectedHoldingId === h.id && (
                    <Feather name="check" size={16} color={theme.tint} />
                  )}
                </TouchableOpacity>
              ))}
              {holdings.filter((h) => h.shareClass === "DIST" || h.holdingType === "Stock").length === 0 && (
                <Text style={[styles.holdingMeta, { color: theme.textSecondary, padding: 16 }]}>
                  Add DIST ETFs or stocks to log dividends.
                </Text>
              )}
            </View>

            <View style={[styles.row, { marginTop: 16 }]}>
              <View style={{ flex: 1 }}>
                <Text style={labelStyle}>AMOUNT</Text>
                <TextInput
                  style={inputStyle}
                  placeholder="0.00"
                  placeholderTextColor={theme.textTertiary}
                  value={amount}
                  onChangeText={setAmount}
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={labelStyle}>CURRENCY</Text>
                <TextInput
                  style={inputStyle}
                  placeholder="EUR"
                  placeholderTextColor={theme.textTertiary}
                  value={currency}
                  onChangeText={setCurrency}
                  autoCapitalize="characters"
                />
              </View>
            </View>

            <Text style={[labelStyle, { marginTop: 16 }]}>PAYMENT DATE</Text>
            <TextInput
              style={inputStyle}
              value={date}
              onChangeText={setDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={theme.textTertiary}
            />

            <Text style={[labelStyle, { marginTop: 16 }]}>EX-DIVIDEND DATE (optional)</Text>
            <TextInput
              style={inputStyle}
              value={exDate}
              onChangeText={setExDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={theme.textTertiary}
            />
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
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  saveBtn: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  scrollContent: { padding: 20, gap: 6 },
  label: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.8, marginBottom: 6 },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  holdingList: { borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  holdingItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  holdingName: { fontSize: 14 },
  holdingMeta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  row: { flexDirection: "row", gap: 12 },
});
