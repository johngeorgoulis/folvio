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

router.get("/yahoo/chart/:symbol", async (req, res) => {
  const { symbol } = req.params;
  const { interval = "1d", range, period1, period2 } = req.query as Record<string, string>;
  try {
    let url: string;
    if (period1 && period2) {
      url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&period1=${period1}&period2=${period2}`;
    } else {
      url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range ?? "1mo"}`;
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
