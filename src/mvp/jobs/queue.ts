import { PgBoss } from "pg-boss";

// Job queue in Postgres (pg-boss), in its own schema so it never touches app tables.
// Handlers live next to their feature and register here by name.

export type JobHandler<T = unknown> = (data: T) => Promise<void>;

const handlers = new Map<string, JobHandler<any>>();
let boss: PgBoss | null = null;

function connectionString() {
  const raw = process.env.MVP_DATABASE_URL;
  if (!raw) throw new Error("MVP_DATABASE_URL is not set");
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

export async function startQueue({ work = true } = {}) {
  if (boss) return boss;
  boss = new PgBoss({
    connectionString: connectionString(),
    schema: process.env.MVP_JOBS_SCHEMA || "mvp_jobs",
    ssl: { rejectUnauthorized: false },
    max: 4,
  });
  boss.on("error", (err) => console.error("[jobs] error", err));
  await boss.start();

  for (const [name, handler] of handlers) {
    await boss.createQueue(name);
    if (work) {
      await boss.work(name, async (jobs) => {
        for (const job of jobs) await handler(job.data);
      });
    }
  }
  return boss;
}

export async function enqueue<T extends object>(name: string, data: T, options?: { startAfter?: Date | number; singletonKey?: string }) {
  if (!boss) throw new Error("Job queue not started");
  if (!handlers.has(name)) throw new Error(`Unknown job: ${name}`);
  return boss.send(name, data, options ?? {});
}

export async function stopQueue() {
  await boss?.stop({ graceful: true });
  boss = null;
}
