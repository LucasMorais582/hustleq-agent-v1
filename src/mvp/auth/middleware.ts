import type { RequestHandler } from "express";
import { db } from "../db.js";
import { forbidden, unauthorized } from "../http/errors.js";
import { findSession } from "./sessions.js";

export type AuthUser = { id: string; email: string; role: "user" | "admin"; timezone: string };

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      sessionId?: string;
    }
  }
}

export const requireUser: RequestHandler = async (req, _res, next) => {
  const header = req.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) throw unauthorized();

  const session = await findSession(db, token);
  if (!session) throw unauthorized();

  const { id, email, role, timezone } = session.user;
  req.user = { id, email, role, timezone };
  req.sessionId = session.id;
  next();
};

export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (req.user?.role !== "admin") throw forbidden();
  next();
};

// Use inside handlers: the logged-in user, never undefined after requireUser.
export function currentUser(req: Express.Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
