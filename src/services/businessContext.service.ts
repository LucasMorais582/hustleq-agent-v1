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

export function buildBusinessContextPrompt(context: any): string {
  if (!context) return "";

  const safeArray = (arr?: string[]) =>
    Array.isArray(arr) && arr.length > 0 ? arr.join(", ") : null;

  const sections: string[] = [];

    // 🔹 BUSINESS
    if (context.businessName || context.niche || context.description) {
          sections.push(`
      BUSINESS:
      ${context.businessName ? `- Name: ${context.businessName}` : ""}
      ${context.niche ? `- Niche: ${context.niche}` : ""}
      ${context.description ? `- Description: ${context.description}` : ""}
      `.trim());
    }

    // 🔹 OFFER
    if (context.offerings) {
          sections.push(`
      OFFER:
      ${safeArray(context.offerings) ? `- Services/Products: ${safeArray(context.offerings)}` : ""}
      `.trim());
    }

    // 🔹 AUDIENCE
    if (context.idealCustomer || context.mainProblem) {
      sections.push(`
      AUDIENCE:
      ${context.idealCustomer ? `- Ideal Customer: ${context.idealCustomer}` : ""}
      ${context.mainProblem ? `- Main Problem: ${context.mainProblem}` : ""}
      `.trim());
    }

    // 🔹 MARKETING CONTEXT
    if (context.primaryGoals || context.acquisitionChannels) {
      sections.push(`
      MARKETING:
      ${safeArray(context.primaryGoals) ? `- Goals: ${safeArray(context.primaryGoals)}` : ""}
      ${safeArray(context.acquisitionChannels) ? `- Acquisition Channels: ${safeArray(context.acquisitionChannels)}` : ""}
      `.trim());
    }

    // 🔹 BRAND VOICE
    if (context.tone || context.avoidTopics) {
      sections.push(`
      BRAND VOICE:
      ${safeArray(context.tone) ? `- Tone: ${safeArray(context.tone)}` : ""}
      ${safeArray(context.avoidTopics) ? `- Avoid: ${safeArray(context.avoidTopics)}` : ""}
      `.trim());
    }

    // 🔹 SUCCESS DEFINITION (forte pra estratégia)
    if (context.successDefinition) {
      sections.push(`
      SUCCESS:
      - Definition: ${context.successDefinition}
      `.trim());
    }

    return `
      You are assisting a business with the following context:

      ${sections.join("\n\n")}

      IMPORTANT:
      - Always tailor responses to this specific business
      - Avoid generic suggestions
      - Prioritize practical, real-world marketing actions
    `;
}