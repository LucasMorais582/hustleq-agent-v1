import { processAgentChat }
from "../services/agentChat.service.js";

export async function agentChatController(
  req: any,
  res: any
) {
  try {
    const result =
      await processAgentChat(
        req.user.userId,
        req.body
      );

    return res.json(result);

  } catch (error: any) {
    console.error(error);

    /*
      Known errors
    */

    if (
      error.message ===
      "Strategy not found"
    ) {
      return res.status(404).json({
        error:
          "Content strategy not found"
      });
    }

    if (
      error.message ===
      "Conversation not found"
    ) {
      return res.status(404).json({
        error:
          "Conversation not found"
      });
    }

    /*
      Unknown error
    */

    return res.status(500).json({
      error: "Erro no agente",
    });
  }
}