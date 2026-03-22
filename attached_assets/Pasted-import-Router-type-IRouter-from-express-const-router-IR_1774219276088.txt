import { Router, type IRouter } from "express";

const router: IRouter = Router();

const CACHE = new Map<string, { ter: number | null; fetchedAt: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

async function fetchTERFromJustETF(isin: string): Promise<number | null> {
  const cached = CACHE.get(isin);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.ter;
  }

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
      CACHE.set(isin, { ter: null, fetchedAt: Date.now() });
      return null;
    }

    const html = await res.text();

    // JustETF shows TER as "0.22% p.a." in the page
    // Try multiple patterns
    const patterns = [
      /Total expense ratio[^<]*<[^>]+>\s*([\d.]+)\s*%/i,
      /TER[^<]*<[^>]+>\s*([\d.]+)\s*%/i,
      /"ter"[^:]*:\s*"?([\d.]+)"?/i,
      /class="ter[^"]*"[^>]*>\s*([\d.]+)\s*%/i,
      /([\d.]+)\s*%\s*p\.a\./i,
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        const ter = parseFloat(match[1]);
        if (ter > 0 && ter < 3) {
          CACHE.set(isin, { ter, fetchedAt: Date.now() });
          console.log(`[etfdata] TER for ${isin}: ${ter}%`);
          return ter;
        }
      }
    }

    CACHE.set(isin, { ter: null, fetchedAt: Date.now() });
    return null;
  } catch (err) {
    console.error(`[etfdata] Failed to fetch TER for ${isin}:`, err);
    return null;
  }
}

router.get("/etf/ter/:isin", async (req, res) => {
  const { isin } = req.params;
  if (!isin || !/^[A-Z]{2}[A-Z0-9]{10}$/.test(isin)) {
    return res.status(400).json({ error: "Invalid ISIN" });
  }
  try {
    const ter = await fetchTERFromJustETF(isin);
    res.json({ isin, ter });
  } catch (err) {
    console.error("[etf/ter] error:", err);
    res.status(502).json({ error: "upstream error" });
  }
});

export default router;
