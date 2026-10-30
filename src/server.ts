import "./config/env.js";

import express from "express";
import cors from "cors";

import agentRoutes from "./routes/agent.routes.js";
import authRoutes from "./routes/auth.routes.js";
import businessRoutes from "./routes/business.routes.js";
import strategyRoutes from "./routes/strategy.routes.js";
import conversationRoutes from "./routes/conversation.routes.js";
import demoRoutes from "./demo/demo.routes.js";

const app = express();

// Railway sits behind a proxy; needed for per-IP rate limits on /demo.
app.set("trust proxy", 1);

// Public Meet Duke demo, with its own CORS. Must come before the global cors below.
app.use("/demo", express.json({ limit: "10kb" }), demoRoutes);

app.use(cors({
  origin: "*", // depois preciso restringeir
}));

app.use(express.json());

app.use("/agent", agentRoutes);
app.use("/auth", authRoutes);
app.use("/business-context", businessRoutes);
app.use("/content-strategy", strategyRoutes);
app.use("/conversations", conversationRoutes);

app.get("/health", (req, res) => {
  res.send("API running...");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT} 🚀`);
});