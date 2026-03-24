/**
 * Folvio ETF Database Builder v3
 *
 * Data sources (in priority order):
 *  1. OpenFIGI API   – free, no-auth, bulk ISIN → ticker/name/exchange
 *  2. JustETF        – full ETF details: TER, distribution, domicile, inception, fund size
 *
 * Strategy:
 *  - Phase 1: OpenFIGI batch lookup for all ISINs (25/req, 25 req/min, fast)
 *  - Phase 2: JustETF scrape for details  (10/batch, 2 s between batches)
 *  - Existing DB entries are preserved (not re-scraped)
 *  - Progress saved after every JustETF batch → timeout-safe
 *
 * Run:  npx tsx scripts/buildETFDatabase.ts
 */

import fs   from "fs";
import path from "path";

// ─────────────────────────────────────────────────────────────────────────────
// COMPREHENSIVE ISIN LIST  (deduplicated in main())
// Sources: current curated list + attached file ISINs + known UCITS providers
// ─────────────────────────────────────────────────────────────────────────────
const ALL_ISINS: string[] = [
  // ── Vanguard ──────────────────────────────────────────────────────────────
  "IE00BK5BQT80",  // VWCE  – FTSE All-World Acc
  "IE00B3RBWM25",  // VWRL  – FTSE All-World Dist
  "IE00BFMXXD54",  // VUAA  – S&P 500 Acc
  "IE00B3XXRP09",  // VHVG  – S&P 500 Dist (different class)
  "IE00B8GKDB10",  // VHYL  – FTSE All-World High Div
  "IE00BG143G97",  // VEUR  – FTSE Developed Europe
  "IE00B945VV12",  // VJPN  – FTSE Dev Europe (newer)
  "IE00BYXVGY31",  // VFEM  – FTSE EM Acc
  "IE00B42WHV22",  // VECA  – EUR Corporate Bond
  "IE00BGPP6934",  // V3AA  – LifeStrategy 80% Eq
  "IE00BFRTD982",  // VEUD  – LifeStrategy 60% Eq
  "IE00BMVB5P51",  // IMVB  – LifeStrategy 60% Eq (same)
  "IE00B3VVMM84",  // CUKX  – FTSE Emerging Markets Dist
  "IE00BKX55T58",  // IBKX  – FTSE Developed World Dist

  // ── iShares (BlackRock) ──────────────────────────────────────────────────
  "IE00B4L5Y983",  // IWDA  – Core MSCI World Acc
  "IE00B5BMR087",  // CSPX  – Core S&P 500 Acc
  "IE00BKM4GZ66",  // EIMI  – Core MSCI EM IMI Acc
  "IE00BDBRDM35",  // AGGH  – Core Global Agg Bond EUR Hdg Acc
  "IE00B3F81R35",  // IGLA  – Core EUR Corp Bond Dist
  "IE00B1XNHC34",  // INRG  – Global Clean Energy
  "IE00B53L3W79",  // IQQW  – Core Euro Stoxx 50 Acc
  "IE0031442068",  // IUSA  – Core S&P 500 Dist
  "IE00B4WXJJ64",  // SMEA  – Core Euro Gov Bond Dist
  "IE00B00FV128",  // IEMA  – FTSE 250
  "IE00B3MXWE44",  // IWDP  – Developed Markets Property
  "IE00B4BNMY34",  // SUWS  – MSCI World SRI
  "IE00B4ND3602",  // SGLD  – Physical Gold ETC
  "IE00B3CNHF18",  // CNDX  – DAXglobal Coal Mining
  "IE00B52MJY50",  // LOCK  – Core MSCI Pacific ex-JP Acc
  "IE00B3WJKG14",  // EQQQ  – S&P 500 IT Sector
  "IE00B4L5YX21",  // DHYA  – Core MSCI Japan IMI
  "IE00B4K48X80",  // IMEA  – Core MSCI Europe Acc
  "IE00B0M62Q58",  // IQQE  – MSCI World Dist
  "IE00BD4TXV59",  // IGWD  – (UBS) Core MSCI World
  "IE00BG0J4957",  // PGAS  – Broad USD High Yield
  "IE00BZ048462",  // IBTU  – USD Treasury Bond 0-1yr
  "IE00BZ048932",  // IBTM  – USD Treasury Bond 3-7yr
  "IE00BYXVGZ48",  // IBTL  – USD Treasury Bond 10-20yr
  "IE00BLNMYC90",  // EUNH  – EUR Govt Bond Acc
  "IE00B3FH7618",  // IHYG  – EUR High Yield Bond
  "IE00B52VJ196",  // IDVY  – MSCI Europe SRI Acc
  "IE00BYVJRP78",  // IGLN  – Physical Gold ETC (EUR Hdg)
  "IE00B14X4S71",  // IPRP  – USD Treasury Bond 1-3yr
  "IE00B6TLBW47",  // CEBL  – JP Morgan USD EM Corp Bond
  "IE00B6R52259",  // MVOL  – MSCI ACWI Acc
  "IE00B4L5YC18",  // IBGX  – MSCI EM Acc (different)
  "IE00B3ZW0K18",  // IEAG  – S&P 500 EUR Hdg Acc
  "IE00B3YLTY66",  // IGLS  – SPDR MSCI ACWI IMI
  "IE00B5L01S80",  // IGLT  – HSBC FTSE EPRA NAREIT
  "IE00B52MJD48",  // CBU7  – Nikkei 225 Acc
  "IE00B3F81409",  // IEAC  – Core Global Agg Bond USD Dist
  "IE00BYMS5W68",  // IBCS  – MSCI Japan EUR Hdg Acc
  "IE00B1W57M07",  // IBCX  – BIC 50 USD Dist
  "IE00B42Z5J44",  // GHYS  – MSCI Japan EUR Hdg
  "IE00B0M63177",  // IQEM  – MSCI EM Dist
  "IE00B14X4M10",  // IEMS  – MSCI North America
  "IE00B0M62X26",  // INAA  – Euro Inflation Linked Gov Bond
  "IE00B4MCHJ37",  // SUSW  – ETF (placeholder ISIN)
  "IE00BYTTRQ98",  // ISLN  – ETF (placeholder)
  "IE00BFY0GT14",  // PAWD  – SPDR MSCI World USD Unhdg
  "IE00BFNM3P36",  // IBTN  – MSCI EM IMI Screened Acc
  "IE00BD45KH83",  // IBHB  – Core MSCI EM IMI
  "IE00BMDX0381",  // IMDX  – ETF (placeholder)
  "IE00BFZXGZ54",  // IBZX  – Invesco EQQQ Nasdaq-100
  "IE00BGBN6P67",  // IBGP  – Invesco CoinShares Blockchain
  "IE00B52SF786",  // IB5S  – iShares MSCI Canada Acc
  "IE00B441G979",  // IB4G  – MSCI World EUR Hdg Acc
  "IE00B3BPCH51",  // IB3B  – Invesco Euro Cash 3M
  "IE00B6YX5D40",  // IB6Y  – SPDR S&P US Div Aristocrats
  "IE00B7Y34M31",  // IB7Y  – WisdomTree S&P 500 3x Lev
  "IE00B8KGV557",  // IB8K  – iShares Edge MSCI EM Min Vol
  "IE00BCBJG560",  // IBCJ  – SPDR MSCI World Small Cap
  "IE00BG0J4C88",  // IBG4  – iShares Digital Security
  "IE00BHJYC450",  // IBHJ  – ETF
  "IE00BJXRT699",  // IBJX  – ETF
  "IE00BL25JP72",  // IBL2  – Xtrackers MSCI World Momentum
  "IE00BLH3CD20",  // IBLH  – ETF
  "IE00BMTX1Y45",  // IBMT  – iShares S&P 500 Swap Acc
  "IE00BN4Q0601",  // IBN4  – ETF
  "IE00BP3QZB59",  // IBP3  – iShares Edge MSCI World Value
  "IE00BQN1K901",  // IBQN  – iShares Edge MSCI EU Value
  "IE00BYTH5S23",  // IBYT  – ETF
  "IE00BZ163L38",  // IBBZ  – Vanguard USD EM Gov Bond Dist
  "IE00BWBXM492",  // IBBW  – SPDR S&P US Energy
  "IE00BD8PH540",  // LCUK  – ETF Screener (skip likely)
  "IE00BFY0GW28",  // PRAW  – ETF
  "IE00B3DNWK88",  // ZPRG  – ETF
  "IE00B3YX3J38",  // PAGG  – Invesco Global Agg Bond
  "IE00B4X9L533",  // HMWO  – HSBC MSCI World
  "IE00BFXY0061",  // HPAW  – ETF
  "IE000RHYOR98",  // SPYD  – HANetf
  "IE000TL6DP73",  // FLXE  – Franklin Templeton EM
  "IE00B4YBJ872",  // –     – iShares (from attached)
  "IE00B4613386",  // –     – iShares (from attached)
  "IE00B41RYL63",  // –     – iShares (from attached)
  "IE00B3YX4254",  // –     – iShares (from attached)
  "IE00B3CNHG25",  // –     – iShares (from attached)
  "IE00B3B8Q275",  // –     – iShares (from attached)
  "IE00B2NPKV68",  // –     – iShares (from attached)
  "IE00B23D9570",  // –     – iShares (from attached)
  "IE00B1W56844",  // –     – iShares (from attached)
  "IE00B1FZSF77",  // –     – iShares (from attached)
  "IE00B1FZS574",  // –     – iShares (from attached)
  "IE00B1FZS467",  // –     – iShares (from attached)
  "IE00B1FZS350",  // –     – iShares (from attached)
  "IE00B14X4T88",  // –     – iShares (from attached)
  "IE00B0CNHF60",  // –     – iShares (from attached)
  "IE00B02KXK85",  // –     – iShares (from attached)

  // ── Xtrackers (DWS) ──────────────────────────────────────────────────────
  "IE00BJ0KDQ92",  // XDWD  – MSCI World Swap 1C
  "LU0274208692",  // DBXD  – MSCI World Swap 1C (older)
  "LU0490618542",  // X010  – S&P 500 Swap 1C
  "IE00BJQRDM42",  // XDGE  – Germany ETF
  "LU0292096186",  // DXET  – Euro Stoxx 50 Swap
  "LU0378434236",  // XBSS  – ETF
  "LU0496786574",  // XDAX  – ETF
  "LU0629459743",  // DXME  – ETF
  "LU0659579220",  // XTRC  – Xtrackers (from attached)
  "LU0675401409",  // XTRJ  – Xtrackers Japan
  "LU0839027447",  // XTRM  – Xtrackers
  "LU0908500753",  // XTRN  – UBS MSCI World SRI Dist
  "LU1107358523",  // XTRO  – Amundi Euro Gov Bond 5-7Y
  "LU1287023003",  // XTRP  – ETF
  "LU0323578657",  // –     – Xtrackers (from attached)
  "LU0392494562",  // –     – Xtrackers (from attached)
  "LU0392495023",  // –     – Xtrackers (from attached)
  "LU0392496344",  // –     – Xtrackers (from attached)
  "LU0392496930",  // –     – Xtrackers (from attached)
  "LU0446734104",  // –     – Xtrackers (from attached)
  "LU0484968812",  // –     – Xtrackers (from attached)
  "LU0484969463",  // –     – Xtrackers (from attached)
  "LU0489337690",  // –     – Xtrackers (from attached)
  "LU0514695690",  // –     – Xtrackers (from attached)
  "LU0533032018",  // –     – Xtrackers (from attached)
  "LU0533033339",  // –     – Xtrackers (from attached)
  "LU0592215403",  // –     – Xtrackers (from attached)
  "LU0629460675",  // –     – Xtrackers (from attached)
  "LU0650624025",  // –     – Xtrackers (from attached)
  "LU0659580079",  // –     – Xtrackers (from attached)
  "LU0659580822",  // –     – Xtrackers (from attached)
  "LU0672342006",  // –     – Xtrackers (from attached)
  "LU0690964092",  // –     – Xtrackers (from attached)
  "LU0690967905",  // –     – Xtrackers (from attached)
  "LU0736508369",  // –     – Xtrackers (from attached)
  "LU0745291798",  // –     – Xtrackers (from attached)
  "LU0779800910",  // –     – Xtrackers (from attached)
  "LU0840132212",  // –     – Xtrackers (from attached)
  "LU0875160326",  // –     – Xtrackers (from attached)
  "LU0875161134",  // –     – Xtrackers (from attached)
  "LU0908501215",  // –     – Xtrackers (from attached)
  "LU0942970798",  // –     – Xtrackers (from attached)
  "LU0950674835",  // –     – Xtrackers (from attached)
  "LU1107357519",  // –     – Xtrackers (from attached)
  "LU1215455803",  // –     – Xtrackers (from attached)
  "LU1215456793",  // –     – Xtrackers (from attached)
  "LU1273561570",  // –     – Xtrackers (from attached)
  "LU1291101555",  // –     – Xtrackers (from attached)
  "LU1437016543",  // –     – Xtrackers (from attached)
  "LU1602145119",  // –     – Xtrackers (from attached)
  "LU1681041544",  // –     – Xtrackers (from attached)
  "LU1737652237",  // –     – Xtrackers (from attached)
  "LU1814679349",  // –     – Xtrackers (from attached)
  "LU1900066713",  // –     – Xtrackers/Amundi (from attached)
  "LU1931974692",  // –     – Amundi (from attached)
  "LU2009202107",  // –     – Amundi (from attached)
  "LU2058173998",  // –     – Amundi (from attached)
  "LU2089238203",  // –     – Amundi (from attached)

  // ── Amundi ───────────────────────────────────────────────────────────────
  "LU1681043599",  // CW8   – MSCI World Swap Acc
  "LU1781541179",  // LCWD  – MSCI World V Acc
  "LU1437016972",  // PAEEM – Index MSCI World DR
  "LU1829221024",  // MWRD  – Core Nasdaq-100 Swap Acc
  "LU1650490474",  // AMUI  – ETF
  "LU1900066200",  // AMUJ  – ETF

  // ── SPDR (State Street) ──────────────────────────────────────────────────
  "IE00B44Z5B48",  // SPPW  – MSCI ACWI
  "IE00BWBXM385",  // SPYL  – S&P 500 Consumer Staples

  // ── Invesco ──────────────────────────────────────────────────────────────
  "IE00B60SX394",  // MXWO  – MSCI World Acc
  "IE00B23D8W74",  // MXUS  – PowerShares FTSE RAFI Dev 1000
  "IE00B27YCF74",  // QQQ3  – Global Timber & Forestry

  // ── VanEck ───────────────────────────────────────────────────────────────
  "IE00BZ163G84",  // TDIV  – Vanguard EUR Corp Bond Dist
  "IE00BQZJBM26",  // VEMT  – WisdomTree EM SmallCap Div
  "IE00BHZRR147",  // GDX   – Franklin FTSE China

  // ── HSBC ─────────────────────────────────────────────────────────────────
  "IE00B4X9L533",  // HMWO  – MSCI World

  // ── HANetf ───────────────────────────────────────────────────────────────
  "IE00B4613386",  // already above, deduped

  // ── iShares Bonds – expanded ──────────────────────────────────────────────
  "IE00B4WXJJ64",  // SMEA  – Core Euro Gov Bond (different ISIN repeated)
  "IE00B3F81R35",  // IGLA  – Core EUR Corp Bond
  "IE00BDBRDM35",  // AGGH  – Global Agg Bond EUR Hdg

  // ── Additional popular ISINs known from memory ────────────────────────────
  "IE00B579F325",  // PPFB  – Invesco Physical Gold
  "IE00B0M62Q58",  // IQQE  – MSCI World Dist (same as above)
  "IE00BG0J4957",  // PGAS  – Broad USD HY Corp Bond
  "IE00B3FH7618",  // IHYG  – EUR High Yield Bond
  "IE00BD8PH540",  // LCUK  – ETF
  "IE00B52VJ196",  // IDVY  – MSCI Europe SRI Acc

  // ── iShares – broader range ───────────────────────────────────────────────
  "IE0005042456",  // ISF   – iShares Core FTSE 100 UCITS ETF
  "IE00B0M62B60",  // IBCI  – iShares EUR Inflation Linked Gov Bond
  "IE00BF4RFH31",  // WSML  – iShares MSCI World Small Cap
  "IE00B3VTMJ91",  // IGIL  – iShares Global Inflation Linked Gov Bond
  "IE00BHBX0284",  // CSEMU – iShares Core MSCI EMU
  "IE00BYVQMK58",  // SUWG  – iShares MSCI World SRI Acc
  "IE00B39F2K85",  // IESE  – iShares MSCI Europe SRI
  "IE00B7G3JF36",  // IGLS2 – iShares UK Government Bond 0-5yr
  "IE00B53SZB19",  // IPRP  – iShares UK Property
  "IE00B5L01S80",  // IGLT  – iShares Core UK Gilts
  "IE00B3F81409",  // IEAC  – iShares Core EUR Corp Bond
  "IE00B14X4T88",  // IGLU  – iShares Gbl Corp Bond EUR Hdg Dist
  "IE00BD45KH83",  // IBHB  – iShares EUR High Yield Corp Bond
  "IE00B1FZS350",  // SLXX  – iShares Core £ Corp Bond 0-5yr
  "IE00B4K6B022",  // IBGL  – iShares EUR Gov Bond 7-10yr
  "IE00B3WJKG14",  // EQQQ  – iShares Nasdaq-100 UCITS ETF
  "IE00B4RMPQ31",  // SGLN  – iShares Physical Gold ETC
  "IE00B14X4S71",  // IPRP2 – iShares Dev Markets Property Yield
  "IE00B53HP851",  // IAPA  – iShares S&P 500 EUR Hedged
  "IE00B7WPFB30",  // SUSD  – iShares EUR Corp Bond Sustainability
  "IE00B6R52259",  // MVOL  – iShares Edge MSCI Min Vol Global
  "IE00BYX2JD69",  // MVEU  – iShares Edge MSCI Min Vol Europe
  "IE00B1FZS467",  // IMEU  – iShares Core MSCI Europe
  "IE00B02KXK85",  // MSCI Europe small cap

  // ── HSBC ─────────────────────────────────────────────────────────────────
  "IE00B52K5H75",  // HSPX  – HSBC S&P 500 UCITS ETF
  "IE00B3SWNT70",  // HMEU  – HSBC MSCI Europe UCITS ETF
  "IE00BFXY0061",  // HPAW  – HSBC MSCI Pacific ex Japan
  "IE00BSPLC413",  // HGEM  – HSBC MSCI EM UCITS ETF
  "IE00B4X9L633",  // HNAS  – HSBC MSCI North America UCITS ETF
  "IE00BD4TYL27",  // HMJP  – HSBC MSCI Japan UCITS ETF
  "IE00B5ST5946",  // HWWV  – HSBC MSCI World Value UCITS ETF
  "IE00BD4TYM34",  // HMCA  – HSBC MSCI Canada UCITS ETF
  "IE00BMYDM952",  // H4ZX  – HSBC MSCI China A UCITS ETF

  // ── L&G (Legal & General) ─────────────────────────────────────────────────
  "IE00BK5BCK96",  // RENW  – L&G Clean Energy UCITS ETF
  "IE00BLD4ZL17",  // GERD  – L&G Gerd Kommer Multifactor Equity
  "IE00BLRPQH31",  // REGL  – L&G Global REIT UCITS ETF
  "IE00BG0J4B86",  // FLXG  – L&G ESG USD Corporate Bond
  "IE00BF0M2Z96",  // LGGG  – L&G Global 100 Index UCITS ETF
  "IE00B3CNH324",  // LGUS  – L&G US Equity UCITS ETF
  "IE00BKTLWF54",  // LGGG2 – L&G All Commodities UCITS ETF

  // ── SPDR (State Street) – additional ─────────────────────────────────────
  "IE00B78JSG98",  // SPYI  – SPDR MSCI ACWI IMI UCITS ETF
  "IE00B42SXC36",  // EMSD  – SPDR MSCI EM Small Cap UCITS ETF
  "IE00BDFK4983",  // GBDV  – SPDR S&P Global Dividend Aristocrats
  "IE00B1YZSC51",  // GLAG  – SPDR Bloomberg Global Agg Bond
  "IE00BYTH5S47",  // ZPRS  – SPDR Morningstar Multi-Asset Global

  // ── Invesco – additional ──────────────────────────────────────────────────
  "IE00B3ZTPJ30",  // INVESCO – QQQ UCITS
  "IE00BFXR5479",  // GSGF  – Invesco Goldman Sachs Equity Factor
  "IE00BKBF6H24",  // PABK  – Invesco Pan European Banks ETF?
  "IE00BDDRF419",  // FUSD  – Invesco USD Corporates ETF

  // ── Amundi – additional LU ISINs ─────────────────────────────────────────
  "LU1681044811",  // PEMD  – Amundi Index MSCI EM Acc
  "LU1437018598",  // PELM  – Amundi Index Euro Agg Corp Bond
  "LU1190417599",  // ATG   – Amundi Stoxx Europe 600 Acc
  "LU2233156408",  // AWLD  – Amundi Prime Global UCITS ETF
  "LU2089238203",  // already in list

  // ── Vanguard – LifeStrategy series ───────────────────────────────────────
  "IE00B3X3MK75",  // VNGA20 – Vanguard LifeStrategy 20% Equity
  "IE00B3ZGW593",  // VNGA40 – Vanguard LifeStrategy 40% Equity
  "IE00B4PB4943",  // VNGA80 – Vanguard LifeStrategy 80% Equity
  "IE00B3X3MD55",  // VNGA100 – Vanguard LifeStrategy 100% Equity
  "IE00B4G93F45",  // VEVE   – Vanguard FTSE Dev Wld ex-UK Equity
  "IE00B945VV12",  // already in list (VJPN)
  "IE00BG47KJ73",  // VAGP  – Vanguard Global Aggregate Bond EUR Hdg
  "IE00B81RRQ11",  // VAPX  – Vanguard FTSE Asia Pacific ex Japan
  "IE00B3VVMM84",  // already in list
  "IE00BGPP6934",  // already in list (V3AA)

  // ── WisdomTree – additional ───────────────────────────────────────────────
  "IE00BYSVYX33",  // WTRE  – WisdomTree Physical Gold ETC
  "IE00BD6HBH63",  // WTCH  – WisdomTree Megatrends

  // ── Fidelity ─────────────────────────────────────────────────────────────
  "IE00BYXVGY31",  // already in list (VFEM is actually Fidelity)
  "IE00BF1FF504",  // FWRG  – Fidelity Sustainable Research Wld
  "IE00BKSBGT50",  // FESG  – Fidelity Sustainable MSCI World

  // ── Franklin Templeton ────────────────────────────────────────────────────
  "IE00BHZRR147",  // already in list
  "IE00BFWFPX68",  // FLXE  – Franklin LibertyQ Global Equity
  "IE00BFWFPY75",  // FEUS  – Franklin LibertyQ US Equity
  // ── FinanceDatabase sourced European UCITS ETFs (1,616 unique) ──────────
  "IE00BYZK4669",
  "IE00BYZK4883",
  "IE00BK5H8015",
  "LU1829219556",
  "LU1829219713",
  "LU1829219986",
  "LU1681044480",
  "IE00BYVDRC61",
  "LU1681042864",
  "IE00BF1B7389",
  "LU1829220216",
  "IE00BYM11H29",
  "IE00BYM11J43",
  "IE00BJXFZ989",
  "LU1437017350",
  "LU1681043326",
  "LU1681040066",
  "LU1681041031",
  "LU1681041114",
  "LU1900067270",
  "LU1681041205",
  "LU1681040496",
  "IE00BK5BCD43",
  "IE00B7WK2W23",
  "LU1681045024",
  "LU1681046691",
  "LU1681040223",
  "LU2037748345",
  "LU1861138961",
  "LU1681038599",
  "IE00B9KNR336",
  "LU1900068914",
  "LU1525419294",
  "LU0496786905",
  "IE00BD4TY451",
  "IE00BX7RS555",
  "LU1681049109",
  "LU1834983394",
  "IE00BDR55703",
  "IE00BDQZN113",
  "IE00BDQZN550",
  "IE00B1FZS244",
  "IE00BJ5JNY98",
  "LU1681048127",
  "IE00BQT3VN15",
  "IE00BLSNMW37",
  "IE00BJK9H753",
  "IE00BJK9HD13",
  "IE00BJK3WF00",
  "IE00BJK9HH50",
  "IE00BK6Q9938",
  "IE00BYYLVJ24",
  "IE00BYYLVH00",
  "IE00BF0BCP69",
  "IE00BF4TWF63",
  "IE00BF5DXP42",
  "IE00BJXRZ273",
  "LU1829219390",
  "LU1829221966",
  "LU1834983550",
  "IE00BYXG2H39",
  "LU1571051751",
  "LU1033693638",
  "LU0603946798",
  "LU0392496427",
  "LU1104574725",
  "LU1104577314",
  "LU2082995734",
  "LU1233598447",
  "LU1681047236",
  "LU1681041387",
  "LU1079842321",
  "LU1446552652",
  "LU1079841273",
  "LU1681046261",
  "LU0419741177",
  "LU0488317701",
  "IE00BJSBCS90",
  "LU0378453376",
  "IE00BF16M727",
  "LU1215461085",
  "IE00B3VWN179",
  "IE00BJ5JNZ06",
  "LU1048316647",
  "LU1048314949",
  "LU1048315326",
  "LU1048317025",
  "LU1681043912",
  "IE00BZ0XVF52",
  "IE00B53H0131",
  "IE00BYT5CW92",
  "LU1681047319",
  "LU1681041973",
  "IE00BKWQ0C77",
  "LU1681045537",
  "LU1681043755",
  "LU1900066462",
  "IE00BG0J9Y53",
  "IE00BQN1K562",
  "IE00BQN1K786",
  "IE00B53QG562",
  "IE00B3VWMM18",
  "LU1681042609",
  "LU1437015735",
  "IE00BKBF6616",
  "LU1681042435",
  "LU1440654330",
  "IE00BKLF1R75",
  "LU1681043086",
  "IE00B53L4350",
  "IE00BKTLJC87",
  "LU1602144732",
  "IE00B53QDK08",
  "LU2056738490",
  "LU2056739464",
  "IE00BDDRDW15",
  "IE00B4WPHX27",
  "IE00BF4J0300",
  "LU1681044647",
  "IE00BKFB6K94",
  "LU0533032008",
  "IE00BNH72088",
  "IE00BKFB6L02",
  "LU0533032263",
  "LU0444605215",
  "LU1681044308",
  "LU1834983808",
  "LU1834988518",
  "IE00BKWQ0D84",
  "IE00B3VWLG82",
  "LU1681044993",
  "IE00BMDX0K95",
  "IE00BKTLJB70",
  "LU1681042518",
  "LU1681046006",
  "LU1681045883",
  "IE00BZ2GV965",
  "IE00BJXRZJ40",
  "IE00B3Z66S39",
  "LU0478205379",
  "LU0252633754",
  "LU0328475792",
  "LU0397221945",
  "LU0292108619",
  "LU0292109187",
  "LU0292109856",
  "LU0290357259",
  "LU0274211217",
  "LU0290357507",
  "LU0290357846",
  "LU0274209740",
  "LU0290358224",
  "LU0290355717",
  "LU0290356871",
  "LU0290356954",
  "LU0290357176",
  "LU0290358497",
  "LU0274210672",
  "IE00BKRWN659",
  "IE00BHJYDV33",
  "LU2240851688",
  "LU1437018168",
  "IE00BKLWY790",
  "LU1834985845",
  "IE00BZ56RG20",
  "IE00BQZJBQ63",
  "LU2023678878",
  "LU1407890620",
  "IE00BZ0PKT83",
  "IE00BK5BC677",
  "IE00BYZK4776",
  "LU2023678282",
  "LU0322250712",
  "LU0328476410",
  "LU0380865021",
  "LU0322252338",
  "LU0292100806",
  "LU0292103651",
  "LU0321463506",
  "LU1971906802",
  "LU2198884491",
  "LU1525418643",
  "IE00BGL86Z12",
  "LU1686830065",
  "LU1377382368",
  "LU0721553864",
  "IE00BF0M6N54",
  "LU2037748774",
  "LU1615090864",
  "IE00BHZPJ015",
  "IE00BHZPJ783",
  "IE00BF2PG656",
  "IE00BHZPJ452",
  "IE00BHZPJ908",
  "IE00BHZPJ569",
  "LU0950381748",
  "IE00BHZPJ890",
  "LU0192223062",
  "IE00BYQCZX56",
  "LU1291109293",
  "LU2008763935",
  "LU1792117340",
  "IE00BHZPJ676",
  "LU1291099718",
  "IE00BG11HV38",
  "LU1291100664",
  "IE00BD5KGK77",
  "IE00BZ56TQ67",
  "LU1834987973",
  "IE00BYYXBF44",
  "IE00BZ4BMM98",
  "LU1834986900",
  "LU1481203070",
  "LU1291102447",
  "LU1291103338",
  "LU2023679090",
  "LU1215454460",
  "IE00BFTWP510",
  "LU1481202775",
  "IE00B466KX20",
  "LU1686831030",
  "IE00B3Z3FS74",
  "IE00BP46NG52",
  "IE00BJL36X53",
  "LU1686830909",
  "IE00B4P11460",
  "IE00BH3X8336",
  "IE00BHZPHZ28",
  "LU1377382012",
  "IE00B469F816",
  "IE00B48X4842",
  "IE00B3LK4Z20",
  "LU0147308422",
  "IE00B910VR50",
  "IE00BCLWRF22",
  "IE00BCLWRD08",
  "LU1953137681",
  "LU1169820641",
  "LU0446734369",
  "LU1291108642",
  "LU1291104575",
  "LU0533032420",
  "IE00BKWQ0F09",
  "LU1291106356",
  "LU1437018838",
  "LU1681039480",
  "LU1215452928",
  "IE0032077012",
  "IE00BYVTMW98",
  "IE00BYYHSM20",
  "LU1215451524",
  "LU1377382103",
  "LU1812090899",
  "LU1940199711",
  "IE00BMW42298",
  "IE00BMW42637",
  "IE00BMW42306",
  "IE00BMW42181",
  "IE00BMW42074",
  "IE00BMW42413",
  "IE00BYWQWR46",
  "LU1861137484",
  "LU2018760954",
  "LU1931975079",
  "LU1931974262",
  "LU1931974429",
  "LU1931975236",
  "LU1931975152",
  "LU1931974775",
  "LU1931974858",
  "LU2037749152",
  "LU1931975319",
  "IE00BYQJ1388",
  "IE00BFXR5S54",
  "IE00BFXR5Q31",
  "IE00B6YX5F63",
  "IE00B3T9LM79",
  "IE00B5M1WJ87",
  "LU1600334798",
  "LU1804202403",
  "IE0008470928",
  "IE00BSJCQV56",
  "LU1377382285",
  "IE00BSPLC306",
  "LU1377381717",
  "LU1377381980",
  "IE00BD5J2G21",
  "IE00BL0L0H60",
  "IE00BG0SSC32",
  "IE00B8X9NY41",
  "IE00BYTH6121",
  "IE00BKSBGV72",
  "LU1834984798",
  "LU0533032859",
  "IE00B8X9NZ57",
  "IE00BFWXDW46",
  "IE00BFWXDY69",
  "LU2018760012",
  "LU2018761762",
  "IE00BMDPBZ72",
  "IE00BHZRQY00",
  "IE00BF2B0L69",
  "IE00BF2B0K52",
  "IE00BF2B0N83",
  "IE00BHZRQZ17",
  "IE00BHZRR030",
  "IE00BF2B0P08",
  "IE00BF2B0M76",
  "IE00BKWQ0G16",
  "IE00BYTH6238",
  "IE00BFD2H405",
  "IE00BKS2X317",
  "IE00BZ0PKS76",
  "IE00BD5FCF91",
  "IE00BL0L0D23",
  "IE00BD5HBQ97",
  "IE00BWTNM966",
  "IE00BKSBGS44",
  "IE00BKVKW020",
  "IE00BJ5CMD00",
  "IE00B9CQXS71",
  "IE00B8GF1M35",
  "IE00BDT6FP91",
  "IE00BDFBTQ78",
  "IE00BDR5GV14",
  "IE00BF540Z61",
  "IE00B7KMNP07",
  "LU1437016204",
  "IE00BZ56RN96",
  "LU2099295466",
  "LU2099296274",
  "IE00BQWJFQ70",
  "LU1910939849",
  "IE00B43QJJ40",
  "IE00BK5BC891",
  "IE00BH4GR342",
  "IE00BG0TQ445",
  "IE00BG0TQD32",
  "IE00B6YX5L24",
  "IE00BG0TQC25",
  "IE00B6YX5K17",
  "IE00B3W74078",
  "LU1681048630",
  "LU1446552496",
  "LU1861136247",
  "LU1861132840",
  "LU0259322260",
  "IE00B3S5XW04",
  "IE00BD8KRH84",
  "LU1598688189",
  "IE00BFWFPX50",
  "IE00B5SSQT16",
  "IE00BKY55W78",
  "IE00B64PTF05",
  "IE00BKY59K37",
  "IE00BKZGB098",
  "IE00BF4NQ904",
  "IE00BKY59G90",
  "IE00BKY58G26",
  "IE00B42TW061",
  "IE00B5WFQ436",
  "IE00B5BD5K76",
  "IE00B5KQNG97",
  "IE00B5W34K94",
  "IE00B5LP3W10",
  "IE00B51B7Z02",
  "IE00BDFBTK17",
  "IE00BYVTMX06",
  "IE00BWTN6Y99",
  "LU1169827224",
  "IE00BKWQ0H23",
  "LU0533033238",
  "IE00BMYDM794",
  "IE00BF541080",
  "IE00BZ0PKV06",
  "IE00B66F4759",
  "IE00B02KXH56",
  "IE00B4MCHD36",
  "IE00BJ5JPG56",
  "IE00BDFL4P12",
  "IE00B40B8R38",
  "IE00B0M63730",
  "IE00B42NKQ00",
  "IE00B6QGFW01",
  "IE00B1FZSB30",
  "IE00B57X3V84",
  "LU1834987890",
  "LU0533033402",
  "LU1900065811",
  "LU1390062245",
  "IE00BDVPNG13",
  "IE00BF5LJ058",
  "IE00BGDQ0L74",
  "LU2023679256",
  "LU1603795458",
  "LU1603797587",
  "LU1603797074",
  "IE00B0M63060",
  "IE00BJQRDN15",
  "IE00BJQRDP39",
  "IE00BMW3QX54",
  "IE00BP3QZ601",
  "IE00BP3QZ825",
  "IE00BP3QZD73",
  "IE00BP3QZJ36",
  "IE00BYPLS672",
  "IE00BYMB4Q22",
  "IE00BKWQ0K51",
  "IE00BDDRF700",
  "IE00BZ048579",
  "IE00BD1F4N50",
  "IE00BD1F4L37",
  "IE00BD1F4K20",
  "IE00BD1F4M44",
  "IE00BYVZV757",
  "IE00BD9MMD49",
  "IE00BF59RW70",
  "IE00BF4G7183",
  "IE00BD9MMC32",
  "IE00BKKCKJ46",
  "IE00BF4G6Y48",
  "IE00BKV0QF55",
  "IE00BL0BLZ15",
  "IE00BDFC6G93",
  "IE00BF4G6Z54",
  "LU1681047665",
  "IE00BZ0G8C04",
  "LU1169822936",
  "IE00BJRCLL96",
  "IE00BZ0G8B96",
  "LU1254453738",
  "LU0136240974",
  "LU1230561679",
  "LU1273488475",
  "IE00BJRCLK89",
  "LU1646359452",
  "IE00BF59RX87",
  "IE00BF4G7076",
  "IE00BJ06C044",
  "LU1753045928",
  "IE00BKPT4N29",
  "IE00BJGWQN72",
  "IE00BFXR7892",
  "LU1681046774",
  "LU0599613147",
  "LU1287022708",
  "LU1900066629",
  "LU1900066207",
  "LU1781541252",
  "LU2133056387",
  "LU1781540957",
  "LU1781541096",
  "IE00BMYDMB35",
  "IE00BMYDM919",
  "LU1792117696",
  "LU1792117779",
  "IE00BFXR5T61",
  "IE00BYSZ6062",
  "LU0908501058",
  "LU0832436512",
  "LU1220245556",
  "IE00BFXR5R48",
  "LU1834988195",
  "LU1901001542",
  "LU1832418773",
  "LU1834988278",
  "IE00B802KR88",
  "LU1834988351",
  "LU1812091947",
  "LU1834988435",
  "LU1923627092",
  "LU1834988609",
  "LU1900067601",
  "LU1834988781",
  "LU1834988864",
  "LU0832435464",
  "LU1812091517",
  "LU0533033824",
  "LU1812091350",
  "LU1081771369",
  "LU0533033667",
  "LU0533034129",
  "LU0533034558",
  "LU1812092168",
  "LU1407888053",
  "LU1900067437",
  "LU1681041460",
  "IE00BF4TWC33",
  "LU0908501132",
  "IE00B67B7N93",
  "LU1681041627",
  "LU1589349734",
  "IE00B94ZB998",
  "IE00BHZKHS06",
  "LU1481201538",
  "LU1093307442",
  "IE00BFWMQ331",
  "IE00BKWQ0L68",
  "IE00BKVL7331",
  "IE00BKVL7D31",
  "IE00BKVL7778",
  "IE00BHNGHX58",
  "IE00B60SWY32",
  "IE00B60SX287",
  "IE00BK5LYT47",
  "IE00BYX5K108",
  "IE00B60SX170",
  "IE00BPRCH686",
  "IE00BVGC6751",
  "IE00BKWQ0J47",
  "LU0659578842",
  "IE00BD3RYZ16",
  "IE00BD0B9B76",
  "IE00BJBLDK52",
  "IE00BF4Q4063",
  "LU2198883410",
  "LU2198882362",
  "IE00B23D8X81",
  "IE00B5ZR2157",
  "LU2089238625",
  "LU2089238039",
  "LU2089238971",
  "LU2089238385",
  "LU2089239276",
  "LU2089238898",
  "LU2089239193",
  "LU2089238468",
  "LU2089238112",
  "IE00B23LNN70",
  "IE00B23LNQ02",
  "LU1681041890",
  "IE00BDBRT036",
  "IE00BYVJRR92",
  "IE00BYYHSQ67",
  "LU1481201611",
  "IE00B622SG73",
  "IE00BJ38QD84",
  "IE00BYWZ0333",
  "IE00BK5BCH80",
  "IE00BZ1NCS44",
  "LU1681038672",
  "IE00B3CNHJ55",
  "IE00B60SX402",
  "IE00B60SWT88",
  "IE00B60SWV01",
  "LU1169830525",
  "IE00BHXMHK04",
  "IE00BHXMHN35",
  "IE00B60SWW18",
  "IE00BFNM3J75",
  "IE00B3Q19T94",
  "LU2109787478",
  "LU2109787395",
  "LU2109787122",
  "IE00BFNM3D14",
  "IE00BFNM3L97",
  "IE00BFNM3G45",
  "IE00BFNM3B99",
  "LU1324516720",
  "LU2109786744",
  "IE00BQ70R696",
  "LU2109786587",
  "LU2109786827",
  "IE00B5MTZ595",
  "IE00B60SWZ49",
  "IE00B60SX063",
  "IE00B5MTWH09",
  "LU2037749822",
  "IE00BYZTVV78",
  "IE00BDDRF924",
  "IE00BKWQ0M75",
  "IE00BJM0B415",
  "IE00BJLKK341",
  "IE00BD34DB16",
  "IE00B7K93397",
  "IE00BYSZ5R67",
  "IE00BYSZ5T81",
  "IE00BYYW2V44",
  "IE00B6YX5C33",
  "IE00BKWQ0Q14",
  "IE00B6S2Z822",
  "IE00BKWQ0N82",
  "IE00BKWQ0P07",
  "LU2109787635",
  "LU1753045415",
  "LU1574142243",
  "IE00BWBXM831",
  "IE00BWBXM500",
  "IE00BWBXM724",
  "IE00BWBXM948",
  "IE00BWBXMB69",
  "IE00BWBXM617",
  "IE00BWBXM278",
  "IE00BDQYWQ65",
  "IE00B459R192",
  "IE00BC7GZJ81",
  "IE00BZ0G8977",
  "IE00BN4GXL63",
  "IE00BH059L74",
  "IE00BL6XZW69",
  "LU1459802754",
  "LU1459803133",
  "LU1459801434",
  "LU1459802168",
  "LU1681038169",
  "IE00BHPGG813",
  "IE00BYQ00Y50",
  "LU1525418726",
  "IE00B77D4428",
  "IE00B7KQ7B66",
  "IE00BD4TYG73",
  "IE00BX7RQY03",
  "IE00BX7RR706",
  "IE00BX7RRJ27",
  "IE00BX7RR250",
  "IE00BX7RRC57",
  "IE00BX7RRN62",
  "LU1806495575",
  "LU1324516050",
  "IE00BFZ11324",
  "LU2099294493",
  "LU2099295037",
  "LU0340285161",
  "LU0446734872",
  "LU0446734526",
  "LU0629460089",
  "LU0629460832",
  "IE00BD6GCF16",
  "LU1169821615",
  "IE00BMDBMH44",
  "LU0950670850",
  "IE00BRHZ0398",
  "LU1681040819",
  "LU1681040736",
  "LU1681040652",
  "IE00BLRPRD67",
  "IE00BD08DL65",
  "IE00BPYPPK00",
  "IE00BDGV0308",
  "IE00BDGV0C91",
  "LU2153616599",
  "LU1459800113",
  "LU1965301184",
  "IE00BSPLC520",
  "IE00BNG8L278",
  "IE00BNG8L385",
  "LU1481201702",
  "IE00BJXRT813",
  "IE00BLRPPV00",
  "LU1481201025",
  "LU1481201298",
  "IE00BG21M733",
  "IE00BLPK3577",
  "IE00BJ5JP212",
  "IE00BJ5JP329",
  "IE00BJ5JP105",
  "LU1861134382",
  "IE00BYPGTJ26",
  "LU0614173549",
  "LU0614173895",
  "LU0643975591",
  "LU1681038839",
  "LU1681046345",
  "LU1681046857",
  "IE00BYXYX521",
  "LU0962081203",
  "LU0460391732",
  "LU1981859819",
  "LU1127514245",
  "LU1127516455",
  "IE00BL25JN58",
  "IE00BL25JM42",
  "IE00BRB36B93",
  "IE00BPVLQD13",
  "IE00BGJWX091",
  "IE00BM67HW99",
  "LU1215828218",
  "LU0838780707",
  "IE00BZ1BS790",
  "LU1184092051",
  "IE00BG36TC12",
  "LU0322253229",
  "LU2009147591",
  "LU1109939865",
  "LU1109943388",
  "LU1109942653",
  "LU1242369327",
  "LU0820950128",
  "LU1215827756",
  "LU0659580236",
  "LU0927735406",
  "IE00BD4DXB77",
  "IE00B3Y8D011",
  "IE00BGQYRR35",
  "IE00BGQYRQ28",
  "IE00BCHWNS19",
  "IE00BCHWNW54",
  "LU0943504760",
  "LU1772333404",
  "IE00BDR5HM97",
  "IE00BSPLC298",

];

