import { Router, type IRouter } from "express";

const router: IRouter = Router();

const BASE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  Origin: "https://finance.yahoo.com",
  Referer: "https://finance.yahoo.com/",
};

let sessionCookie = "";
let crumb = "";
let sessionFetchedAt = 0;
const SESSION_TTL_MS = 55 * 60 * 1000;

async function refreshSession(): Promise<void> {
  const pageRes = await fetch("https://finance.yahoo.com/", {
    headers: {
      "User-Agent": BASE_HEADERS["User-Agent"],
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    redirect: "follow",
  });
  const setCookie = pageRes.headers.get("set-cookie") ?? "";
  sessionCookie = setCookie
    .split(",")
    .map((c) => c.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");

  const crumbRes = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
    headers: { ...BASE_HEADERS, Cookie: sessionCookie },
  });
  crumb = (await crumbRes.text()).trim();
  sessionFetchedAt = Date.now();
  console.log(`[yahoo proxy] Session refreshed. Crumb: ${crumb.slice(0, 8)}…`);
}

async function ensureSession(): Promise<void> {
  if (!crumb || Date.now() - sessionFetchedAt > SESSION_TTL_MS) {
    await refreshSession();
  }
}

async function yahooFetch(url: string): Promise<unknown> {
  await ensureSession();
  const fullUrl = url + (url.includes("?") ? "&" : "?") + `crumb=${encodeURIComponent(crumb)}`;
  const res = await fetch(fullUrl, {
    headers: { ...BASE_HEADERS, Cookie: sessionCookie },
  });
  if (res.status === 401 || res.status === 403 || res.status === 429) {
    await refreshSession();
    const retryUrl = url + (url.includes("?") ? "&" : "?") + `crumb=${encodeURIComponent(crumb)}`;
    const retry = await fetch(retryUrl, {
      headers: { ...BASE_HEADERS, Cookie: sessionCookie },
    });
    return retry.json();
  }
  return res.json();
}

const ALLOWED_INTERVALS = new Set(["1m","2m","5m","15m","30m","60m","90m","1h","1d","5d","1wk","1mo","3mo"]);
const ALLOWED_RANGES = new Set(["1d","5d","1mo","3mo","6mo","1y","2y","5y","10y","ytd","max"]);

router.get("/yahoo/chart/:symbol", async (req, res) => {
  const { symbol } = req.params;
  const { interval = "1d", range, period1, period2 } = req.query as Record<string, string>;

  const safeInterval = ALLOWED_INTERVALS.has(interval) ? interval : "1d";
  const safeRange = range && ALLOWED_RANGES.has(range) ? range : "1mo";
  const safePeriod1 = period1 && /^\d+$/.test(period1) ? period1 : undefined;
  const safePeriod2 = period2 && /^\d+$/.test(period2) ? period2 : undefined;

  try {
    let url: string;
    if (safePeriod1 && safePeriod2) {
      url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${safeInterval}&period1=${safePeriod1}&period2=${safePeriod2}`;
    } else {
      url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${safeInterval}&range=${safeRange}`;
    }
    const data = await yahooFetch(url);
    res.json(data);
  } catch (err) {
    console.error("[yahoo/chart] error:", err);
    res.status(502).json({ error: "upstream error" });
  }
});

router.get("/yahoo/search", async (req, res) => {
  const { q = "" } = req.query as Record<string, string>;
  try {
    const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=15&newsCount=0`;
    const data = await yahooFetch(url);
    res.json(data);
  } catch (err) {
    console.error("[yahoo/search] error:", err);
    res.status(502).json({ error: "upstream error" });
  }
});

export default router;
