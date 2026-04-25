import { prisma } from "../lib/prisma.js";

export async function createContentPlan(userId: string, data: any) {
  return prisma.contentPlan.create({
    data: {
      userId,
      name: data.name || "Content Plan",
      strategyId: data.strategyId || null,
      data: data.plan
    }
  });
}