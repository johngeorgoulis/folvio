#!/usr/bin/env bash
# stability-check.sh — enforces the three Folvio stability rules.
# Exit 0 = all pass.  Exit 1 = one or more failures.
# See STABILITY_RULES.md for the full explanation of each check.

set -euo pipefail
MOBILE="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=1
result=0

green() { printf '\033[0;32m  PASS\033[0m %s\n' "$*"; }
red()   { printf '\033[0;31m  FAIL\033[0m %s\n' "$*"; result=1; }

echo ""
echo "=== Folvio Stability Check ==="
echo ""

# ── CHECK 1 · Feather font preloaded in useFonts ────────────────────────────
echo "CHECK 1: Feather.font spread into useFonts in app/_layout.tsx"

LAYOUT="$MOBILE/app/_layout.tsx"

if ! grep -q '\.\.\.Feather\.font' "$LAYOUT"; then
  red "...Feather.font is missing from useFonts() in app/_layout.tsx"
  red "  Fix: add '...Feather.font,' inside the useFonts({...}) call"
else
  green "Feather.font found in useFonts"
fi

if ! grep -q 'if (!fontsLoaded && !fontError) return null' "$LAYOUT"; then
  red "Null-guard 'if (!fontsLoaded && !fontError) return null' is missing"
  red "  Fix: add this guard before any component renders icons"
else
  green "Null-guard present before first render"
fi

# ── CHECK 2 · try/catch on all context async callbacks ───────────────────────
echo ""
echo "CHECK 2: try/catch wraps every async callback in context files"

check_trycatch() {
  local file="$1"; shift
  local label="$1"; shift
  # All remaining args are function names to check
  local missing=()
  for fn in "$@"; do
    # Look for the function name followed (within 25 lines) by 'try {'
    # Uses awk: find function, then scan the next lines for try {
    found=$(awk "/const ${fn} =|function ${fn}[( ]/{found=1; count=0} found{count++; if(/try \{/) {print \"yes\"; found=0} if(count>25) found=0}" "$file")
    if [[ "$found" != "yes" ]]; then
      missing+=("$fn")
    fi
  done
  if [[ ${#missing[@]} -gt 0 ]]; then
    for fn in "${missing[@]}"; do
      red "$label: '$fn' is missing try/catch"
    done
  else
    green "$label: all callbacks have try/catch"
  fi
}

check_trycatch \
  "$MOBILE/context/PortfolioContext.tsx" \
  "PortfolioContext" \
  "addHolding" "updateHolding" "deleteHolding" "refreshPrices" "clearPrices"

check_trycatch \
  "$MOBILE/context/AllocationContext.tsx" \
  "AllocationContext" \
  "upsertTarget" "removeTarget" "setRebalanceThreshold"

# ── CHECK 3 · Expo starts in tunnel mode ─────────────────────────────────────
echo ""
echo "CHECK 3: expo-loop.sh uses --tunnel and package.json has @expo/ngrok"

LOOP="$MOBILE/scripts/expo-loop.sh"
PKG="$MOBILE/package.json"

if ! grep -q -- '--tunnel' "$LOOP"; then
  red "expo-loop.sh does not contain '--tunnel'"
  red "  Fix: ensure 'npx expo start --tunnel' is the start command"
else
  green "expo-loop.sh uses --tunnel"
fi

if ! grep -q '"@expo/ngrok"' "$PKG"; then
  red "@expo/ngrok is not listed in package.json devDependencies"
  red "  Fix: pnpm add -D @expo/ngrok --filter @workspace/mobile"
else
  green "@expo/ngrok present in package.json"
fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
if [[ $result -eq 0 ]]; then
  echo "=== All checks passed ==="
else
  echo "=== One or more checks FAILED — see above ==="
fi
echo ""
exit $result
