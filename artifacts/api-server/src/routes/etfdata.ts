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

// ── ISIN-by-ticker cache (ticker → isin) ─────────────────────────────────────
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
};

// ── Core JustETF scraper ──────────────────────────────────────────────────────
async function fetchETFDataFromJustETF(isin: string): Promise<ETFData> {
  const cached = CACHE.get(isin);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  const empty: ETFData = {
    isin,
    ter: null,
    fundSize: null,
    replicationMethod: null,
    numberOfHoldings: null,
    launchDate: null,
    domicile: null,
    distributionPolicy: null,
    description: null,
  };

  try {
    const url = `https://www.justetf.com/en/etf-profile.html?isin=${isin}`;
    const res = await fetch(url, { headers: FETCH_HEADERS });

    if (!res.ok) {
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
        if (v > 0 && v < 3) {
          ter = v;
          break;
        }
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
      if (m && m[1]) {
        fundSize = `€${m[1].trim()}`;
        break;
      }
    }

    // ── Replication ──────────────────────────────────────────────────────────
    let replicationMethod: string | null = null;
    const replPatterns = [
      /Replication[^<]*<[^>]+>\s*(Physical|Synthetic|Optimised|Sampling)/i,
      /(Physical|Synthetic|Optimised|Sampling)\s+replication/i,
    ];
    for (const p of replPatterns) {
      const m = html.match(p);
      if (m && m[1]) {
        replicationMethod = m[1];
        break;
      }
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
      if (m && m[1]) {
        numberOfHoldings = parseInt(m[1]);
        break;
      }
    }

    // ── Launch Date — only search near the inception/launch label ───────────
    // The first date in the page is always the NAV date (recent), NOT the
    // fund launch date. We must anchor the search near the label.
    let launchDate: string | null = null;
    const inceptionSection =
      html.match(/(?:Fund\s+inception|inception\s+date|launch\s+date|fund\s+launch)[\s\S]{0,400}/i);
    if (inceptionSection) {
      const dateInSection = inceptionSection[0].match(/\b(\d{1,2}[./]\d{1,2}[./]\d{4})\b/);
      if (dateInSection) launchDate = dateInSection[1];
    }
    if (!launchDate) {
      const m = html.match(
        /(?:inception|launch\s+date)[^<]*<\/[^>]+>[^<]*<[^>]+>\s*(\d{1,2}[./]\d{1,2}[./]\d{4})\s*</i
      );
      if (m && m[1]) launchDate = m[1];
    }

    // ── Domicile — targeted: only look within ~200 chars of the label ────────
    let domicile: string | null = null;
    const DOMICILE_COUNTRIES =
      /Ireland|Luxembourg|Germany|France|Switzerland|Netherlands|Austria|Belgium|Sweden|Denmark|Norway|Finland|Poland|Liechtenstein/i;
    const domSection =
      html.match(/[Ff]und\s+domicile[\s\S]{1,250}/i) ||
      html.match(/[Dd]omicile[\s\S]{1,250}/i);
    if (domSection) {
      const inner = domSection[0];
      const m =
        inner.match(new RegExp(`>\\s*(${DOMICILE_COUNTRIES.source})\\s*<`, "i"));
      if (m && m[1]) domicile = m[1];
    }

    // ── Distribution Policy ──────────────────────────────────────────────────
    let distributionPolicy: string | null = null;
    const distPatterns = [
      /Distribution policy[^<]*<[^>]+>\s*(Accumulating|Distributing|Reinvesting)/i,
      /(Accumulating|Distributing)\s+ETF/i,
    ];
    for (const p of distPatterns) {
      const m = html.match(p);
      if (m && m[1]) {
        distributionPolicy = m[1];
        break;
      }
    }

    // ── Description — decode all HTML entities ───────────────────────────────
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
      isin,
      ter,
      fundSize,
      replicationMethod,
      numberOfHoldings,
      launchDate,
      domicile,
      distributionPolicy,
      description,
    };

    console.log(
      `[etfdata] ${isin}: TER=${ter}, Domicile=${domicile}, Repl=${replicationMethod}`
    );
    CACHE.set(isin, { data, fetchedAt: Date.now() });
    return data;
  } catch (err) {
    console.error(`[etfdata] Failed for ${isin}:`, err);
    CACHE.set(isin, { data: empty, fetchedAt: Date.now() });
    return empty;
  }
}

