import { Router } from "express";
import { z } from "zod";
import { costReport } from "./costs.js";
import { deleteNicheDate, generateNicheDates, nicheDatesForReview, reviewNicheDate } from "../campaigns/nicheDates.js";
import { db } from "../db.js";
import { AppError, notFound } from "../http/errors.js";
import { currentUser, requireAdmin, requireUser } from "../auth/middleware.js";
import { hashToken } from "../auth/sessions.js";
import { socialData, SocialDataUnavailable, type IgProfileBundle } from "../socialData/index.js";
import { enqueueSafe } from "../jobs/queue.js";
import { resetOnboardingForNewHandle } from "../onboarding/service.js";
import { appUrl, sendEmail } from "../email/send.js";
import { accountUpdatedEmail } from "../email/templates.js";
import { releaseInvite, reserveForInvite, unlinkUser } from "../instagram/link.js";
import { isApiMode } from "../socialData/index.js";
import { expiresAtFor, instagramTaken, inviteToken, newInviteId, sendInviteEmail } from "../invites/service.js";

// Admin is a role inside the app. Phase 1: invites (check the Instagram, reserve it, send).
const router = Router();
router.use(requireUser, requireAdmin);

const handleSchema = z.string().trim().toLowerCase().transform((h) => h.replace(/^@/, "")).pipe(z.string().regex(/^[a-z0-9._]{1,30}$/, "Not a valid Instagram handle"));

// Lookups are slow (15-25 s with the demo source); keep them 10 minutes so "check" then "send" costs one.
const lookups = new Map<string, { at: number; bundle: IgProfileBundle | null }>();
async function lookup(handle: string, adminId: string) {
  const hit = lookups.get(handle);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.bundle;
  try {
    const bundle = await socialData(adminId).lookupProfile(handle);
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
  const bundle = await lookup(handle, currentUser(req).id);
  if (!bundle) throw new AppError(404, "instagram_not_found", `We couldn't find @${handle} on Instagram.`);
  const taken = await instagramTaken(bundle.profile.id);
  res.json({ profile: bundle.profile, recentPosts: bundle.posts.length, source: bundle.source, taken });
});

const inviteBody = z.object({
  email: z.string().trim().toLowerCase().email(),
  businessName: z.string().trim().min(1).max(120),
  handle: handleSchema,
  firstAccess: z.boolean().default(false),
  billingExempt: z.boolean().default(false), // "Managed by HustleQ team" (FPP accounts)
});

router.post("/invites", async (req, res) => {
  const me = currentUser(req);
  const body = inviteBody.parse(req.body);

  if (await db.user.findUnique({ where: { email: body.email } })) throw new AppError(409, "email_taken", "This email already has an account.");
  if (await db.invite.findFirst({ where: { email: body.email, status: "pending", expiresAt: { gt: new Date() } } })) {
    throw new AppError(409, "invite_pending", "This email already has an open invite. Resend it instead.");
  }

  const bundle = await lookup(body.handle, me.id);
  if (!bundle) throw new AppError(404, "instagram_not_found", `We couldn't find @${body.handle} on Instagram.`);
  const taken = await instagramTaken(bundle.profile.id);
  if (taken) throw new AppError(409, "instagram_taken", taken === "user" ? "This Instagram already belongs to an account." : "This Instagram already has an open invite.");

  const id = newInviteId();
  const createdAt = new Date();
  // api mode: reserve the profile there first; its Initial Profile Sync starts right away.
  const socialProfileId = await reserveForInvite(id, bundle.profile.handle, expiresAtFor(createdAt));
  const invite = await db.invite.create({
    data: {
      id,
      email: body.email,
      businessName: body.businessName,
      instagramHandle: bundle.profile.handle,
      instagramProfileId: bundle.profile.id,
      socialProfileId,
      tokenHash: hashToken(inviteToken(id)),
      createdAt,
      expiresAt: expiresAtFor(createdAt),
      createdById: me.id,
      firstAccess: body.firstAccess,
      billingExempt: body.billingExempt,
    },
  });
  const email = await sendInviteEmail(invite);
  // Initial Profile Sync: onboarding opens with the profile and posts already read.
  // (api mode: the API does it after the reservation; we can read it once the invite is accepted.)
  if (!isApiMode()) await enqueueSafe("instagram-sync", { handle: invite.instagramHandle });
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
  await releaseInvite(updated);
  await audit(me.id, "invite.revoke", { inviteId: id });
  res.json({ invite: present(updated) });
});

// ---------- "Not my account" requests (E.4) ----------

// ---------- Team: who is an admin ----------

// Accounts, with search by email or business name (Admin › Team).
router.get("/users", async (req, res) => {
  const { q } = z.object({ q: z.string().trim().max(80).optional() }).parse(req.query);
  const users = await db.user.findMany({
    where: q ? { OR: [{ email: { contains: q, mode: "insensitive" } }, { business: { businessName: { contains: q, mode: "insensitive" } } }] } : {},
    select: { id: true, email: true, role: true, billingExempt: true, instagramHandle: true, createdAt: true, business: { select: { businessName: true } } },
    orderBy: [{ role: "asc" }, { createdAt: "desc" }],
    take: 100,
  });
  const me = currentUser(req);
  res.json({
    items: users.map((u) => ({
      id: u.id, email: u.email, role: u.role, managed: u.billingExempt, instagramHandle: u.instagramHandle,
      businessName: u.business?.businessName ?? null, createdAt: u.createdAt, isMe: u.id === me.id,
    })),
  });
});

