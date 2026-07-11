import AsyncStorage from "@react-native-async-storage/async-storage";
import { Feather } from "@expo/vector-icons";
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
import { upsertInvestorProfile } from "@/services/db";

const { width: SCREEN_W } = Dimensions.get("window");

export const INVESTOR_PROFILE_KEY = "investor_profile_completed";

// ── Theme ────────────────────────────────────────────────────────────────────
const DARK_BG    = "#0A0F1E";
const CARD_BG    = "#111827";
const ELEVATED   = "#1C2333";
const BORDER     = "#1E2D45";
const GOLD       = "#F59E0B";
const TEXT       = "#F1F5F9";
const TEXT_SEC   = "#94A3B8";
const TEXT_TERT  = "#475569";

// ── Questions ────────────────────────────────────────────────────────────────
interface Question {
  question: string;
  options: string[];
}

const QUESTIONS: Question[] = [
  {
    question: "When do you plan to use this money?",
    options: [
      "Less than 5 years",
      "5–10 years",
      "10–20 years",
      "20+ years (retirement)",
    ],
  },
  {
    question: "What's your main investing goal?",
    options: [
      "Grow my wealth long-term",
      "Generate passive income",
      "Balanced approach",
      "Capital preservation",
    ],
  },
  {
    question: "If your portfolio dropped 30%, you would…",
    options: [
      "Sell — I can't handle that loss",
      "Hold and wait it out",
      "Buy more — great opportunity",
    ],
  },
  {
    question: "How would you describe your stage?",
    options: [
      "Just starting out (< €10k)",
      "Building up (€10k–€100k)",
      "Established investor (€100k+)",
    ],
  },
  {
    question: "How much can you invest monthly?",
    options: [
      "Less than €100",
      "€100–€300",
      "€300–€1,000",
      "€1,000+",
    ],
  },
];

// ── Scoring ──────────────────────────────────────────────────────────────────
const Q1_SCORES: Record<string, number> = {
  "Less than 5 years": 1,
  "5–10 years": 2,
  "10–20 years": 3,
  "20+ years (retirement)": 5,
};
const Q2_SCORES: Record<string, number> = {
  "Capital preservation": 1,
  "Generate passive income": 2,
  "Balanced approach": 3,
  "Grow my wealth long-term": 5,
};
const Q3_SCORES: Record<string, number> = {
  "Sell — I can't handle that loss": 1,
  "Hold and wait it out": 3,
  "Buy more — great opportunity": 5,
};

type ProfileLabel = "Conservative" | "Moderate" | "Growth" | "Aggressive";

const PROFILE_DESCRIPTIONS: Record<ProfileLabel, string> = {
  Conservative: "You prioritize capital safety and steady, predictable returns.",
  Moderate:     "You balance growth potential with manageable risk exposure.",
  Growth:       "You're comfortable with volatility in pursuit of long-term gains.",
  Aggressive:   "You embrace risk as a core tool for maximizing long-term wealth.",
};

const PROFILE_ICONS: Record<ProfileLabel, React.ComponentProps<typeof Feather>["name"]> = {
  Conservative: "shield",
  Moderate:     "bar-chart-2",
  Growth:       "trending-up",
  Aggressive:   "zap",
};

function computeProfile(answers: Record<number, string>) {
  const s1 = Q1_SCORES[answers[0]] ?? 3;
  const s2 = Q2_SCORES[answers[1]] ?? 3;
  const s3 = Q3_SCORES[answers[2]] ?? 3;
  const riskScore = (s1 + s2 + s3) / 3;

  let profileLabel: ProfileLabel;
  if (riskScore <= 2.0)      profileLabel = "Conservative";
  else if (riskScore <= 3.0) profileLabel = "Moderate";
  else if (riskScore <= 4.0) profileLabel = "Growth";
  else                       profileLabel = "Aggressive";

  const incomeOriented = answers[1] === "Generate passive income";
  return { riskScore, profileLabel, incomeOriented };
}

