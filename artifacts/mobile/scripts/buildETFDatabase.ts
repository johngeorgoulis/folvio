/**
 * Fortis ETF Database Builder
 * Scrapes JustETF profile pages for a curated list of UCITS ETF ISINs.
 * Output: assets/etf-database.json
 *
 * Run: npx tsx scripts/buildETFDatabase.ts
 */

import fs from "fs";
import path from "path";

// ── Curated ISIN list ─────────────────────────────────────────────────────────
// Each entry: [ISIN, primaryTicker, primaryYahooSymbol, assetClass, exchanges[]]
// exchanges[] = short codes used for Yahoo suffix (DE=XETRA, L=LSE, AS=Amsterdam, MI=Milan, PA=Paris, SW=SIX)
const ISIN_LIST: Array<{
  isin: string;
  ticker: string;
  primarySymbol: string;
  assetClass: string;
  exchanges: string[];
  currency?: string;
}> = [
  // ── Vanguard ──────────────────────────────────────────────────────────────
  { isin: "IE00BK5BQT80", ticker: "VWCE",  primarySymbol: "VWCE.DE",  assetClass: "Equity",       exchanges: ["XETRA", "London", "Milan", "Amsterdam"] },
  { isin: "IE00B3RBWM25", ticker: "VWRL",  primarySymbol: "VWRL.AS",  assetClass: "Equity",       exchanges: ["London", "Amsterdam", "XETRA", "Milan"] },
  { isin: "IE00BFMXXD54", ticker: "VUAA",  primarySymbol: "VUAA.DE",  assetClass: "Equity",       exchanges: ["XETRA", "London", "Milan", "Amsterdam"] },
  { isin: "IE00B3XXRP09", ticker: "VHVG",  primarySymbol: "VHVG.DE",  assetClass: "Equity",       exchanges: ["XETRA", "London"] },
  { isin: "IE00B8GKDB10", ticker: "VHYL",  primarySymbol: "VHYL.AS",  assetClass: "Equity",       exchanges: ["Amsterdam", "London", "XETRA", "Milan"] },
  { isin: "IE00BGPP6934", ticker: "V3AA",  primarySymbol: "V3AA.DE",  assetClass: "Equity",       exchanges: ["XETRA", "London"] },
  { isin: "IE00BFRTD982", ticker: "VEUD",  primarySymbol: "VEUD.L",   assetClass: "Equity",       exchanges: ["London", "XETRA"] },
  { isin: "IE00BG143G97", ticker: "VEUR",  primarySymbol: "VEUR.AS",  assetClass: "Equity",       exchanges: ["Amsterdam", "London", "XETRA"] },
  { isin: "IE00B945VV12", ticker: "VJPN",  primarySymbol: "VJPN.AS",  assetClass: "Equity",       exchanges: ["Amsterdam", "London"] },
  { isin: "IE00BYXVGY31", ticker: "VFEM",  primarySymbol: "VFEM.AS",  assetClass: "Equity",       exchanges: ["Amsterdam", "London"] },
  { isin: "IE00B42WHV22", ticker: "VECA",  primarySymbol: "VECA.AS",  assetClass: "Bonds",        exchanges: ["Amsterdam", "London"] },
  { isin: "IE00B3RBWM25", ticker: "VGWD",  primarySymbol: "VGWD.DE",  assetClass: "Equity",       exchanges: ["XETRA"] },
  // ── iShares (BlackRock) ───────────────────────────────────────────────────
  { isin: "IE00B4L5Y983", ticker: "IWDA",  primarySymbol: "IWDA.AS",  assetClass: "Equity",       exchanges: ["Amsterdam", "London", "XETRA", "Milan"] },
  { isin: "IE00B5BMR087", ticker: "CSPX",  primarySymbol: "CSPX.L",   assetClass: "Equity",       exchanges: ["London", "XETRA", "Amsterdam", "Milan"] },
  { isin: "IE00BKM4GZ66", ticker: "EIMI",  primarySymbol: "EIMI.L",   assetClass: "Equity",       exchanges: ["London", "XETRA", "Amsterdam", "Milan"] },
  { isin: "IE00BDBRDM35", ticker: "AGGH",  primarySymbol: "AGGH.L",   assetClass: "Bonds",        exchanges: ["London", "XETRA", "Amsterdam"] },
  { isin: "IE00B3F81R35", ticker: "IGLA",  primarySymbol: "IGLA.L",   assetClass: "Bonds",        exchanges: ["London", "Amsterdam"] },
  { isin: "IE00B1XNHC34", ticker: "INRG",  primarySymbol: "INRG.L",   assetClass: "Equity",       exchanges: ["London", "Amsterdam", "XETRA"] },
  { isin: "IE00B53L3W79", ticker: "IQQW",  primarySymbol: "IQQW.DE",  assetClass: "Equity",       exchanges: ["XETRA", "London"] },
  { isin: "IE0031442068",  ticker: "IUSA",  primarySymbol: "IUSA.L",   assetClass: "Equity",       exchanges: ["London", "XETRA"] },
  { isin: "IE00B4WXJJ64", ticker: "SMEA",  primarySymbol: "SMEA.L",   assetClass: "Equity",       exchanges: ["London", "XETRA", "Milan"] },
  { isin: "IE00B00FV128", ticker: "IEMA",  primarySymbol: "IEMA.L",   assetClass: "Equity",       exchanges: ["London"] },
  { isin: "IE00B3MXWE44", ticker: "IWDP",  primarySymbol: "IWDP.L",   assetClass: "Real Estate",  exchanges: ["London", "XETRA"] },
  { isin: "IE00B4BNMY34", ticker: "SUWS",  primarySymbol: "SUWS.L",   assetClass: "Equity",       exchanges: ["London"] },
  { isin: "IE00B579F325", ticker: "PPFB",  primarySymbol: "PPFB.L",   assetClass: "Commodities",  exchanges: ["London", "XETRA"] },
  { isin: "IE00B4ND3602", ticker: "SGLD",  primarySymbol: "SGLD.L",   assetClass: "Commodities",  exchanges: ["London"] },
  { isin: "IE00B3CNHF18", ticker: "CNDX",  primarySymbol: "CNDX.L",   assetClass: "Equity",       exchanges: ["London", "XETRA"] },
  { isin: "IE00B52MJY50", ticker: "LOCK",  primarySymbol: "LOCK.L",   assetClass: "Equity",       exchanges: ["London"] },
  { isin: "IE00B3WJKG14", ticker: "EQQQ",  primarySymbol: "EQQQ.L",   assetClass: "Equity",       exchanges: ["London", "XETRA", "Amsterdam"] },
  { isin: "IE00B4L5YX21", ticker: "DHYA",  primarySymbol: "DHYA.L",   assetClass: "Bonds",        exchanges: ["London"] },
  { isin: "IE00B4K48X80", ticker: "IMEA",  primarySymbol: "IMEA.L",   assetClass: "Equity",       exchanges: ["London", "XETRA"] },
  { isin: "IE00B0M62Q58", ticker: "IQQE",  primarySymbol: "IQQE.DE",  assetClass: "Equity",       exchanges: ["XETRA", "London"] },
  { isin: "IE00BD4TXV59", ticker: "IGWD",  primarySymbol: "IGWD.L",   assetClass: "Equity",       exchanges: ["London"] },
  { isin: "IE00BG0J4957", ticker: "PGAS",  primarySymbol: "PGAS.L",   assetClass: "Equity",       exchanges: ["London"] },
  // ── Xtrackers (DWS) ──────────────────────────────────────────────────────
  { isin: "IE00BJ0KDQ92", ticker: "XDWD",  primarySymbol: "XDWD.DE",  assetClass: "Equity",       exchanges: ["XETRA", "London", "Milan"] },
  { isin: "LU0274208692", ticker: "DBXD",  primarySymbol: "DBXD.DE",  assetClass: "Equity",       exchanges: ["XETRA"] },
  { isin: "LU0490618542", ticker: "X010",  primarySymbol: "X010.DE",  assetClass: "Equity",       exchanges: ["XETRA"] },
  { isin: "IE00BJQRDM42", ticker: "XDGE",  primarySymbol: "XDGE.L",   assetClass: "Equity",       exchanges: ["London"] },
  // ── Amundi ───────────────────────────────────────────────────────────────
  { isin: "LU1681043599", ticker: "CW8",   primarySymbol: "CW8.PA",   assetClass: "Equity",       exchanges: ["Paris", "Milan"] },
  { isin: "LU1781541179", ticker: "LCWD",  primarySymbol: "LCWD.PA",  assetClass: "Equity",       exchanges: ["Paris", "Amsterdam"] },
  { isin: "LU1437016972", ticker: "PAEEM", primarySymbol: "PAEEM.PA", assetClass: "Equity",       exchanges: ["Paris"] },
  { isin: "LU1829221024", ticker: "MWRD",  primarySymbol: "MWRD.L",   assetClass: "Equity",       exchanges: ["London"] },
  // ── VanEck ───────────────────────────────────────────────────────────────
  { isin: "IE00BZ163G84", ticker: "TDIV",  primarySymbol: "TDIV.AS",  assetClass: "Equity",       exchanges: ["Amsterdam", "XETRA"] },
  { isin: "IE00BQZJBM26", ticker: "VEMT",  primarySymbol: "VEMT.AS",  assetClass: "Bonds",        exchanges: ["Amsterdam", "London"] },
  { isin: "IE00BHZRR147", ticker: "GDX",   primarySymbol: "GDX.L",    assetClass: "Equity",       exchanges: ["London"] },
  // ── SPDR (State Street) ──────────────────────────────────────────────────
  { isin: "IE00B44Z5B48", ticker: "SPPW",  primarySymbol: "SPPW.DE",  assetClass: "Equity",       exchanges: ["XETRA", "London", "Amsterdam"] },
  { isin: "IE00BWBXM385", ticker: "SPYL",  primarySymbol: "SPYL.L",   assetClass: "Equity",       exchanges: ["London", "Amsterdam"] },
  { isin: "IE00B3DNWK88", ticker: "ZPRG",  primarySymbol: "ZPRG.DE",  assetClass: "Equity",       exchanges: ["XETRA"] },
  // ── Invesco ──────────────────────────────────────────────────────────────
  { isin: "IE00B60SX394", ticker: "MXWO",  primarySymbol: "MXWO.L",   assetClass: "Equity",       exchanges: ["London"] },
  { isin: "IE00B23D8W74", ticker: "MXUS",  primarySymbol: "MXUS.L",   assetClass: "Equity",       exchanges: ["London"] },
  { isin: "IE00B27YCF74", ticker: "QQQ3",  primarySymbol: "QQQ3.MI",  assetClass: "Equity",       exchanges: ["Milan"] },
  { isin: "IE00B3YX3J38", ticker: "PAGG",  primarySymbol: "PAGG.L",   assetClass: "Bonds",        exchanges: ["London"] },
  // ── HSBC ─────────────────────────────────────────────────────────────────
  { isin: "IE00B4X9L533", ticker: "HMWO",  primarySymbol: "HMWO.L",   assetClass: "Equity",       exchanges: ["London"] },
  { isin: "IE00BFXY0061", ticker: "HPAW",  primarySymbol: "HPAW.L",   assetClass: "Equity",       exchanges: ["London"] },
  // ── WisdomTree ───────────────────────────────────────────────────────────
  { isin: "IE00BQZJBM26", ticker: "VEMT",  primarySymbol: "VEMT.AS",  assetClass: "Bonds",        exchanges: ["Amsterdam"] },
  // ── HANetf ───────────────────────────────────────────────────────────────
  { isin: "IE000RHYOR98", ticker: "SPYD",  primarySymbol: "SPYD.L",   assetClass: "Equity",       exchanges: ["London"] },
  // ── Ossiam ───────────────────────────────────────────────────────────────
  // ── Global X ─────────────────────────────────────────────────────────────
  // ── Franklin Templeton ───────────────────────────────────────────────────
  { isin: "IE000TL6DP73", ticker: "FLXE",  primarySymbol: "FLXE.L",   assetClass: "Equity",       exchanges: ["London"] },
  // ── Additional iShares ────────────────────────────────────────────────────
  { isin: "IE00BZ048462", ticker: "IBTU",  primarySymbol: "IBTU.L",   assetClass: "Bonds",        exchanges: ["London"] },
  { isin: "IE00BZ048932", ticker: "IBTM",  primarySymbol: "IBTM.L",   assetClass: "Bonds",        exchanges: ["London"] },
  { isin: "IE00BYXVGZ48", ticker: "IBTL",  primarySymbol: "IBTL.L",   assetClass: "Bonds",        exchanges: ["London"] },
  { isin: "IE00BLNMYC90", ticker: "EUNH",  primarySymbol: "EUNH.DE",  assetClass: "Bonds",        exchanges: ["XETRA", "London"] },
  { isin: "IE00B3FH7618", ticker: "IHYG",  primarySymbol: "IHYG.L",   assetClass: "Bonds",        exchanges: ["London", "XETRA", "Amsterdam"] },
  { isin: "IE00BD8PH540", ticker: "LCUK",  primarySymbol: "LCUK.L",   assetClass: "Equity",       exchanges: ["London"] },
  { isin: "IE00B52VJ196", ticker: "IDVY",  primarySymbol: "IDVY.L",   assetClass: "Equity",       exchanges: ["London", "Amsterdam"] },
  { isin: "IE00B4WXJJ64", ticker: "SMEA",  primarySymbol: "SMEA.L",   assetClass: "Equity",       exchanges: ["London"] },
  { isin: "IE00B42WHV22", ticker: "VECA",  primarySymbol: "VECA.AS",  assetClass: "Bonds",        exchanges: ["Amsterdam"] },
  { isin: "IE00BYVJRP78", ticker: "IGLN",  primarySymbol: "IGLN.L",   assetClass: "Commodities",  exchanges: ["London", "XETRA", "Amsterdam"] },
  { isin: "IE00B14X4S71", ticker: "IPRP",  primarySymbol: "IPRP.L",   assetClass: "Real Estate",  exchanges: ["London"] },
  { isin: "IE00B6TLBW47", ticker: "CEBL",  primarySymbol: "CEBL.L",   assetClass: "Bonds",        exchanges: ["London"] },
  { isin: "IE00B3CNHF18", ticker: "CNDX",  primarySymbol: "CNDX.L",   assetClass: "Equity",       exchanges: ["London"] },
];

