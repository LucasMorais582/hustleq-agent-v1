import "./config/env.js";

import express from "express";
import cors from "cors";
import bcrypt from "bcrypt";

import { runAgent } from "./agent/agent.service.js";
import { prisma } from "./lib/prisma.js";
import { generateToken } from "./lib/auth.js";
import { authMiddleware } from "./middleware/auth.middleware.js";
import { mapContextToAgent, upsertBusinessContext } from "./services/businessContext.service.js";
import type { BusinessContextInput } from "./types/agent.types.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/auth/me", authMiddleware, async (req: any, res: any) => {
  try {
    const userId = req.user.userId;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json(user);

  } catch (error) {
    res.status(500).json({ error: `Error: ${JSON.stringify(error)}` });
  }
});

app.post("/auth/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return res.status(400).json({
        error: "Email já está em uso",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
      },
    });

    const token = generateToken(user.id);

    res.json({ token, user });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erro ao registrar" });
  }
});

app.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return res.status(400).json({ error: "Usuário não encontrado" });
    }

    const valid = await bcrypt.compare(password, user.password);

    if (!valid) {
      return res.status(400).json({ error: "Senha inválida" });
    }

    const token = generateToken(user.id);

    res.json({ token, user });

  } catch (error) {
    res.status(500).json({ error: "Erro no login" });
  }
});

app.get("/business-context", authMiddleware, async (req: any, res: any) => {
  try {
    const userId = req.user.userId;
    const context = await prisma.businessContext.findUnique({
      where: { userId },
    });

    res.json({ context });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erro ao buscar contexto" });
  }
});

app.post("/business-context", authMiddleware, async (req: any, res: any) => {
  try {
    const data = req.body;
    const userId = req.user.userId;
    const context = await upsertBusinessContext(userId, data);

    res.json({ context });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erro ao salvar contexto" });
  }
});

app.get("/conversations", authMiddleware,  async (req: any, res: any) => {
  try {
    const userId = req.user.userId;

    const conversations = await prisma.conversation.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        createdAt: true,
      },
    });

    res.json({ conversations });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erro ao listar conversas" });
  }
});

app.delete("/conversations/:id", authMiddleware, async (req: any, res: any) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    // 🔒 garante que a conversa pertence ao usuário
    const conversation = await prisma.conversation.findFirst({
      where: {
        id,
        userId,
      },
    });

    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    // 🧹 deleta mensagens primeiro (se não tiver cascade no schema)
    await prisma.message.deleteMany({
      where: {
        conversationId: id,
      },
    });

    // 🗑️ deleta a conversa
    await prisma.conversation.delete({
      where: { id },
    });

    return res.json({ success: true });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Erro ao deletar conversa" });
  }
});

app.get("/conversations/:id/messages", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    // 1. busca do banco
    const rawMessages = await prisma.message.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        role: true,
        content: true,
        createdAt: true,
      },
    });

    // 2. transformação (AQUI entra o trecho)
   const messages = rawMessages.map((msg) => {
      if (msg.role === "assistant") {
        try {
          return {
            ...msg,
            content: JSON.parse(msg.content),
          };
        } catch {
          return {
            ...msg,
            content: msg.content,
          };
        }
      }

      return msg;
    });

    // 3. retorno
    res.json({ messages });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erro ao buscar mensagens" });
  }
});

app.post("/agent/chat", authMiddleware, async (req: any, res: any) => {
  try {
    const { message, conversationId, mode, contentGoal, businessContext } = req.body;

    let conversation;

    const contextFromDB = await prisma.businessContext.findUnique({
      where: { userId: req.user.userId },
    });

    const fallbackContext: BusinessContextInput = {
      niche: "general business",
      tone: ["professional"],
      primaryGoals: ["ENGAGEMENT"],
    };

    const dbContext = contextFromDB ? 
    mapContextToAgent(contextFromDB) : businessContext ?
      mapContextToAgent(businessContext) : fallbackContext;

    // 🧠 1. Criar ou buscar conversa
    if (!conversationId) {
      conversation = await prisma.conversation.create({
        data: {
          title: message.slice(0, 30),
          userId: req.user.userId,
        },
      });
    } else {
      conversation = await prisma.conversation.findFirst({
        where: {
          id: conversationId,
          userId: req.user.userId,
        },
      });

      if (!conversation) {
        return res.status(403).json({
          error: "Acesso negado à conversa",
        });
      }
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
      businessContext : dbContext,
      instagramData: undefined
    });

    // 🧠 5. Salvar resposta
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "assistant",
        content: JSON.stringify({
          type: mode,
          data: response,
        })
      },
    });

    // 🧠 6. Retornar resposta + conversationId
    res.json({
    messages: {
      content: {
        type: mode,
        data: response,
      }
    },
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