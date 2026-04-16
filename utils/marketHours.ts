/**
 * Exchange market hours utility.
 *
 * All major European equity exchanges trade Mon–Fri, 09:00–17:30 local time.
 * We use the Intl API to convert the current UTC time to the exchange's
 * local timezone so DST is handled automatically.
 */

const EXCHANGE_TIMEZONES: Record<string, string> = {
  "XETRA":        "Europe/Berlin",
  "EURONEXT_AMS": "Europe/Amsterdam",
  "EURONEXT_PAR": "Europe/Paris",
  "LSE":          "Europe/London",
  "BORSA_IT":     "Europe/Rome",
  "SIX":          "Europe/Zurich",
  "EURONEXT_BRU": "Europe/Brussels",
  "BME":          "Europe/Madrid",
  "NASDAQ_HEL":   "Europe/Helsinki",
  "NASDAQ_STO":   "Europe/Stockholm",
  "OSLO":         "Europe/Oslo",
  "NASDAQ_CPH":   "Europe/Copenhagen",
};

interface LocalTimeParts {
  weekday: number; // 0=Sun, 1=Mon … 6=Sat
  hour: number;
  minute: number;
}

function getLocalTimeParts(tz: string, date: Date): LocalTimeParts {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      weekday: "short",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    }).formatToParts(date);

    const weekdayStr = parts.find((p) => p.type === "weekday")?.value ?? "";
    const hour       = parseInt(parts.find((p) => p.type === "hour")?.value   ?? "0", 10);
    const minute     = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);

    const WEEKDAY_MAP: Record<string, number> = {
      Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
    };
    const weekday = WEEKDAY_MAP[weekdayStr] ?? date.getUTCDay();
    return { weekday, hour, minute };
  } catch {
    // Fallback: use UTC (conservative — may say "closed" when actually open)
    return {
      weekday: date.getUTCDay(),
      hour:    date.getUTCHours(),
      minute:  date.getUTCMinutes(),
    };
  }
}

/**
 * Returns true if the given exchange's market is currently open.
 * Hours: Mon–Fri 09:00–17:30 in the exchange's local timezone.
 */
export function isExchangeOpen(exchange: string): boolean {
  const tz  = EXCHANGE_TIMEZONES[exchange] ?? "Europe/Berlin";
  const now = new Date();
  const { weekday, hour, minute } = getLocalTimeParts(tz, now);

  if (weekday === 0 || weekday === 6) return false; // weekend

  const totalMinutes  = hour * 60 + minute;
  const openMinutes   = 9 * 60;        // 09:00
  const closeMinutes  = 17 * 60 + 30;  // 17:30

  return totalMinutes >= openMinutes && totalMinutes < closeMinutes;
}

/**
 * Returns a human-readable age string for a lastFetched timestamp.
 */
function ageLabel(lastFetched: string): string {
  const ageMs  = Date.now() - new Date(lastFetched).getTime();
  const mins   = Math.floor(ageMs / 60_000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/**
 * Returns a context-aware price status label for the holding detail header.
 *
 * - No price at all               → "Price unavailable"
 * - Market closed                 → "Last close price"
 * - Market open, price is stale   → "Price delayed · Xh ago"
 * - Market open, price is fresh   → "Live · Xm ago"
 */
export function getPriceStatusLabel(
  exchange: string,
  lastFetched: string | null | undefined,
  hasPrice: boolean,
  isStale: boolean,
): string {
  if (!hasPrice || !lastFetched) return "Price unavailable";

  if (!isExchangeOpen(exchange)) return "Last close price";

  // Market is open
  if (isStale) return `Price delayed · ${ageLabel(lastFetched)}`;
  return `Live · ${ageLabel(lastFetched)}`;
}
