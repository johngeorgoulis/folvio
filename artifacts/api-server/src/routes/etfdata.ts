import { Router, type IRouter } from "express";

const router: IRouter = Router();

export interface ETFData {
  isin: string;
  ter: number | null;
  fundSize: string | null;
  replicationMethod: string | null;
  numberOfHoldings: number | null;
  launchDate: string | null;
  domicile: string | null;
  distributionPolicy: string | null;
  description: string | null;
}

const CACHE = new Map<string, { data: ETFData; fetchedAt: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const TICKER_ISIN_CACHE = new Map<string, { isin: string; fetchedAt: number }>();

// ── HTML entity decoder ───────────────────────────────────────────────────────
function decodeHTMLEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&ndash;/g, "\u2013")
    .replace(/&mdash;/g, "\u2014")
    .replace(/&nbsp;/g, " ")
    .replace(/&lsquo;/g, "\u2018")
    .replace(/&rsquo;/g, "\u2019")
    .replace(/&ldquo;/g, "\u201C")
    .replace(/&rdquo;/g, "\u201D")
    .replace(/&hellip;/g, "\u2026")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) =>
      String.fromCharCode(parseInt(code, 16))
    );
}

const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
};

const JSON_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
};

// ── Date helpers ──────────────────────────────────────────────────────────────
const MONTH_NAMES: Record<string, string> = {
  january:"01", february:"02", march:"03", april:"04", may:"05", june:"06",
  july:"07", august:"08", september:"09", october:"10", november:"11", december:"12",
  jan:"01", feb:"02", mar:"03", apr:"04", jun:"06", jul:"07", aug:"08",
  sep:"09", oct:"10", nov:"11", dec:"12",
};

// Parse "21 May 2013" or "21/05/2013" → "21/05/2013"; rejects years ≥ current year.
function parseHistoricDate(s: string): string | null {
  const m = s.match(/\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/);
  if (!m) return null;
  const year = parseInt(m[3], 10);
  const currentYear = new Date().getFullYear();
  if (year < 1990 || year >= currentYear) return null;
  return s;
}

function parseFriendlyDate(s: string): string | null {
  // "21 May 2013" or "21 may 2013"
  const m = s.trim().match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (!m) return null;
  const day   = m[1].padStart(2, "0");
  const month = MONTH_NAMES[m[2].toLowerCase()];
  const year  = parseInt(m[3], 10);
  const currentYear = new Date().getFullYear();
  if (!month || year < 1990 || year >= currentYear) return null;
  return `${day}/${month}/${m[3]}`;
}

