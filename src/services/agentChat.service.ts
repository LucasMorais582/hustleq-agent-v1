import { prisma } from "../lib/prisma.js";

import { runAgent }
from "../ai/orchestrator/dukeOrchestrator.js";

import {
  mapContextToAgent
} from "./businessContext.service.js";

import type {
  BusinessContextInput
} from "../types/agent.types.js";

export async function processAgentChat(
  userId: string,
  body: any
) {
  const {
    message,
    conversationId,
    mode,
    contentGoals,
    strategyId,
    planConfig,
    weekNumber,
    monthlyOverview,
    previousWeek,
    userFeedback,
    generatedWeeks,
  } = body;

  let conversation;
  let strategy = null;

  /*
    Business context
  */

  const contextFromDB =
    await prisma.businessContext.findUnique({
      where: { userId },
    });

  const fallbackContext:
    BusinessContextInput = {
      niche: "general business",
      tone: ["professional"],
      primaryGoals: ["ENGAGEMENT"],
    };

  const dbContext =
    contextFromDB
      ? mapContextToAgent(
          contextFromDB
        )
      : fallbackContext;

  /*
    Strategy
  */

  const strategyModes = [
    "CONTENT_PLAN_WEEK_V3"
  ];

  if (
    strategyModes.includes(mode)
    && strategyId
  ) {
    strategy =
      await prisma.contentStrategy.findUnique({
        where: { id: strategyId },
      });

    if (!strategy) {
      throw new Error(
        "Strategy not found"
      );
    }
  }

  /*
    Conversation
  */

  if (!conversationId) {
    conversation =
      await prisma.conversation.create({
        data: {
          title:
            message.slice(0, 30),
          userId,
        },
      });

  } else {
    conversation =
      await prisma.conversation.findFirst({
        where: {
          id: conversationId,
          userId,
        },
      });

    if (!conversation) {
      throw new Error(
        "Conversation not found"
      );
    }
  }

  /*
    History
  */

  const messages =
    await prisma.message.findMany({
      where: {
        conversationId:
          conversation.id
      },

      orderBy: {
        createdAt: "asc"
      },
    });

  const history =
    messages.map((msg) => ({
      role:
        (
          msg.role === "assistant"
            ? "assistant"
            : "user"
        ) as "user" | "assistant",

      content:
        msg.content,
    }));

  /*
    Save user message
  */

  await prisma.message.create({
    data: {
      conversationId:
        conversation.id,

      role: "user",

      content: message,
    },
  });

  /*
    Execute agent
  */

  const response =
    await runAgent({
      userMessage: message,
      history,
      mode,
      contentGoals,
      businessContext:
        dbContext,
      strategy,
      planConfig,
      weekNumber,
      monthlyOverview,
      previousWeek,
      userFeedback,
      generatedWeeks,
    });

  /*
    Save response
  */

  for (const msg of response) {
    await prisma.message.create({
      data: {
        conversationId:
          conversation.id,

        role: "assistant",

        content:
          JSON.stringify(
            msg.content
          ),
      },
    });
  }

  return {
    messages: response,

    conversationId:
      conversation.id,
  };
}