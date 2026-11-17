import { createHmac, randomUUID } from "node:crypto";
import { db } from "../db.js";
import { appUrl, sendEmail, WAITLIST_URL } from "../email/send.js";
import { inviteEmail, inviteExpiredEmail, inviteLastDayEmail, inviteReminderEmail } from "../email/templates.js";
import { addDays, dayInTz, daysBetween, shortDate, zonedTime } from "../lib/time.js";

// Invites last 7 days (day 1 = the day it was sent) and expire at the end of day 7, New York time.
// Day 1: invite email. Days 2-6: one reminder a day. Day 7: last-day email. After: expired email.
export const INVITE_TZ = "America/New_York";
export const INVITE_DAYS = 7;

type InviteRow = { id: string; email: string; businessName: string; instagramHandle: string; createdAt: Date; expiresAt: Date };

export function inviteDay(invite: { createdAt: Date }, now = new Date()) {
  return daysBetween(dayInTz(invite.createdAt, INVITE_TZ), dayInTz(now, INVITE_TZ)) + 1;
}

export function expiresAtFor(createdAt: Date) {
  const lastDay = addDays(dayInTz(createdAt, INVITE_TZ), INVITE_DAYS - 1);
  return zonedTime(lastDay, "23:59:59", INVITE_TZ);
}

// One fixed link per invite, derived from its id and a server secret: every email (day 1, reminders,
// last day) carries the same link, and we only store the hash of it.
export const newInviteId = () => randomUUID();
export function inviteToken(inviteId: string) {
  const secret = process.env.INVITE_TOKEN_SECRET;
  if (!secret) throw new Error("INVITE_TOKEN_SECRET is not set");
  return createHmac("sha256", secret).update(`invite:${inviteId}`).digest("base64url");
}
export const inviteUrl = (inviteId: string) => appUrl(`/invite/${inviteToken(inviteId)}`);

function vars(invite: InviteRow, url: string) {
  return { businessName: invite.businessName, handle: invite.instagramHandle, url, heldUntil: shortDate(invite.expiresAt, INVITE_TZ) };
}

export async function sendInviteEmail(invite: InviteRow) {
  return sendEmail(invite.email, inviteEmail(vars(invite, inviteUrl(invite.id))), invite.id);
}

// Seat is taken when a user already owns the profile or another pending invite holds it.
export async function instagramTaken(profileId: string, exceptInviteId?: string) {
  const [user, invite] = await Promise.all([
    db.user.findUnique({ where: { instagramProfileId: profileId }, select: { id: true } }),
    db.invite.findFirst({
      where: { instagramProfileId: profileId, status: "pending", expiresAt: { gt: new Date() }, ...(exceptInviteId ? { id: { not: exceptInviteId } } : {}) },
      select: { id: true },
    }),
  ]);
  return user ? "user" : invite ? "invite" : null;
}

// Daily job (9 AM New York). Safe to run more than once a day: EmailLog stops duplicates.
// `onlyIds` narrows the run (tests); the scheduled job passes nothing.
export async function runInviteDaily(now = new Date(), onlyIds?: string[]) {
  const result = { expired: 0, reminders: 0, lastDay: 0 };
  const pending = await db.invite.findMany({ where: { status: "pending", ...(onlyIds ? { id: { in: onlyIds } } : {}) } });
  const today = dayInTz(now, INVITE_TZ);

  for (const invite of pending) {
    if (invite.expiresAt <= now) {
      await db.invite.update({ where: { id: invite.id }, data: { status: "expired" } });
      await sendEmail(invite.email, inviteExpiredEmail({ businessName: invite.businessName, waitlistUrl: WAITLIST_URL }), invite.id);
      result.expired += 1;
      continue;
    }

    const day = inviteDay(invite, now);
    if (day >= INVITE_DAYS) {
      const already = await db.emailLog.findFirst({ where: { refId: invite.id, template: "invite_last_day" } });
      if (already) continue;
      await sendEmail(invite.email, inviteLastDayEmail(vars(invite, inviteUrl(invite.id))), invite.id);
      await db.invite.update({ where: { id: invite.id }, data: { lastReminderAt: now } });
      result.lastDay += 1;
    } else if (day >= 2) {
      if (invite.lastReminderAt && dayInTz(invite.lastReminderAt, INVITE_TZ) === today) continue;
      const daysLeft = INVITE_DAYS - day;
      await sendEmail(invite.email, inviteReminderEmail({ ...vars(invite, inviteUrl(invite.id)), daysLeft }), invite.id);
      await db.invite.update({ where: { id: invite.id }, data: { lastReminderAt: now } });
      result.reminders += 1;
    }
  }
  return result;
}