// ── Look up ISIN from JustETF search by ticker ───────────────────────────────
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
    // Extract all ISINs from JustETF search result hrefs
    const isinRegex = /isin=([A-Z]{2}[A-Z0-9]{10})/g;
    let match: RegExpExecArray | null;
    const isins: string[] = [];
    while ((match = isinRegex.exec(html)) !== null) {
      if (!isins.includes(match[1])) isins.push(match[1]);
    }

    if (isins.length === 0) return null;

    // Prefer the first ISIN where the ticker appears near it in the HTML
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

    // Fall back to first result
    const isin = isins[0];
    TICKER_ISIN_CACHE.set(tickerUpper, { isin, fetchedAt: Date.now() });
    return isin;
  } catch (err) {
    console.error(`[etfdata] ISIN lookup failed for ${ticker}:`, err);
    return null;
  }
}

// ── Extract Yahoo-compatible ticker from JustETF profile page ────────────────
async function resolveISINToTicker(isin: string): Promise<string | null> {
  try {
    const url = `https://www.justetf.com/en/etf-profile.html?isin=${isin}`;
    const res = await fetch(url, { headers: FETCH_HEADERS });
    if (!res.ok) return null;

    const html = await res.text();

    // JustETF profile pages have the listing tickers in the page
    // Look for ticker symbol patterns like VWCE, IWDA etc.
    const tickerPatterns = [
      /[Tt]icker(?:\s+symbol)?[^<]*<\/[^>]+>\s*<[^>]+>\s*([A-Z]{2,10})\s*</,
      /<title>\s*([A-Z]{2,10})\s*[|–\-]/,
      /symbol["\s]+:\s*["']([A-Z]{2,10})["']/,
    ];
    for (const p of tickerPatterns) {
      const m = html.match(p);
      if (m && m[1] && m[1].length >= 2 && m[1].length <= 8) {
        return m[1];
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

// Existing: lookup by ISIN directly
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

// New: lookup by Yahoo symbol — resolves ticker → ISIN → ETFData
router.get("/etf/by-symbol", async (req, res) => {
  const { symbol } = req.query as { symbol?: string };
  if (!symbol) return res.status(400).json({ error: "symbol required" });

  const ticker = symbol.split(".")[0].toUpperCase();

  const empty: ETFData = {
    isin: "",
    ter: null,
    fundSize: null,
    replicationMethod: null,
    numberOfHoldings: null,
    launchDate: null,
    domicile: null,
    distributionPolicy: null,
    description: null,
  };

  try {
    const isin = await lookupISINByTicker(ticker);
    if (!isin) return res.json(empty);

    const data = await fetchETFDataFromJustETF(isin);
    res.json({ ...data, isin });
  } catch (err) {
    console.error(`[etfdata] by-symbol failed for ${symbol}:`, err);
    res.json(empty);
  }
});

// New: resolve ISIN to Yahoo symbol + ETF data (used for ISIN search)
router.get("/etf/isin-resolve", async (req, res) => {
  const { isin } = req.query as { isin?: string };
  if (!isin || !/^[A-Za-z]{2}[A-Za-z0-9]{10}$/.test(isin)) {
    return res.status(400).json({ error: "Invalid ISIN" });
  }

  const upperIsin = isin.toUpperCase();

  try {
    // Try to extract a base ticker from the JustETF profile page
    const ticker = await resolveISINToTicker(upperIsin);

    // Also fetch ETF data while we're at it
    const etfData = await fetchETFDataFromJustETF(upperIsin);

    // Build likely Yahoo symbols to try based on ISIN country + ticker
    const country = upperIsin.substring(0, 2);
    const suffixes =
      country === "IE"
        ? [".DE", ".L", ".AS", ".MI"]
        : country === "LU"
        ? [".DE", ".AS"]
        : country === "DE"
        ? [".DE"]
        : country === "NL"
        ? [".AS", ".DE"]
        : country === "FR"
        ? [".PA", ".DE"]
        : [".DE", ".L", ".AS"];

    const candidates = ticker
      ? suffixes.map((s) => `${ticker}${s}`)
      : [];

    res.json({ isin: upperIsin, ticker, candidates, etfData });
  } catch (err) {
    console.error(`[etfdata] isin-resolve failed for ${upperIsin}:`, err);
    res.status(502).json({ error: "upstream error" });
  }
});

export default router;
