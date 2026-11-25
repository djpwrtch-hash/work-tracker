import { describe, expect, it } from 'vitest';
import {
  DAY_HOURS,
  cn,
  dayTypeLabel,
  formatDate,
  formatDateTime,
  formatHoursAsDuration,
  formatISTTime,
  formatOvertimeHours,
  formatWorkedDuration,
  getInitials,
  parseServerTime,
  statusColor,
} from './utils';

describe('dayTypeLabel', () => {
  it('labels work_end as Full Day', () => {
    expect(dayTypeLabel('work_end', 6)).toBe('Full Day');
    expect(dayTypeLabel('work_end', 8)).toBe('Full Day');
  });

  it('labels half_day as Half Day', () => {
    expect(dayTypeLabel('half_day', 3)).toBe('Half Day');
  });

  it('labels present/on_break/absent/leave/holiday/remote', () => {
    expect(dayTypeLabel('present')).toBe('Present');
    expect(dayTypeLabel('on_break')).toBe('On Break');
    expect(dayTypeLabel('absent')).toBe('Absent');
    expect(dayTypeLabel('leave')).toBe('Leave');
    expect(dayTypeLabel('holiday')).toBe('Holiday');
    expect(dayTypeLabel('remote')).toBe('Remote');
  });

  it('falls back to a prettified status for unknown statuses', () => {
    expect(dayTypeLabel('on_leave')).toBe('On Leave');
  });

  it('returns an em dash for empty status', () => {
    expect(dayTypeLabel('')).toBe('—');
  });
});

describe('formatOvertimeHours', () => {
  it('returns - for null, undefined, and non-positive values', () => {
    expect(formatOvertimeHours(null)).toBe('-');
    expect(formatOvertimeHours(undefined)).toBe('-');
    expect(formatOvertimeHours(0)).toBe('-');
    expect(formatOvertimeHours(-2)).toBe('-');
  });

  it('formats hours below a full day with h and m', () => {
    expect(formatOvertimeHours(1.5)).toBe('+1h 30m');
  });

  it('treats 8 cumulative hours as 1 day', () => {
    expect(formatOvertimeHours(8)).toBe('+1d 0h');
  });

  it('formats mixed days, hours, minutes', () => {
    expect(formatOvertimeHours(9.5)).toBe('+1d 1h 30m');
  });

  it('formats a handful of minutes alone', () => {
    expect(formatOvertimeHours(0.5)).toBe('+30m');
  });
});

describe('formatHoursAsDuration', () => {
  it('formats plain hours', () => {
    expect(formatHoursAsDuration(6)).toBe('6h 0m');
  });

  it('formats hours with minutes', () => {
    expect(formatHoursAsDuration(6.5)).toBe('6h 30m');
  });

  it('formats beyond a day', () => {
    expect(formatHoursAsDuration(DAY_HOURS + 2)).toBe('1d 2h 0m');
  });

  it('preserves a negative sign', () => {
    expect(formatHoursAsDuration(-3)).toBe('-3h 0m');
  });
});

describe('formatWorkedDuration', () => {
  it('returns 0h 0m for null, undefined, and non-positive', () => {
    expect(formatWorkedDuration(null)).toBe('0h 0m');
    expect(formatWorkedDuration(undefined)).toBe('0h 0m');
    expect(formatWorkedDuration(0)).toBe('0h 0m');
    expect(formatWorkedDuration(-1)).toBe('0h 0m');
  });

  it('formats hours and minutes', () => {
    expect(formatWorkedDuration(6.5)).toBe('6h 30m');
  });

  it('formats whole hours', () => {
    expect(formatWorkedDuration(8)).toBe('8h 0m');
  });
});

describe('cn', () => {
  it('merges class names and resolves tailwind conflicts', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
    const hidden = false as boolean;
    expect(cn('text-sm', hidden && 'hidden', undefined, 'font-bold')).toBe('text-sm font-bold');
  });

  it('returns an empty string with no inputs', () => {
    expect(cn()).toBe('');
  });
});

describe('formatDate', () => {
  it('formats a date as a short US date', () => {
    expect(formatDate('2026-01-15T12:00:00')).toBe('Jan 15, 2026');
  });

  it('accepts Date objects', () => {
    expect(formatDate(new Date(2026, 0, 15, 12))).toBe('Jan 15, 2026');
  });
});

describe('formatDateTime', () => {
  it('formats a datetime with date and 2-digit time', () => {
    const out = formatDateTime('2026-01-15T12:00:00');
    expect(out).toContain('Jan 15, 2026');
    expect(out).toMatch(/\d{2}:\d{2}/);
  });
});

describe('parseServerTime', () => {
  it('returns null for empty input', () => {
    expect(parseServerTime(null)).toBeNull();
    expect(parseServerTime(undefined)).toBeNull();
    expect(parseServerTime('')).toBeNull();
  });

  it('returns the same Date instance unchanged', () => {
    const d = new Date('2026-01-15T10:30:00Z');
    expect(parseServerTime(d)).toBe(d);
  });

  it('parses "YYYY-MM-DD HH:mm:ss" as UTC', () => {
    const d = parseServerTime('2026-01-15 10:30:00');
    expect(d?.toISOString()).toBe('2026-01-15T10:30:00.000Z');
  });

  it('parses other ISO strings', () => {
    const d = parseServerTime('2026-01-15T10:30:00Z');
    expect(d?.toISOString()).toBe('2026-01-15T10:30:00.000Z');
  });

  it('returns null for an invalid date string', () => {
    expect(parseServerTime('not-a-date')).toBeNull();
  });
});

describe('formatISTTime', () => {
  it('returns - for empty or invalid input', () => {
    expect(formatISTTime(null)).toBe('-');
    expect(formatISTTime(undefined)).toBe('-');
    expect(formatISTTime('garbage')).toBe('-');
  });

  it('converts a UTC server time to IST (UTC+5:30)', () => {
    expect(formatISTTime('2026-01-15 10:30:00')).toBe('16:00:00');
  });

  it('wraps across midnight', () => {
    expect(formatISTTime('2026-01-15 20:00:00')).toBe('01:30:00');
  });
});

describe('getInitials', () => {
  it('combines the first letters uppercased', () => {
    expect(getInitials('john', 'doe')).toBe('JD');
  });

  it('handles a missing last name', () => {
    expect(getInitials('john')).toBe('J');
  });

  it('falls back to ? when there is nothing to show', () => {
    expect(getInitials()).toBe('?');
    expect(getInitials('', '')).toBe('?');
  });
});

describe('statusColor', () => {
  it('returns a specific class for known statuses', () => {
    expect(statusColor('active')).toContain('text-emerald-400');
    expect(statusColor('rejected')).toContain('text-rose-400');
    expect(statusColor('pending')).toContain('text-amber-400');
  });

  it('returns the default class for an unknown status', () => {
    expect(statusColor('mystery')).toBe('bg-slate-500/15 text-slate-400 border-slate-500/20');
  });
});
