import "./config/env.js";

import express from "express";
import cors from "cors";
import { runAgent } from "./agent/agent.service.js";

const app = express();
app.use(cors());
app.use(express.json());

app.post("/agent/chat", async (req, res) => {
  try {
    const { message, niche } = req.body;

    const mockInstagramData = {
      followers: 12000,
      avg_likes: 350,
      avg_comments: 20,
      posts_per_week: 2,
    };

    const response = await runAgent({
      userMessage: message,
      instagramData: mockInstagramData,
      businessContext: {
        niche,
      },
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