import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { db } from "../db.js";
import { AppError } from "../http/errors.js";
import { hashPassword } from "../auth/password.js";
import { createSession, hashToken } from "../auth/sessions.js";
import { publicUser } from "../auth/routes.js";
import { isValidTimezone } from "../lib/time.js";
import { INVITE_TZ } from "./service.js";
import { startPreparation } from "../onboarding/service.js";

// Public side of an invite: read it (screen 1.2 or E.3) and accept it (create password).
const router = Router();
const limiter = rateLimit({ windowMs: 15 * 60_000, limit: 60, standardHeaders: "draft-8", legacyHeaders: false });
router.use(limiter);

const tokenParam = z.object({ token: z.string().min(20).max(200) });

async function findOpenInvite(token: string) {
  const invite = await db.invite.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!invite || invite.status === "revoked") throw new AppError(404, "invite_not_found", "This invite link isn't valid.");
  if (invite.status === "accepted") throw new AppError(409, "invite_used", "This invite was already used. Log in instead.");
  if (invite.status === "expired" || invite.expiresAt <= new Date()) throw new AppError(410, "invite_expired", "This invite expired.");
  return invite;
}

router.get("/:token", async (req, res) => {
  const { token } = tokenParam.parse(req.params);
  const invite = await findOpenInvite(token);
  res.json({
    email: invite.email,
    businessName: invite.businessName,
    instagramHandle: invite.instagramHandle,
    expiresAt: invite.expiresAt,
  });
});

const acceptBody = z.object({
  password: z.string().min(8, "At least 8 characters").max(200),
  acceptTerms: z.literal(true),
  timezone: z.string().max(64).optional(),
});

router.post("/:token/accept", async (req, res) => {
  const { token } = tokenParam.parse(req.params);
  const body = acceptBody.parse(req.body);
  const invite = await findOpenInvite(token);

  if (await db.user.findUnique({ where: { email: invite.email } })) {
    throw new AppError(409, "email_taken", "There's already an account with this email. Log in instead.");
  }
  if (invite.instagramProfileId && (await db.user.findUnique({ where: { instagramProfileId: invite.instagramProfileId } }))) {
    throw new AppError(409, "instagram_taken", "This Instagram is already linked to another account. Write to our team.");
  }

  const timezone = body.timezone && isValidTimezone(body.timezone) ? body.timezone : INVITE_TZ;
  const passwordHash = await hashPassword(body.password);

  const user = await db.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email: invite.email,
        passwordHash,
        timezone,
        instagramHandle: invite.instagramHandle,
        instagramProfileId: invite.instagramProfileId,
        termsAcceptedAt: new Date(),
        termsVersion: process.env.TERMS_VERSION || "draft-2026-11",
        billingExempt: invite.billingExempt,
      },
    });
    // The plan starts in Stripe Checkout right after this (First Access: first month free).
    if (!invite.billingExempt) await tx.subscription.create({ data: { userId: created.id, firstAccess: invite.firstAccess } });
    await tx.businessProfile.create({ data: { userId: created.id, businessName: invite.businessName } });
    await tx.onboardingState.create({ data: { userId: created.id } });
    // Accepting stops the reminders: the daily job only looks at pending invites.
    await tx.invite.update({ where: { id: invite.id }, data: { status: "accepted", acceptedUserId: created.id, acceptedAt: new Date() } });
    return created;
  });

  const session = await createSession(db, user.id, req.get("user-agent"));
  // Start reading the posts now; onboarding step 2 needs it in a few seconds.
  startPreparation(user.id).catch((error) => console.error("[onboarding] prepare failed", error));
  res.status(201).json({ token: session.token, expiresAt: session.expiresAt, user: publicUser(user) });
});

export default router;
