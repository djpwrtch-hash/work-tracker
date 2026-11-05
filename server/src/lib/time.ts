import { config } from './config.js';

// Business timezone for "today", attendance dates and scheduled jobs.
// Configurable via APP_TIMEZONE (defaults to Asia/Kolkata).
const APP_TIMEZONE = config.timezone;

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: APP_TIMEZONE,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

// Offset of the configured timezone from UTC, in minutes, for a given instant.
// Uses Intl so DST transitions are handled correctly (unlike a fixed offset).
function timezoneOffsetMinutes(date: Date): number {
  const parts = partsFormatter.formatToParts(date);
  const values: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') values[part.type] = part.value;
  }
  // Some engines render midnight as hour 24.
  const hour = Number(values.hour) === 24 ? 0 : Number(values.hour);
  const asUTC = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    hour,
    Number(values.minute),
    Number(values.second)
  );
  // formatToParts has second precision, so compare against the instant floored to seconds.
  return (asUTC - Math.floor(date.getTime() / 1000) * 1000) / 60000;
}

export function getISTDate(): string {
  return dateFormatter.format(new Date());
}

export function getISTYear(): number {
  return Number(getISTDate().slice(0, 4));
}

// Returns the business-timezone calendar date for a given ISO timestamp/date string.
export function getISTDateFromISO(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return dateFormatter.format(d);
}

// Parses SQLite/MySQL datetime strings ('YYYY-MM-DD HH:mm:ss', UTC) and other
// date/time strings as UTC instead of the server's local timezone.
// Also handles Date objects from MySQL driver.
export function parseUTC(dateString: string | Date): Date {
  if (dateString instanceof Date) return dateString;
  const s = String(dateString).trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) {
    return new Date(s.replace(' ', 'T') + 'Z');
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(s)) {
    return new Date(s + 'Z');
  }
  return new Date(s);
}

export function getISTNow(): Date {
  // Business wall-clock as a Date, independent of server timezone:
  // shift the instant so that local getters (getHours) read the configured
  // timezone. On a UTC server (Docker/Railway) the UTC getters
  // (getUTCHours/toISOString) read it too. The old implementation used a
  // hardcoded +330 minutes; this derives the offset from APP_TIMEZONE so
  // other business timezones (including DST zones) work unchanged.
  const now = new Date();
  return new Date(now.getTime() + (timezoneOffsetMinutes(now) + now.getTimezoneOffset()) * 60000);
}

export function isISTPast(hours: number, minutes: number): boolean {
  const now = getISTNow();
  return (now.getHours() * 60 + now.getMinutes()) > (hours * 60 + minutes);
}

export function getISTDayOfWeek(): string {
  return new Date().toLocaleDateString('en-US', { timeZone: APP_TIMEZONE, weekday: 'long' });
}

export function isSundayIST(dateStr: string): boolean {
  // dateStr is YYYY-MM-DD already in the business timezone — parse as UTC to get correct day-of-week
  const parts = dateStr.split('-').map(Number);
  const y = parts[0] ?? 0;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 0;
}
