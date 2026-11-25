import { runInviteDaily } from "../invites/service.js";
import { syncInstagram } from "../instagram/own.js";
import { syncMonitoring } from "../instagram/link.js";
import { JOB_PREPARE, prepareOnboarding } from "../onboarding/service.js";
import { writePostDetails } from "../plan/details.js";
import { JOB_SHOT_LIST, writeShotList } from "../production/shotList.js";
import { runReminders } from "../posts/reminders.js";
import { db } from "../db.js";
import { defineJob, defineSchedule } from "./queue.js";

// Registry of every job.
export const JOBS = {
  ping: "ping", // checks the queue end to end
  invitesDaily: "invites-daily", // reminders, last day and expiry of invites
  instagramSync: "instagram-sync", // own profile + 12 posts, at invite time
  onboardingPrepare: JOB_PREPARE, // read the posts for onboarding (Claude)
  postDetails: "post-details", // full details of one post (Claude)
  shotList: JOB_SHOT_LIST, // what to film for a week (Claude)
  postReminders: "post-reminders", // 6.3 reminder emails, every 15 minutes
  instagramDaily: "instagram-daily", // own profile + recent posts for every owner, once a day (Home numbers, 6.4)
  socialDataCron: "social-data-cron", // wakes the Social Data API's daily collection (it runs it once a day, 4 AM New York)
} as const;

export let lastPing: { at: Date; data: unknown } | null = null;

defineJob<{ note?: string }>(JOBS.ping, async (data) => {
  lastPing = { at: new Date(), data };
  console.log("[jobs] ping", data);
});

defineJob(JOBS.invitesDaily, async () => {
  const result = await runInviteDaily();
  console.log("[jobs] invites daily", result);
});
defineSchedule(JOBS.invitesDaily, "0 9 * * *", "America/New_York");

defineJob<{ handle: string }>(JOBS.instagramSync, async ({ handle }) => {
  await syncInstagram(handle);
});
defineJob<{ userId: string }>(JOBS.onboardingPrepare, async ({ userId }) => {
  await prepareOnboarding(userId);
});
defineJob<{ postId: string }>(JOBS.postDetails, async ({ postId }) => {
  await writePostDetails(postId);
});
defineJob<{ shotListId: string }>(JOBS.shotList, async ({ shotListId }) => {
  await writeShotList(shotListId);
});
defineJob(JOBS.postReminders, async () => {
  const r = await runReminders();
  if (r.sent) console.log("[jobs] post reminders", r);
});
defineSchedule(JOBS.postReminders, "*/15 * * * *", "UTC");

// Once a day: each owner's profile and last posts. A failure keeps yesterday's data and the Home
// shows E.6 ("Your numbers are from ..."); the next run tries again.
defineJob(JOBS.instagramDaily, async () => {
  const users = await db.user.findMany({ where: { instagramHandle: { not: null }, onboarding: { status: "done" } }, select: { instagramHandle: true } });
  const handles = [...new Set(users.map((u) => u.instagramHandle!))];
  let ok = 0;
  for (const handle of handles) {
    try {
      if (await syncInstagram(handle, { maxAgeMs: 20 * 3600_000, waitMs: 0 })) ok += 1;
    } catch (error) {
      console.error("[jobs] instagram daily failed", handle, error);
    }
  }
  console.log("[jobs] instagram daily", { handles: handles.length, ok, monitoring: await syncMonitoring() });
});
defineSchedule(JOBS.instagramDaily, "0 6 * * *", "America/New_York");

// api mode: the Social Data API has no scheduler of its own on Railway, so we call its cron route
// every 10 minutes; it decides itself when the daily collection is due and never runs it twice.
defineJob(JOBS.socialDataCron, async () => {
  const base = process.env.SOCIAL_DATA_API_URL;
  const secret = process.env.SOCIAL_DATA_CRON_SECRET;
  if (process.env.SOCIAL_DATA_MODE !== "api" || !base || !secret) return;
  const res = await fetch(base.replace(/\/$/, "") + "/api/cron/instagram-refresh", {
    headers: { authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(240_000),
  }).catch((error: unknown) => {
    console.error("[jobs] social data cron unreachable", error);
    return null;
  });
  if (!res) return;
  const body = await res.text();
  if (!res.ok && res.status !== 409) console.error("[jobs] social data cron", res.status, body.slice(0, 300));
  else if (!body.includes('"skipped":true')) console.log("[jobs] social data cron", res.status, body.slice(0, 300));
});
defineSchedule(JOBS.socialDataCron, "*/10 * * * *", "UTC");
