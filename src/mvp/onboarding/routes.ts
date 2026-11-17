import { Router } from "express";
import { requireActivePlan } from "../billing/service.js";
import { z } from "zod";
import { currentUser, requireUser } from "../auth/middleware.js";
import { AppError } from "../http/errors.js";
import { getOnboarding, OnboardingInputError, replyOnboarding, retryPreparation } from "./service.js";

const router = Router();
router.use(requireUser);

router.get("/", async (req, res) => {
  res.json(await getOnboarding(currentUser(req).id));
});

const replyBody = z.object({
  choices: z.array(z.string().max(200)).max(10).optional(),
  text: z.string().max(600).optional(),
});

router.post("/reply", requireActivePlan, async (req, res) => {
  const me = currentUser(req);
  try {
    const result = await replyOnboarding(me.id, replyBody.parse(req.body));
    res.json({ ...(await getOnboarding(me.id)), next: result?.next ?? null });
  } catch (error) {
    if (error instanceof OnboardingInputError) throw new AppError(400, "invalid_answer", error.message);
    throw error;
  }
});

router.post("/retry", async (req, res) => {
  const me = currentUser(req);
  await retryPreparation(me.id);
  res.json(await getOnboarding(me.id));
});

export default router;
