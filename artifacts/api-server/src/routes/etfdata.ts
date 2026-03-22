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
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

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
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (!res.ok) {
      CACHE.set(isin, { data: empty, fetchedAt: Date.now() });
      return empty;
    }

    const html = await res.text();

    // TER
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

    // Fund Size
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

    // Replication method
    let replicationMethod: string | null = null;
    const replPatterns = [
      /Replication[^<]*<[^>]+>\s*(Physical|Synthetic|Optimised|Sampling)/i,
      /(Physical|Synthetic|Optimised|Sampling)\s+replication/i,
    ];
    for (const p of replPatterns) {
      const m = html.match(p);
      if (m && m[1]) { replicationMethod = m[1]; break; }
    }

    // Number of holdings
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

    // Launch date
    let launchDate: string | null = null;
    const datePatterns = [
      /(\d{1,2}[.\-\/]\d{1,2}[.\-\/]\d{4})/,
      /inception[^>]*>[^<]*>([^<]+\d{4}[^<]*)</i,
      /(\w+ \d{4})/,
    ];
    for (const p of datePatterns) {
      const m = html.match(p);
      if (m && m[1]) { launchDate = m[1]; break; }
    }

    // Domicile
    let domicile: string | null = null;
    const domPatterns = [
      /domicile[^>]*>[^<]*>\s*([A-Za-z ]+?)\s*</i,
      /registered[^>]*>[^<]*>\s*(Ireland|Luxembourg|Germany|France|Switzerland|Netherlands)\s*</i,
      /\b(Ireland|Luxembourg|Germany|France|Switzerland|Netherlands)\b/,
    ];
    for (const p of domPatterns) {
      const m = html.match(p);
      if (m && m[1]) { domicile = m[1]; break; }
    }

    // Distribution policy
    let distributionPolicy: string | null = null;
    const distPatterns = [
      /Distribution policy[^<]*<[^>]+>\s*(Accumulating|Distributing|Reinvesting)/i,
      /(Accumulating|Distributing)\s+ETF/i,
    ];
    for (const p of distPatterns) {
      const m = html.match(p);
      if (m && m[1]) { distributionPolicy = m[1]; break; }
    }

    // Description — og:description first, then meta description
    let description: string | null = null;
    const descMatch = html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/i)
      || html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:description"/i)
      || html.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i)
      || html.match(/<meta[^>]+content="([^"]+)"[^>]+name="description"/i);
    if (descMatch && descMatch[1]) {
      description = descMatch[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"').trim();
      if (description.length > 300) description = description.substring(0, 300) + "…";
    }

    const data: ETFData = {
      isin, ter, fundSize, replicationMethod,
      numberOfHoldings, launchDate, domicile,
      distributionPolicy, description,
    };

    console.log(`[etfdata] ${isin}: TER=${ter}, Size=${fundSize}, Repl=${replicationMethod}`);
    CACHE.set(isin, { data, fetchedAt: Date.now() });
    return data;
  } catch (err) {
    console.error(`[etfdata] Failed for ${isin}:`, err);
    CACHE.set(isin, { data: empty, fetchedAt: Date.now() });
    return empty;
  }
}

router.get("/etf/ter/:isin", async (req, res) => {
  const { isin } = req.params;
  if (!isin || !/^[A-Z]{2}[A-Z0-9]{10}$/.test(isin)) {
    return res.status(400).json({ error: "Invalid ISIN" });
  }
  try {
    const data = await fetchETFDataFromJustETF(isin);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: "upstream error" });
  }
});

export default router;