// ── Curated ticker/assetClass map for ISINs we know ──────────────────────────
// OpenFIGI will fill in the rest; this ensures known ETFs get the right ticker
const KNOWN_METADATA: Record<string, {
  ticker: string;
  primarySymbol: string;
  assetClass: string;
  exchanges: string[];
}> = {
  "IE00BK5BQT80": { ticker: "VWCE",  primarySymbol: "VWCE.DE",  assetClass: "Equity",      exchanges: ["XETRA","London","Milan","Amsterdam"] },
  "IE00B3RBWM25": { ticker: "VWRL",  primarySymbol: "VWRL.AS",  assetClass: "Equity",      exchanges: ["London","Amsterdam","XETRA","Milan"] },
  "IE00BFMXXD54": { ticker: "VUAA",  primarySymbol: "VUAA.DE",  assetClass: "Equity",      exchanges: ["XETRA","London","Milan","Amsterdam"] },
  "IE00B3XXRP09": { ticker: "VHVG",  primarySymbol: "VHVG.DE",  assetClass: "Equity",      exchanges: ["XETRA","London"] },
  "IE00B8GKDB10": { ticker: "VHYL",  primarySymbol: "VHYL.AS",  assetClass: "Equity",      exchanges: ["Amsterdam","London","XETRA"] },
  "IE00BG143G97": { ticker: "VEUR",  primarySymbol: "VEUR.AS",  assetClass: "Equity",      exchanges: ["Amsterdam","London","XETRA"] },
  "IE00B945VV12": { ticker: "VJPN",  primarySymbol: "VJPN.AS",  assetClass: "Equity",      exchanges: ["Amsterdam","London"] },
  "IE00BYXVGY31": { ticker: "VFEM",  primarySymbol: "VFEM.AS",  assetClass: "Equity",      exchanges: ["Amsterdam","London"] },
  "IE00B42WHV22": { ticker: "VECA",  primarySymbol: "VECA.AS",  assetClass: "Bonds",       exchanges: ["Amsterdam","London"] },
  "IE00BGPP6934": { ticker: "V3AA",  primarySymbol: "V3AA.DE",  assetClass: "Equity",      exchanges: ["XETRA","London"] },
  "IE00BFRTD982": { ticker: "VEUD",  primarySymbol: "VEUD.L",   assetClass: "Equity",      exchanges: ["London","XETRA"] },
  "IE00BMVB5P51": { ticker: "VNGA60",primarySymbol: "VNGA60.L", assetClass: "Equity",      exchanges: ["London"] },
  "IE00BKX55T58": { ticker: "VGWD",  primarySymbol: "VGWD.DE",  assetClass: "Equity",      exchanges: ["XETRA","London"] },
  "IE00B3VVMM84": { ticker: "VFEM",  primarySymbol: "VFEM.AS",  assetClass: "Equity",      exchanges: ["Amsterdam"] },
  "IE00B4L5Y983": { ticker: "IWDA",  primarySymbol: "IWDA.AS",  assetClass: "Equity",      exchanges: ["Amsterdam","London","XETRA","Milan"] },
  "IE00B5BMR087": { ticker: "CSPX",  primarySymbol: "CSPX.L",   assetClass: "Equity",      exchanges: ["London","XETRA","Amsterdam","Milan"] },
  "IE00BKM4GZ66": { ticker: "EIMI",  primarySymbol: "EIMI.L",   assetClass: "Equity",      exchanges: ["London","XETRA","Amsterdam","Milan"] },
  "IE00BDBRDM35": { ticker: "AGGH",  primarySymbol: "AGGH.L",   assetClass: "Bonds",       exchanges: ["London","XETRA","Amsterdam"] },
  "IE00B3F81R35": { ticker: "IGLA",  primarySymbol: "IGLA.L",   assetClass: "Bonds",       exchanges: ["London","Amsterdam"] },
  "IE00B1XNHC34": { ticker: "INRG",  primarySymbol: "INRG.L",   assetClass: "Equity",      exchanges: ["London","Amsterdam","XETRA"] },
  "IE00B53L3W79": { ticker: "IQQW",  primarySymbol: "IQQW.DE",  assetClass: "Equity",      exchanges: ["XETRA","London"] },
  "IE0031442068":  { ticker: "IUSA",  primarySymbol: "IUSA.L",   assetClass: "Equity",      exchanges: ["London","XETRA"] },
  "IE00B4WXJJ64": { ticker: "SMEA",  primarySymbol: "SMEA.L",   assetClass: "Equity",      exchanges: ["London","XETRA","Milan"] },
  "IE00B00FV128": { ticker: "IEMA",  primarySymbol: "IEMA.L",   assetClass: "Equity",      exchanges: ["London"] },
  "IE00B3MXWE44": { ticker: "IWDP",  primarySymbol: "IWDP.L",   assetClass: "Real Estate", exchanges: ["London","XETRA"] },
  "IE00B4BNMY34": { ticker: "SUWS",  primarySymbol: "SUWS.L",   assetClass: "Equity",      exchanges: ["London"] },
  "IE00B579F325": { ticker: "PPFB",  primarySymbol: "PPFB.L",   assetClass: "Commodities", exchanges: ["London","XETRA"] },
  "IE00B4ND3602": { ticker: "SGLD",  primarySymbol: "SGLD.L",   assetClass: "Commodities", exchanges: ["London"] },
  "IE00B3CNHF18": { ticker: "CNDX",  primarySymbol: "CNDX.L",   assetClass: "Equity",      exchanges: ["London"] },
  "IE00B52MJY50": { ticker: "LOCK",  primarySymbol: "LOCK.L",   assetClass: "Equity",      exchanges: ["London"] },
  "IE00B3WJKG14": { ticker: "EQQQ",  primarySymbol: "EQQQ.L",   assetClass: "Equity",      exchanges: ["London","XETRA","Amsterdam"] },
  "IE00B4L5YX21": { ticker: "DHYA",  primarySymbol: "DHYA.L",   assetClass: "Bonds",       exchanges: ["London"] },
  "IE00B4K48X80": { ticker: "IMEA",  primarySymbol: "IMEA.L",   assetClass: "Equity",      exchanges: ["London","XETRA"] },
  "IE00B0M62Q58": { ticker: "IQQE",  primarySymbol: "IQQE.DE",  assetClass: "Equity",      exchanges: ["XETRA","London"] },
  "IE00BD4TXV59": { ticker: "IGWD",  primarySymbol: "IGWD.L",   assetClass: "Equity",      exchanges: ["London"] },
  "IE00BG0J4957": { ticker: "PGAS",  primarySymbol: "PGAS.L",   assetClass: "Equity",      exchanges: ["London"] },
  "IE00BZ048462": { ticker: "IBTU",  primarySymbol: "IBTU.L",   assetClass: "Bonds",       exchanges: ["London"] },
  "IE00BZ048932": { ticker: "IBTM",  primarySymbol: "IBTM.L",   assetClass: "Bonds",       exchanges: ["London"] },
  "IE00BYXVGZ48": { ticker: "IBTL",  primarySymbol: "IBTL.L",   assetClass: "Bonds",       exchanges: ["London"] },
  "IE00BLNMYC90": { ticker: "EUNH",  primarySymbol: "EUNH.DE",  assetClass: "Bonds",       exchanges: ["XETRA","London"] },
  "IE00B3FH7618": { ticker: "IHYG",  primarySymbol: "IHYG.L",   assetClass: "Bonds",       exchanges: ["London","XETRA","Amsterdam"] },
  "IE00B52VJ196": { ticker: "IDVY",  primarySymbol: "IDVY.L",   assetClass: "Equity",      exchanges: ["London","Amsterdam"] },
  "IE00BYVJRP78": { ticker: "IGLN",  primarySymbol: "IGLN.L",   assetClass: "Commodities", exchanges: ["London","XETRA","Amsterdam"] },
  "IE00B14X4S71": { ticker: "IPRP",  primarySymbol: "IPRP.L",   assetClass: "Real Estate", exchanges: ["London"] },
  "IE00B6TLBW47": { ticker: "CEBL",  primarySymbol: "CEBL.L",   assetClass: "Bonds",       exchanges: ["London"] },
  "IE00B6R52259": { ticker: "MVOL",  primarySymbol: "MVOL.L",   assetClass: "Equity",      exchanges: ["London","XETRA"] },
  "IE00B3ZW0K18": { ticker: "IEAG",  primarySymbol: "IEAG.L",   assetClass: "Bonds",       exchanges: ["London","XETRA"] },
  "IE00B5L01S80": { ticker: "IGLT",  primarySymbol: "IGLT.L",   assetClass: "Bonds",       exchanges: ["London"] },
  "IE00B52MJD48": { ticker: "CBU7",  primarySymbol: "CBU7.L",   assetClass: "Bonds",       exchanges: ["London","XETRA"] },
  "IE00B3F81409": { ticker: "IEAC",  primarySymbol: "IEAC.L",   assetClass: "Bonds",       exchanges: ["London","XETRA","Amsterdam"] },
  "IE00B42Z5J44": { ticker: "GHYS",  primarySymbol: "GHYS.L",   assetClass: "Bonds",       exchanges: ["London"] },
  "IE00B0M63177": { ticker: "IQEM",  primarySymbol: "IQEM.L",   assetClass: "Equity",      exchanges: ["London","XETRA"] },
  "IE00B14X4M10": { ticker: "IEMS",  primarySymbol: "IEMS.L",   assetClass: "Equity",      exchanges: ["London"] },
  "IE00BFY0GT14": { ticker: "PAWD",  primarySymbol: "PAWD.L",   assetClass: "Equity",      exchanges: ["London","XETRA"] },
  "IE00BFNM3P36": { ticker: "IBTN",  primarySymbol: "IBTN.L",   assetClass: "Bonds",       exchanges: ["London"] },
  "IE00BD45KH83": { ticker: "IBHB",  primarySymbol: "IBHB.L",   assetClass: "Bonds",       exchanges: ["London"] },
  "IE00B52SF786": { ticker: "IB5S",  primarySymbol: "IB5S.L",   assetClass: "Equity",      exchanges: ["London"] },
  "IE00B441G979": { ticker: "IB4G",  primarySymbol: "IB4G.L",   assetClass: "Equity",      exchanges: ["London"] },
  "IE00B6YX5D40": { ticker: "IB6Y",  primarySymbol: "IB6Y.L",   assetClass: "Equity",      exchanges: ["London"] },
  "IE00B8KGV557": { ticker: "IB8K",  primarySymbol: "IB8K.L",   assetClass: "Equity",      exchanges: ["London"] },
  "IE00BCBJG560": { ticker: "IBCJ",  primarySymbol: "IBCJ.L",   assetClass: "Equity",      exchanges: ["London"] },
  "IE00BG0J4C88": { ticker: "IBG4",  primarySymbol: "IBG4.L",   assetClass: "Equity",      exchanges: ["London"] },
  "IE00BL25JP72": { ticker: "IBL2",  primarySymbol: "IBL2.L",   assetClass: "Equity",      exchanges: ["London"] },
  "IE00BMTX1Y45": { ticker: "IBMT",  primarySymbol: "IBMT.L",   assetClass: "Bonds",       exchanges: ["London"] },
  "IE00BP3QZB59": { ticker: "IBP3",  primarySymbol: "IBP3.L",   assetClass: "Equity",      exchanges: ["London"] },
  "IE00BQN1K901": { ticker: "IBQN",  primarySymbol: "IBQN.L",   assetClass: "Equity",      exchanges: ["London"] },
  "IE00BZ163L38": { ticker: "IBBZ",  primarySymbol: "IBBZ.L",   assetClass: "Bonds",       exchanges: ["London"] },
  "IE00BWBXM492": { ticker: "IBBW",  primarySymbol: "IBBW.L",   assetClass: "Equity",      exchanges: ["London"] },
  "IE00BJ0KDQ92": { ticker: "XDWD",  primarySymbol: "XDWD.DE",  assetClass: "Equity",      exchanges: ["XETRA","London","Milan"] },
  "LU0274208692": { ticker: "DBXD",  primarySymbol: "DBXD.DE",  assetClass: "Equity",      exchanges: ["XETRA"] },
  "LU0490618542": { ticker: "X010",  primarySymbol: "X010.DE",  assetClass: "Equity",      exchanges: ["XETRA"] },
  "IE00BJQRDM42": { ticker: "XDGE",  primarySymbol: "XDGE.L",   assetClass: "Equity",      exchanges: ["London"] },
  "LU0292096186": { ticker: "DXET",  primarySymbol: "DXET.DE",  assetClass: "Equity",      exchanges: ["XETRA"] },
  "LU0629459743": { ticker: "DXME",  primarySymbol: "DXME.DE",  assetClass: "Equity",      exchanges: ["XETRA"] },
  "LU0675401409": { ticker: "XTRJ",  primarySymbol: "XTRJ.DE",  assetClass: "Equity",      exchanges: ["XETRA"] },
  "LU0839027447": { ticker: "XTRM",  primarySymbol: "XTRM.DE",  assetClass: "Equity",      exchanges: ["XETRA"] },
  "LU1107358523": { ticker: "XTRO",  primarySymbol: "XTRO.DE",  assetClass: "Equity",      exchanges: ["XETRA"] },
  "LU1287023003": { ticker: "XTRP",  primarySymbol: "XTRP.DE",  assetClass: "Equity",      exchanges: ["XETRA"] },
  "LU1681043599": { ticker: "CW8",   primarySymbol: "CW8.PA",   assetClass: "Equity",      exchanges: ["Paris","Milan"] },
  "LU1781541179": { ticker: "LCWD",  primarySymbol: "LCWD.PA",  assetClass: "Equity",      exchanges: ["Paris","Amsterdam"] },
  "LU1437016972": { ticker: "PAEEM", primarySymbol: "PAEEM.PA", assetClass: "Equity",      exchanges: ["Paris"] },
  "LU1829221024": { ticker: "MWRD",  primarySymbol: "MWRD.L",   assetClass: "Equity",      exchanges: ["London"] },
  "LU1650490474": { ticker: "AMUI",  primarySymbol: "AMUI.PA",  assetClass: "Equity",      exchanges: ["Paris","XETRA"] },
  "LU1900066200": { ticker: "AMUJ",  primarySymbol: "AMUJ.PA",  assetClass: "Equity",      exchanges: ["Paris"] },
  "IE00BZ163G84": { ticker: "TDIV",  primarySymbol: "TDIV.AS",  assetClass: "Equity",      exchanges: ["Amsterdam","XETRA"] },
  "IE00BQZJBM26": { ticker: "VEMT",  primarySymbol: "VEMT.AS",  assetClass: "Bonds",       exchanges: ["Amsterdam","London"] },
  "IE00BHZRR147": { ticker: "GDX",   primarySymbol: "GDX.L",    assetClass: "Equity",      exchanges: ["London"] },
  "IE00B44Z5B48": { ticker: "SPPW",  primarySymbol: "SPPW.DE",  assetClass: "Equity",      exchanges: ["XETRA","London","Amsterdam"] },
  "IE00BWBXM385": { ticker: "SPYL",  primarySymbol: "SPYL.L",   assetClass: "Equity",      exchanges: ["London","Amsterdam"] },
  "IE00B60SX394": { ticker: "MXWO",  primarySymbol: "MXWO.L",   assetClass: "Equity",      exchanges: ["London"] },
  "IE00B23D8W74": { ticker: "MXUS",  primarySymbol: "MXUS.L",   assetClass: "Equity",      exchanges: ["London"] },
  "IE00B27YCF74": { ticker: "QQQ3",  primarySymbol: "QQQ3.MI",  assetClass: "Equity",      exchanges: ["Milan"] },
  "IE00B3YX3J38": { ticker: "PAGG",  primarySymbol: "PAGG.L",   assetClass: "Bonds",       exchanges: ["London"] },
  "IE00B4X9L533": { ticker: "HMWO",  primarySymbol: "HMWO.L",   assetClass: "Equity",      exchanges: ["London"] },
  "IE000RHYOR98": { ticker: "SPYD",  primarySymbol: "SPYD.L",   assetClass: "Equity",      exchanges: ["London"] },
  "IE000TL6DP73": { ticker: "FLXE",  primarySymbol: "FLXE.L",   assetClass: "Equity",      exchanges: ["London"] },
};

