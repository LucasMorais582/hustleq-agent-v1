import cors from "cors";
import express, { Router } from "express";
import authRoutes from "./auth/routes.js";
import conversationRoutes from "./conversations/routes.js";
import inviteRoutes from "./invites/routes.js";
import adminRoutes from "./admin/routes.js";
import onboardingRoutes from "./onboarding/routes.js";
import businessRoutes from "./business/routes.js";
import { strategiesRouter, weeksRouter } from "./plan/routes.js";
import { postsRouter } from "./posts/routes.js";
import { calendarRouter, homeRouter } from "./home/routes.js";
import { exportsRouter, filesRouter, productionRouter, sharedRouter, shotItemsRouter } from "./production/routes.js";
import { errorHandler } from "./http/errors.js";

// Everything the MVP app calls lives under /v1, with its own CORS list (APP_ORIGINS).
export function mvpRouter() {
  const origins = (process.env.APP_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean);
  const router = Router();

  router.use(cors({ origin: origins, credentials: false }));
  router.use(express.json({ limit: "200kb" }));

  router.use("/auth", authRoutes);
  router.use("/conversations", conversationRoutes);
  router.use("/invites", inviteRoutes);
  router.use("/admin", adminRoutes);
  router.use("/onboarding", onboardingRoutes);
  router.use("/business-profile", businessRoutes);
  router.use("/strategies", strategiesRouter);
  router.use("/weeks", weeksRouter);
  router.use("/weeks", productionRouter);
  router.use("/home", homeRouter);
  router.use("/calendar", calendarRouter);
  router.use("/shot-list", shotItemsRouter);
  router.use("/exports", exportsRouter);
  router.use("/shared", sharedRouter);
  router.use("/files", filesRouter);
  router.use("/posts", postsRouter);

  router.use((_req, res) => {
    res.status(404).json({ error: { code: "not_found", message: "Not found.", time: new Date().toISOString() } });
  });
  router.use(errorHandler);
  return router;
}
