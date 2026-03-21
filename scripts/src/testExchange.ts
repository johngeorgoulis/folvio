// Self-contained version — no React Native imports

const YAHOO_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  "Accept": "application/json",
};

interface SearchResult {
  symbol: string;
  shortName: string;
  exchange: string;
}

async function searchTickers(query: string): Promise<SearchResult[]> {
  const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=15&newsCount=0`;
  try {
    const res = await fetch(url, { headers: YAHOO_HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as { quotes?: Record<string, string>[] };
    return (data?.quotes ?? []).map((q) => ({
      symbol: q.symbol ?? "",
      shortName: q.shortname ?? q.longname ?? "",
      exchange: q.exchange ?? "",
    }));
  } catch {
    return [];
  }
}

async function resolveExchangeFromISIN(isin: string, ticker: string): Promise<string> {
  if (!isin) return "XETRA";
  try {
    const results = await searchTickers(isin);
    if (results.length === 0) return "XETRA";

    const EXCHANGE_PRIORITY: Record<string, number> = {
      "GER": 1, "XET": 1,
      "AMS": 2, "PAR": 3, "MIL": 4, "EBS": 5, "LSE": 6, "BRU": 7, "OSL": 8,
    };
    const EXCHANGE_MAP: Record<string, string> = {
      "GER": "XETRA", "XET": "XETRA",
      "AMS": "EURONEXT_AMS", "PAR": "EURONEXT_PAR",
      "MIL": "BORSA_IT", "EBS": "SIX", "LSE": "LSE",
      "BRU": "EURONEXT_PAR", "OSL": "Other",
    };

    const matching = results.filter(r =>
      r.symbol.toUpperCase().startsWith(ticker.toUpperCase())
    );
    const candidates = matching.length > 0 ? matching : results;

    const sorted = candidates.sort((a, b) =>
      (EXCHANGE_PRIORITY[a.exchange] ?? 99) - (EXCHANGE_PRIORITY[b.exchange] ?? 99)
    );

    const best = sorted[0];
    console.log(`  raw results for ${ticker}: ${results.map(r => `${r.symbol}@${r.exchange}`).join(", ")}`);
    console.log(`  best: ${best.symbol}@${best.exchange}`);

    const mapped = EXCHANGE_MAP[best.exchange];
    if (mapped) return mapped;

    const suffix = best.symbol.split(".").pop()?.toUpperCase() ?? "";
    const SUFFIX_MAP: Record<string, string> = {
      "DE": "XETRA", "AS": "EURONEXT_AMS", "PA": "EURONEXT_PAR",
      "MI": "BORSA_IT", "SW": "SIX", "L": "LSE",
    };
    return SUFFIX_MAP[suffix] ?? "XETRA";
  } catch {
    return "XETRA";
  }
}

async function main() {
  const tests = [
    { isin: "IE00BK5BQT80", ticker: "VWCE" },
    { isin: "IE00B4ND3602", ticker: "EGLN" },
    { isin: "IE00B3VTML14", ticker: "CSBGE7" },
    { isin: "IE00BCRY6557", ticker: "ERNE" },
    { isin: "IE00B8GKDB10", ticker: "VHYL" },
    { isin: "NL0011683594", ticker: "TDIV" },
  ];

  for (const t of tests) {
    const exchange = await resolveExchangeFromISIN(t.isin, t.ticker);
    console.log(`${t.ticker} (${t.isin}) → ${exchange}`);
  }
}

main().catch(console.error);
