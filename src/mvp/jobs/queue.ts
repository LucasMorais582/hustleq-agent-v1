import { PgBoss } from "pg-boss";

// Job queue in Postgres (pg-boss), in its own schema so it never touches app tables.
// Handlers live next to their feature and register here by name.

export type JobHandler<T = unknown> = (data: T) => Promise<void>;

const handlers = new Map<string, JobHandler<any>>();
const schedules: { name: string; cron: string; tz: string }[] = [];
let boss: PgBoss | null = null;

function connectionString() {
  // pg-boss needs a session connection (LISTEN/NOTIFY, advisory locks): the direct URL, with few clients.
  const raw = process.env.MVP_DIRECT_URL ?? process.env.MVP_DATABASE_URL;
  if (!raw) throw new Error("MVP_DIRECT_URL is not set");
  // node-postgres rejects Prisma-only params such as pgbouncer and schema.
  const url = new URL(raw);
  url.searchParams.delete("pgbouncer");
  url.searchParams.delete("schema");
  url.searchParams.delete("connection_limit");
  return url.toString();
}

export function defineJob<T>(name: string, handler: JobHandler<T>) {
  handlers.set(name, handler);
}

// Runs `name` on a cron, in a timezone (pg-boss keeps one schedule per name, across instances).
export function defineSchedule(name: string, cron: string, tz: string) {
  schedules.push({ name, cron, tz });
}

export async function startQueue({ work = true } = {}) {
  if (boss) return boss;
  boss = new PgBoss({
    connectionString: connectionString(),
    schema: process.env.MVP_JOBS_SCHEMA || "mvp_jobs",
    ssl: { rejectUnauthorized: false },
    max: 2,
  });
  boss.on("error", (err) => console.error("[jobs] error", err));
  await boss.start();

  for (const [name, handler] of handlers) {
    await boss.createQueue(name);
    if (work) {
      // Up to 4 jobs of a kind at once (e.g. the details of a week's posts).
      await boss.work(name, { localConcurrency: 4 }, async (jobs) => {
        for (const job of jobs) await handler(job.data);
      });
    }
  }
  if (work) {
    for (const s of schedules) await boss.schedule(s.name, s.cron, {}, { tz: s.tz });
  }
  return boss;
}

export async function enqueue<T extends object>(name: string, data: T, options?: { startAfter?: Date | number; singletonKey?: string }) {
  if (!boss) throw new Error("Job queue not started");
  if (!handlers.has(name)) throw new Error(`Unknown job: ${name}`);
  return boss.send(name, data, options ?? {});
}

// For request handlers: queue work if the worker is up, never fail the request because of it.
export async function enqueueSafe<T extends object>(name: string, data: T, options?: { singletonKey?: string }) {
  if (!boss) {
    console.warn(`[jobs] queue not started, skipped ${name}`);
    return null;
  }
  try {
    return await boss.send(name, data, options ?? {});
  } catch (error) {
    console.error(`[jobs] could not queue ${name}`, error);
    return null;
  }
}

export async function stopQueue() {
  await boss?.stop({ graceful: true });
  boss = null;
}