// ── Core JustETF scraper ──────────────────────────────────────────────────────
async function fetchETFDataFromJustETF(isin: string): Promise<ETFData> {
  const cached = CACHE.get(isin);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  const empty: ETFData = {
    isin, ter: null, fundSize: null, replicationMethod: null,
    numberOfHoldings: null, launchDate: null, domicile: null,
    distributionPolicy: null, description: null,
  };

  try {
    const url = `https://www.justetf.com/en/etf-profile.html?isin=${isin}`;
    const res = await fetch(url, { headers: FETCH_HEADERS });

    if (!res.ok) {
      console.warn(`[etfdata] JustETF returned ${res.status} for ${isin}`);
      CACHE.set(isin, { data: empty, fetchedAt: Date.now() });
      return empty;
    }

    const html = await res.text();

    // ── TER ──────────────────────────────────────────────────────────────────
    let ter: number | null = null;
    const terPatterns = [
      /Total expense ratio[^<]*<[^>]+>\s*([\d.]+)\s*%/i,
      /TER[^<]*<[^>]+>\s*([\d.]+)\s*%/i,
      /([\d.]+)\s*%\s*p\.a\./i,
    ];
    for (const p of terPatterns) {
      const m = html.match(p);
      if (m && m[1]) {
        const v = parseFloat(m[1]);
        if (v > 0 && v < 3) { ter = v; break; }
      }
    }

    // ── Fund Size ────────────────────────────────────────────────────────────
    let fundSize: string | null = null;
    const sizePatterns = [
      /(\d[\d,. ]+)\s*(?:million|bn|billion|m|b)?\s*EUR/i,
      /EUR\s*([\d,. ]+\s*(?:million|bn|billion)?)/i,
      /fund[- ]size[^>]*>[^<]*([\d,.]+\s*(?:EUR|billion|million|bn|m)?)/i,
      />\s*([\d,.]+)\s*(?:EUR\s*)?(?:million|billion|bn)\s*</i,
    ];
    for (const p of sizePatterns) {
      const m = html.match(p);
      if (m && m[1]) { fundSize = `€${m[1].trim()}`; break; }
    }

    // ── Replication ──────────────────────────────────────────────────────────
    let replicationMethod: string | null = null;
    const replPatterns = [
      /Replication[^<]*<[^>]+>\s*(Physical|Synthetic|Optimised|Sampling)/i,
      /(Physical|Synthetic|Optimised|Sampling)\s+replication/i,
    ];
    for (const p of replPatterns) {
      const m = html.match(p);
      if (m && m[1]) { replicationMethod = m[1]; break; }
    }

    // ── Number of Holdings ───────────────────────────────────────────────────
    let numberOfHoldings: number | null = null;
    const holdPatterns = [
      />(\d{1,5})\s*(?:holdings|constituents|components)</i,
      /number[- ]of[- ]holdings[^>]*>[^<]*>(\d+)</i,
      /(\d+)\s*positions/i,
    ];
    for (const p of holdPatterns) {
      const m = html.match(p);
      if (m && m[1]) { numberOfHoldings = parseInt(m[1]); break; }
    }

    // ── Launch Date ───────────────────────────────────────────────────────────
    // JustETF profile pages render the launch date in a specific element with
    // data-testid="tl_etf-basics_value_launch-date" (also in the header as
    // data-testid="etf-profile-header_inception-date-value").
    // The date format is "21 May 2013" (day MonthName year), not dd/mm/yyyy.
    let launchDate: string | null = null;

    // Primary: data-testid attribute (most specific, never matches NAV dates)
    const dateTestIdMatch =
      html.match(/data-testid="tl_etf-basics_value_launch-date">([^<]+)/) ||
      html.match(/data-testid="etf-profile-header_inception-date-value">([^<]+)/);
    if (dateTestIdMatch) {
      const raw = dateTestIdMatch[1].trim();
      // Validate: must contain a month name and a historic year
      const parsed = parseFriendlyDate(raw);
      if (parsed) launchDate = parsed;
    }

    // Fallback: look for "dd Month yyyy" within 200 chars of a table inception label
    if (!launchDate) {
      const inceptionSection = html.match(/Fund\s+inception[\s\S]{0,200}/i);
      if (inceptionSection) {
        const dateMatch = inceptionSection[0].match(/\b(\d{1,2}\s+[A-Za-z]+\s+\d{4}|\d{1,2}[./]\d{1,2}[./]\d{4})\b/g);
        if (dateMatch) {
          for (const d of dateMatch) {
            const parsed = parseFriendlyDate(d) || parseHistoricDate(d);
            if (parsed) { launchDate = parsed; break; }
          }
        }
      }
    }

    // ── Domicile ─────────────────────────────────────────────────────────────
    // Only look within 250 chars of the "Fund domicile" or "Domicile" label.
    let domicile: string | null = null;
    const DOMICILE_COUNTRIES =
      /Ireland|Luxembourg|Germany|France|Switzerland|Netherlands|Austria|Belgium|Sweden|Denmark|Norway|Finland|Poland|Liechtenstein/i;
    const domSection =
      html.match(/[Ff]und\s+domicile[\s\S]{1,250}/i) ||
      html.match(/[Dd]omicile[\s\S]{1,250}/i);
    if (domSection) {
      const m = domSection[0].match(
        new RegExp(`>\\s*(${DOMICILE_COUNTRIES.source})\\s*<`, "i")
      );
      if (m && m[1]) domicile = m[1];
    }

    // ── Distribution Policy ───────────────────────────────────────────────────
    // JustETF renders the distribution policy in elements with specific
    // data-testid attributes. This is reliable and never false-matches.
    let distributionPolicy: string | null = null;

    // Primary: data-testid (most reliable — exact element, no ambiguity)
    const distTestIdMatch =
      html.match(/data-testid="tl_etf-basics_value_distribution-policy">([^<]+)/) ||
      html.match(/data-testid="etf-profile-header_distribution-policy-value">([^<]+)/);
    if (distTestIdMatch) {
      const raw = distTestIdMatch[1].trim();
      if (/^(Accumulating|Distributing|Reinvesting)$/i.test(raw)) {
        distributionPolicy = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
      }
    }

    // Fallback: og:description / page title contain the policy word
    if (!distributionPolicy) {
      const metaMatch =
        html.match(/<title>[^<]*(Accumulating|Distributing)[^<]*<\/title>/i) ||
        html.match(/content="[^"]*(Accumulating|Distributing)[^"]*"/i);
      if (metaMatch && metaMatch[1]) {
        distributionPolicy = metaMatch[1].charAt(0).toUpperCase() + metaMatch[1].slice(1).toLowerCase();
      }
    }

    // ── Description ──────────────────────────────────────────────────────────
    let description: string | null = null;
    const descMatch =
      html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/i) ||
      html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:description"/i) ||
      html.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i) ||
      html.match(/<meta[^>]+content="([^"]+)"[^>]+name="description"/i);
    if (descMatch && descMatch[1]) {
      description = decodeHTMLEntities(descMatch[1]).trim();
      if (description.length > 300) description = description.substring(0, 300) + "…";
    }

    const data: ETFData = {
      isin, ter, fundSize, replicationMethod, numberOfHoldings,
      launchDate, domicile, distributionPolicy, description,
    };

    console.log(
      `[etfdata] ${isin}: TER=${ter}, Domicile=${domicile}, Dist=${distributionPolicy}, Inception=${launchDate}`
    );
    CACHE.set(isin, { data, fetchedAt: Date.now() });
    return data;
  } catch (err) {
    console.error(`[etfdata] Failed for ${isin}:`, err);
    CACHE.set(isin, { data: empty, fetchedAt: Date.now() });
    return empty;
  }
}

