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
import {
  BROKERS,
  Broker,
  HoldingType,
  ShareClass,
  usePortfolio,
} from "@/context/PortfolioContext";

interface AddHoldingSheetProps {
  visible: boolean;
  onClose: () => void;
}

function SegmentControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: T[];
  value: T;
  onChange: (v: T) => void;
}) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const theme = isDark ? Colors.dark : Colors.light;
  return (
    <View
      style={[
        segStyles.container,
        { backgroundColor: isDark ? "#1E1E1E" : "#F3F4F6" },
      ]}
    >
      {options.map((opt) => (
        <TouchableOpacity
          key={opt}
          style={[
            segStyles.option,
            value === opt && {
              backgroundColor: isDark ? "#2A2A2A" : "#fff",
              shadowColor: "#000",
              shadowOpacity: 0.08,
              shadowRadius: 4,
              shadowOffset: { width: 0, height: 1 },
              elevation: 1,
            },
          ]}
          onPress={() => onChange(opt)}
          activeOpacity={0.8}
        >
          <Text
            style={[
              segStyles.label,
              {
                color:
                  value === opt ? theme.tint : theme.textSecondary,
              },
            ]}
          >
            {opt}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const segStyles = StyleSheet.create({
  container: {
    flexDirection: "row",
    borderRadius: 10,
    padding: 3,
  },
  option: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 8,
    alignItems: "center",
  },
  label: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
});

export function AddHoldingSheet({ visible, onClose }: AddHoldingSheetProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const theme = isDark ? Colors.dark : Colors.light;
  const insets = useSafeAreaInsets();
  const { addHolding } = usePortfolio();

  const [name, setName] = useState("");
  const [holdingType, setHoldingType] = useState<HoldingType>("ETF");
  const [isin, setIsin] = useState("");
  const [ticker, setTicker] = useState("");
  const [broker, setBroker] = useState<Broker>("Trading 212");
  const [units, setUnits] = useState("");
  const [avgPrice, setAvgPrice] = useState("");
  const [currentPrice, setCurrentPrice] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [targetAlloc, setTargetAlloc] = useState("");
  const [shareClass, setShareClass] = useState<ShareClass>("ACC");
  const [showBrokerPicker, setShowBrokerPicker] = useState(false);

  const inputStyle = [
    styles.input,
    {
      backgroundColor: isDark ? "#1E1E1E" : "#F8F9FA",
      borderColor: theme.border,
      color: theme.text,
    },
  ];

  const reset = () => {
    setName("");
    setHoldingType("ETF");
    setIsin("");
    setTicker("");
    setBroker("Trading 212");
    setUnits("");
    setAvgPrice("");
    setCurrentPrice("");
    setCurrency("EUR");
    setTargetAlloc("");
    setShareClass("ACC");
  };

  const handleSave = () => {
    if (!name.trim()) {
      Alert.alert("Required", "Please enter a holding name.");
      return;
    }
    if (!units || isNaN(Number(units)) || Number(units) <= 0) {
      Alert.alert("Required", "Please enter valid units.");
      return;
    }
    if (!avgPrice || isNaN(Number(avgPrice)) || Number(avgPrice) <= 0) {
      Alert.alert("Required", "Please enter a valid average purchase price.");
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    addHolding({
      name: name.trim(),
      holdingType,
      isin: holdingType === "ETF" ? isin.trim().toUpperCase() : "",
      ticker: holdingType === "Stock" ? ticker.trim().toUpperCase() : "",
      broker,
      units: Number(units),
      avgPurchasePrice: Number(avgPrice),
      currentPrice: currentPrice ? Number(currentPrice) : Number(avgPrice),
      currency,
      targetAllocationPct: targetAlloc ? Number(targetAlloc) : 0,
      shareClass,
    });
    reset();
    onClose();
  };

  const labelStyle = [styles.label, { color: theme.textSecondary }];

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
              Add Holding
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
            <Text style={labelStyle}>HOLDING TYPE</Text>
            <SegmentControl
              options={["ETF", "Stock"] as HoldingType[]}
              value={holdingType}
              onChange={setHoldingType}
            />

            <Text style={[labelStyle, { marginTop: 16 }]}>NAME</Text>
            <TextInput
              style={inputStyle}
              placeholder="e.g. Vanguard FTSE All-World"
              placeholderTextColor={theme.textTertiary}
              value={name}
              onChangeText={setName}
            />

            {holdingType === "ETF" ? (
              <>
                <Text style={[labelStyle, { marginTop: 16 }]}>ISIN</Text>
                <TextInput
                  style={inputStyle}
                  placeholder="e.g. IE00B3RBWM25"
                  placeholderTextColor={theme.textTertiary}
                  value={isin}
                  onChangeText={setIsin}
                  autoCapitalize="characters"
                />
              </>
            ) : (
              <>
                <Text style={[labelStyle, { marginTop: 16 }]}>TICKER</Text>
                <TextInput
                  style={inputStyle}
                  placeholder="e.g. AAPL"
                  placeholderTextColor={theme.textTertiary}
                  value={ticker}
                  onChangeText={setTicker}
                  autoCapitalize="characters"
                />
              </>
            )}

            <Text style={[labelStyle, { marginTop: 16 }]}>SHARE CLASS</Text>
            <SegmentControl
              options={["ACC", "DIST"] as ShareClass[]}
              value={shareClass}
              onChange={setShareClass}
            />

            <Text style={[labelStyle, { marginTop: 16 }]}>BROKER</Text>
            <TouchableOpacity
              style={[inputStyle, styles.pickerRow]}
              onPress={() => setShowBrokerPicker(!showBrokerPicker)}
            >
              <Text style={{ color: theme.text, fontFamily: "Inter_400Regular", fontSize: 15 }}>
                {broker}
              </Text>
              <Feather
                name={showBrokerPicker ? "chevron-up" : "chevron-down"}
                size={16}
                color={theme.textSecondary}
              />
            </TouchableOpacity>
            {showBrokerPicker && (
              <View
                style={[
                  styles.brokerList,
                  { backgroundColor: theme.backgroundElevated, borderColor: theme.border },
                ]}
              >
                {BROKERS.map((b) => (
                  <TouchableOpacity
                    key={b}
                    style={[
                      styles.brokerItem,
                      { borderBottomColor: theme.borderLight },
                      broker === b && { backgroundColor: isDark ? "#1E1E1E" : "#F0FDF8" },
                    ]}
                    onPress={() => {
                      setBroker(b);
                      setShowBrokerPicker(false);
                    }}
                  >
                    <Text
                      style={[
                        styles.brokerText,
                        {
                          color: broker === b ? theme.tint : theme.text,
                          fontFamily: broker === b ? "Inter_600SemiBold" : "Inter_400Regular",
                        },
                      ]}
                    >
                      {b}
                    </Text>
                    {broker === b && (
                      <Feather name="check" size={16} color={theme.tint} />
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={labelStyle}>UNITS</Text>
                <TextInput
                  style={inputStyle}
                  placeholder="0"
                  placeholderTextColor={theme.textTertiary}
                  value={units}
                  onChangeText={setUnits}
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

            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={labelStyle}>AVG PRICE (€)</Text>
                <TextInput
                  style={inputStyle}
                  placeholder="0.00"
                  placeholderTextColor={theme.textTertiary}
                  value={avgPrice}
                  onChangeText={setAvgPrice}
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={labelStyle}>CURRENT PRICE (€)</Text>
                <TextInput
                  style={inputStyle}
                  placeholder="0.00"
                  placeholderTextColor={theme.textTertiary}
                  value={currentPrice}
                  onChangeText={setCurrentPrice}
                  keyboardType="decimal-pad"
                />
              </View>
            </View>

            <Text style={[labelStyle, { marginTop: 16 }]}>TARGET ALLOCATION (%)</Text>
            <TextInput
              style={inputStyle}
              placeholder="e.g. 40"
              placeholderTextColor={theme.textTertiary}
              value={targetAlloc}
              onChangeText={setTargetAlloc}
              keyboardType="decimal-pad"
            />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  saveBtn: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  scrollContent: {
    padding: 20,
    gap: 6,
  },
  label: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  pickerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  brokerList: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
    marginTop: 4,
  },
  brokerItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  brokerText: {
    fontSize: 14,
  },
  row: {
    flexDirection: "row",
    gap: 12,
    marginTop: 16,
  },
});