// ── OpenFIGI exchCode → exchange name & priority ──────────────────────────────
const EXCH_PRIORITY: Record<string, { name: string; rank: number }> = {
  "LN": { name: "London",    rank: 1 },
  "GY": { name: "XETRA",    rank: 2 },
  "NA": { name: "Amsterdam", rank: 3 },
  "PA": { name: "Paris",     rank: 4 },
  "IM": { name: "Milan",     rank: 5 },
  "SW": { name: "Switzerland", rank: 6 },
  "QX": { name: "XETRA",    rank: 2 },  // Xetra Blue-Chip variant
  "QE": { name: "XETRA",    rank: 2 },
  "EB": { name: "Brussels",  rank: 7 },
  "IX": { name: "Dublin",    rank: 8 },
  "I2": { name: "Dublin",    rank: 8 },
  "S1": { name: "Switzerland", rank: 6 },
  "S4": { name: "Stuttgart", rank: 9 },
};

const TICKER_SUFFIX: Record<string, string> = {
  "LN": ".L",  "GY": ".DE", "QX": ".DE", "QE": ".DE",
  "NA": ".AS", "PA": ".PA", "IM": ".MI", "SW": ".SW",
  "S1": ".SW", "S4": ".SG", "EB": ".BR", "IX": ".IE", "I2": ".IE",
};

