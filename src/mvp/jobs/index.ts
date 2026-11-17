import { runInviteDaily } from "../invites/service.js";
import { syncInstagram } from "../instagram/own.js";
import { JOB_PREPARE, prepareOnboarding } from "../onboarding/service.js";
import { defineJob, defineSchedule } from "./queue.js";

// Registry of every job.
export const JOBS = {
  ping: "ping", // checks the queue end to end
  invitesDaily: "invites-daily", // reminders, last day and expiry of invites
  instagramSync: "instagram-sync", // own profile + 12 posts, at invite time
  onboardingPrepare: JOB_PREPARE, // read the posts for onboarding (Claude)
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
