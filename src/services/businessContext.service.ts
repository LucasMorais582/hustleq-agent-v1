import type { BusinessContextInput } from "../types/agent.types.js";
import { prisma } from "../lib/prisma.js";

function normalizeContext(input: BusinessContextInput) {
  return {
    ...input,

    offerings: input.offerings || [],
    acquisitionChannels: input.acquisitionChannels || [],
    primaryGoals: input.primaryGoals?.length
      ? input.primaryGoals.map(g => g.toUpperCase()) : ["ENGAGEMENT"],
    tone: input.tone || ["professional"],
    avoidTopics: input.avoidTopics || [],
    contentFocus: input.contentFocus || [],
    currentIssues: input.currentIssues || [],
    inspirations: input.inspirations || [],
    competitors: input.competitors || [],
  };
}

export function mapContextToAgent(context: any) {
  if (!context) return {};

  return {
    businessName: context.businessName,
    description: context.description,
    niche: context.niche,
    location: context.location,

    idealCustomer: context.idealCustomer,
    mainProblem: context.mainProblem,

    tone: context.tone,
    primaryGoals: context.primaryGoals,

    contentFocus: context.contentFocus,

    goal: context.primaryGoals?.[0] || null,
  };
}

export async function upsertBusinessContext(userId: string, data: BusinessContextInput) {
  const normalized = normalizeContext(data);

  return prisma.businessContext.upsert({
    where: { userId },
    update: normalized,
    create: {
      userId,
      ...normalized,
    },
  });
}