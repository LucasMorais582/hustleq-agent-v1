import { defineJob } from "./queue.js";

// Registry of every job. Phase 0 has only a ping used to check the queue end to end.
export const JOBS = {
  ping: "ping",
} as const;

export let lastPing: { at: Date; data: unknown } | null = null;

defineJob<{ note?: string }>(JOBS.ping, async (data) => {
  lastPing = { at: new Date(), data };
  console.log("[jobs] ping", data);
});
