# Folvio Stability Rules

Three categories of bugs have recurred across multiple sessions.
Each rule below describes what the bug is, how it was permanently fixed,
and which automated check (`scripts/stability-check.sh`) enforces it.

---

## Rule 1 — Feather icons must be preloaded before first render

### Symptom
Grey squares appear in the tab bar instead of icons immediately after launch.

### Root cause
`@expo/vector-icons` renders glyphs from a `.ttf` font file.
If the font is not loaded before the first paint, React Native falls back
to a blank/grey box.  The tab bar is one of the first things rendered on
every navigation state, so it must be ready on frame 0.

### Fix (applied in `app/_layout.tsx`)
1. Spread `Feather.font` into the `useFonts` call so it is loaded alongside
   the Inter family before any component renders:
   ```tsx
   const [fontsLoaded, fontError] = useFonts({
     Inter_400Regular,
     Inter_500Medium,
     Inter_600SemiBold,
     Inter_700Bold,
     ...Feather.font,   // ← must never be removed
   });
   ```
2. Return `null` (keep splash visible) until fonts are confirmed ready:
   ```tsx
   if (!fontsLoaded && !fontError) return null;
   ```

### Do not
- Remove `...Feather.font` from `useFonts`.
- Add any tab bar / icon component outside the `fontsLoaded` guard.
- Add a second icon library (e.g. `Ionicons`) without also adding its font
  to the same `useFonts` call.

### Automated check
```
scripts/stability-check.sh  →  CHECK 1
```

---

## Rule 2 — Every SQLite / AsyncStorage call must be inside try/catch

### Symptom
Console shows 14+ unhandled promise rejections on startup (e.g. during
a first launch, a DB migration, or when the SQLite file is temporarily
locked).

### Root cause
`expo-sqlite` async methods throw when:
- The DB file is not yet open (race condition during cold start).
- A migration ALTER TABLE conflicts with an existing column.
- The device storage is full.

If the `await` is not inside `try/catch`, the rejection propagates to
React Native's global unhandled-promise handler, which logs the error
and — in some builds — crashes the component tree.

### Fix

**Layer A — `services/db.native.ts`**
- `openAndInit` already wraps the ALTER TABLE migration in try/catch.
- The singleton `_dbPromise` resets on failure so the next caller retries.

**Layer B — context callback functions**
Every exported context callback that calls `await` must have its own
`try/catch`.  Pattern:
```tsx
const addHolding = useCallback(async (...) => {
  try {
    await insertHolding(...);
    await loadData();
  } catch (e) {
    console.error("[portfolio] addHolding failed:", e);
    throw e;  // re-throw so UI callers can show feedback
  }
}, [loadData]);
```

Functions that must always have try/catch in `PortfolioContext.tsx`:
- `loadData`
- `doRefreshPrices`
- `addHolding`
- `updateHolding`
- `deleteHolding`
- `refreshPrices`
- `clearPrices`

Functions that must always have try/catch in `AllocationContext.tsx`:
- `init` (inside useEffect)
- `reloadTargets`
- `upsertTarget`
- `removeTarget`
- `setRebalanceThreshold`

### Do not
- Add a new `async` callback to either context without a `try/catch`.
- Move the `try` block below any `await` statement inside the callback.

### Automated check
```
scripts/stability-check.sh  →  CHECK 2
```

---

## Rule 3 — Expo must always start in tunnel mode

### Symptom
Metro Bundler starts but Expo Go cannot connect from a phone on a
different network.  The Replit preview proxy (port 18115) is not a
direct Metro connection — Expo Go requires a public URL.

### Fix (applied in `scripts/expo-loop.sh`)
`npx expo start --tunnel --port "${EXPO_PORT}"` is the only accepted
start command.  `@expo/ngrok@^4.1.0` is a required devDependency and
must remain in `package.json`.

The `expo-loop.sh` script also:
- Clears the port before each Metro start attempt.
- Auto-restarts on ngrok timeouts (ngrok free tier drops after ~2 h).
- Handles SIGTERM cleanly so Replit's workflow manager can stop it.

### Do not
- Remove `--tunnel` from the expo start command.
- Replace `npx expo start` with `expo start` without confirming the
  binary is in PATH.
- Remove `@expo/ngrok` from `package.json` devDependencies.

### Automated check
```
scripts/stability-check.sh  →  CHECK 3
```

---

## Running the checks

```bash
bash artifacts/mobile/scripts/stability-check.sh
```

Exit code 0 = all green.  Exit code 1 = one or more rules violated.
Run this after every significant change to either `_layout.tsx`,
`context/PortfolioContext.tsx`, `context/AllocationContext.tsx`,
`scripts/expo-loop.sh`, or `package.json`.
