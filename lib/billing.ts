/**
 * Billing: every "Slutför" costs the plan price, re-finishes too. The price lives here and in
 * the PLAN_PRICE_SEK setting only.
 */

const DEFAULT_PLAN_PRICE_SEK = 50;

export function planPriceOre(setting = process.env.PLAN_PRICE_SEK): number {
  const sek = Number(setting ?? DEFAULT_PLAN_PRICE_SEK);
  return Number.isFinite(sek) && sek >= 0 ? Math.round(sek * 100) : DEFAULT_PLAN_PRICE_SEK * 100;
}

export type BillingPeriod = "day" | "week" | "month";

const TIME_ZONE = "Europe/Stockholm";

/** The wall-clock date and time in Stockholm at an instant. */
function stockholmParts(instant: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute"), second: value("second") };
}

/** The instant of midnight starting a Stockholm calendar day (month and day may overflow). */
export function stockholmMidnight(year: number, month: number, day: number): Date {
  // Guess UTC midnight, then correct by Stockholm's offset at that moment, twice to settle
  // across a daylight-saving change.
  let guess = Date.UTC(year, month - 1, day);
  for (let i = 0; i < 2; i += 1) {
    const local = stockholmParts(new Date(guess));
    const shownAsUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
    guess += Date.UTC(year, month - 1, day) - shownAsUtc;
  }
  return new Date(guess);
}

/**
 * The start and end of a billing period in Stockholm time, `offset` periods back (0 = the
 * current one). Weeks start on Monday.
 */
export function stockholmRange(period: BillingPeriod, offset = 0, now = new Date()): { from: Date; to: Date } {
  const today = stockholmParts(now);
  if (period === "month") {
    return {
      from: stockholmMidnight(today.year, today.month + offset, 1),
      to: stockholmMidnight(today.year, today.month + offset + 1, 1),
    };
  }
  if (period === "week") {
    const weekday = (new Date(Date.UTC(today.year, today.month - 1, today.day)).getUTCDay() + 6) % 7;
    const monday = today.day - weekday + offset * 7;
    return {
      from: stockholmMidnight(today.year, today.month, monday),
      to: stockholmMidnight(today.year, today.month, monday + 7),
    };
  }
  return {
    from: stockholmMidnight(today.year, today.month, today.day + offset),
    to: stockholmMidnight(today.year, today.month, today.day + offset + 1),
  };
}
