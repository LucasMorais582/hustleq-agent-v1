import { db } from "../db.js";
import { dayInTz } from "../lib/time.js";

// Hidden fair-use cap (decided 17/11): 10 heavy generations a day per owner, in their timezone.
// Heavy = drafting a strategy or a week, revising a post, regenerating a section. Chat is free.
export const HEAVY_PER_DAY = Number(process.env.HEAVY_GENERATIONS_PER_DAY ?? 10);

export class DailyCapReached extends Error {}

export async function useHeavyGeneration(userId: string, timezone: string) {
  const periodStart = new Date(`${dayInTz(new Date(), timezone)}T00:00:00Z`);
  const row = await db.usage.upsert({
    where: { userId_kind_periodStart: { userId, kind: "heavy_generation", periodStart } },
    update: { count: { increment: 1 } },
    create: { userId, kind: "heavy_generation", periodStart, count: 1 },
  });
  if (row.count > HEAVY_PER_DAY) {
    await db.usage.update({ where: { id: row.id }, data: { count: { decrement: 1 } } });
    throw new DailyCapReached();
  }
}

// Give one back when the generation failed before producing anything.
export async function refundHeavyGeneration(userId: string, timezone: string) {
  const periodStart = new Date(`${dayInTz(new Date(), timezone)}T00:00:00Z`);
  await db.usage.updateMany({ where: { userId, kind: "heavy_generation", periodStart, count: { gt: 0 } }, data: { count: { decrement: 1 } } });
}
