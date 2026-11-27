/**
 * Africa/Addis_Ababa Timezone Utilities
 * All daily evaluation limits strictly reset at midnight in the Africa/Addis_Ababa timezone (UTC+3).
 */

export const ETHIOPIA_TIMEZONE = "Africa/Addis_Ababa";

/**
 * Returns the calendar date string ("YYYY-MM-DD") in Africa/Addis_Ababa timezone.
 */
export function getAddisAbabaDateString(date: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: ETHIOPIA_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(date); // e.g. "2026-11-16"
}

/**
 * Returns the calendar month string ("YYYY-MM") in Africa/Addis_Ababa timezone.
 */
export function getAddisAbabaMonthString(date: Date = new Date()): string {
  return getAddisAbabaDateString(date).slice(0, 7);
}

/**
 * Calculates the exact UTC Date of the next midnight in Africa/Addis_Ababa.
 */
export function getAddisAbabaNextMidnight(date: Date = new Date()): Date {
  const currentDateStr = getAddisAbabaDateString(date);
  const [year, month, day] = currentDateStr.split("-").map(Number);

  // Africa/Addis_Ababa is always UTC+3 (no DST)
  // Midnight of the next day in UTC+3 corresponds to 21:00 UTC of the current day
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0, 0));
  // Subtract 3 hours (UTC+3 offset)
  const nextMidnightUtc = new Date(nextDay.getTime() - 3 * 60 * 60 * 1000);
  return nextMidnightUtc;
}

/**
 * Calculates the exact UTC Date of the start (00:00:00) of the current day in Africa/Addis_Ababa.
 */
export function getAddisAbabaMidnight(date: Date = new Date()): Date {
  const currentDateStr = getAddisAbabaDateString(date);
  const [year, month, day] = currentDateStr.split("-").map(Number);
  const currentDay = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  return new Date(currentDay.getTime() - 3 * 60 * 60 * 1000);
}

/**
 * Checks whether two dates fall on the exact same calendar day in Africa/Addis_Ababa.
 */
export function isSameAddisAbabaDay(date1: Date, date2: Date): boolean {
  return getAddisAbabaDateString(date1) === getAddisAbabaDateString(date2);
}
