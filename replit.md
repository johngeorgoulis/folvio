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
│   └── mobile/             # Expo React Native app (Fortis)
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

## Fortis Mobile App (`artifacts/mobile`)

European UCITS ETF portfolio tracker built with Expo (managed workflow).

### Design System
- **Theme**: Dark blue (#1E3A5F) primary, gold (#C9A84C) accent, dark background (#0A0F1A)
- **Font**: Inter (400, 500, 600, 700)
- **Persistence**: expo-sqlite (local only, no backend in v1)

### Screens
- **Dashboard** (`/`) — total portfolio value, allocation donut chart, stats
- **Holdings** (`/holdings`) — list of all holdings, tap for detail, add new
- **Holding Detail** (`/holding/[id]`) — full breakdown, edit, delete
- **Performance** (`/performance`) — return stats, 10-year projections, dividend estimates
- **Settings** (`/settings`) — display prefs, premium status, about

### Free Tier Logic
- Max **10 holdings** in free tier
- On 11th add attempt: shows PremiumModal (RevenueCat paywall stub)
- Premium unlocks: unlimited holdings, CSV export, benchmark comparison

### RevenueCat (Monetization)
- **Status**: NOT configured — user dismissed the integration
- `react-native-purchases` and `replit-revenuecat-v2` are installed in the root workspace
- To set up: connect the RevenueCat integration in Replit, then run the seed script at `scripts/src/seedRevenueCat.ts`
- The PremiumModal currently shows a "Coming Soon" stub — wire up real purchases once RevenueCat is connected

### Data Layer
- `services/database.ts` — SQLite helpers using `expo-sqlite`
- `context/PortfolioContext.tsx` — React context wrapping DB calls, exposes holdings + computed values
- Tables: `holdings`, `prices_cache`

### Key Files
- `app/_layout.tsx` — root layout, stack navigator, providers
- `app/(tabs)/_layout.tsx` — tab bar (Dashboard, Holdings, Performance, Settings)
- `constants/colors.ts` — full theme (light + dark)
- `utils/format.ts` — EUR formatting (de-DE locale), date helpers

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
