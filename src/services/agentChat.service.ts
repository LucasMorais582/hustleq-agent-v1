import { prisma } from "../lib/prisma.js";

import { runAgent }
from "../ai/orchestrator/dukeOrchestrator.js";

import {
  mapContextToAgent
} from "./businessContext.service.js";

import type {
  BusinessContextInput
} from "../types/agent.types.js";

import {
  getLatestMonthStrategy
} from "../repositories/conversation.repository.js";

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
    Strategy
  */

  const strategyModes = [
    "CONTENT_WEEK_BLUEPRINT",
    "CONTENT_WEEK_PIPELINE",
    "CONTENT_BACKUP_PIPELINE",
  ];

  let resolvedStrategyId = strategyId;
  let resolvedPlanConfig = planConfig;

  if (
    strategyModes.includes(mode)
  ) {
    if (!resolvedStrategyId) {
      const latestStrategy = await getLatestMonthStrategy(conversation.id);

      if (!latestStrategy) {
        throw new Error(
          "Month strategy not found"
        );
      }

      resolvedStrategyId =
        latestStrategy.metadata?.strategyId;

      resolvedPlanConfig =
        latestStrategy.metadata?.planConfig;
    }

    strategy =
      await prisma.contentStrategy.findUnique({
        where: {
          id: resolvedStrategyId,
        },
      });

    if (!strategy) {
      throw new Error(
        "Strategy not found"
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

  let payload: any = {
      userMessage: message,
      history,
      mode,
      contentGoals,
      businessContext:
      dbContext,
      strategy,
      planConfig: resolvedPlanConfig,
      weekNumber,
      monthlyOverview,
      previousWeek,
      userFeedback,
      generatedWeeks,
    };
  if(conversationId) payload.conversationId = conversationId;
  
  const response = await runAgent(payload);

  /*
    Inject metadata into assistant responses
  */

  for (const msg of response) {
    if (msg.content?.type === "CONTENT_MONTH_STRATEGY") {
      msg.content = {
        ...msg.content,
        metadata: {
            strategyId: resolvedStrategyId,
            planConfig: resolvedPlanConfig,
        }
      };
    }
  }


  /*
    Save response
  */

  for (const msg of response) {
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "assistant",
        content: JSON.stringify(
            msg.content
          ),
      },
    });
  }

  return {
    messages: response,
    conversationId: conversation.id,
  };
}