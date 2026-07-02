import {
  getUserConversations,
  getConversationMessages
} from "../services/conversation.service.js";

export async function getConversationsController(
  req: any,
  res: any
) {
  try {
    const conversations =
      await getUserConversations(
        req.user.userId
      );

    return res.json({
      conversations,
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error:
        "Failed to fetch conversations"
    });
  }
}

export async function getMessagesController(
  req: any,
  res: any
) {
  try {
    const messages =
      await getConversationMessages(
        req.user.userId,
        req.params.id
      );

    return res.json({
      messages,
    });

  } catch (error: any) {
    console.error(error);

    if (
      error.message ===
      "Conversation not found"
    ) {
      return res.status(404).json({
        error:
          "Conversation not found"
      });
    }

    return res.status(500).json({
      error:
        "Failed to fetch messages"
    });
  }
}