// ── Static ISIN map for common UCITS ETFs ─────────────────────────────────────
// Server-side APIs (Yahoo Finance, JustETF search) are rate-limited from Replit.
// For the most frequently looked-up non-portfolio ETFs, hardcode the ISIN so the
// server can go straight to the JustETF profile page without any ISIN discovery.
const STATIC_ISIN_MAP: Record<string, string> = {
  // ── Vanguard ─────────────────────────────────────────────────────────────
  VHYL:   "IE00B8GKDB10",   // FTSE All-World High Dividend Yield (Distributing)
  VUAA:   "IE00BFMXXD54",   // S&P 500 (USD) Accumulating
  VHVG:   "IE00B3XXRP09",   // S&P 500 (USD) Distributing
  VWRL:   "IE00B3RBWM25",   // FTSE All-World (Distributing) — XETRA ticker VGWD
  VGWD:   "IE00B3RBWM25",
  VWCE:   "IE00BK5BQT80",   // FTSE All-World (Accumulating) — LSE ticker VWRP
  VWRP:   "IE00BK5BQT80",
  VAGP:   "IE00B3RBWM25",   // alias
  // ── iShares (BlackRock) ───────────────────────────────────────────────────
  IWDA:   "IE00B4L5Y983",   // Core MSCI World (Acc) — same fund, three tickers
  SWDA:   "IE00B4L5Y983",
  EUNL:   "IE00B4L5Y983",
  CSPX:   "IE00B5BMR087",   // Core S&P 500 (USD Acc) — LSE
  SXR8:   "IE00B5BMR087",   // same fund — XETRA ticker
  IUSA:   "IE0031442068",   // S&P 500 (USD) Distributing
  EIMI:   "IE00BKM4GZ66",   // Core MSCI EM IMI (Acc)
  IS3N:   "IE00BKM4GZ66",
  IQQH:   "IE00B1XNHC34",   // Global Clean Energy
  INRG:   "IE00B1XNHC34",
  AGGH:   "IE00BDBRDM35",   // Core Global Aggregate Bond (EUR Hdg)
  IGLA:   "IE00B3F81R35",   // $ Treasury Bond 7-10yr
  // ── Xtrackers (DWS) ──────────────────────────────────────────────────────
  XDWD:   "IE00BJ0KDQ92",   // MSCI World Swap (Acc)
  XMAW:   "IE00BJ0KDQ92",
  // ── Amundi ───────────────────────────────────────────────────────────────
  LCWD:   "LU1781541179",   // MSCI World ESG Filtered
  CW8:    "LU1681043599",   // MSCI World (Acc)
  // ── SPDR ─────────────────────────────────────────────────────────────────
  SPYD:   "IE000RHYOR98",   // Portfolio S&P 500 High Div
};

