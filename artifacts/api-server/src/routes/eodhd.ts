import { Router, type IRouter } from "express";

const EODHD_BASE = "https://eodhd.com/api";

function apiKey(): string {
  const key = process.env.EODHD_API_KEY ?? "";
  if (!key) console.warn("[eodhd] EODHD_API_KEY is not set");
  return key;
}

const router: IRouter = Router();

/**
 * GET /api/eodhd/real-time/:symbol
 * Proxies EODHD real-time quote. Key stays server-side.
 */
router.get("/eodhd/real-time/:symbol", async (req, res) => {
  const { symbol } = req.params;
  const key = apiKey();
  if (!key) {
    res.status(503).json({ error: "Price service unavailable" });
    return;
  }
  try {
    const url = `${EODHD_BASE}/real-time/${encodeURIComponent(symbol)}?api_token=${key}&fmt=json`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const r = await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
    if (!r.ok) {
      res.status(r.status).json({ error: "upstream error" });
      return;
    }
    res.json(await r.json());
  } catch (err) {
    console.error("[eodhd/real-time] error:", err);
    res.status(502).json({ error: "upstream error" });
  }
});

/**
 * GET /api/eodhd/eod/:symbol?from=YYYY-MM-DD
 * Proxies EODHD end-of-day historical bars. Key stays server-side.
 */
router.get("/eodhd/eod/:symbol", async (req, res) => {
  const { symbol } = req.params;
  const { from } = req.query as Record<string, string>;
  const key = apiKey();
  if (!key) {
    res.status(503).json({ error: "Price service unavailable" });
    return;
  }

  const safeFrom = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : "";
  const fromParam = safeFrom ? `&from=${safeFrom}` : "";

  try {
    const url = `${EODHD_BASE}/eod/${encodeURIComponent(symbol)}?api_token=${key}&fmt=json${fromParam}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    const r = await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
    if (!r.ok) {
      res.status(r.status).json({ error: "upstream error" });
      return;
    }
    res.json(await r.json());
  } catch (err) {
    console.error("[eodhd/eod] error:", err);
    res.status(502).json({ error: "upstream error" });
  }
});

export default router;
