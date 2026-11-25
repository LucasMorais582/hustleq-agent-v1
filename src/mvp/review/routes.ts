import { Router } from "express";
import { z } from "zod";
import { currentUser, requireUser } from "../auth/middleware.js";
import { requireActivePlan } from "../billing/service.js";
import { AppError } from "../http/errors.js";
import { getReview, listMilestones, replyReview, retryAnalysis, ReviewInputError, startReview } from "./service.js";

// 12.0 to 12.3 · the monthly review conversation; 12.4 · milestones.
export const reviewRouter = Router();
reviewRouter.use(requireUser);

reviewRouter.post("/start", requireActivePlan, async (req, res) => {
  res.json(await startReview(currentUser(req).id));
});

const convParam = z.object({ conversationId: z.string().uuid() });

reviewRouter.get("/:conversationId", async (req, res) => {
  const { conversationId } = convParam.parse(req.params);
  res.json(await getReview(currentUser(req).id, conversationId));
});

reviewRouter.post("/:conversationId/reply", requireActivePlan, async (req, res) => {
  const me = currentUser(req);
  const { conversationId } = convParam.parse(req.params);
  const body = z.object({ choices: z.array(z.string().max(200)).max(5).optional(), text: z.string().max(600).optional() }).parse(req.body ?? {});
  try {
    const r = await replyReview(me.id, conversationId, body);
    res.json({ ...(await getReview(me.id, conversationId)), next: r.next });
  } catch (error) {
    if (error instanceof ReviewInputError) throw new AppError(400, "invalid_answer", error.message);
    throw error;
  }
});

reviewRouter.post("/:conversationId/retry", async (req, res) => {
  const { conversationId } = convParam.parse(req.params);
  res.json(await retryAnalysis(currentUser(req).id, conversationId));
});

export const milestonesRouter = Router();
milestonesRouter.use(requireUser);
milestonesRouter.get("/", async (req, res) => {
  res.json(await listMilestones(currentUser(req).id));
});
