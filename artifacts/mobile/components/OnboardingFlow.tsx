import React, { useRef, useState } from "react";
import {
  Dimensions,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ViewToken,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");
export const ONBOARDING_KEY = "fortis_onboarding_complete";

const NAVY = "#0F1923";
const GOLD = "#C9A84C";
const WHITE = "#FFFFFF";
const MUTED = "#6B7A8D";
const CHIP_BG = "#1A2E42";

interface Page {
  id: string;
  icon?: keyof typeof Feather.glyphMap;
  isFirst?: boolean;
  isLast?: boolean;
  title: string;
  subtitle?: string;
  body: string;
  note?: string;
  chips?: string[];
}

const PAGES: Page[] = [
  {
    id: "1",
    isFirst: true,
    title: "Fortis",
    subtitle: "The portfolio tracker built for European ETF investors",
    body: "🇪🇺  UCITS-native · DCA-aware · Multi-broker",
  },
  {
    id: "2",
    icon: "shield",
    title: "Your data stays on\nyour device",
    body: "Fortis stores everything locally. No account required, no cloud sync, no data sharing. Your portfolio is yours alone.",
    note: "Cloud sync available in a future update for those who want it.",
  },
  {
    id: "3",
    icon: "globe",
    title: "Finally, an app that\nunderstands UCITS",
    body: "Track ISINs, ACC vs DIST share classes, and compare against European benchmarks — not just the S&P 500.",
    chips: ["ISIN Search", "ACC/DIST", "EUR Native"],
  },
  {
    id: "4",
    icon: "repeat",
    title: "Track your DCA.\nStay on target.",
    body: "Log monthly contributions, see your weighted average cost, get drift alerts when your allocation needs attention, and let the rebalancing calculator tell you exactly what to buy next.",
  },
  {
    id: "5",
    isLast: true,
    title: "You're all set",
    body: "Add your first ETF holding to get started. Search by ticker or ISIN.",
  },
];

interface Props {
  onComplete: (goToSearch: boolean) => void;
}

export default function OnboardingFlow({ onComplete }: Props) {
  const insets = useSafeAreaInsets();
  const flatListRef = useRef<FlatList<Page>>(null);
  const [currentIndex, setCurrentIndex] = useState(0);

  const viewabilityConfig = useRef({ viewAreaCoveragePercentThreshold: 50 });
  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems.length > 0) {
        setCurrentIndex(viewableItems[0].index ?? 0);
      }
    }
  );

  async function markAndFinish(goToSearch: boolean) {
    await AsyncStorage.setItem(ONBOARDING_KEY, "true");
    onComplete(goToSearch);
  }

  function goToPage(index: number) {
    flatListRef.current?.scrollToIndex({ index, animated: true });
    setCurrentIndex(index);
  }

  function handleNext() {
    if (currentIndex < PAGES.length - 1) {
      goToPage(currentIndex + 1);
    }
  }

  const isLast = currentIndex === PAGES.length - 1;
  const isFirst = currentIndex === 0;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Skip button */}
      {!isLast && (
        <TouchableOpacity
          style={styles.skipBtn}
          onPress={() => markAndFinish(false)}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={styles.skipText}>Skip</Text>
        </TouchableOpacity>
      )}

      {/* Pages */}
      <FlatList
        ref={flatListRef}
        data={PAGES}
        keyExtractor={(item) => item.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        bounces={false}
        scrollEventThrottle={16}
        viewabilityConfig={viewabilityConfig.current}
        onViewableItemsChanged={onViewableItemsChanged.current}
        renderItem={({ item }) => <PageView page={item} />}
      />

      {/* Bottom controls */}
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 32) }]}>
        {/* Dots */}
        <View style={styles.dotsRow}>
          {PAGES.map((_, i) => (
            <TouchableOpacity
              key={i}
              onPress={() => goToPage(i)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <View
                style={[
                  styles.dot,
                  i === currentIndex ? styles.dotActive : styles.dotInactive,
                ]}
              />
            </TouchableOpacity>
          ))}
        </View>

        {/* CTA */}
        {isLast ? (
          <View style={styles.lastCtaGroup}>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => markAndFinish(true)}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryBtnText}>Add My First Holding</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => markAndFinish(false)}>
              <Text style={styles.secondaryLink}>I'll explore on my own</Text>
            </TouchableOpacity>
          </View>
        ) : isFirst ? (
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={handleNext}
            activeOpacity={0.85}
          >
            <Text style={styles.primaryBtnText}>Get Started →</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.nextBtn}
            onPress={handleNext}
            activeOpacity={0.8}
          >
            <Feather name="arrow-right" size={24} color={GOLD} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function PageView({ page }: { page: Page }) {
  return (
    <View style={styles.page}>
      {page.isFirst ? (
        /* ── Screen 1: Welcome ────────────────────────────────────────────── */
        <View style={styles.pageInner}>
          <View style={styles.fMarkWrap}>
            <FMark size={96} />
          </View>
          <Text style={styles.wordmark}>Fortis</Text>
          <Text style={styles.subtitle}>{page.subtitle}</Text>
          <View style={styles.badgeRow}>
            <Text style={styles.flagBody}>{page.body}</Text>
          </View>
        </View>
      ) : page.isLast ? (
        /* ── Screen 5: Ready ──────────────────────────────────────────────── */
        <View style={styles.pageInner}>
          <View style={styles.checkCircle}>
            <Feather name="check" size={52} color={GOLD} />
          </View>
          <Text style={styles.pageTitle}>{page.title}</Text>
          <Text style={styles.pageBody}>{page.body}</Text>
        </View>
      ) : (
        /* ── Screens 2-4: Icon + title + body ─────────────────────────────── */
        <View style={styles.pageInner}>
          {page.icon && (
            <View style={styles.iconCircle}>
              <Feather name={page.icon} size={48} color={GOLD} />
            </View>
          )}
          <Text style={styles.pageTitle}>{page.title}</Text>
          <Text style={styles.pageBody}>{page.body}</Text>
          {page.chips && (
            <View style={styles.chipsRow}>
              {page.chips.map((chip) => (
                <View key={chip} style={styles.chip}>
                  <Text style={styles.chipText}>{chip}</Text>
                </View>
              ))}
            </View>
          )}
          {page.note && <Text style={styles.pageNote}>{page.note}</Text>}
        </View>
      )}
    </View>
  );
}