// ── ISIN lookup via Yahoo Finance quote API (server-side) ─────────────────────
// Yahoo Finance's v7 quote endpoint returns `isin` for UCITS ETFs.
async function lookupISINFromYahoo(yahooSymbol: string): Promise<string | null> {
  try {
    const url = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(yahooSymbol)}`;
    const res = await fetch(url, { headers: JSON_HEADERS });
    if (!res.ok) {
      console.warn(`[etfdata] Yahoo quote API ${res.status} for ${yahooSymbol}`);
      return null;
    }
    const data = await res.json();
    const quote = data?.quoteResponse?.result?.[0];
    const isin = quote?.isin;
    if (typeof isin === "string" && /^[A-Z]{2}[A-Z0-9]{10}$/.test(isin)) {
      console.log(`[etfdata] Yahoo ISIN for ${yahooSymbol}: ${isin}`);
      return isin;
    }
    return null;
  } catch (err) {
    console.warn(`[etfdata] Yahoo ISIN lookup failed for ${yahooSymbol}:`, err);
    return null;
  }
}

// ── ISIN lookup via JustETF search HTML (fallback) ────────────────────────────
// JustETF's search page is mostly JS-rendered, but profile hrefs sometimes
// survive in the initial HTML or SSR markup.
async function lookupISINByTicker(ticker: string): Promise<string | null> {
  const cached = TICKER_ISIN_CACHE.get(ticker.toUpperCase());
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.isin;
  }

  try {
    const url = `https://www.justetf.com/en/search.html?search=ETFS&query=${encodeURIComponent(ticker)}`;
    const res = await fetch(url, { headers: FETCH_HEADERS });
    if (!res.ok) return null;

    const html = await res.text();
    const isinRegex = /isin=([A-Z]{2}[A-Z0-9]{10})/g;
    let match: RegExpExecArray | null;
    const isins: string[] = [];
    while ((match = isinRegex.exec(html)) !== null) {
      if (!isins.includes(match[1])) isins.push(match[1]);
    }

    console.log(`[etfdata] JustETF search for "${ticker}" found ISINs: ${isins.join(", ") || "none"}`);
    if (isins.length === 0) return null;

    const tickerUpper = ticker.toUpperCase();
    for (const isin of isins) {
      const idx = html.indexOf(isin);
      if (idx === -1) continue;
      const surrounding = html.substring(Math.max(0, idx - 300), idx + 300);
      if (
        surrounding.includes(`>${tickerUpper}<`) ||
        surrounding.includes(`"${tickerUpper}"`) ||
        surrounding.includes(` ${tickerUpper} `)
      ) {
        TICKER_ISIN_CACHE.set(tickerUpper, { isin, fetchedAt: Date.now() });
        return isin;
      }
    }

    const isin = isins[0];
    TICKER_ISIN_CACHE.set(tickerUpper, { isin, fetchedAt: Date.now() });
    return isin;
  } catch (err) {
    console.error(`[etfdata] ISIN lookup failed for ${ticker}:`, err);
    return null;
  }
}

