import React, { useRef, useState } from "react";
import {
  Dimensions,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ViewToken,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");
export const ONBOARDING_KEY = "folvio_onboarding_complete";

const NAVY    = "#0F1923";
const GOLD    = "#C9A84C";
const WHITE   = "#FFFFFF";
const MUTED   = "#6B7A8D";
const CHIP_BG = "#1A2E42";
const DARK_BG = "#0A0F1E";

// ─── Page data ────────────────────────────────────────────────────────────────

type PageId = "welcome" | "features" | "privacy" | "first-etf";

const PAGES: PageId[] = ["welcome", "features", "privacy", "first-etf"];

interface Props {
  onComplete: (goToSearch: boolean) => void;
}

export default function OnboardingFlow({ onComplete }: Props) {
  const insets = useSafeAreaInsets();
  const flatListRef = useRef<FlatList<PageId>>(null);
  const [currentIndex, setCurrentIndex] = useState(0);

  const viewabilityConfig = useRef({ viewAreaCoveragePercentThreshold: 50 });
  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems.length > 0) setCurrentIndex(viewableItems[0].index ?? 0);
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
    if (currentIndex < PAGES.length - 1) goToPage(currentIndex + 1);
  }

  const isLast  = currentIndex === PAGES.length - 1;
  const isFirst = currentIndex === 0;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Skip button — hidden on last screen */}
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
        keyExtractor={(item) => item}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        bounces={false}
        scrollEventThrottle={16}
        viewabilityConfig={viewabilityConfig.current}
        onViewableItemsChanged={onViewableItemsChanged.current}
        renderItem={({ item }) => <PageView id={item} />}
      />

      {/* Bottom controls */}
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 32) }]}>
        {/* Dot indicators */}
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
              <Text style={styles.primaryBtnText}>Search ETFs</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => markAndFinish(false)}>
              <Text style={styles.secondaryLink}>Skip for now</Text>
            </TouchableOpacity>
          </View>
        ) : isFirst ? (
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={handleNext}
            activeOpacity={0.85}
          >
            <Text style={styles.primaryBtnText}>Get Started</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={handleNext}
            activeOpacity={0.85}
          >
            <Text style={styles.primaryBtnText}>Next</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

// ─── Page views ────────────────────────────────────────────────────────────────

function PageView({ id }: { id: PageId }) {
  switch (id) {
    case "welcome":   return <WelcomePage />;
    case "features":  return <FeaturesPage />;
    case "privacy":   return <PrivacyPage />;
    case "first-etf": return <FirstETFPage />;
  }
}

// Screen 1 — Welcome
function WelcomePage() {
  return (
    <View style={styles.page}>
      <View style={styles.pageInner}>
        <View style={styles.fMarkWrap}>
          <FMark size={88} />
        </View>
        <Text style={styles.wordmark}>Folvio</Text>
        <Text style={styles.welcomeHeading}>
          Your European portfolio,{"\n"}finally in one place
        </Text>
        <Text style={styles.welcomeSubtitle}>
          Track UCITS ETFs across all your brokers, in EUR
        </Text>
      </View>
    </View>
  );
}

// Screen 2 — Features
const FEATURE_BULLETS = [
  {
    emoji: "📊",
    text: "UCITS-native tracking — ISIN, TER, ACC/DIST support",
  },
  {
    emoji: "🎯",
    text: "Allocation drift alerts — know when to rebalance",
  },
  {
    emoji: "🤖",
    text: "AI-powered insights — personalised portfolio analysis",
  },
];

function FeaturesPage() {
  return (
    <View style={styles.page}>
      <View style={styles.pageInner}>
        <Text style={styles.pageTitle}>Built for European{"\n"}ETF investors</Text>
        <View style={styles.bulletList}>
          {FEATURE_BULLETS.map((b) => (
            <View key={b.emoji} style={styles.bulletRow}>
              <Text style={styles.bulletEmoji}>{b.emoji}</Text>
              <Text style={styles.bulletText}>{b.text}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

// Screen 3 — Privacy
function PrivacyPage() {
  return (
    <View style={styles.page}>
      <View style={styles.pageInner}>
        <View style={styles.iconCircle}>
          <Feather name="shield" size={48} color={GOLD} />
        </View>
        <Text style={styles.pageTitle}>Your data stays{"\n"}on your device</Text>
        <Text style={styles.pageBody}>
          No account required. Your portfolio data is stored locally on your
          iPhone, never shared.
        </Text>
      </View>
    </View>
  );
}

// Screen 4 — First ETF
function FirstETFPage() {
  return (
    <View style={styles.page}>
      <View style={styles.pageInner}>
        <Text style={styles.pageTitle}>Add your first ETF</Text>
        <Text style={styles.pageBody}>
          Search by ticker, name, or ISIN
        </Text>
        <View style={styles.searchBarWrap}>
          <Feather name="search" size={18} color={MUTED} style={styles.searchIcon} />
          <TextInput
            style={styles.searchBar}
            placeholder="VWCE, IWDA, VUAA..."
            placeholderTextColor={MUTED}
            editable={false}
            pointerEvents="none"
          />
        </View>
      </View>
    </View>
  );
}

// ─── Inline "F" mark ──────────────────────────────────────────────────────────

function FMark({ size }: { size: number }) {
  const s      = size / 100;
  const stroke = 18 * s;
  const topBarW = 74 * s;
  const height  = 88 * s;
  const midBarW = 52 * s;
  const midY    = height * 0.44;
  return (
    <View style={{ width: topBarW, height }}>
      <View style={{ position: "absolute", left: 0, top: 0, width: stroke, height, backgroundColor: GOLD, borderRadius: 3 * s }} />
      <View style={{ position: "absolute", left: 0, top: 0, width: topBarW, height: stroke, backgroundColor: GOLD, borderRadius: 3 * s }} />
      <View style={{ position: "absolute", left: 0, top: midY, width: midBarW, height: stroke * 0.85, backgroundColor: GOLD, borderRadius: 3 * s }} />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: DARK_BG,
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

  // Page layout
  page: {
    width: SCREEN_W,
    height: SCREEN_H,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 36,
    paddingBottom: 180,
  },
  pageInner: {
    width: "100%",
    alignItems: "center",
    gap: 20,
  },

  // Screen 1 — Welcome
  fMarkWrap: { marginBottom: 4 },
  wordmark: {
    fontSize: 48,
    fontFamily: "Inter_700Bold",
    color: WHITE,
    letterSpacing: 1,
  },
  welcomeHeading: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    color: WHITE,
    textAlign: "center",
    lineHeight: 38,
    letterSpacing: -0.3,
  },
  welcomeSubtitle: {
    fontSize: 16,
    fontFamily: "Inter_400Regular",
    color: MUTED,
    textAlign: "center",
    lineHeight: 24,
  },

  // Screen 2 — Features
  bulletList: {
    width: "100%",
    gap: 16,
    marginTop: 8,
  },
  bulletRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
    backgroundColor: CHIP_BG,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: GOLD + "22",
  },
  bulletEmoji: {
    fontSize: 22,
    lineHeight: 26,
  },
  bulletText: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
    color: WHITE,
    flex: 1,
    lineHeight: 22,
  },

  // Screens 2–3 shared
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
    letterSpacing: -0.3,
  },
  pageBody: {
    fontSize: 16,
    fontFamily: "Inter_400Regular",
    color: MUTED,
    textAlign: "center",
    lineHeight: 26,
  },

  // Screen 4 — Search bar (decorative)
  searchBarWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: CHIP_BG,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: GOLD + "44",
    paddingHorizontal: 16,
    paddingVertical: 14,
    width: "100%",
    marginTop: 8,
  },
  searchIcon: {
    marginRight: 10,
  },
  searchBar: {
    flex: 1,
    fontSize: 16,
    fontFamily: "Inter_400Regular",
    color: WHITE,
  },

  // Footer
  footer: {
    alignItems: "center",
    gap: 20,
    paddingHorizontal: 32,
    paddingTop: 12,
  },
  dotsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  dot: { borderRadius: 4 },
  dotActive:   { width: 24, height: 8, backgroundColor: GOLD },
  dotInactive: { width: 8,  height: 8, backgroundColor: MUTED + "55" },

  // Buttons
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
