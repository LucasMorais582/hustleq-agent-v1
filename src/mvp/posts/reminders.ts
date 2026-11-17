import { db } from "../db.js";
import { appUrl, sendEmail } from "../email/send.js";
import { postReminderEmail } from "../email/templates.js";
import { dayInTz, zonedTime } from "../lib/time.js";
import { FORMAT_LABEL, type Format } from "../plan/service.js";
import { timeLabel } from "../plan/timing.js";
import { signedReadUrls } from "./storage.js";

// 6.3 · Reminder email on the morning of each scheduled post, at the owner's reminder time (9:00 AM
// by default) in their timezone. A job runs every 15 minutes and sends what's due; a post moved to
// another day gets its reminder again (reminderSentAt is cleared on move).

const EARLY_LEAD_MS = 60 * 60_000; // a post before the reminder time gets it 1 hour before

export function reminderAt(scheduledAt: Date, tz: string, reminderTime: string) {
  const day = dayInTz(scheduledAt, tz);
  const morning = zonedTime(day, `${reminderTime}:00`, tz);
  const latest = new Date(scheduledAt.getTime() - EARLY_LEAD_MS);
  return morning < latest ? morning : latest;
}

export async function runReminders(now = new Date()) {
  const posts = await db.post.findMany({
    where: {
      status: "scheduled",
      reminderEmail: true,
      reminderSentAt: null,
      scheduledAt: { gt: now, lte: new Date(now.getTime() + 26 * 3600_000) },
      user: { remindersOn: true },
    },
    include: { user: { select: { email: true, timezone: true, reminderTime: true } }, media: { orderBy: { position: "asc" } } },
    take: 500,
  });
  let sent = 0;
  for (const p of posts) {
    if (!p.scheduledAt || reminderAt(p.scheduledAt, p.user.timezone, p.user.reminderTime) > now) continue;
    // Claim it first, so two workers never send the same reminder.
    const claimed = await db.post.updateMany({ where: { id: p.id, reminderSentAt: null }, data: { reminderSentAt: now } });
    if (!claimed.count) continue;
    try {
      const paths = p.media.map((m) => (m.kind === "video" ? m.framePaths[0] : m.storagePath)).filter((x): x is string => Boolean(x));
      const urls = await signedReadUrls(paths, 7 * 24 * 3600);
      const images = p.media.filter((m) => m.kind === "image").length;
      const videos = p.media.length - images;
      const what = [images ? `${images} ${images === 1 ? "image" : "images"}` : "", videos ? `${videos === 1 ? "video" : `${videos} videos`}` : ""].filter(Boolean).join(" and ");
      const time = new Intl.DateTimeFormat("en-GB", { timeZone: p.user.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(p.scheduledAt);
      const mediaSummary = p.media.length
        ? `Your ${what} ${p.media.length === 1 ? "is" : "are"} ready${p.caption ? " and the caption is written" : ""}.`
        : `The media isn't uploaded yet${p.caption ? ", but the caption is written" : ""}.`;
      await sendEmail(p.user.email, postReminderEmail({
        timeLabel: timeLabel(time),
        formatLabel: FORMAT_LABEL[(p.format ?? "feed") as Format] ?? p.format ?? "Post",
        title: p.title ?? "Your post",
        mediaSummary,
        caption: p.caption,
        hashtags: p.hashtags,
        imageUrls: paths.map((x) => urls.get(x)).filter((u): u is string => Boolean(u)),
        url: appUrl(`/posts/${p.id}`),
        settingsUrl: appUrl("/settings/account"),
      }), p.id);
      sent += 1;
    } catch (error) {
      console.error("[reminders] failed", p.id, error);
      await db.post.update({ where: { id: p.id }, data: { reminderSentAt: null } });
    }
  }
  return { checked: posts.length, sent };
}