// ── Extract ticker from JustETF profile page ──────────────────────────────────
async function resolveISINToTicker(isin: string): Promise<string | null> {
  try {
    const url = `https://www.justetf.com/en/etf-profile.html?isin=${isin}`;
    const res = await fetch(url, { headers: FETCH_HEADERS });
    if (!res.ok) return null;
    const html = await res.text();
    const tickerPatterns = [
      /[Tt]icker(?:\s+symbol)?[^<]*<\/[^>]+>\s*<[^>]+>\s*([A-Z]{2,10})\s*</,
      /<title>\s*([A-Z]{2,10})\s*[|–\-]/,
      /symbol["\s]+:\s*["']([A-Z]{2,10})["']/,
    ];
    for (const p of tickerPatterns) {
      const m = html.match(p);
      if (m && m[1] && m[1].length >= 2 && m[1].length <= 8) return m[1];
    }
    return null;
  } catch {
    return null;
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

// Lookup by ISIN directly (portfolio path)
router.get("/etf/ter/:isin", async (req, res) => {
  const { isin } = req.params;
  if (!isin || !/^[A-Z]{2}[A-Z0-9]{10}$/.test(isin)) {
    return res.status(400).json({ error: "Invalid ISIN" });
  }
  try {
    const data = await fetchETFDataFromJustETF(isin);
    res.json(data);
  } catch {
    res.status(502).json({ error: "upstream error" });
  }
});

// Lookup by Yahoo symbol — three-step ISIN resolution:
//   1. Yahoo Finance v7 quote API  (most reliable for UCITS ETFs)
//   2. JustETF HTML search         (fallback, works when Yahoo fails)
router.get("/etf/by-symbol", async (req, res) => {
  const { symbol } = req.query as { symbol?: string };
  if (!symbol) return res.status(400).json({ error: "symbol required" });

  const ticker = symbol.split(".")[0].toUpperCase();
  const empty: ETFData = {
    isin: "", ter: null, fundSize: null, replicationMethod: null,
    numberOfHoldings: null, launchDate: null, domicile: null,
    distributionPolicy: null, description: null,
  };

  try {
    // Step 0: Static map — instant, no network calls, no rate limiting
    let isin: string | null = STATIC_ISIN_MAP[ticker] ?? null;
    if (isin) {
      console.log(`[etfdata] Static ISIN for ${ticker}: ${isin}`);
    }

    // Step 1: Try Yahoo Finance for ISIN (server-side call, often rate-limited)
    if (!isin) isin = await lookupISINFromYahoo(symbol);

    // Step 2: Fall back to JustETF HTML search (works if page is SSR)
    if (!isin) isin = await lookupISINByTicker(ticker);

    if (!isin) {
      console.warn(`[etfdata] Could not find ISIN for ${symbol}`);
      return res.json(empty);
    }

    const data = await fetchETFDataFromJustETF(isin);
    res.json({ ...data, isin });
  } catch (err) {
    console.error(`[etfdata] by-symbol failed for ${symbol}:`, err);
    res.json(empty);
  }
});

// Resolve ISIN → Yahoo symbol candidates + ETF data (used for ISIN search)
router.get("/etf/isin-resolve", async (req, res) => {
  const { isin } = req.query as { isin?: string };
  if (!isin || !/^[A-Za-z]{2}[A-Za-z0-9]{10}$/.test(isin)) {
    return res.status(400).json({ error: "Invalid ISIN" });
  }
  const upperIsin = isin.toUpperCase();
  try {
    const ticker = await resolveISINToTicker(upperIsin);
    const etfData = await fetchETFDataFromJustETF(upperIsin);
    const country = upperIsin.substring(0, 2);
    const suffixes =
      country === "IE" ? [".DE", ".L", ".AS", ".MI"] :
      country === "LU" ? [".DE", ".AS"] :
      country === "DE" ? [".DE"] :
      country === "NL" ? [".AS", ".DE"] :
      country === "FR" ? [".PA", ".DE"] :
      [".DE", ".L", ".AS"];
    const candidates = ticker ? suffixes.map(s => `${ticker}${s}`) : [];
    res.json({ isin: upperIsin, ticker, candidates, etfData });
  } catch (err) {
    console.error(`[etfdata] isin-resolve failed for ${upperIsin}:`, err);
    res.status(502).json({ error: "upstream error" });
  }
});

export default router;
