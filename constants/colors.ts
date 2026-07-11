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

// ── Minimalist redesign palette (Modernist design system) ─────────────────────

export type MinimalTheme = {
  background: string;
  surface: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  divider: string;
  hairline: string;
  accent: string;
  accentPressed: string;
  positive: string;
  negative: string;
  shadow: string;
  // Legacy aliases for components that still reference these
  textTertiary: string;
  backgroundCard: string;
  backgroundElevated: string;
  border: string;
  borderLight: string;
  tint: string;
  tintDim: string;
  warning: string;
  tabIconDefault: string;
  tabIconSelected: string;
  chartLine: string;
  chartFill: string;
  deepBlue: string;
  deepBlueDark: string;
};

export const minimalLight: MinimalTheme = {
  background:         "#f3f2f2",
  surface:            "#eae9e9",
  text:               "#201e1d",
  textSecondary:      "#7d7979",
  textMuted:          "#7d7979",
  divider:            "rgba(32,30,29,0.4)",
  hairline:           "#d7d3d3",
  accent:             "#ec3013",
  accentPressed:      "#dd2b0f",
  positive:           "#1a7a4a",
  negative:           "#8a2a1a",
  shadow:             "rgba(45,43,43,0.14)",
  // Legacy aliases
  textTertiary:       "#9b9797",
  backgroundCard:     "#eae9e9",
  backgroundElevated: "#eae9e9",
  border:             "#d7d3d3",
  borderLight:        "#eae7e7",
  tint:               "#ec3013",
  tintDim:            "#dd2b0f",
  warning:            "#ec3013",
  tabIconDefault:     "#7d7979",
  tabIconSelected:    "#201e1d",
  chartLine:          "#ec3013",
  chartFill:          "rgba(236,48,19,0.10)",
  deepBlue:           "#eae9e9",
  deepBlueDark:       "#d7d3d3",
};

export const minimalDark: MinimalTheme = {
  background:         "#2d2b2b",
  surface:            "#444141",
  text:               "#f8f4f4",
  textSecondary:      "#bab6b6",
  textMuted:          "#bab6b6",
  divider:            "#605d5d",
  hairline:           "#605d5d",
  accent:             "#ff9783",
  accentPressed:      "#ec3013",
  positive:           "#4ade80",
  negative:           "#ff9783",
  shadow:             "rgba(0,0,0,0.30)",
  // Legacy aliases
  textTertiary:       "#7d7979",
  backgroundCard:     "#444141",
  backgroundElevated: "#444141",
  border:             "#605d5d",
  borderLight:        "#605d5d",
  tint:               "#ff9783",
  tintDim:            "#ec3013",
  warning:            "#ff9783",
  tabIconDefault:     "#bab6b6",
  tabIconSelected:    "#f8f4f4",
  chartLine:          "#ff9783",
  chartFill:          "rgba(255,151,131,0.10)",
  deepBlue:           "#444141",
  deepBlueDark:       "#2d2b2b",
};

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
