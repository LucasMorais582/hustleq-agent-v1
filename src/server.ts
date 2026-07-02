import "./config/env.js";

import express from "express";
import cors from "cors";

import agentRoutes from "./routes/agent.routes.js";
import authRoutes from "./routes/auth.routes.js";
import businessRoutes from "./routes/business.routes.js";
import strategyRoutes from "./routes/strategy.routes.js";
import conversationRoutes from "./routes/conversation.routes.js";

const app = express();

app.use(cors({
  origin: "*", // depois preciso restringeir
}));

app.use(express.json());

app.use("/agent", agentRoutes);
app.use("/auth", authRoutes);
app.use("/business", businessRoutes);
app.use("/strategy", strategyRoutes);
app.use("/conversation", conversationRoutes);

app.get("/health", (req, res) => {
  res.send("API running...");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT} 🚀`);
});