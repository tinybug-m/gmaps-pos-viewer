/**
 * Calendar maths in the team's business time zone, so "today", "overdue"
 * and dashboard ranges mean the same thing for every user and on the
 * server (which runs in UTC).
 */

export const BUSINESS_TIME_ZONE = "Europe/London";

const DAY_MS = 24 * 60 * 60 * 1000;

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function localParts(date: Date, timeZone: string): LocalParts {
  let fmt = formatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, fmt);
  }
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Milliseconds the zone is ahead of UTC at `date`. */
function offsetMs(date: Date, timeZone: string): number {
  const p = localParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** The instant a wall-clock time occurs in `timeZone`. Day overflow (e.g. day 32) rolls over. */
export function zonedTime(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  timeZone = BUSINESS_TIME_ZONE
): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  // Two passes settle the offset across a DST change.
  let t = wall - offsetMs(new Date(wall), timeZone);
  t = wall - offsetMs(new Date(t), timeZone);
  return new Date(t);
}

/** Local midnight `days` days from the day containing `date`. */
export function startOfDay(date: Date, days = 0, timeZone = BUSINESS_TIME_ZONE): Date {
  const p = localParts(date, timeZone);
  return zonedTime(p.year, p.month, p.day + days, 0, 0, timeZone);
}

export const RANGE_KEYS = ["today", "7d", "30d"] as const;
export type RangeKey = (typeof RANGE_KEYS)[number];

export const RANGE_LABEL: Record<RangeKey, string> = { today: "Today", "7d": "Last 7 days", "30d": "Last 30 days" };

const RANGE_DAYS: Record<RangeKey, number> = { today: 1, "7d": 7, "30d": 30 };

/** `[from, to)` covering whole local days up to and including today. */
export function rangeBounds(key: RangeKey, now: Date, timeZone = BUSINESS_TIME_ZONE): { from: Date; to: Date } {
  return {
    from: startOfDay(now, 1 - RANGE_DAYS[key], timeZone),
    to: startOfDay(now, 1, timeZone),
  };
}

export type FollowUpBucket = "overdue" | "today" | "upcoming";

export function followUpBucket(dueAt: Date, now: Date, timeZone = BUSINESS_TIME_ZONE): FollowUpBucket {
  if (dueAt.getTime() < now.getTime()) return "overdue";
  if (dueAt.getTime() < startOfDay(now, 1, timeZone).getTime()) return "today";
  return "upcoming";
}

export const MAX_FOLLOW_UP_DAYS = 365;

/** Follow-ups must be in the future and within a year; returns an error message or null. */
export function checkFollowUpDate(dueAt: Date, now: Date): string | null {
  if (Number.isNaN(dueAt.getTime())) return "Pick a valid follow-up date.";
  if (dueAt.getTime() <= now.getTime()) return "The follow-up must be in the future.";
  if (dueAt.getTime() > now.getTime() + MAX_FOLLOW_UP_DAYS * DAY_MS) {
    return `The follow-up must be within ${MAX_FOLLOW_UP_DAYS} days.`;
  }
  return null;
}

/** Quick picks offered by the call form. */
export function followUpPresets(now: Date, timeZone = BUSINESS_TIME_ZONE): { label: string; at: Date }[] {
  const tomorrow = localParts(startOfDay(now, 1, timeZone), timeZone);
  const inThree = localParts(startOfDay(now, 3, timeZone), timeZone);
  return [
    { label: "In 2 hours", at: new Date(now.getTime() + 2 * 60 * 60 * 1000) },
    { label: "Tomorrow 9:00", at: zonedTime(tomorrow.year, tomorrow.month, tomorrow.day, 9, 0, timeZone) },
    { label: "In 3 days", at: zonedTime(inThree.year, inThree.month, inThree.day, 9, 0, timeZone) },
  ];
}