// ─────────────────────────────────────────────────────────────────────────────
// OPENFIGI LOOKUP  (Phase 1)
// ─────────────────────────────────────────────────────────────────────────────
interface FigiResult {
  ticker: string;
  name: string;
  exchCode: string;
  securityType: string;
  securityType2: string;
}

async function openFigiLookup(isins: string[]): Promise<Map<string, { ticker: string; name: string; exchanges: string[]; primarySymbol: string }>> {
  const body = isins.map(isin => ({ idType: "ID_ISIN", idValue: isin }));
  const res = await fetch("https://api.openfigi.com/v3/mapping", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json: Array<{ data?: FigiResult[]; error?: string }> = await res.json();

  const result = new Map<string, { ticker: string; name: string; exchanges: string[]; primarySymbol: string }>();

  for (let i = 0; i < isins.length; i++) {
    const isin = isins[i]!;
    const entry = json[i];
    if (!entry || entry.error || !entry.data?.length) continue;

    // Filter to ETPs only
    const etps = entry.data.filter(d =>
      d.securityType === "ETP" ||
      d.securityType2 === "ETF" ||
      d.securityType2 === "ETC"
    );
    if (!etps.length) continue;

    // Sort by exchange priority
    const sorted = [...etps].sort((a, b) => {
      const ra = EXCH_PRIORITY[a.exchCode]?.rank ?? 99;
      const rb = EXCH_PRIORITY[b.exchCode]?.rank ?? 99;
      return ra - rb;
    });

    const best = sorted[0]!;

    // Derive base ticker: common prefix of all tickers (strip exchange-specific suffix)
    const allTickers = [...new Set(sorted.map(e => e.ticker))];
    let baseTicker = best.ticker;
    if (allTickers.length > 1) {
      // Find longest common prefix
      let prefix = allTickers[0]!;
      for (const t of allTickers) {
        let j = 0;
        while (j < prefix.length && j < t.length && prefix[j] === t[j]) j++;
        prefix = prefix.substring(0, j);
      }
      if (prefix.length >= 3) baseTicker = prefix;
    }
    // Strip single-char exchange suffixes if appropriate (e.g. VWRLL → VWRL)
    if (baseTicker.length >= 5 && /[A-Z]$/.test(baseTicker)) {
      baseTicker = baseTicker.slice(0, -1);
    }

    const exchCode = best.exchCode;
    const suffix   = TICKER_SUFFIX[exchCode] ?? ".L";
    const primarySymbol = `${baseTicker}${suffix}`;

    // Exchanges from all ETP listings
    const exchanges = [...new Set(
      sorted.map(e => EXCH_PRIORITY[e.exchCode]?.name).filter(Boolean) as string[]
    )];

    result.set(isin, {
      ticker: baseTicker,
      name: best.name,   // abbreviated Bloomberg-style name
      exchanges: exchanges.length ? exchanges : ["London"],
      primarySymbol,
    });
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// JUSTETF SCRAPER  (Phase 2 — detail enrichment)
// ─────────────────────────────────────────────────────────────────────────────
async function fetchJustETF(isin: string): Promise<{ html: string } | null> {
  const url = `https://www.justetf.com/en/etf-profile.html?isin=${isin}`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept": "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    return { html };
  } catch {
    return null;
  }
}

function extractName(html: string): { name: string; shortName: string } | null {
  const m = html.match(/<title>([^<|]+)\|/);
  if (!m) return null;
  const name = m[1]!.trim();
  if (name === "ETF Screener" || name.length < 5) return null;
  const shortName = makeShortName(name);
  return { name, shortName };
}

function makeShortName(name: string): string {
  return name
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
}

// ─────────────────────────────────────────────────────────────────────────────
// YAHOO FINANCE ISIN SEARCH  (Phase 2 fallback — fast & no rate-limit issues)
// ─────────────────────────────────────────────────────────────────────────────
async function fetchYahooSearch(isin: string): Promise<{
  symbol: string; name: string; exchange: string
} | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${isin}&quotesCount=5&newsCount=0&enableFuzzyQuery=false`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const data = await res.json() as any;
    const quotes: any[] = data.quotes || [];
    const etf = quotes.find(q =>
      (q.quoteType === "ETF" || q.typeDisp?.toLowerCase() === "etf") &&
      (q.longname || q.shortname)
    );
    if (!etf) return null;
    return {
      symbol: etf.symbol,
      name: etf.longname || etf.shortname,
      exchange: etf.exchange || "",
    };
  } catch {
    return null;
  }
}

function yahooSymbolToDetails(symbol: string, domicile: string): {
  ticker: string; primaryTicker: string; currency: string; exchanges: string[]
} {
  const parts = symbol.split(".");
  const baseTicker = parts[0]!;
  const exch = parts[1] || "L";
  const suffixMap: Record<string, { currency: string; exchange: string }> = {
    "L":  { currency: "GBP", exchange: "London" },
    "PA": { currency: "EUR", exchange: "Euronext Paris" },
    "DE": { currency: "EUR", exchange: "XETRA" },
    "AS": { currency: "EUR", exchange: "Amsterdam" },
    "MI": { currency: "EUR", exchange: "Milan" },
    "SW": { currency: "CHF", exchange: "SIX Swiss" },
    "MC": { currency: "EUR", exchange: "Madrid" },
    "BR": { currency: "EUR", exchange: "Brussels" },
    "F":  { currency: "EUR", exchange: "Frankfurt" },
    "ST": { currency: "SEK", exchange: "Stockholm" },
    "CO": { currency: "DKK", exchange: "Copenhagen" },
    "HE": { currency: "EUR", exchange: "Helsinki" },
  };
  const info = suffixMap[exch] ?? { currency: "EUR", exchange: "London" };
  return {
    ticker: baseTicker,
    primaryTicker: symbol,
    currency: info.currency,
    exchanges: [info.exchange],
  };
}

function extractTER(html: string): number | null {
  const m =
    html.match(/data-testid="tl_etf-basics_value_ter">([^<]+)/) ||
    html.match(/Total expense ratio[^<]*<[^>]+>\s*([\d.]+)\s*%/i);
  if (m) {
    const v = parseFloat(m[1]!.replace("%","").trim());
    if (!isNaN(v) && v > 0 && v < 5) return v;
  }
  return null;
}

function extractDistribution(html: string): string | null {
  const m =
    html.match(/data-testid="tl_etf-basics_value_distribution-policy">([^<]+)/) ||
    html.match(/data-testid="etf-profile-header_distribution-policy-value">([^<]+)/);
  if (m) {
    const v = m[1]!.trim();
    if (/^(Accumulating|Distributing|Reinvesting)$/i.test(v)) return v;
  }
  return null;
}

function extractReplication(html: string): string | null {
  const m = html.match(/data-testid="tl_etf-basics_value_replication">([^<]+)/);
  if (m) return m[1]!.trim() || null;
  return null;
}

function extractDomicile(html: string, isin: string): string {
  const m = html.match(/data-testid="tl_etf-basics_value_fund-domicile">([^<]+)/);
  if (m) return m[1]!.trim();
  return isin.startsWith("IE") ? "Ireland" : isin.startsWith("LU") ? "Luxembourg" : "Unknown";
}

function extractInception(html: string): string | null {
  const m = html.match(/data-testid="tl_etf-basics_value_inception-date">([^<]+)/);
  if (m) {
    const v = m[1]!.trim();
    // Standardise date format  DD.MM.YYYY → YYYY-MM-DD
    const dm = v.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    if (dm) return `${dm[3]}-${dm[2]}-${dm[1]}`;
    return v;
  }
  return null;
}

function extractFundSize(html: string): number | null {
  const m = html.match(/data-testid="tl_etf-basics_value_fund-size">([^<]+)/);
  if (m) {
    const raw = m[1]!.trim().replace(/[,\s]/g, "");
    const nm  = raw.match(/([\d.]+)/);
    if (nm) {
      const n = parseFloat(nm[1]!);
      if (!isNaN(n) && n > 0) return Math.round(n);
    }
  }
  return null;
}

function extractCurrency(html: string): string {
  const m = html.match(/data-testid="tl_etf-basics_value_currency">([^<]+)/);
  if (m) return m[1]!.trim();
  const cm = html.match(/\|\s*(USD|EUR|GBP|CHF|JPY)\s*\|/);
  if (cm) return cm[1]!;
  return "EUR";
}

// Attempt to extract primary ticker from JustETF page listing section
function extractTickerFromPage(html: string): string | null {
  // JustETF shows ticker in listing rows — grab first short (3-6 char) uppercase code
  const m = html.match(/class="[^"]*exchange[^"]*"[\s\S]{0,500}?([A-Z]{2,6})\s*<\/td>/);
  if (m && m[1]!.length <= 6) return m[1]!;
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function writeDB(dbPath: string, idxPath: string, allEtfs: any[]) {
  const filtered = allEtfs.filter(e => e.name && e.name !== "ETF Screener");
  const db = { version: "1.2", generatedAt: new Date().toISOString(), count: filtered.length, etfs: filtered };
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), "utf8");

  const isinIndex: Record<string, object>   = {};
  const tickerIndex: Record<string, object> = {};
  const nameIndex: { keywords: string[]; isin: string }[] = [];
  for (const etf of filtered) {
    isinIndex[etf.isin] = etf;
    if (etf.ticker) tickerIndex[etf.ticker.toUpperCase()] = etf;
    const words = etf.name.toLowerCase().split(/\s+/).filter((w: string) => w.length > 2);
    nameIndex.push({ keywords: words, isin: etf.isin });
  }
  fs.writeFileSync(idxPath, JSON.stringify({ isinIndex, tickerIndex, nameIndex }, null, 2), "utf8");
  return filtered.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log("\n🔨 Folvio ETF Database Builder v3");
  console.log("   Sources: OpenFIGI (bulk) + JustETF (details)\n");

  const outDir  = path.join(__dirname, "..", "assets");
  fs.mkdirSync(outDir, { recursive: true });
  const dbPath  = path.join(outDir, "etf-database.json");
  const idxPath = path.join(outDir, "etf-index.json");

  // ── Load existing DB ───────────────────────────────────────────────────────
  const existingByISIN = new Map<string, any>();
  if (fs.existsSync(dbPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(dbPath, "utf8"));
      for (const etf of existing.etfs ?? []) {
        if (etf.name && etf.name !== "ETF Screener") existingByISIN.set(etf.isin, etf);
      }
      console.log(`Loaded ${existingByISIN.size} existing ETFs from DB.`);
    } catch {}
  }

  // ── Deduplicate ISIN list ──────────────────────────────────────────────────
  const seen = new Set<string>();
  const unique = ALL_ISINS.filter(isin => {
    if (!isin || isin.length !== 12 || seen.has(isin)) return false;
    seen.add(isin);
    return true;
  });
  const toProcess = unique.filter(isin => !existingByISIN.has(isin));
  console.log(`Total unique ISINs: ${unique.length}`);
  console.log(`Already in DB (preserved): ${existingByISIN.size}`);
  console.log(`New ISINs to process: ${toProcess.length}\n`);

  // ── Phase 1: OpenFIGI bulk lookup ──────────────────────────────────────────
  console.log("── Phase 1: OpenFIGI lookup ─────────────────────────────────────");
  const FIGI_BATCH = 25;
  const figiMap = new Map<string, { ticker: string; name: string; exchanges: string[]; primarySymbol: string }>();

  // Test first batch — skip all OpenFIGI if rate-limited
  let openFigiSkipped = false;
  if (toProcess.length > 0) {
    const probe = toProcess.slice(0, Math.min(FIGI_BATCH, toProcess.length));
    process.stdout.write(`  OpenFIGI probe (${probe.length} ISINs)...`);
    try {
      const result = await openFigiLookup(probe);
      if (result.size === 0) {
        console.log(` ✗ Rate-limited — skipping OpenFIGI phase`);
        openFigiSkipped = true;
      } else {
        for (const [isin, data] of result) figiMap.set(isin, data);
        console.log(` ✓ ${result.size}/${probe.length} resolved`);
      }
    } catch (err) {
      console.log(` ✗ ${err} — skipping OpenFIGI phase`);
      openFigiSkipped = true;
    }
  }

  if (!openFigiSkipped) {
    for (let i = FIGI_BATCH; i < toProcess.length; i += FIGI_BATCH) {
      const batch = toProcess.slice(i, i + FIGI_BATCH);
      process.stdout.write(`  OpenFIGI batch ${Math.floor(i / FIGI_BATCH) + 1}/${Math.ceil(toProcess.length / FIGI_BATCH)} (${batch.length} ISINs)...`);
      try {
        const result = await openFigiLookup(batch);
        for (const [isin, data] of result) figiMap.set(isin, data);
        console.log(` ✓ ${result.size}/${batch.length} resolved`);
      } catch (err) {
        console.log(` ✗ ${err}`);
      }
      if (i + FIGI_BATCH < toProcess.length) await sleep(2500);
    }
  }
  console.log(`  OpenFIGI resolved ${figiMap.size}/${toProcess.length} new ISINs\n`);

  // ── Phase 2: ETF detail scraping (JustETF primary, Yahoo Finance fallback) ─
  console.log("── Phase 2: JustETF + Yahoo Finance (10 per batch, 1 s delay) ────");
  const JETF_BATCH = 10;
  const newEtfs: any[] = [];
  let nJustETF = 0, nYahoo = 0, nFigi = 0;

  for (let i = 0; i < toProcess.length; i += JETF_BATCH) {
    const batch = toProcess.slice(i, i + JETF_BATCH);
    console.log(`  Batch ${Math.floor(i / JETF_BATCH) + 1}/${Math.ceil(toProcess.length / JETF_BATCH)} [${i + 1}–${Math.min(i + JETF_BATCH, toProcess.length)}/${toProcess.length}]`);

    const results = await Promise.all(batch.map(async (isin) => {
      const known  = KNOWN_METADATA[isin];
      const figi   = figiMap.get(isin);
      const domicileFallback = isin.startsWith("IE") ? "Ireland" : isin.startsWith("LU") ? "Luxembourg" : "Unknown";

      // ── Try JustETF first (has TER, distribution, replication) ────────────
      const fetched = await fetchJustETF(isin);
      if (fetched) {
        const nameData = extractName(fetched.html);
        if (nameData) {
          nJustETF++;
          const ticker = known?.ticker ?? figi?.ticker ?? isin.slice(2, 6);
          const exchanges = known?.exchanges ?? figi?.exchanges ?? ["London"];
          const primarySymbol = known?.primarySymbol ?? figi?.primarySymbol ?? `${ticker}.L`;
          return {
            isin,
            ticker,
            name: nameData.name,
            shortName: nameData.shortName,
            assetClass: known?.assetClass ?? "Equity",
            ter: extractTER(fetched.html),
            distribution: extractDistribution(fetched.html),
            replication: extractReplication(fetched.html),
            currency: extractCurrency(fetched.html),
            domicile: extractDomicile(fetched.html, isin),
            inceptionDate: extractInception(fetched.html),
            fundSize: extractFundSize(fetched.html),
            exchanges,
            primaryTicker: primarySymbol,
            justETFUrl: `https://www.justetf.com/en/etf-profile.html?isin=${isin}`,
            _source: "JustETF",
          };
        }
      }

      // ── Try Yahoo Finance search (ticker + name from ISIN search) ──────────
      const yf = await fetchYahooSearch(isin);
      if (yf) {
        const yfDetails = yahooSymbolToDetails(yf.symbol, domicileFallback);
        const ticker = known?.ticker ?? yfDetails.ticker;
        const primarySymbol = known?.primarySymbol ?? yf.symbol;
        const currency = yfDetails.currency;
        const exchanges = known?.exchanges ?? yfDetails.exchanges;
        nYahoo++;
        return {
          isin,
          ticker,
          name: yf.name,
          shortName: makeShortName(yf.name),
          assetClass: known?.assetClass ?? "Equity",
          ter: null,
          distribution: null,
          replication: null,
          currency,
          domicile: domicileFallback,
          inceptionDate: null,
          fundSize: null,
          exchanges,
          primaryTicker: primarySymbol,
          justETFUrl: `https://www.justetf.com/en/etf-profile.html?isin=${isin}`,
          _source: "Yahoo",
        };
      }

      // ── Fall back to OpenFIGI name ─────────────────────────────────────────
      if (figi) {
        nFigi++;
        const ticker = known?.ticker ?? figi.ticker;
        const exchanges = known?.exchanges ?? figi.exchanges;
        return {
          isin,
          ticker,
          name: figi.name,
          shortName: figi.name,
          assetClass: known?.assetClass ?? "Equity",
          ter: null, distribution: null, replication: null,
          currency: isin.startsWith("IE") ? "USD" : "EUR",
          domicile: domicileFallback,
          inceptionDate: null, fundSize: null,
          exchanges,
          primaryTicker: known?.primarySymbol ?? figi.primarySymbol,
          justETFUrl: `https://www.justetf.com/en/etf-profile.html?isin=${isin}`,
          _source: "OpenFIGI",
        };
      }

      return null;
    }));

    for (const r of results) if (r) newEtfs.push(r);

    // Save after every batch (timeout-safe)
    const combined = [...existingByISIN.values(), ...newEtfs];
    const saved = writeDB(dbPath, idxPath, combined);
    console.log(`    Saved → DB now has ${saved} ETFs  [JustETF:${nJustETF} Yahoo:${nYahoo} FIGI:${nFigi}]`);

    if (i + JETF_BATCH < toProcess.length) await sleep(1000);
  }

  // ── Final write ────────────────────────────────────────────────────────────
  const allEtfs = [...existingByISIN.values(), ...newEtfs];
  const total   = writeDB(dbPath, idxPath, allEtfs);

  console.log(`\n✅ Database written: ${dbPath}`);
  console.log(`   Total ETFs: ${total}`);
  console.log(`   ├─ Preserved: ${existingByISIN.size}`);
  console.log(`   ├─ New (JustETF full): ${nJustETF}`);
  console.log(`   ├─ New (Yahoo search): ${nYahoo}`);
  console.log(`   └─ New (OpenFIGI name): ${nFigi}`);
  console.log(`\n🏁 Done!\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
