import cors from "cors";
import express, { Router } from "express";
import authRoutes from "./auth/routes.js";
import conversationRoutes from "./conversations/routes.js";
import { errorHandler } from "./http/errors.js";

// Everything the MVP app calls lives under /v1, with its own CORS list (APP_ORIGINS).
export function mvpRouter() {
  const origins = (process.env.APP_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean);
  const router = Router();

  router.use(cors({ origin: origins, credentials: false }));
  router.use(express.json({ limit: "200kb" }));

  router.use("/auth", authRoutes);
  router.use("/conversations", conversationRoutes);

  router.use((_req, res) => {
    res.status(404).json({ error: { code: "not_found", message: "Not found.", time: new Date().toISOString() } });
  });
  router.use(errorHandler);
  return router;
}
