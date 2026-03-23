/**
 * Fortis ETF Database Service
 *
 * Provides instant local search over the bundled ETF database.
 * Handles background updates from a remote URL (GitHub Gist).
 *
 * Load order:
 *   1. Load bundled etf-database.json (always available)
 *   2. Check AsyncStorage for a newer downloaded version
 *   3. On first load per session (max once per 24h) check remote URL in background
 *      → if newer version found, download & cache silently
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

// ── Types ─────────────────────────────────────────────────────────────────────
export interface ETFEntry {
  isin: string;
  ticker: string;
  name: string;
  shortName: string;
  assetClass: "Equity" | "Bonds" | "Commodities" | "Real Estate" | "Money Market" | string;
  ter: number | null;
  distribution: string | null;
  replication: string | null;
  currency: string;
  domicile: string | null;
  inceptionDate: string | null;
  fundSize: number | null;
  exchanges: string[];
  primaryTicker: string;
  justETFUrl: string;
}

export interface ETFDatabase {
  version: string;
  generatedAt: string;
  count: number;
  etfs: ETFEntry[];
}

export interface ETFSearchResult extends ETFEntry {
  matchType: "isin" | "ticker" | "name";
  score: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const ASYNC_KEY_DB      = "fortis_etf_database";
const ASYNC_KEY_VERSION = "fortis_etf_db_version";
const ASYNC_KEY_LAST_CHECK = "fortis_etf_db_last_check";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const FETCH_TIMEOUT_MS  = 5_000;

// Replace with your actual GitHub Gist raw URL after setup (Step 7).
const REMOTE_DB_URL =
  "https://raw.githubusercontent.com/your-username/fortis-etf-db/main/etf-database.json";

// ── Module state ──────────────────────────────────────────────────────────────
let _db: ETFDatabase | null = null;
let _isinMap = new Map<string, ETFEntry>();
let _tickerMap = new Map<string, ETFEntry>();
let _allEntries: ETFEntry[] = [];
let _initialized = false;
let _initPromise: Promise<void> | null = null;

// ── Bundled database ──────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-var-requires
const BUNDLED_DB: ETFDatabase = require("../assets/etf-database.json");

// ── Initialization ────────────────────────────────────────────────────────────
function buildIndex(db: ETFDatabase) {
  _db = db;
  _isinMap.clear();
  _tickerMap.clear();
  _allEntries = db.etfs;
  for (const etf of db.etfs) {
    _isinMap.set(etf.isin.toUpperCase(), etf);
    _tickerMap.set(etf.ticker.toUpperCase(), etf);
    // Also index all exchanges listed (ticker prefixes differ by exchange)
    // e.g. VWCE on XETRA = VWCE.DE — allow search by bare ticker
    const bareTicker = etf.primaryTicker.split(".")[0];
    if (bareTicker && bareTicker !== etf.ticker) {
      _tickerMap.set(bareTicker.toUpperCase(), etf);
    }
  }
  _initialized = true;
}

export async function initETFDatabase(): Promise<void> {
  if (_initialized) return;
  if (_initPromise) return _initPromise;
  _initPromise = _init();
  return _initPromise;
}

async function _init() {
  // Try cached (downloaded) version first
  try {
    const [cachedJson, cachedVersion] = await Promise.all([
      AsyncStorage.getItem(ASYNC_KEY_DB),
      AsyncStorage.getItem(ASYNC_KEY_VERSION),
    ]);
    if (cachedJson) {
      const cached: ETFDatabase = JSON.parse(cachedJson);
      // Use cached only if its version is >= bundled version
      const bundledVer = parseInt(BUNDLED_DB.version.replace(/\D/g, ""), 10) || 0;
      const cachedVer  = parseInt((cachedVersion || "0").replace(/\D/g, ""), 10) || 0;
      if (cachedVer >= bundledVer && cached.etfs?.length > 0) {
        buildIndex(cached);
        _triggerBackgroundUpdate(); // check for even newer version
        return;
      }
    }
  } catch {
    // ignore
  }
  // Fall back to bundled
  buildIndex(BUNDLED_DB);
  _triggerBackgroundUpdate();
}

// ── Background update ─────────────────────────────────────────────────────────
let _updateTriggered = false;
let _onUpdateCallback: ((msg: string) => void) | null = null;

export function setUpdateCallback(cb: (msg: string) => void) {
  _onUpdateCallback = cb;
}

function _triggerBackgroundUpdate() {
  if (_updateTriggered) return;
  _updateTriggered = true;
  _backgroundUpdate().catch(() => {});
}

async function _backgroundUpdate() {
  // Rate-limit: once per 24h
  try {
    const lastCheck = await AsyncStorage.getItem(ASYNC_KEY_LAST_CHECK);
    if (lastCheck) {
      const elapsed = Date.now() - parseInt(lastCheck, 10);
      if (elapsed < CHECK_INTERVAL_MS) return;
    }
  } catch { return; }

  // Timeout wrapper
  async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
      return await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  try {
    await AsyncStorage.setItem(ASYNC_KEY_LAST_CHECK, Date.now().toString());

    const res = await fetchWithTimeout(REMOTE_DB_URL, FETCH_TIMEOUT_MS);
    if (!res.ok) return;

    const remote: ETFDatabase = await res.json();
    if (!remote?.version || !Array.isArray(remote.etfs)) return;

    const currentVersion = _db?.version || BUNDLED_DB.version;

    // Compare using proper semver so "1.12" is never treated as > "2.0".
    // Trigger a download whenever the remote version differs from what we have
    // (either direction triggers; this is intentional — Gist is source of truth).
    if (remote.version === currentVersion) return; // already up to date

    // Only install if remote is strictly newer (prevents accidental downgrade).
    function semverGt(a: string, b: string): boolean {
      const pa = a.split(".").map(s => parseInt(s, 10) || 0);
      const pb = b.split(".").map(s => parseInt(s, 10) || 0);
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const na = pa[i] ?? 0, nb = pb[i] ?? 0;
        if (na > nb) return true;
        if (na < nb) return false;
      }
      return false;
    }
    if (!semverGt(remote.version, currentVersion)) return;

    // Apply update
    await Promise.all([
      AsyncStorage.setItem(ASYNC_KEY_DB, JSON.stringify(remote)),
      AsyncStorage.setItem(ASYNC_KEY_VERSION, remote.version),
    ]);
    buildIndex(remote);

    if (_onUpdateCallback) {
      _onUpdateCallback("ETF database updated");
    }
  } catch {
    // Silently fail — network error or timeout
  }
}

// ── Search ────────────────────────────────────────────────────────────────────
const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{10}$/;

export function searchETFDatabase(query: string, maxResults = 10): ETFSearchResult[] {
  if (!_initialized || !query || query.length < 2) return [];
  const q = query.trim().toUpperCase();
  const results: ETFSearchResult[] = [];
  const seen = new Set<string>();

  function push(entry: ETFEntry, matchType: ETFSearchResult["matchType"], score: number) {
    if (seen.has(entry.isin)) return;
    seen.add(entry.isin);
    results.push({ ...entry, matchType, score });
  }

  // 1. Exact ISIN match
  if (ISIN_RE.test(q)) {
    const match = _isinMap.get(q);
    if (match) push(match, "isin", 1000);
  }

  // 2. Exact ticker match
  const tickerExact = _tickerMap.get(q);
  if (tickerExact) push(tickerExact, "ticker", 900);

  // 3. Ticker starts-with
  for (const [ticker, entry] of _tickerMap) {
    if (results.length >= maxResults) break;
    if (ticker.startsWith(q) && ticker !== q) push(entry, "ticker", 800 - ticker.length);
  }

  // 4. ISIN starts-with (partial ISIN typed)
  if (q.length >= 4) {
    for (const [isin, entry] of _isinMap) {
      if (results.length >= maxResults) break;
      if (isin.startsWith(q) && isin !== q) push(entry, "isin", 750);
    }
  }

  // 5. Name contains (case-insensitive)
  const qLower = q.toLowerCase();
  for (const entry of _allEntries) {
    if (results.length >= maxResults) break;
    const nameLower = entry.name.toLowerCase();
    if (nameLower.includes(qLower)) {
      const score = nameLower.startsWith(qLower) ? 700 : 600;
      push(entry, "name", score);
    }
  }

  // 6. Short name contains
  for (const entry of _allEntries) {
    if (results.length >= maxResults) break;
    if (entry.shortName.toLowerCase().includes(qLower)) {
      push(entry, "name", 500);
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, maxResults);
}

/** Look up a single ETF by ISIN. Returns null if not in local DB. */
export function lookupByISIN(isin: string): ETFEntry | null {
  return _isinMap.get(isin.toUpperCase()) ?? null;
}

/** Look up a single ETF by ticker (bare, e.g. "VWCE"). Returns null if not in local DB. */
export function lookupByTicker(ticker: string): ETFEntry | null {
  return _tickerMap.get(ticker.toUpperCase()) ?? null;
}

/** Whether the database has been initialized. */
export function isDBReady(): boolean {
  return _initialized;
}

/** Count of ETFs in the current database. */
export function dbCount(): number {
  return _allEntries.length;
}
