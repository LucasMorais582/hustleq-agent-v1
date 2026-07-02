import { prisma } from "../lib/prisma.js";

export async function getUserConversations(
  userId: string
) {
  const conversations =
    await prisma.conversation.findMany({
      where: {
        userId,
      },

      orderBy: {
        // depois setar updateAt: "desc",
        createdAt: "desc",
      },
    });

  return conversations;
}

export async function getConversationMessages(
  userId: string,
  conversationId: string
) {
  const conversation =
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

  const messages =
    await prisma.message.findMany({
      where: {
        conversationId,
      },

      orderBy: {
        createdAt: "asc",
      },
    });

  return messages;
}