// ── Folvio Design System ─────────────────────────────────────────────────────
// Gold/Amber (#F59E0B) appears in EXACTLY 3 contexts:
//   1. Active bottom tab icon + label
//   2. Selected toggle / button states
//   3. Premium / Upgrade badges and CTAs
// Nowhere else. Chart segment colours are separate.
// ─────────────────────────────────────────────────────────────────────────────

const gold    = "#F59E0B"; // Amber — restricted to the 3 contexts above
const goldDim = "#D97706";
const success = "#10B981"; // Emerald green
const danger  = "#EF4444"; // Red

export default {
  // ── Light theme kept for compatibility; app runs forced-dark ───────────────
  light: {
    text:             "#0F1923",
    textSecondary:    "#4A5568",
    textTertiary:     "#718096",
    textMuted:        "#718096",
    background:       "#F7F8FA",
    backgroundCard:   "#FFFFFF",
    backgroundElevated: "#FFFFFF",
    border:           "#E2E8F0",
    borderLight:      "#F1F5F9",
    tint:             gold,
    tintDim:          goldDim,
    accent:           "#1C2333",
    positive:         success,
    negative:         danger,
    warning:          gold,
    tabIconDefault:   "#94A3B8",
    tabIconSelected:  gold,
    chartLine:        gold,
    chartFill:        "rgba(245,158,11,0.12)",
    shadow:           "rgba(0,0,0,0.08)",
    deepBlue:         "#1C2333",
    deepBlueDark:     "#111827",
  },

  // ── Dark theme — the only theme used ──────────────────────────────────────
  dark: {
    // Surfaces (darkest → elevated)
    background:         "#0A0F1E", // page background
    backgroundCard:     "#111827", // standard card
    backgroundElevated: "#1C2333", // modals, hero, elevated cards

    // Borders
    border:       "#1E2D45",
    borderLight:  "#1E2D45",

    // Brand
    tint:    gold,
    tintDim: goldDim,
    accent:  "#4A90D9",

    // Semantic
    positive: success,   // #10B981
    negative: danger,    // #EF4444
    warning:  gold,      // #F59E0B

    // Typography scale
    text:          "#F1F5F9", // primary   — Display / Title
    textSecondary: "#94A3B8", // body      — labels, list items
    textTertiary:  "#475569", // caption   — secondary info, dates
    textMuted:     "#475569", // alias for tertiary

    // Navigation
    tabIconDefault:  "#475569",
    tabIconSelected: gold,

    // Charts
    chartLine: gold,
    chartFill: "rgba(245,158,11,0.10)",

    // Misc
    shadow:       "rgba(0,0,0,0.5)",
    deepBlue:     "#1C2333", // elevated surface (used across legacy components)
    deepBlueDark: "#111827", // card surface
  },
};