// ── Scraper helpers ───────────────────────────────────────────────────────────
const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
};

const MONTH_NAMES: Record<string, string> = {
  january:"01", february:"02", march:"03", april:"04", may:"05", june:"06",
  july:"07", august:"08", september:"09", october:"10", november:"11", december:"12",
  jan:"01", feb:"02", mar:"03", apr:"04", jun:"06", jul:"07", aug:"08",
  sep:"09", oct:"10", nov:"11", dec:"12",
};

function parseFriendlyDate(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (!m) return null;
  const day = m[1].padStart(2, "0");
  const month = MONTH_NAMES[m[2].toLowerCase()];
  const year = parseInt(m[3], 10);
  if (!month || year < 1990 || year > new Date().getFullYear()) return null;
  return `${m[3]}-${month}-${day}`;   // ISO format: YYYY-MM-DD
}

function extractFundSize(html: string): number | null {
  // JustETF shows fund size in millions EUR, near "Fund size" label
  // data-testid="tl_etf-basics_value_fund-size"
  const testIdMatch = html.match(/data-testid="tl_etf-basics_value_fund-size">([^<]+)/);
  if (testIdMatch) {
    const raw = testIdMatch[1].trim().replace(/[,\s]/g, "");
    // Format: "7,428 million EUR" or "7.428 mrd. EUR" or "1.2 billion"
    const numMatch = raw.match(/([\d.]+)/);
    if (numMatch) {
      const n = parseFloat(numMatch[1]);
      if (!isNaN(n) && n > 0) return Math.round(n);
    }
  }
  // Fallback: look for "million EUR" nearby fund-size label
  const sizeSection = html.match(/fund.?size[\s\S]{0,200}/i);
  if (sizeSection) {
    const m = sizeSection[0].match(/([\d,]+)\s*(?:million|mio|mrd|bn|billion)?/i);
    if (m) {
      const n = parseFloat(m[1].replace(",", "."));
      if (!isNaN(n) && n > 0) return Math.round(n);
    }
  }
  return null;
}

