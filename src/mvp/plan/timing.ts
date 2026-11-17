import type { IgPost } from "../socialData/index.js";
import { addDays, dayInTz, zonedTime } from "../lib/time.js";

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export type DayName = (typeof DAYS)[number];

// Monday of the week that contains `at`, in the owner's timezone ("2026-11-16").
export function mondayOf(at: Date, tz: string): string {
  const day = dayInTz(at, tz);
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(day, weekday === 0 ? -6 : 1 - weekday);
}

export function weekStartFor(which: "this" | "next", tz: string, now = new Date()) {
  const monday = mondayOf(now, tz);
  return which === "next" ? addDays(monday, 7) : monday;
}

export function dateForDay(weekStart: string, day: DayName) {
  return addDays(weekStart, DAYS.indexOf(day));
}

export function scheduledAt(weekStart: string, day: DayName, time: string, tz: string) {
  return zonedTime(dateForDay(weekStart, day), `${time}:00`, tz);
}

// "Best time": the hour whose posts got the most likes + comments on average, among hours with
// at least 2 posts. Without enough posts, 7:00 PM (the screens' default) and we say it's a default.
export function bestTime(posts: IgPost[], tz: string): { time: string; fromData: boolean } {
  const by = new Map<number, { total: number; n: number }>();
  for (const p of posts) {
    if (!p.publishedAt) continue;
    const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(new Date(p.publishedAt)));
    const s = by.get(hour) ?? { total: 0, n: 0 };
    s.total += (p.likes ?? 0) + (p.comments ?? 0);
    s.n += 1;
    by.set(hour, s);
  }
  // Never suggest the middle of the night, even if a post happened to land then.
  const best = [...by.entries()].filter(([h, s]) => s.n >= 2 && h >= 6 && h <= 22).sort((a, b) => b[1].total / b[1].n - a[1].total / a[1].n)[0];
  if (!best) return { time: "19:00", fromData: false };
  return { time: `${String(best[0]).padStart(2, "0")}:00`, fromData: true };
}

export function timeLabel(time: string) {
  const [h, m] = time.split(":").map(Number) as [number, number];
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

// Posts per week over the last 4 weeks, per kind (for 4.2b "based on how often you post today").
export function postingPace(posts: IgPost[], now = new Date()) {
  const since = now.getTime() - 28 * 864e5;
  const recent = posts.filter((p) => p.publishedAt && Date.parse(p.publishedAt) >= since);
  const per = (f: (p: IgPost) => boolean) => Math.round((recent.filter(f).length / 4) * 10) / 10;
  return { videosPerWeek: per((p) => p.format === "reel"), staticPerWeek: per((p) => p.format !== "reel"), basedOnPosts: recent.length };
}