// Make an account admin, or take it back. Never yourself, never the last admin. Logged.
router.post("/users/:id/role", async (req, res) => {
  const me = currentUser(req);
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const { role } = z.object({ role: z.enum(["admin", "user"]) }).parse(req.body);
  if (id === me.id) throw new AppError(400, "own_role", "You can’t change your own access. Ask another admin.");
  const target = await db.user.findUnique({ where: { id } });
  if (!target) throw notFound("Account not found.");
  if (target.role !== role) {
    if (role === "user" && (await db.user.count({ where: { role: "admin" } })) <= 1) throw new AppError(400, "last_admin", "There must be at least one admin.");
    await db.user.update({ where: { id }, data: { role } });
    await audit(me.id, role === "admin" ? "admin_granted" : "admin_revoked", { email: target.email }, id);
  }
  res.json({ id, role });
});

// Cost per account this month (Claude), for the per-customer cost study.
// Commercial dates by niche: they show to owners right away; the team fixes, hides or deletes them.
router.get("/niche-dates", async (_req, res) => {
  res.json(await nicheDatesForReview());
});

router.post("/niche-dates/generate/:userId", async (req, res) => {
  const { userId } = z.object({ userId: z.string().uuid() }).parse(req.params);
  res.json(await generateNicheDates(userId));
});

router.post("/niche-dates/:id", async (req, res) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const body = z.object({ status: z.enum(["approved", "rejected"]), name: z.string().trim().min(1).max(60).optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).parse(req.body);
  if (!(await reviewNicheDate(id, body))) throw notFound("Date not found.");
  res.json({ ok: true });
});

router.delete("/niche-dates/:id", async (req, res) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  if (!(await deleteNicheDate(id))) throw notFound("Date not found.");
  res.json({ ok: true });
});

router.get("/costs", async (req, res) => {
  const { month } = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() }).parse(req.query);
  res.json(await costReport(month ?? new Date().toISOString().slice(0, 7)));
});

router.get("/account-requests", async (_req, res) => {
  const rows = await db.accountChangeRequest.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  const users = await db.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, include: { business: true } });
  res.json({
    items: rows.map((r) => {
      const u = users.find((x) => x.id === r.userId);
      return { ...r, email: u?.email ?? null, businessName: u?.business?.businessName ?? null };
    }),
  });
});

router.post("/account-requests/:id/resolve", async (req, res) => {
  const me = currentUser(req);
  const { id } = idParam.parse(req.params);
  const { handle } = z.object({ handle: handleSchema }).parse(req.body);
  const request = await db.accountChangeRequest.findUnique({ where: { id } });
  if (!request || request.status !== "open") throw notFound("Request not found.");

  const bundle = await lookup(handle, me.id);
  if (!bundle) throw new AppError(404, "instagram_not_found", `We couldn't find @${handle} on Instagram.`);
  const taken = await instagramTaken(bundle.profile.id);
  const owner = await db.user.findUnique({ where: { instagramProfileId: bundle.profile.id } });
  if (taken && owner?.id !== request.userId) throw new AppError(409, "instagram_taken", "This Instagram already belongs to an account or an open invite.");

  const user = await db.user.update({
    where: { id: request.userId },
    data: { instagramHandle: bundle.profile.handle, instagramProfileId: bundle.profile.id },
    include: { onboarding: true },
  });
  await unlinkUser(user.id); // the next read reserves and links the new handle in the API
  await db.accountChangeRequest.update({ where: { id }, data: { status: "resolved", resolvedAt: new Date() } });
  await resetOnboardingForNewHandle(user.id, user.onboarding?.conversationId ?? null);
  await sendEmail(user.email, accountUpdatedEmail({ handle: bundle.profile.handle, url: appUrl("/onboarding") }), user.id);
  await audit(me.id, "account.change_instagram", { requestId: id, from: request.currentHandle, to: bundle.profile.handle }, user.id);
  res.json({ ok: true });
});

function present(i: { id: string; email: string; businessName: string; instagramHandle: string; status: string; createdAt: Date; expiresAt: Date; acceptedAt?: Date | null; lastReminderAt?: Date | null; firstAccess?: boolean; billingExempt?: boolean }) {
  return {
    id: i.id, email: i.email, businessName: i.businessName, instagramHandle: i.instagramHandle, status: i.status,
    firstAccess: Boolean(i.firstAccess), billingExempt: Boolean(i.billingExempt),
    createdAt: i.createdAt, expiresAt: i.expiresAt, acceptedAt: i.acceptedAt ?? null, lastReminderAt: i.lastReminderAt ?? null,
  };
}

export default router;
