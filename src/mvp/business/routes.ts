import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { currentUser, requireUser } from "../auth/middleware.js";
import { FIELD_KEYS, isProfileField, PROFILE_FIELDS, profileValues } from "./fields.js";

// Business Profile (2.4 during onboarding, 13.7 / 13.8 afterwards).
const router = Router();
router.use(requireUser);

async function present(userId: string) {
  const bp = await db.businessProfile.findUnique({ where: { userId } });
  const data = (await db.onboardingState.findUnique({ where: { userId } }))?.data as { analysis?: { fields?: Record<string, { suggestions?: string[] }> } } | null;
  return {
    businessName: bp?.businessName ?? null,
    completedAt: bp?.completedAt ?? null,
    updatedAt: bp?.updatedAt ?? null,
    fields: PROFILE_FIELDS.map((f) => ({
      key: f.key,
      label: f.label,
      value: profileValues(bp as Record<string, unknown> | null)[f.key],
      // Suggestions Duke made from the posts (13.8 "Pick suggestions or write your own").
      suggestions: data?.analysis?.fields?.[f.key]?.suggestions ?? [],
    })),
  };
}

router.get("/", async (req, res) => {
  res.json(await present(currentUser(req).id));
});

const patchBody = z.record(z.string(), z.string().trim().max(600)).refine((o) => Object.keys(o).length > 0 && Object.keys(o).every(isProfileField), "Unknown field");

router.patch("/", async (req, res) => {
  const me = currentUser(req);
  const body = patchBody.parse(req.body);
  const data: Record<string, string | null> = {};
  for (const k of FIELD_KEYS) if (k in body) data[k] = body[k] || null;
  await db.businessProfile.update({ where: { userId: me.id }, data });
  res.json(await present(me.id));
});

export default router;
