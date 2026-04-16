/**
 * Exchange market hours utility.
 *
 * Each exchange maps to its local timezone and trading window so DST is
 * handled automatically via the Intl API.
 */

interface ExchangeSchedule {
  tz: string;
  openH: number;  openM: number;
  closeH: number; closeM: number;
}

const EXCHANGE_SCHEDULES: Record<string, ExchangeSchedule> = {
  "XETRA":        { tz: "Europe/Berlin",     openH:  9, openM: 0, closeH: 17, closeM: 30 },
  "EURONEXT_AMS": { tz: "Europe/Amsterdam",  openH:  9, openM: 0, closeH: 17, closeM: 40 },
  "EURONEXT_PAR": { tz: "Europe/Amsterdam",  openH:  9, openM: 0, closeH: 17, closeM: 40 },
  "EURONEXT_BRU": { tz: "Europe/Amsterdam",  openH:  9, openM: 0, closeH: 17, closeM: 40 },
  "LSE":          { tz: "Europe/London",     openH:  8, openM: 0, closeH: 16, closeM: 30 },
  "BORSA_IT":     { tz: "Europe/Rome",       openH:  9, openM: 0, closeH: 17, closeM: 35 },
  "SIX":          { tz: "Europe/Zurich",     openH:  9, openM: 0, closeH: 17, closeM: 30 },
  "BME":          { tz: "Europe/Madrid",     openH:  9, openM: 0, closeH: 17, closeM: 30 },
  "NASDAQ_HEL":   { tz: "Europe/Helsinki",   openH:  9, openM: 0, closeH: 17, closeM: 30 },
  "NASDAQ_STO":   { tz: "Europe/Stockholm",  openH:  9, openM: 0, closeH: 17, closeM: 30 },
  "OSLO":         { tz: "Europe/Oslo",       openH:  9, openM: 0, closeH: 17, closeM: 30 },
  "NASDAQ_CPH":   { tz: "Europe/Copenhagen", openH:  9, openM: 0, closeH: 17, closeM: 30 },
};

// Keep the old timezone-only map for any callers that only need the tz string
const EXCHANGE_TIMEZONES: Record<string, string> = Object.fromEntries(
  Object.entries(EXCHANGE_SCHEDULES).map(([k, v]) => [k, v.tz])
);

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
 * Uses per-exchange open/close times (Mon–Fri) in the exchange's local timezone.
 */
export function isExchangeOpen(exchange: string): boolean {
  const schedule = EXCHANGE_SCHEDULES[exchange];
  const tz  = schedule?.tz ?? "Europe/Berlin";
  const now = new Date();
  const { weekday, hour, minute } = getLocalTimeParts(tz, now);

  if (weekday === 0 || weekday === 6) return false; // weekend

  const total    = hour * 60 + minute;
  const openMin  = (schedule?.openH  ?? 9)  * 60 + (schedule?.openM  ?? 0);
  const closeMin = (schedule?.closeH ?? 17) * 60 + (schedule?.closeM ?? 30);

  return total >= openMin && total < closeMin;
}

/**
 * Returns a context-aware price status label.
 *
 * - No price / fetch failed  → "Price unavailable"  (grey, no icon)
 * - Market open              → ""                   (nothing — price is live)
 * - Market closed            → "Last close"         (grey, no icon)
 */
export function getPriceStatusLabel(
  exchange: string,
  _lastFetched: string | null | undefined,
  hasPrice: boolean,
  _isStale: boolean,
): string {
  if (!hasPrice) return "Price unavailable";
  if (isExchangeOpen(exchange)) return "";
  return "Last close";
}
