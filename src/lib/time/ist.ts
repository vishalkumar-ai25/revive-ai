// =============================================================================
// IST TIMEZONE UTILITIES
// =============================================================================
// Shared utilities for handling Indian Standard Time (IST, UTC+5:30)
// consistently without relying on the server's local process.env.TZ.

const IST_OFFSET_MINUTES = 5 * 60 + 30; // +5:30

/**
 * Returns the full IST date decomposition for a given UTC Date.
 */
export function toIstDate(date: Date) {
  const istDate = new Date(date.getTime() + IST_OFFSET_MINUTES * 60 * 1000);
  return {
    year: istDate.getUTCFullYear(),
    month: istDate.getUTCMonth(),
    date: istDate.getUTCDate(),
    hour: istDate.getUTCHours(),
    minute: istDate.getUTCMinutes(),
  };
}

/**
 * Returns the current IST hour (0-23) for a given UTC Date.
 */
export function toIstHour(date: Date): number {
  return toIstDate(date).hour;
}

/**
 * Returns the next occurrence of a specific IST hour/minute as a UTC Date.
 */
export function nextIstTime(date: Date, targetHourIst: number, targetMinuteIst: number = 0): Date {
  const ist = toIstDate(date);
  
  // Convert target IST to UTC target
  // e.g. 9:00 AM IST = 3:30 AM UTC
  let targetHourUtc = targetHourIst - 5;
  let targetMinuteUtc = targetMinuteIst - 30;

  if (targetMinuteUtc < 0) {
    targetMinuteUtc += 60;
    targetHourUtc -= 1;
  }
  if (targetHourUtc < 0) {
    targetHourUtc += 24;
  }

  // Calculate if the target has already passed today in IST
  let daysToAdd = 0;
  if (ist.hour > targetHourIst || (ist.hour === targetHourIst && ist.minute >= targetMinuteIst)) {
    daysToAdd = 1;
  }

  // Calculate the target time based on the IST date components, but represented in UTC
  const targetUtc = Date.UTC(ist.year, ist.month, ist.date + daysToAdd, targetHourUtc, targetMinuteUtc, 0, 0);
  
  return new Date(targetUtc);
}
