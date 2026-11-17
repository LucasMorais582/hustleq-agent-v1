import "./config/env.js";

import express from "express";
import demoRoutes from "./demo/demo.routes.js";
import { mvpRouter } from "./mvp/router.js";

export function createApp() {
  const app = express();

  // Railway sits behind a proxy; needed for per-IP rate limits.
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  // Public Meet Duke demo (landing), with its own CORS. Unchanged.
  app.use("/demo", express.json({ limit: "10kb" }), demoRoutes);

  // HustleQ MVP app.
  app.use("/v1", mvpRouter());

  app.get("/health", (_req, res) => {
    res.send("API running...");
  });

  return app;
}