function extractCurrency(html: string): string {
  // ETF currency from data-testid
  const m = html.match(/data-testid="tl_etf-basics_value_currency">([^<]+)/);
  if (m) return m[1].trim();
  // Fallback: look for currency code near title
  const currMatch = html.match(/\|\s*(USD|EUR|GBP|CHF|JPY|SEK|NOK|DKK)\s*\|/);
  if (currMatch) return currMatch[1];
  return "EUR";
}

function extractName(html: string): { name: string; shortName: string } {
  // Title format: "Name | WKN | ISIN"
  const titleMatch = html.match(/<title>([^<|]+)\|/);
  if (titleMatch) {
    const name = titleMatch[1].trim();
    // Remove common suffixes for shortName
    const shortName = name
      .replace(/\s+UCITS ETF\s*/gi, " ")
      .replace(/\s+\(USD\)\s*/gi, " ")
      .replace(/\s+\(EUR\)\s*/gi, " ")
      .replace(/\s+\(GBP\)\s*/gi, " ")
      .replace(/\s+USD\s+/gi, " ")
      .replace(/\s+EUR\s+/gi, " ")
      .replace(/\s+Accumulating\s*/gi, " Acc")
      .replace(/\s+Distributing\s*/gi, " Dist")
      .replace(/\s+Hedged\s*/gi, " Hdg")
      .replace(/\s+/g, " ")
      .trim();
    return { name, shortName };
  }
  return { name: "", shortName: "" };
}