// ── QuestionCard ─────────────────────────────────────────────────────────────
function QuestionCard({
  question,
  questionIndex,
  selectedOption,
  onSelect,
}: {
  question: Question;
  questionIndex: number;
  selectedOption: string | undefined;
  onSelect: (option: string) => void;
}) {
  return (
    <View style={[cardStyles.page, { width: SCREEN_W }]}>
      <Text style={cardStyles.qLabel}>Question {questionIndex + 1}</Text>
      <Text style={cardStyles.qText}>{question.question}</Text>
      <View style={cardStyles.options}>
        {question.options.map((option) => {
          const selected = selectedOption === option;
          return (
            <TouchableOpacity
              key={option}
              style={[
                cardStyles.option,
                {
                  backgroundColor: selected ? GOLD + "1A" : ELEVATED,
                  borderColor: selected ? GOLD : BORDER,
                },
              ]}
              onPress={() => onSelect(option)}
              activeOpacity={0.75}
            >
              <Text style={[cardStyles.optionText, { color: selected ? GOLD : TEXT }]}>
                {option}
              </Text>
              {selected && (
                <View style={[cardStyles.check, { backgroundColor: GOLD }]}>
                  <Feather name="check" size={11} color={DARK_BG} />
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const cardStyles = StyleSheet.create({
  page: {
    paddingHorizontal: 24,
    paddingTop: 24,
    justifyContent: "flex-start",
  },
  qLabel: {
    fontSize: 11,
    fontFamily: "Archivo_600SemiBold",
    color: TEXT_SEC,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 14,
  },
  qText: {
    fontSize: 24,
    fontFamily: "Archivo_800ExtraBold",
    color: TEXT,
    letterSpacing: -0.4,
    lineHeight: 32,
    marginBottom: 36,
  },
  options: { gap: 10 },
  option: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 14,
    borderWidth: 1.5,
    paddingVertical: 17,
    paddingHorizontal: 18,
  },
  optionText: {
    fontSize: 15,
    fontFamily: "Archivo_600SemiBold",
    flex: 1,
    lineHeight: 20,
  },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 10,
    flexShrink: 0,
  },
});

// ── ResultScreen ─────────────────────────────────────────────────────────────
function ResultScreen({
  answers,
  onViewInsights,
  onEditAnswers,
}: {
  answers: Record<number, string>;
  onViewInsights: () => void;
  onEditAnswers: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { riskScore, profileLabel, incomeOriented: _ } = computeProfile(answers);
  const description = PROFILE_DESCRIPTIONS[profileLabel];
  const icon        = PROFILE_ICONS[profileLabel];

  return (
    <View style={[resultStyles.root, { paddingTop: insets.top, paddingBottom: insets.bottom + 16 }]}>
      <View style={resultStyles.inner}>
        <View style={[resultStyles.iconWrap, { backgroundColor: GOLD + "18" }]}>
          <Feather name={icon} size={44} color={GOLD} />
        </View>

        <Text style={resultStyles.eyebrow}>You're a</Text>
        <Text style={[resultStyles.label, { color: GOLD }]}>{profileLabel} Investor</Text>
        <Text style={resultStyles.description}>{description}</Text>

        <View style={[resultStyles.scoreRow, { backgroundColor: ELEVATED, borderColor: BORDER }]}>
          <Text style={resultStyles.scoreKey}>Risk Score</Text>
          <Text style={[resultStyles.scoreVal, { color: GOLD }]}>{riskScore.toFixed(1)}</Text>
          <Text style={[resultStyles.scoreMax, { color: TEXT_TERT }]}>/5</Text>
        </View>
      </View>

      <View style={resultStyles.buttons}>
        <TouchableOpacity
          style={[resultStyles.primaryBtn, { backgroundColor: GOLD }]}
          onPress={onViewInsights}
          activeOpacity={0.85}
        >
          <Text style={resultStyles.primaryBtnText}>View my Insights</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[resultStyles.secondaryBtn, { borderColor: BORDER }]}
          onPress={onEditAnswers}
          activeOpacity={0.85}
        >
          <Text style={[resultStyles.secondaryBtnText, { color: TEXT_SEC }]}>Edit answers</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const resultStyles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: DARK_BG,
    paddingHorizontal: 28,
    justifyContent: "space-between",
  },
  inner: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 0,
  },
  iconWrap: {
    width: 96,
    height: 96,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 28,
  },
  eyebrow: {
    fontSize: 17,
    fontFamily: "Archivo_400Regular",
    color: TEXT_SEC,
    marginBottom: 4,
  },
  label: {
    fontSize: 34,
    fontFamily: "Archivo_800ExtraBold",
    letterSpacing: -1,
    marginBottom: 18,
    textAlign: "center",
  },
  description: {
    fontSize: 15,
    fontFamily: "Archivo_400Regular",
    color: TEXT_SEC,
    textAlign: "center",
    lineHeight: 24,
    marginBottom: 28,
    paddingHorizontal: 8,
  },
  scoreRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  scoreKey:  { fontSize: 13, fontFamily: "Archivo_400Regular", color: TEXT_SEC },
  scoreVal:  { fontSize: 26, fontFamily: "Archivo_800ExtraBold", letterSpacing: -0.5 },
  scoreMax:  { fontSize: 15, fontFamily: "Archivo_400Regular" },
  buttons: { gap: 12, paddingHorizontal: 4 },
  primaryBtn: {
    width: "100%",
    borderRadius: 14,
    paddingVertical: 17,
    alignItems: "center",
  },
  primaryBtnText: {
    fontSize: 16,
    fontFamily: "Archivo_800ExtraBold",
    color: DARK_BG,
  },
  secondaryBtn: {
    width: "100%",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    borderWidth: 1,
  },
  secondaryBtnText: {
    fontSize: 16,
    fontFamily: "Archivo_600SemiBold",
  },
});

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  onComplete: () => void;
  onSkip: () => void;
}

export default function InvestorProfileOnboarding({ onComplete, onSkip }: Props) {
  const insets = useSafeAreaInsets();
  const flatListRef = useRef<FlatList<Question>>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [showResult, setShowResult] = useState(false);
  const [saving, setSaving] = useState(false);

  const viewabilityConfig = useRef({ viewAreaCoveragePercentThreshold: 50 });
  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems.length > 0) {
        setCurrentIndex(viewableItems[0].index ?? 0);
      }
    }
  );

  function goTo(index: number) {
    flatListRef.current?.scrollToIndex({ index, animated: true });
    setCurrentIndex(index);
  }

  function handleSelect(questionIndex: number, option: string) {
    setAnswers((prev) => ({ ...prev, [questionIndex]: option }));
  }

  async function handleNext() {
    if (currentIndex < QUESTIONS.length - 1) {
      goTo(currentIndex + 1);
      return;
    }
    // Final question — save and show result
    setSaving(true);
    try {
      const { riskScore, profileLabel, incomeOriented } = computeProfile(answers);
      await upsertInvestorProfile({
        risk_score: riskScore,
        profile_label: profileLabel,
        income_oriented: incomeOriented ? 1 : 0,
        investment_horizon: answers[0] ?? "",
        investing_stage: answers[3] ?? "",
        monthly_dca_range: answers[4] ?? "",
      });
      await AsyncStorage.setItem(INVESTOR_PROFILE_KEY, "true");
    } catch (e) {
      console.warn("[InvestorProfile] Save failed:", e);
    } finally {
      setSaving(false);
    }
    setShowResult(true);
  }

  async function handleSkip() {
    try {
      await AsyncStorage.setItem(INVESTOR_PROFILE_KEY, "true");
    } catch {}
    onSkip();
  }

  function handleEditAnswers() {
    setShowResult(false);
    goTo(0);
  }

  const canProceed = !!answers[currentIndex];

  if (showResult) {
    return (
      <ResultScreen
        answers={answers}
        onViewInsights={onComplete}
        onEditAnswers={handleEditAnswers}
      />
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <View style={styles.progressArea}>
          <Text style={styles.progressText}>{currentIndex + 1}/5</Text>
          <View style={styles.segments}>
            {QUESTIONS.map((_, i) => (
              <View
                key={i}
                style={[
                  styles.segment,
                  {
                    backgroundColor: i <= currentIndex ? GOLD : BORDER,
                    flex: i === currentIndex ? 2 : 1,
                  },
                ]}
              />
            ))}
          </View>
        </View>
        <TouchableOpacity
          onPress={handleSkip}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={styles.skipText}>Skip</Text>
        </TouchableOpacity>
      </View>

      {/* Question cards */}
      <FlatList
        ref={flatListRef}
        data={QUESTIONS}
        keyExtractor={(_, i) => String(i)}
        horizontal
        pagingEnabled
        scrollEnabled={false}
        showsHorizontalScrollIndicator={false}
        viewabilityConfig={viewabilityConfig.current}
        onViewableItemsChanged={onViewableItemsChanged.current}
        renderItem={({ item, index }) => (
          <QuestionCard
            question={item}
            questionIndex={index}
            selectedOption={answers[index]}
            onSelect={(option) => handleSelect(index, option)}
          />
        )}
        style={styles.list}
      />

      {/* Bottom bar */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}>
        {currentIndex > 0 ? (
          <TouchableOpacity
            style={[styles.backBtn, { backgroundColor: ELEVATED }]}
            onPress={() => goTo(currentIndex - 1)}
          >
            <Feather name="arrow-left" size={20} color={TEXT_SEC} />
          </TouchableOpacity>
        ) : (
          <View style={styles.backPlaceholder} />
        )}

        <TouchableOpacity
          style={[
            styles.nextBtn,
            { backgroundColor: canProceed ? GOLD : ELEVATED },
          ]}
          onPress={canProceed && !saving ? handleNext : undefined}
          disabled={!canProceed || saving}
          activeOpacity={0.85}
        >
          <Text style={[styles.nextBtnText, { color: canProceed ? DARK_BG : TEXT_TERT }]}>
            {currentIndex === QUESTIONS.length - 1 ? "Finish" : "Next"}
          </Text>
          <Feather
            name="arrow-right"
            size={16}
            color={canProceed ? DARK_BG : TEXT_TERT}
          />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: DARK_BG,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingVertical: 14,
    gap: 16,
  },
  progressArea: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  progressText: {
    fontSize: 13,
    fontFamily: "Archivo_600SemiBold",
    color: TEXT_SEC,
    minWidth: 24,
  },
  segments: {
    flex: 1,
    flexDirection: "row",
    gap: 4,
    height: 4,
    alignItems: "center",
  },
  segment: {
    height: 4,
    borderRadius: 2,
  },
  skipText: {
    fontSize: 15,
    fontFamily: "Archivo_600SemiBold",
    color: TEXT_SEC,
  },
  list: {
    flex: 1,
  },
  bottomBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  backBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
  },
  backPlaceholder: {
    width: 46,
  },
  nextBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 14,
  },
  nextBtnText: {
    fontSize: 16,
    fontFamily: "Archivo_800ExtraBold",
  },
});
