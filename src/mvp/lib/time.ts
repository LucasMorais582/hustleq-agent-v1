// Date helpers in a given IANA timezone, without extra libraries.

// "2026-11-17" for the calendar day of `at` in `tz`.
export function dayInTz(at: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromDay: string, toDay: string): number {
  return Math.round((Date.parse(`${toDay}T12:00:00Z`) - Date.parse(`${fromDay}T12:00:00Z`)) / 864e5);
}

// Offset of `tz` from UTC at instant `at`, in minutes (New York in winter: -300).
function offsetMinutes(at: Date, tz: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(at).map((p) => [p.type, p.value])
  );
  const asUtc = Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!);
  return Math.round((asUtc - at.getTime()) / 60000);
}

// The instant of HH:MM:SS on `day` in `tz`.
export function zonedTime(day: string, time: string, tz: string): Date {
  const guess = new Date(`${day}T${time}Z`);
  const first = new Date(guess.getTime() - offsetMinutes(guess, tz) * 60000);
  // Second pass fixes days when the offset changes (DST).
  return new Date(guess.getTime() - offsetMinutes(first, tz) * 60000);
}

// "Tue, Nov 17"
export function shortDate(at: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).format(at);
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