function extractTER(html: string): number | null {
  const m =
    html.match(/data-testid="tl_etf-basics_value_ter">([^<]+)/) ||
    html.match(/Total expense ratio[^<]*<[^>]+>\s*([\d.]+)\s*%/i) ||
    html.match(/TER[^<]*<[^>]+>\s*([\d.]+)\s*%/i);
  if (m) {
    const v = parseFloat(m[1].replace("%","").trim());
    if (!isNaN(v) && v > 0 && v < 5) return v;
  }
  return null;
}

function extractDistribution(html: string): string | null {
  const m =
    html.match(/data-testid="tl_etf-basics_value_distribution-policy">([^<]+)/) ||
    html.match(/data-testid="etf-profile-header_distribution-policy-value">([^<]+)/);
  if (m) {
    const v = m[1].trim();
    if (/^(Accumulating|Distributing|Reinvesting)$/i.test(v)) return v;
  }
  // Fallback: title/og:description
  const titleMatch = html.match(/<title>[^<]*(Accumulating|Distributing)[^<]*<\/title>/i);
  if (titleMatch) return titleMatch[1];
  return null;
}

function extractReplication(html: string): string | null {
  const m =
    html.match(/data-testid="tl_etf-basics_value_replication">([^<]+)/) ||
    html.match(/Replication[^<]*<[^>]+>\s*(Physical|Synthetic|Optimised|Sampling)/i);
  if (m) return m[1].trim();
  // Alternative: look for physical/synthetic near replication label
  const section = html.match(/replication[\s\S]{0,200}/i);
  if (section) {
    const mv = section[0].match(/>(Physical|Synthetic|Optimised|Sampling)\s*</i);
    if (mv) return mv[1];
  }
  return null;
}

