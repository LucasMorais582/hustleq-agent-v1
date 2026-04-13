import "./config/env.js";

import express from "express";
import cors from "cors";
import { runAgent } from "./agent/agent.service.js";
import { prisma } from "./lib/prisma.js";

const app = express();
app.use(cors());
app.use(express.json());

const conversations: Record<
  string,
  {
    history: any[];
    context: any;
    insights: {
      mainGoal?: string;
      tone?: string;
    };
  }
> = {};

app.post("/agent/chat", async (req, res) => {
  try {
    // TEMP: criar usuário fake para testes
    // await prisma.user.upsert({
    //   where: { id: "temp-user" },
    //   update: {},
    //   create: {
    //     id: "temp-user",
    //     email: "test@test.com",
    //     password: "123456",
    //   },
    // });

    const { message, conversationId, mode, contentGoal, businessContext } = req.body;

    let conversation;

    // 🧠 1. Criar ou buscar conversa
    if (!conversationId) {
      conversation = await prisma.conversation.create({
        data: {
          title: message.slice(0, 30),
          userId: "temp-user", // depois vamos trocar por auth real
        },
      });
    } else {
      conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
      });
    }

    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    // 🧠 2. Buscar histórico
    const messages = await prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "asc" },
    });

    const history = messages.map((msg) => ({
      role: (msg.role === "assistant" ? "assistant" : "user") as "user" | "assistant",
      content: msg.content,
    }));

    // 🧠 3. Salvar mensagem do usuário
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "user",
        content: message,
      },
    });

    // 🧠 4. Rodar agente
    const response = await runAgent({
      userMessage: message,
      history,
      mode,
      contentGoal,
      businessContext,
      instagramData: undefined
    });

    // 🧠 5. Salvar resposta
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "assistant",
        content: JSON.stringify(response),
      },
    });

    // 🧠 6. Retornar resposta + conversationId
    res.json({
      response,
      conversationId: conversation.id,
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erro no agente" });
  }
});

app.listen(3000, () => {
  console.log("Servidor rodando na porta 3000 🚀");
});