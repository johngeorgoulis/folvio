# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM (API server); expo-sqlite (mobile app)

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── api-server/         # Express API server
│   └── mobile/             # Expo React Native app (Folvio)
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json
└── package.json
```

## Folvio Mobile App (`artifacts/mobile`)

European UCITS ETF portfolio tracker built with Expo (managed workflow).

### Design System
- **Theme**: Dark blue (#1E3A5F) primary, gold (#C9A84C) accent, dark background (#0A0F1A)
- **Font**: Inter (400, 500, 600, 700)
- **Persistence**: expo-sqlite (local only, no backend in v1)

### Screens
- **Dashboard** (`/`) — total portfolio value, allocation donut chart, stats
- **Holdings** (`/holdings`) — list of all holdings, tap for detail, add new; accepts `prefillTicker`/`prefillName`/`prefillExchange` URL params to auto-open AddHoldingModal
- **Holding Detail** (`/holding/[id]`) — full breakdown, edit, delete
- **Search** (`/search`) — 5th tab; search bar with debounce, Popular ETFs + Major Stocks horizontal scroll cards with live prices, type filter chips (All/ETF/Stock/Fund), tap to open Ticker Detail
- **Ticker Detail** (`/ticker/[symbol]`) — deep blue hero header, range selector (1D/1W/1M/3M/6M/1Y/All), SVG PriceChart with touch crosshair, Key Stats, Performance cards, "Add to Portfolio" action bar
- **Performance** (`/performance`) — return stats, 10-year projections, dividend estimates
- **Settings** (`/settings`) — display prefs, premium status, Default Benchmark picker (S&P 500 / MSCI World / Euro Stoxx 50 / FTSE All-World / DAX), about

### Free Tier Logic
- Max **10 holdings** in free tier
- On 11th add attempt: shows PremiumModal (RevenueCat paywall stub)
- Premium unlocks: unlimited holdings, CSV import, CSV export, benchmark comparison

### CSV Import (`app/import.tsx`, `services/csvImport.ts`)
- Accessible from Settings → DATA → "Import from CSV"
- 3-step modal screen: broker selection → export instructions + file upload → preview & confirm
- Supports 10 brokers: Trading 212, Degiro, Trade Republic, Lightyear, Freedom24, Scalable Capital, Flatex, Saxo Bank, Revolut, Generic CSV
- `expo-document-picker` for file selection; `expo-file-system` for reading; `papaparse` for CSV parsing
- Aggregates BUY/SELL transactions into holdings with weighted avg cost
- Duplicate detection: Merge (weighted avg of qty+cost), Replace (delete old + add new), or Skip
- Brokers without direct ticker columns (Degiro, Scalable, Flatex, Trade Republic) use instrument name heuristics and flag `needsTickerConfirmation=true` — user can edit ticker in Step 3
- Free tier cap enforced at import time

### RevenueCat (Monetization)
- **Status**: NOT configured — user dismissed the integration
- `react-native-purchases` and `replit-revenuecat-v2` are installed in the root workspace
- To set up: connect the RevenueCat integration in Replit, then run the seed script at `scripts/src/seedRevenueCat.ts`
- The PremiumModal currently shows a "Coming Soon" stub — wire up real purchases once RevenueCat is connected

### Data Layer
- `services/db.native.ts` — expo-sqlite helpers (native: iOS/Android)
- `services/db.web.ts` — AsyncStorage fallback (web preview); Metro resolves via `.native.ts`/`.web.ts` extensions
- `context/PortfolioContext.tsx` — React context; exposes holdings with computed price fields; wires AppState foreground refresh
- Tables: `holdings`, `prices_cache`

### Price Service (`services/priceService.ts`)

**Data sources:**
- **FMP (Financial Modeling Prep)** — primary price source; always routed through the API server proxy (`/api/fmp/profile/:symbol`) so the API key stays server-side. Uses `/stable/profile` endpoint which works for all UCITS ETFs including European suffixes (.DE .AS .PA .L .SW).
- **Yahoo Finance** — secondary source for chart/historical data and multi-period start prices; on native calls Yahoo directly, on web routes through `/api/yahoo/chart/:symbol` proxy.
- **Frankfurter** — free FX rates for GBP→EUR, USD→EUR, CHF→EUR conversions.

**Key functions:**
- `buildYahooSymbol(ticker, exchange)` — constructs Yahoo Finance / FMP symbol (e.g. VWCE → VWCE.DE for XETRA)
- `fetchLivePrice(ticker, exchange)` — FMP profile; returns price in EUR
- `fetchTickerMeta(symbol)` — FMP profile; returns price, change, changePct, 52W range, ISIN, isEtf
- `fetchChartHistory(symbol, range)` — Yahoo Finance; all ranges (1D–All) via CHART_INTERVALS
- `fetchPeriodReturn(symbol, period)` — 1D: FMP profile (price−change = previousClose); 1W–All: Yahoo historical start price + FMP live end price (parallel fetch)
- `fetchFXRate(from, to)` — Frankfurter API (free, no key); in-memory 60s cache
- `normalizeToEUR(price, currency, fxRates)` — handles EUR, GBp/GBX (÷100), GBP, USD, CHF
- `refreshAllPrices(holdings)` — batch refresh with max 5 concurrent, skips manual prices and fresh cache
- `getCachedPrice(ticker)` — reads from DB, returns `isStale: true` if cache > 15 min old
- **Stale-ok fallback**: if fetch fails, keeps old cached price; if no cache and fails → null
- **Manual protection**: prices with `source: "manual"` are never auto-overwritten
- AppState `"active"` listener in PortfolioContext triggers refresh on foreground return

**FMP API notes:**
- API key stored as `FMP_API_KEY` secret (server-side only)
- All FMP calls go through `artifacts/api-server/src/routes/fmp.ts` proxy
- `/stable/profile` returns: price, change, changePercentage, volume, currency, isin, isEtf, range (yearLow-yearHigh string), companyName, exchange
- Historical price endpoints (`/stable/historical-price-full`) require a paid plan — not used
- `previousClose = profile.price − profile.change`
- `yearLow/yearHigh` parsed from `range` string "low-high" via `parseRange()`

### Exchanges
`["XETRA", "Euronext Paris", "Euronext Amsterdam", "LSE", "Borsa Italiana", "SIX Swiss", "Other"]`  
Suffix map: XETRA→.DE, Euronext Paris→.PA, Euronext Amsterdam→.AS, LSE→.L, Borsa Italiana→.MI, SIX Swiss→.SW

### Price UI States
| State | Display |
|---|---|
| Live (< 15 min) | Green dot · "Live · Xm ago" |
| Stale (> 15 min) | ⚠ amber · "Stale · Xm ago" + Refresh button |
| Manual | "Manual price" + "Fetch live" button |
| No price | "—" + "Enter manually" button |

### Rebalancing & Allocation (`services/allocationService.ts`, `context/AllocationContext.tsx`)
- `target_allocations` table in SQLite (native) / AsyncStorage (web)
- Default 7-ETF portfolio seeded on first launch: VWCE 30%, TDIV 25%, VHYL 15%, ERNE 10%, CSBGE7 7%, IEGE 6%, EGLN 7%
- `validateTargets()` — checks sum = 100%, shows error if not
- `calculateAllocations()` — computes actual%, drift, status (ok/overweight/underweight/untracked/no_price) per threshold
- `calculateDCARebalance()` — DCA mode: buy only (no sells), distribute new capital to underweight ETFs
- `calculateFullRebalance()` — Full mode: buy + sell suggestions, tax warning
- Rebalance threshold configurable: ±3%, ±5%, ±10% (stored in AsyncStorage)
- `AllocationContext` — provides targets, threshold; seeds defaults; exposes upsert/remove functions

### Rebalancing Screen (`app/rebalance.tsx`)
- Accessible from Performance tab (tapping the Rebalance Calculator card)
- Section 1: Allocation Overview — stacked color bar + table (Ticker, Target%, Actual%, Drift, Status badge)
- Section 2: Calculator — DCA mode (cash input) or Full Rebalance toggle
- Section 3: Suggestions — BUY (green) / SELL (red) / SKIP (gray) with unit counts and EUR estimates
- Section 4: Summary — capital to deploy, transaction count, mode
- Edge cases: empty portfolio, invalid targets, no price, DCA never suggests sells

### Target Allocation Editor (Settings tab)
- Drift threshold picker (±3/5/10%)
- Add new ticker + percentage inline
- Edit existing target (tap pencil → inline TextInput → confirm)
- Remove target (trash → confirm alert)
- Live sum validation: "Sum: X% ✓" (green) or error (red)

### ETF Database Service (`services/etfDatabaseService.ts`)
- Bundled seed database: `assets/etf-database.json` — **671 real UCITS ETFs** (version 2.0, ~400KB); sourced from JustETF (TER/distribution/replication), Yahoo Finance search (ticker+name), and legacy curated entries. All IE/LU domicile.
- Provider coverage: iShares 139, Amundi 136, SPDR 71, Xtrackers 65, Invesco 39, UBS 50, L&G 21, HSBC 16, Vanguard 15, WisdomTree 13
- Search index: `assets/etf-index.json` — ISIN map, ticker map, keyword index for O(1) lookups
- `initETFDatabase()` — loads bundled DB then checks AsyncStorage for newer downloaded version
- `searchETFDatabase(query, maxResults)` — instant synchronous search: exact ISIN → exact ticker → partial ticker → name contains; returns scored results with `matchType`
- `lookupByISIN(isin)` / `lookupByTicker(ticker)` — O(1) single lookups
- Background update: checks `REMOTE_DB_URL` (GitHub Gist) max once per 24h, 5s timeout, never blocks UI; shows toast on success
- AsyncStorage keys: `folvio_etf_database`, `folvio_etf_db_version`, `folvio_etf_db_last_check`
- **To enable remote updates**: Create a GitHub Gist with `etf-database.json` contents → get the raw URL → replace `REMOTE_DB_URL` constant in `etfDatabaseService.ts`

### Search Screen (`app/(tabs)/search.tsx`)
- Instant local search from bundled DB (no network, as user types) → colored asset class badges (green=Equity, blue=Bonds, yellow=Commodities, purple=Real Estate)
- Shows: ticker, short name, ISIN, TER%, asset class badge, Acc/Dist badge
- Falls back to Yahoo Finance live search when local DB has < 5 results
- Labels sections: "UCITS ETF Database" (local) and "More results / Yahoo Finance" (network)
- Shows "ETF database updated" toast when background download completes

### Build Script (`scripts/buildETFDatabase.ts`)
- Run: `cd artifacts/mobile && timeout 110 /home/runner/workspace/artifacts/api-server/node_modules/.bin/tsx scripts/buildETFDatabase.ts`
- Phase 1: OpenFIGI bulk lookup (probe first; skips entire phase if rate-limited)
- Phase 2: JustETF profile scraping (TER, distribution, replication) with Yahoo Finance fallback for ISIN→ticker+name lookup when JustETF is rate-limited
- 1,007 ISINs in `ALL_ISINS[]` array; sources: curated list + JerBouma/FinanceDatabase EU ETFs
- Saves incrementally after every 10-ISIN batch (timeout-safe); run multiple times to process all ISINs
- JustETF rate-limit: IP may be blocked after ~200 requests; Yahoo Finance is not rate-limited and serves as reliable fallback
- Output format: `{ version, generatedAt, count, etfs: [...] }` written to `assets/etf-database.json` + `assets/etf-index.json`

### Key Files
- `app/_layout.tsx` — root layout; wraps with PortfolioProvider + AllocationProvider
- `app/(tabs)/_layout.tsx` — tab bar (Dashboard, Holdings, Search, Performance, Settings)
- `app/(tabs)/search.tsx` — Explore/Search tab
- `app/ticker/[symbol].tsx` — Ticker Detail stack screen
- `components/PriceChart.tsx` — SVG sparkline with touch crosshair
- `services/priceService.ts` — Yahoo Finance + Frankfurter FX; exports `searchTickers`, `fetchChartHistory`, `fetchSymbolPrice`, `yahooChartUrl`, `yahooSearchUrl`
- `constants/colors.ts` — full theme (light + dark)
- `utils/format.ts` — EUR formatting (de-DE locale), date helpers

### API Server (`artifacts/api-server`)
- `src/routes/yahoo.ts` — CORS proxy for web preview: `/api/yahoo/chart/:symbol` and `/api/yahoo/search`; uses crumb+cookie session for Yahoo Finance auth
- **Note**: Yahoo Finance rate-limits Replit server IPs so the proxy may return 502 in the web preview. On native iOS/Android the app calls Yahoo Finance directly (no CORS), which works correctly.

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. Root `tsconfig.json` lists all packages as project references.

- **Always typecheck from root** — `pnpm run typecheck`
- **emitDeclarationOnly** — JS bundling handled by esbuild/tsx/vite
- **Project references** — cross-package imports need `references` in tsconfig

## Root Scripts

- `pnpm run build` — typecheck then build all packages
- `pnpm run typecheck` — `tsc --build --emitDeclarationOnly`

## Packages

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server. Entry: `src/index.ts`. Routes in `src/routes/`.

### `artifacts/mobile` (`@workspace/mobile`)

Expo SDK 53+ managed workflow app. Dev: `pnpm --filter @workspace/mobile run dev`

### `lib/db` (`@workspace/db`)

Drizzle ORM + PostgreSQL. Push schema: `pnpm --filter @workspace/db run push`

### `scripts` (`@workspace/scripts`)

Run scripts: `pnpm --filter @workspace/scripts exec tsx src/<script>.ts`