function extractDomicile(html: string): string | null {
  const m = html.match(/data-testid="tl_etf-basics_value_domicile">([^<]+)/);
  if (m) return m[1].trim();
  const DOMICILE_COUNTRIES = /Ireland|Luxembourg|Germany|France|Switzerland|Netherlands/i;
  const section = html.match(/domicile[\s\S]{0,200}/i);
  if (section) {
    const mv = section[0].match(new RegExp(`>\\s*(${DOMICILE_COUNTRIES.source})\\s*<`, "i"));
    if (mv) return mv[1];
  }
  return null;
}

function extractInceptionDate(html: string): string | null {
  const m =
    html.match(/data-testid="tl_etf-basics_value_launch-date">([^<]+)/) ||
    html.match(/data-testid="etf-profile-header_inception-date-value">([^<]+)/);
  if (m) return parseFriendlyDate(m[1].trim());
  return null;
}

async function scrapeJustETF(isin: string): Promise<{
  name: string; shortName: string; ter: number | null; distribution: string | null;
  replication: string | null; domicile: string | null; inceptionDate: string | null;
  fundSize: number | null; currency: string;
} | null> {
  const url = `https://www.justetf.com/en/etf-profile.html?isin=${isin}`;
  try {
    const res = await fetch(url, { headers: FETCH_HEADERS as Record<string, string> });
    if (!res.ok) { console.warn(`  ⚠ ${isin}: HTTP ${res.status}`); return null; }
    const html = await res.text();
    // Check for not-found page
    if (html.includes("page-not-found") || html.includes("ETF not found") || !html.includes("etf-profile")) {
      console.warn(`  ⚠ ${isin}: Not found on JustETF`);
      return null;
    }
    const { name, shortName } = extractName(html);
    if (!name) { console.warn(`  ⚠ ${isin}: Could not extract name`); return null; }
    return {
      name, shortName,
      ter: extractTER(html),
      distribution: extractDistribution(html),
      replication: extractReplication(html),
      domicile: extractDomicile(html),
      inceptionDate: extractInceptionDate(html),
      fundSize: extractFundSize(html),
      currency: extractCurrency(html),
    };
  } catch (err) {
    console.warn(`  ✗ ${isin}: ${err}`);
    return null;
  }
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🔨 Fortis ETF Database Builder`);
  console.log(`Processing ${ISIN_LIST.length} ETFs from JustETF...\n`);

  // Deduplicate by ISIN
  const seen = new Set<string>();
  const unique = ISIN_LIST.filter(e => {
    if (seen.has(e.isin)) return false;
    seen.add(e.isin);
    return true;
  });

  const etfs: object[] = [];
  let ok = 0, skipped = 0;

  for (let i = 0; i < unique.length; i++) {
    const entry = unique[i]!;
    process.stdout.write(`[${i + 1}/${unique.length}] ${entry.isin} (${entry.ticker}) ... `);
    const data = await scrapeJustETF(entry.isin);
    if (data) {
      etfs.push({
        isin: entry.isin,
        ticker: entry.ticker,
        name: data.name,
        shortName: data.shortName || entry.ticker,
        assetClass: entry.assetClass,
        ter: data.ter,
        distribution: data.distribution,
        replication: data.replication,
        currency: data.currency,
        domicile: data.domicile,
        inceptionDate: data.inceptionDate,
        fundSize: data.fundSize,
        exchanges: entry.exchanges,
        primaryTicker: entry.primarySymbol,
        justETFUrl: `https://www.justetf.com/en/etf-profile.html?isin=${entry.isin}`,
      });
      console.log(`✓ ${data.name.substring(0, 60)}`);
      ok++;
    } else {
      skipped++;
    }
    if (i < unique.length - 1) await sleep(600); // polite delay
  }

  // ── Write database ──────────────────────────────────────────────────────
  const outDir = path.join(__dirname, "..", "assets");
  fs.mkdirSync(outDir, { recursive: true });

  const db = {
    version: "1.0",
    generatedAt: new Date().toISOString(),
    count: etfs.length,
    etfs,
  };

  const dbPath = path.join(outDir, "etf-database.json");
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), "utf8");
  console.log(`\n✅ Database written: ${dbPath} (${ok} ETFs, ${skipped} skipped)`);

  // ── Write index ─────────────────────────────────────────────────────────
  const isinIndex: Record<string, object> = {};
  const tickerIndex: Record<string, object> = {};
  const nameIndex: { keywords: string[]; isin: string }[] = [];

  for (const etf of etfs as any[]) {
    isinIndex[etf.isin] = etf;
    tickerIndex[etf.ticker.toUpperCase()] = etf;
    // Build keyword list from name
    const words = etf.name.toLowerCase().split(/\s+/).filter((w: string) => w.length > 2);
    nameIndex.push({ keywords: words, isin: etf.isin });
  }

  const idxPath = path.join(outDir, "etf-index.json");
  fs.writeFileSync(idxPath, JSON.stringify({ isinIndex, tickerIndex, nameIndex }, null, 2), "utf8");
  console.log(`✅ Index written: ${idxPath}`);
  console.log(`\nDone! ${ok}/${unique.length} ETFs successfully scraped.\n`);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
