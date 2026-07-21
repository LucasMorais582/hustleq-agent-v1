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

export async function getUserConversation(
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

  return conversation;
}

export async function deleteUserConversation(
  conversationId: string
) {
  await prisma.message.deleteMany({
    where: {
      conversationId,
    },
  });

  const conversation =
    await prisma.conversation.delete({
      where: {
        id: conversationId,
      },
    });

  return conversation;
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

  return messages.map((message) => {
    try {
      return {
        ...message,
        content:
          typeof message.content === "string"
            ? JSON.parse(message.content)
            : message.content,
      };
    } catch {
      return message;
    }
  });
}

export async function deleteConversationMessages(
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

  const message =
    await prisma.message.findFirst({
      where: {
        conversationId,
      },

      orderBy: {
        createdAt: "asc",
      },
    });

  if (!message) {
    throw new Error(
      "No messages found"
    );
  }

  await prisma.message.delete({
    where: {
      id: message.id,
    },
  });

  return;
}