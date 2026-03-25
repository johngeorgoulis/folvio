import { Router, type IRouter } from "express";

// FMP has migrated from /api/v3/ to /stable/ endpoints (August 2025).
// Historical price endpoints require a paid plan; profile works on all tiers.
const FMP_BASE = "https://financialmodelingprep.com/stable";

function apiKey(): string {
  const key = process.env.FMP_API_KEY ?? "";
  if (!key) console.warn("[fmp] FMP_API_KEY is not set");
  return key;
}

const router: IRouter = Router();

/**
 * GET /api/fmp/profile/:symbol
 * Returns current price, change, changePercentage, volume, currency, ISIN,
 * exchange, isEtf, ipoDate, range (yearLow–yearHigh).
 * This endpoint works for all symbols including European ETFs (.DE .AS .PA .L .SW).
 */
router.get("/fmp/profile/:symbol", async (req, res) => {
  const { symbol } = req.params;
  try {
    const url = `${FMP_BASE}/profile?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey()}`;
    const r = await fetch(url);
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      console.warn(`[fmp/profile] ${r.status} for ${symbol}:`, body.substring(0, 200));
      res.status(r.status).json({ error: "FMP upstream error", status: r.status });
      return;
    }
    res.json(await r.json());
  } catch (err) {
    console.error("[fmp/profile] error:", err);
    res.status(502).json({ error: "upstream error" });
  }
});

/**
 * GET /api/fmp/quote/:symbol
 * Quote snapshot — works for US-listed symbols on the free tier.
 * For European ETFs, use /fmp/profile/:symbol instead.
 */
router.get("/fmp/quote/:symbol", async (req, res) => {
  const { symbol } = req.params;
  try {
    const url = `${FMP_BASE}/quote?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey()}`;
    const r = await fetch(url);
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      console.warn(`[fmp/quote] ${r.status} for ${symbol}:`, body.substring(0, 200));
      res.status(r.status).json({ error: "FMP upstream error", status: r.status });
      return;
    }
    res.json(await r.json());
  } catch (err) {
    console.error("[fmp/quote] error:", err);
    res.status(502).json({ error: "upstream error" });
  }
});

export default router;
