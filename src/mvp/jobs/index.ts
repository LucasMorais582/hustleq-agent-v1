import { runInviteDaily } from "../invites/service.js";
import { defineJob, defineSchedule } from "./queue.js";

// Registry of every job.
export const JOBS = {
  ping: "ping", // checks the queue end to end
  invitesDaily: "invites-daily", // reminders, last day and expiry of invites
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
