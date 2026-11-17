import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { AppError, notFound } from "../http/errors.js";
import { currentUser, requireAdmin, requireUser } from "../auth/middleware.js";
import { hashToken } from "../auth/sessions.js";
import { socialData, SocialDataUnavailable, type IgProfileBundle } from "../socialData/index.js";
import { expiresAtFor, instagramTaken, inviteToken, newInviteId, sendInviteEmail } from "../invites/service.js";

// Admin is a role inside the app. Phase 1: invites (check the Instagram, reserve it, send).
const router = Router();
router.use(requireUser, requireAdmin);

const handleSchema = z.string().trim().toLowerCase().transform((h) => h.replace(/^@/, "")).pipe(z.string().regex(/^[a-z0-9._]{1,30}$/, "Not a valid Instagram handle"));

// Lookups are slow (15-25 s with the demo source); keep them 10 minutes so "check" then "send" costs one.
const lookups = new Map<string, { at: number; bundle: IgProfileBundle | null }>();
async function lookup(handle: string) {
  const hit = lookups.get(handle);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.bundle;
  try {
    const bundle = await socialData().lookupProfile(handle);
    lookups.set(handle, { at: Date.now(), bundle });
    return bundle;
  } catch (error) {
    if (error instanceof SocialDataUnavailable) throw new AppError(503, "instagram_unavailable", "We couldn't reach Instagram data right now. Try again in a minute.");
    throw error;
  }
}

async function audit(adminId: string, action: string, detail: object, targetUserId?: string) {
  await db.adminAuditLog.create({ data: { adminId, action, detail, targetUserId: targetUserId ?? null } });
}

router.post("/instagram-check", async (req, res) => {
  const { handle } = z.object({ handle: handleSchema }).parse(req.body);
  const bundle = await lookup(handle);
  if (!bundle) throw new AppError(404, "instagram_not_found", `We couldn't find @${handle} on Instagram.`);
  const taken = await instagramTaken(bundle.profile.id);
  res.json({ profile: bundle.profile, recentPosts: bundle.posts.length, source: bundle.source, taken });
});

const inviteBody = z.object({
  email: z.string().trim().toLowerCase().email(),
  businessName: z.string().trim().min(1).max(120),
  handle: handleSchema,
});

router.post("/invites", async (req, res) => {
  const me = currentUser(req);
  const body = inviteBody.parse(req.body);

  if (await db.user.findUnique({ where: { email: body.email } })) throw new AppError(409, "email_taken", "This email already has an account.");
  if (await db.invite.findFirst({ where: { email: body.email, status: "pending", expiresAt: { gt: new Date() } } })) {
    throw new AppError(409, "invite_pending", "This email already has an open invite. Resend it instead.");
  }

  const bundle = await lookup(body.handle);
  if (!bundle) throw new AppError(404, "instagram_not_found", `We couldn't find @${body.handle} on Instagram.`);
  const taken = await instagramTaken(bundle.profile.id);
  if (taken) throw new AppError(409, "instagram_taken", taken === "user" ? "This Instagram already belongs to an account." : "This Instagram already has an open invite.");

  const id = newInviteId();
  const createdAt = new Date();
  const invite = await db.invite.create({
    data: {
      id,
      email: body.email,
      businessName: body.businessName,
      instagramHandle: bundle.profile.handle,
      instagramProfileId: bundle.profile.id,
      tokenHash: hashToken(inviteToken(id)),
      createdAt,
      expiresAt: expiresAtFor(createdAt),
      createdById: me.id,
    },
  });
  const email = await sendInviteEmail(invite);
  await audit(me.id, "invite.create", { inviteId: invite.id, email: invite.email, handle: invite.instagramHandle });
  res.status(201).json({ invite: present(invite), emailStatus: email.status });
});

router.get("/invites", async (_req, res) => {
  const invites = await db.invite.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  const now = new Date();
  res.json({ items: invites.map((i) => present(i.status === "pending" && i.expiresAt <= now ? { ...i, status: "expired" as const } : i)) });
});

const idParam = z.object({ id: z.string().uuid() });

router.post("/invites/:id/resend", async (req, res) => {
  const me = currentUser(req);
  const { id } = idParam.parse(req.params);
  const invite = await db.invite.findUnique({ where: { id } });
  if (!invite) throw notFound("Invite not found.");
  if (invite.status !== "pending" || invite.expiresAt <= new Date()) throw new AppError(409, "invite_closed", "Only open invites can be resent.");
  // Same link as before; the email just goes out again.
  const email = await sendInviteEmail(invite);
  await audit(me.id, "invite.resend", { inviteId: id });
  res.json({ invite: present(invite), emailStatus: email.status });
});

router.post("/invites/:id/revoke", async (req, res) => {
  const me = currentUser(req);
  const { id } = idParam.parse(req.params);
  const invite = await db.invite.findUnique({ where: { id } });
  if (!invite) throw notFound("Invite not found.");
  if (invite.status !== "pending") throw new AppError(409, "invite_closed", "Only open invites can be revoked.");
  const updated = await db.invite.update({ where: { id }, data: { status: "revoked" } });
  await audit(me.id, "invite.revoke", { inviteId: id });
  res.json({ invite: present(updated) });
});

function present(i: { id: string; email: string; businessName: string; instagramHandle: string; status: string; createdAt: Date; expiresAt: Date; acceptedAt?: Date | null; lastReminderAt?: Date | null }) {
  return {
    id: i.id, email: i.email, businessName: i.businessName, instagramHandle: i.instagramHandle, status: i.status,
    createdAt: i.createdAt, expiresAt: i.expiresAt, acceptedAt: i.acceptedAt ?? null, lastReminderAt: i.lastReminderAt ?? null,
  };
}

export default router;
