import { prisma } from "../lib/prisma.js";

export async function getLatestWeekBlueprint(
  conversationId: string,
  weekNumber: number
) {
  const messages =
    await prisma.message.findMany({
      where: {
        conversationId,
        role: "assistant",
      },
      orderBy: {
        createdAt: "desc",
      },
    });

  for (const message of messages) {
    try {
      const content = JSON.parse(message.content);

      if (
        content.type === "CONTENT_WEEK_BLUEPRINT" &&
        content.data?.week === weekNumber
      ) {
        return content.data;
      }
    } catch {
      continue;
    }
  }

  return null;
}

export async function getLatestMonthStrategy(
  conversationId: string
) {
  const messages =
    await prisma.message.findMany({
      where: {
        conversationId,
        role: "assistant",
      },

      orderBy: {
        createdAt: "desc",
      },
    });

  for (const message of messages) {
    try {
      const content =
        JSON.parse(message.content);

      if (
        content.type ===
        "CONTENT_MONTH_STRATEGY"
      ) {
        return content;
      }

    } catch {
      continue;
    }
  }

  return null;
}