import { Router, type IRouter } from "express";

const SYSTEM_PROMPT =
  "You are a portfolio analyst for European passive investors. " +
  "Generate exactly 4 concise, specific portfolio insights based on the data provided. " +
  "Focus on: geographic concentration, cost efficiency, asset allocation vs typical EU passive investor, " +
  "and one actionable suggestion. Be specific with numbers. Maximum 2 sentences per insight. " +
  "Respond ONLY with a JSON array, no other text.";

const router: IRouter = Router();

/**
 * POST /api/insights
 * Accepts a pre-built portfolioContext object from the mobile app and calls
 * the Anthropic API server-side (avoids exposing the key in the client bundle).
 *
 * Body: { portfolioContext: { totalValueEUR, timeInMarketMonths, holdings,
 *          assetMix, weightedAverageTER, dcaMonthlyEUR } }
 * Returns: { insights: Array<{ title, body, type }> }
 */
router.get("/debug-env", (_req, res) => {
  res.json({
    ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
    FMP_API_KEY: !!process.env.FMP_API_KEY,
    NODE_ENV: process.env.NODE_ENV ?? null,
  });
});

router.post("/insights", async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn("[insights] ANTHROPIC_API_KEY is not set");
    res.status(500).json({ error: "ANTHROPIC_API_KEY not configured on server" });
    return;
  }

  const { portfolioContext } = req.body as { portfolioContext?: unknown };
  if (!portfolioContext) {
    res.status(400).json({ error: "portfolioContext required in request body" });
    return;
  }

  let anthropicRes: Response;
  try {
    anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content:
              `Analyze this portfolio and generate 4 insights as JSON:\n\n` +
              `${JSON.stringify(portfolioContext, null, 2)}\n\n` +
              `Respond with: [{"title":"...","body":"...","type":"neutral|positive|warning"},...]`,
          },
        ],
      }),
    });
  } catch (networkErr) {
    console.error("[insights] network error calling Anthropic:", networkErr);
    res.status(502).json({ error: `Network error: ${networkErr}` });
    return;
  }

  if (!anthropicRes.ok) {
    const body = await anthropicRes.text().catch(() => "");
    console.warn(`[insights] Anthropic ${anthropicRes.status}:`, body.substring(0, 300));
    res.status(anthropicRes.status).json({ error: `Anthropic error: ${body}` });
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (await anthropicRes.json()) as any;
  const text: string = (data?.content?.[0]?.text ?? "[]")
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();

  try {
    const insights = JSON.parse(text);
    res.json({ insights });
  } catch {
    console.error("[insights] failed to parse Anthropic response:", text);
    res.status(500).json({ error: `Failed to parse response: ${text}` });
  }
});

export default router;
