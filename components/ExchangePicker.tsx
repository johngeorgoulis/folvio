import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Colors from "@/constants/colors";

export const EXCHANGE_OPTIONS = [
  { label: "Xetra (DE)",              value: "XETRA",        suffix: ".DE" },
  { label: "Euronext Amsterdam (NL)", value: "EURONEXT_AMS", suffix: ".AS" },
  { label: "Euronext Paris (FR)",     value: "EURONEXT_PAR", suffix: ".PA" },
  { label: "LSE (UK)",                value: "LSE",          suffix: ".L"  },
  { label: "Borsa Italiana (IT)",     value: "BORSA_IT",     suffix: ".MI" },
  { label: "SIX Swiss (CH)",          value: "SIX",          suffix: ".SW" },
] as const;

export type ExchangeValue = (typeof EXCHANGE_OPTIONS)[number]["value"];

export function getSuffix(exchange: string): string {
  return EXCHANGE_OPTIONS.find((e) => e.value === exchange)?.suffix ?? "";
}

export function getExchangeLabel(exchange: string): string {
  return EXCHANGE_OPTIONS.find((e) => e.value === exchange)?.label ?? exchange;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  ticker?: string;
}

const theme = Colors.dark;

export default function ExchangePicker({ value, onChange, ticker }: Props) {
  const [open, setOpen] = useState(false);

  const selected = EXCHANGE_OPTIONS.find((e) => e.value === value) ?? EXCHANGE_OPTIONS[0];
  const displayTicker = (ticker || "TICKER").toUpperCase();

  return (
    <>
      <TouchableOpacity
        style={[styles.trigger, { backgroundColor: theme.backgroundElevated, borderColor: theme.border }]}
        onPress={() => setOpen(true)}
        activeOpacity={0.75}
      >
        <View style={{ flex: 1 }}>
          <Text style={[styles.triggerLabel, { color: theme.text }]}>{selected.label}</Text>
          <Text style={[styles.triggerPreview, { color: theme.tint }]}>
            → {displayTicker}{selected.suffix}
          </Text>
        </View>
        <Feather name="chevron-down" size={16} color={theme.textTertiary} />
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable
            style={[styles.sheet, { backgroundColor: theme.backgroundCard, borderColor: theme.border }]}
            onPress={() => {}}
          >
            <Text style={[styles.sheetTitle, { color: theme.textSecondary }]}>SELECT EXCHANGE</Text>
            {EXCHANGE_OPTIONS.map((opt) => {
              const isSelected = opt.value === value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[
                    styles.option,
                    { backgroundColor: isSelected ? theme.deepBlue : "transparent" },
                  ]}
                  onPress={() => { onChange(opt.value); setOpen(false); }}
                  activeOpacity={0.7}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.optionLabel, { color: isSelected ? theme.tint : theme.text }]}>
                      {opt.label}
                    </Text>
                    <Text style={[styles.optionSym, { color: theme.textSecondary }]}>
                      {displayTicker}{opt.suffix}
                    </Text>
                  </View>
                  {isSelected && <Feather name="check" size={15} color={theme.tint} />}
                </TouchableOpacity>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 11,
    gap: 10,
  },
  triggerLabel: { fontSize: 14, fontFamily: "Inter_500Medium" },
  triggerPreview: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.72)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  sheet: {
    width: "100%",
    maxWidth: 380,
    borderRadius: 16,
    borderWidth: 1,
    padding: 8,
    gap: 2,
  },
  sheetTitle: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    gap: 10,
  },
  optionLabel: { fontSize: 14, fontFamily: "Inter_500Medium" },
  optionSym: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
});
