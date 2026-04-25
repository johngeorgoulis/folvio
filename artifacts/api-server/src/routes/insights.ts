import { Router, type IRouter } from "express";

const SYSTEM_PROMPT =
  "You are a portfolio analyst for European passive investors. " +
  "Generate exactly 4 concise, specific portfolio insights based on the data provided. " +
  "Focus on: geographic concentration, cost efficiency, asset allocation vs typical EU passive investor, " +
  "and one actionable suggestion. Be specific with numbers. Maximum 2 sentences per insight. " +
  "When an investor profile is provided, check for mismatches between the stated risk profile and actual allocation " +
  "(e.g. Conservative investor holding >80% equity should be flagged). " +
  "If income_oriented is true, comment on the DIST vs ACC split in the holdings. " +
  "Reference the investor profile explicitly where relevant. " +
  "Respond ONLY with a valid JSON array. No markdown, no code blocks, no backticks, no preamble. Start directly with [ and end with ]";

interface InvestorProfile {
  profile_label: string;
  risk_score: number;
  investment_horizon: string;
  investing_stage: string;
  monthly_dca_range: string;
  income_oriented: number;
}

function buildProfilePrefix(profile: InvestorProfile | null | undefined): string {
  if (!profile) return "";
  return (
    `Investor Profile:\n` +
    `- Risk profile: ${profile.profile_label} (score: ${profile.risk_score}/5)\n` +
    `- Investment horizon: ${profile.investment_horizon}\n` +
    `- Investing stage: ${profile.investing_stage}\n` +
    `- Monthly DCA range: ${profile.monthly_dca_range}\n` +
    `- Income oriented: ${profile.income_oriented ? "yes" : "no"}\n\n` +
    `Portfolio holdings:\n`
  );
}

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

  const { portfolioContext, investorProfile } = req.body as {
    portfolioContext?: unknown;
    investorProfile?: InvestorProfile | null;
  };
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
              buildProfilePrefix(investorProfile) +
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
  const raw: string = data?.content?.[0]?.text ?? "[]";
  console.log("[insights] raw Anthropic response:", raw);
  const text = raw
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
