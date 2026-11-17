import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { db } from "../db.js";
import { AppError } from "../http/errors.js";
import { checkPassword } from "./password.js";
import { createSession, revokeSession } from "./sessions.js";
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
  const user = await db.user.findUniqueOrThrow({ where: { id: me.id }, include: { business: true } });
  res.json({ user: publicUser(user), business: user.business });
});

// Never send passwordHash or other internals to the client.
export function publicUser(u: { id: string; email: string; role: string; timezone: string; instagramHandle: string | null }) {
  return { id: u.id, email: u.email, role: u.role, timezone: u.timezone, instagramHandle: u.instagramHandle };
}

export default router;
