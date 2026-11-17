import { prisma } from "../lib/prisma.js";

export async function createContentStrategy(userId: string, data: any) {
  return prisma.contentStrategy.create({
    data: {
      userId,
      name: data.name,
      description: data.description,
      pillars: data.pillars,
    },
  });
}

export async function listContentStrategies(userId: string) {
  return prisma.contentStrategy.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

export async function getContentStrategyById(userId: string, id: string) {
  return prisma.contentStrategy.findFirst({
    where: {
      id,
      userId,
    },
  });
}

export async function deleteContentStrategy(userId: string, id: string) {
  return prisma.contentStrategy.deleteMany({
    where: {
      id,
      userId,
    },
  });
}