/** Inline geometric "F" mark — matches the app icon exactly */
function FMark({ size }: { size: number }) {
  const s = size / 100;
  const stroke = 18 * s;
  const topBarW = 74 * s;
  const height = 88 * s;
  const midBarW = 52 * s;
  const midY = height * 0.44;
  return (
    <View style={{ width: topBarW, height }}>
      {/* Vertical bar */}
      <View
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: stroke,
          height,
          backgroundColor: GOLD,
          borderRadius: 3 * s,
        }}
      />
      {/* Top horizontal bar */}
      <View
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: topBarW,
          height: stroke,
          backgroundColor: GOLD,
          borderRadius: 3 * s,
        }}
      />
      {/* Middle horizontal bar */}
      <View
        style={{
          position: "absolute",
          left: 0,
          top: midY,
          width: midBarW,
          height: stroke * 0.85,
          backgroundColor: GOLD,
          borderRadius: 3 * s,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: NAVY,
  },
  skipBtn: {
    position: "absolute",
    top: 56,
    right: 24,
    zIndex: 10,
  },
  skipText: {
    color: MUTED,
    fontSize: 15,
    fontFamily: "Inter_500Medium",
  },
  page: {
    width: SCREEN_W,
    height: SCREEN_H,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 36,
    paddingBottom: 170,
  },
  pageInner: {
    width: "100%",
    alignItems: "center",
    gap: 20,
  },
  /* Screen 1 — Welcome */
  fMarkWrap: {
    marginBottom: 8,
  },
  wordmark: {
    fontSize: 52,
    fontFamily: "Inter_700Bold",
    color: WHITE,
    letterSpacing: 1,
  },
  subtitle: {
    fontSize: 17,
    fontFamily: "Inter_400Regular",
    color: MUTED,
    textAlign: "center",
    lineHeight: 26,
  },
  badgeRow: {
    marginTop: 8,
  },
  flagBody: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
    color: GOLD,
    textAlign: "center",
    letterSpacing: 0.5,
  },
  /* Screens 2-4 */
  iconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: CHIP_BG,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  pageTitle: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    color: WHITE,
    textAlign: "center",
    lineHeight: 38,
  },
  pageBody: {
    fontSize: 16,
    fontFamily: "Inter_400Regular",
    color: MUTED,
    textAlign: "center",
    lineHeight: 26,
  },
  pageNote: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "#4A5568",
    textAlign: "center",
    lineHeight: 20,
    marginTop: 4,
  },
  chipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 10,
    marginTop: 4,
  },
  chip: {
    backgroundColor: CHIP_BG,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: GOLD + "44",
  },
  chipText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: GOLD,
  },
  /* Screen 5 — Ready */
  checkCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: CHIP_BG,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
    borderWidth: 2,
    borderColor: GOLD + "55",
  },
  /* Footer */
  footer: {
    alignItems: "center",
    gap: 24,
    paddingHorizontal: 32,
    paddingTop: 12,
  },
  dotsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  dot: {
    borderRadius: 4,
  },
  dotActive: {
    width: 24,
    height: 8,
    backgroundColor: GOLD,
  },
  dotInactive: {
    width: 8,
    height: 8,
    backgroundColor: MUTED + "55",
  },
  primaryBtn: {
    width: "100%",
    backgroundColor: GOLD,
    borderRadius: 14,
    paddingVertical: 17,
    alignItems: "center",
  },
  primaryBtnText: {
    fontSize: 17,
    fontFamily: "Inter_700Bold",
    color: NAVY,
  },
  nextBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: CHIP_BG,
    borderWidth: 1,
    borderColor: GOLD + "44",
    alignItems: "center",
    justifyContent: "center",
  },
  lastCtaGroup: {
    width: "100%",
    alignItems: "center",
    gap: 18,
  },
  secondaryLink: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
    color: MUTED,
    textDecorationLine: "underline",
  },
});
