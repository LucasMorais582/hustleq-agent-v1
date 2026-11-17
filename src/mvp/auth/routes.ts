import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { db } from "../db.js";
import { AppError } from "../http/errors.js";
import { randomBytes } from "node:crypto";
import { appUrl, sendEmail } from "../email/send.js";
import { passwordResetEmail } from "../email/templates.js";
import { checkPassword, hashPassword } from "./password.js";
import { createSession, hashToken, revokeAllSessions, revokeSession } from "./sessions.js";
import { currentUser, requireUser } from "./middleware.js";

const router = Router();

const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false });

const loginBody = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
});

router.post("/login", loginLimiter, async (req, res) => {
  const { email, password } = loginBody.parse(req.body);
  const user = await db.user.findUnique({ where: { email } });
  const ok = user ? await checkPassword(password, user.passwordHash) : false;
  if (!user || !ok) throw new AppError(401, "wrong_credentials", "Email or password is wrong.");

  const { token, expiresAt } = await createSession(db, user.id, req.get("user-agent"));
  res.json({ token, expiresAt, user: publicUser(user) });
});

router.post("/logout", requireUser, async (req, res) => {
  if (req.sessionId) await revokeSession(db, req.sessionId);
  res.status(204).end();
});

router.get("/me", requireUser, async (req, res) => {
  const me = currentUser(req);
  const user = await db.user.findUniqueOrThrow({ where: { id: me.id }, include: { business: true, onboarding: true } });
  res.json({
    user: publicUser(user),
    business: user.business ? { businessName: user.business.businessName, completedAt: user.business.completedAt } : null,
    // The app sends the owner to /onboarding until this is "done".
    onboarding: { status: user.onboarding?.status ?? "active", step: user.onboarding?.step ?? 1 },
  });
});

// ---------- Forgot password (1.4) and set a new one (1.5) ----------

const RESET_HOURS = 2;
const forgotLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 5, standardHeaders: "draft-8", legacyHeaders: false });
const resetLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false });

// Always the same answer, so nobody can find out which emails have an account.
router.post("/forgot", forgotLimiter, async (req, res) => {
  const { email } = z.object({ email: z.string().trim().toLowerCase().email() }).parse(req.body);
  const user = await db.user.findUnique({ where: { email } });
  if (user) {
    const token = randomBytes(32).toString("base64url");
    await db.passwordResetToken.create({
      data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + RESET_HOURS * 3600_000) },
    });
    await sendEmail(user.email, passwordResetEmail({ email: user.email, url: appUrl(`/reset/${token}`) }), user.id);
  }
  res.json({ ok: true });
});

async function openResetToken(token: string) {
  const row = await db.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!row || row.usedAt || row.expiresAt <= new Date()) {
    throw new AppError(410, "reset_link_invalid", "This link expired or was already used. Ask for a new one.");
  }
  return row;
}

router.get("/reset/:token", resetLimiter, async (req, res) => {
  const { token } = z.object({ token: z.string().min(20).max(200) }).parse(req.params);
  const row = await openResetToken(token);
  res.json({ email: row.user.email });
});

router.post("/reset", resetLimiter, async (req, res) => {
  const { token, password } = z.object({ token: z.string().min(20).max(200), password: z.string().min(8, "At least 8 characters").max(200) }).parse(req.body);
  const row = await openResetToken(token);

  // The link works once: mark it used in the same step as changing the password.
  const used = await db.passwordResetToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  if (used.count !== 1) throw new AppError(410, "reset_link_invalid", "This link expired or was already used. Ask for a new one.");

  await db.user.update({ where: { id: row.userId }, data: { passwordHash: await hashPassword(password) } });
  // A new password logs out every other device.
  await revokeAllSessions(db, row.userId);
  await db.passwordResetToken.updateMany({ where: { userId: row.userId, usedAt: null }, data: { usedAt: new Date() } });

  const session = await createSession(db, row.userId, req.get("user-agent"));
  res.json({ token: session.token, expiresAt: session.expiresAt, user: publicUser(row.user) });
});

// Never send passwordHash or other internals to the client.
export function publicUser(u: { id: string; email: string; role: string; timezone: string; instagramHandle: string | null; remindersOn?: boolean; reminderTime?: string }) {
  return { id: u.id, email: u.email, role: u.role, timezone: u.timezone, instagramHandle: u.instagramHandle, reminders: { on: u.remindersOn ?? true, time: u.reminderTime ?? "09:00" } };
}

// Account · Reminders: email on post days, and the time it's sent (owner's timezone).
router.patch("/me/reminders", requireUser, async (req, res) => {
  const me = currentUser(req);
  const body = z.object({ on: z.boolean().optional(), time: z.string().regex(/^([01]\d|2[0-3]):(00|15|30|45)$/).optional() }).parse(req.body);
  const user = await db.user.update({ where: { id: me.id }, data: { ...(body.on !== undefined ? { remindersOn: body.on } : {}), ...(body.time ? { reminderTime: body.time } : {}) } });
  res.json(publicUser(user));
});

export default router;
