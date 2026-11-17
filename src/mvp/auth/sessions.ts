import { createHash, randomBytes } from "node:crypto";
import type { Db } from "../db.js";

// Opaque, revocable session tokens. Only the SHA-256 of the token is stored.
const SESSION_DAYS = 30;

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(db: Db, userId: string, userAgent?: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 864e5);
  await db.session.create({
    data: { userId, tokenHash: hashToken(token), expiresAt, userAgent: userAgent?.slice(0, 300) ?? null },
  });
  return { token, expiresAt };
}

export async function findSession(db: Db, token: string) {
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!session || session.revokedAt || session.expiresAt < new Date()) return null;

  // Touch at most once a minute to keep writes low.
  if (Date.now() - session.lastUsedAt.getTime() > 60_000) {
    await db.session.update({ where: { id: session.id }, data: { lastUsedAt: new Date() } });
  }
  return session;
}

export const revokeSession = (db: Db, sessionId: string) =>
  db.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });

export const revokeAllSessions = (db: Db, userId: string) =>
  db.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
