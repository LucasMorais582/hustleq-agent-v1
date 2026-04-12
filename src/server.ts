import "./config/env.js";

import express from "express";
import cors from "cors";
import { runAgent } from "./agent/agent.service.js";

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
    const { message, sessionId, mode, businessContext } = req.body;

    const mockInstagramData = {
      followers: 12000,
      avg_likes: 350,
      avg_comments: 20,
      posts_per_week: 2,
    };

    // 🔥 inicializa corretamente a sessão
    if (!conversations[sessionId]) {
      conversations[sessionId] = {
        history: [],
        context: {},
        insights: {}, // ✅ faltava isso
      };
    }

    // 🔥 mantém contexto atualizado
    if (businessContext) {
      conversations[sessionId].context = {
        ...conversations[sessionId].context,
        ...businessContext,
      };

      // 🔥 salva "aprendizados" do usuário
      if (businessContext.goal) {
        conversations[sessionId].insights.mainGoal = businessContext.goal;
      }

      if (businessContext.tone) {
        conversations[sessionId].insights.tone = businessContext.tone;
      }
    }

    const { history, context, insights } = conversations[sessionId];

    const response = await runAgent({
      userMessage: message,
      instagramData: mockInstagramData,
      businessContext: {
        ...context,
        ...insights, // 🔥 agora isso funciona de verdade
      },
      mode,
      history,
    });

    // 🔥 salva histórico corretamente
    history.push({
        role: "user",
        content: String(message),
    });
    history.push({
        role: "assistant",
        content: JSON.stringify(response, null, 2),
    });
    res.json({ response });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erro no agente" });
  }
});

app.listen(3000, () => {
  console.log("Servidor rodando na porta 3000 🚀");
});