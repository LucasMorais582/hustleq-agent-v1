import type { NextFunction, Request, Response } from "express";
import { db } from "../db.js";
import { appUrl, sendEmail } from "../email/send.js";
import { limitsRenewedEmail, paymentFailedEmail, planCancelledEmail } from "../email/templates.js";
import { currentUser } from "../auth/middleware.js";
import { AppError } from "../http/errors.js";
import { dayInTz } from "../lib/time.js";
import { monthStart } from "../posts/service.js";
import * as stripeApi from "./stripe.js";

// Plan and limits (13.3-13.6, 1.6, 9.1b, 9.1c). Stripe is the source of truth for the subscription;
// the app keeps a copy (Subscription) from webhooks, and also syncs on return from Checkout.

export const LIMITS = {
  search: { label: "Explore searches", limit: Number(process.env.SEARCHES_PER_MONTH ?? 20) },
  validation: { label: "Post validations", limit: Number(process.env.VALIDATIONS_PER_MONTH ?? 30) },
} as const;
export const WATCH_SLOTS = 3;
export const GRACE_DAYS = 3;
export const CANCEL_REASONS = ["Too expensive", "Not using it enough", "Missing a feature", "Something else"] as const;

export class BillingInputError extends Error {}

type SubRow = Awaited<ReturnType<typeof db.subscription.findUnique>>;
export type PlanState = "active" | "needs_checkout" | "inactive";

const dateLabel = (d: Date, tz: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: tz }).format(d);

export function planStateOf(user: { billingExempt: boolean; role?: string }, sub: SubRow, now = new Date()): { state: PlanState; reason: "cancelled" | "payment" | null; paymentIssue: boolean } {
  if (user.billingExempt || user.role === "admin") return { state: "active", reason: null, paymentIssue: false };
  if (!sub || ["none", "incomplete"].includes(sub.status)) return { state: "needs_checkout", reason: null, paymentIssue: false };
  if (sub.status === "trialing" || sub.status === "active") return { state: "active", reason: null, paymentIssue: false };
  if (sub.status === "past_due") {
    return sub.graceUntil && sub.graceUntil > now ? { state: "active", reason: null, paymentIssue: true } : { state: "inactive", reason: "payment", paymentIssue: true };
  }
  return { state: "inactive", reason: sub.status === "canceled" && sub.cancelAtPeriodEnd ? "cancelled" : sub.status === "canceled" ? "cancelled" : "payment", paymentIssue: sub.status === "unpaid" };
}

async function load(userId: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, include: { subscription: true, business: { select: { businessName: true } } } });
  return { user, sub: user.subscription };
}

export async function planFor(userId: string) {
  const { user, sub } = await load(userId);
  return { ...planStateOf(user, sub), managed: user.billingExempt || user.role === "admin" };
}

// ---------- Limits ----------

export async function usageFor(userId: string, tz: string) {
  const periodStart = monthStart(tz);
  const rows = await db.usage.findMany({ where: { userId, periodStart, kind: { in: Object.keys(LIMITS) } } });
  const watched = await db.watchedAccount.count({ where: { userId } });
  // Limits reset on the 1st of next month, in the owner's timezone.
  const resetsOn = new Date(`${dayInTz(new Date(), tz).slice(0, 7)}-01T12:00:00Z`);
  resetsOn.setUTCMonth(resetsOn.getUTCMonth() + 1);
  type Item = { kind: string; label: string; used: number; limit: number; left: number };
  const items: Item[] = (Object.keys(LIMITS) as (keyof typeof LIMITS)[]).map((kind) => {
    const used = Math.min(rows.find((r) => r.kind === kind)?.count ?? 0, LIMITS[kind].limit);
    return { kind, label: LIMITS[kind].label, used, limit: LIMITS[kind].limit, left: LIMITS[kind].limit - used };
  });
  items.push({ kind: "watch", label: "Watched accounts", used: Math.min(watched, WATCH_SLOTS), limit: WATCH_SLOTS, left: WATCH_SLOTS - Math.min(watched, WATCH_SLOTS) });
  const resetsLabel = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(resetsOn);
  const monthly = items.filter((i) => i.kind !== "watch");
  const full = monthly.filter((i) => i.used >= i.limit);
  const near = monthly.filter((i) => i.used >= i.limit * 0.8 && i.used < i.limit);
  return {
    items,
    resetsOn: resetsOn.toISOString().slice(0, 10),
    resetsLabel,
    canRenew: full.length > 0,
    warnings: [
      ...full.map((i) => ({ kind: i.kind, level: "full" as const, title: `You’ve used all ${i.limit} ${i.label.toLowerCase()}`, text: `Renew now and every limit goes back to zero today. Or wait: limits reset on ${resetsLabel}.` })),
      ...near.map((i) => ({ kind: i.kind, level: "near" as const, title: `You’ve used 80% of your ${i.label.toLowerCase()}`, text: `${i.left} left until ${resetsLabel}. If you use all ${i.limit}, you can renew for US$ 20 and every limit goes back to zero.` })),
    ],
  };
}

// ---------- What the app shows (13.3, 13.6, 1.6) ----------

export async function planPage(userId: string) {
  const { user, sub } = await load(userId);
  const tz = user.timezone;
  const st = planStateOf(user, sub);
  const managed = user.billingExempt || user.role === "admin";
  const period = sub?.currentPeriodEnd ? dateLabel(sub.currentPeriodEnd, tz) : null;
  const trialing = sub?.status === "trialing";
  let statusLabel = "Active";
  let line: string | null = null;
  if (managed) line = "Managed by the HustleQ team.";
  else if (st.state === "needs_checkout") { statusLabel = "Not started"; line = "Start your plan to use Duke."; }
  else if (st.state === "inactive") { statusLabel = "Inactive"; line = st.reason === "payment" ? "Your last payment didn’t go through." : "Your plan ended."; }
  else if (sub?.cancelAtPeriodEnd) { statusLabel = period ? `Ends ${period}` : "Ends soon"; line = `Cancelled. Active until ${period ?? "the end of the period"}, then view-only. No more charges.`; }
  else if (st.paymentIssue && sub?.graceUntil) { statusLabel = "Payment failed"; line = `We couldn’t charge your card. Duke keeps planning until ${dateLabel(sub.graceUntil, tz)}.`; }
  else if (period) line = `${trialing && sub?.firstAccess ? "Duke First Access: first month free. " : trialing ? "Free trial. " : ""}Next charge on ${period}.`;
  const stoppedOn = st.state === "inactive" ? (sub?.endedAt ?? sub?.graceUntil ?? sub?.updatedAt ?? null) : null;
  return {
    priceLabel: "HustleQ · US$ 20/month",
    state: st.state,
    managed,
    statusLabel,
    line,
    firstAccess: Boolean(sub?.firstAccess),
    cancelAtPeriodEnd: Boolean(sub?.cancelAtPeriodEnd),
    canCancel: !managed && st.state === "active" && Boolean(sub?.stripeSubscriptionId) && !sub?.cancelAtPeriodEnd,
    canResume: !managed && Boolean(sub?.cancelAtPeriodEnd) && st.state === "active",
    canUpdateCard: !managed && Boolean(sub?.stripeCustomerId),
    periodEnd: sub?.currentPeriodEnd?.toISOString() ?? null,
    periodEndLabel: period,
    inactive: st.state === "inactive" ? {
      since: stoppedOn ? dateLabel(stoppedOn, tz) : null,
      reason: st.reason,
      why: st.reason === "payment" ? "Your card couldn’t be charged and the 3 days to fix it ended." : "You cancelled your plan and the paid period ended.",
    } : null,
    cancelReasons: CANCEL_REASONS,
    usage: await usageFor(userId, tz),
  };
}

// For /auth/me: just enough for the app to route and lock buttons.
export async function planSummary(userId: string) {
  const { user, sub } = await load(userId);
  const st = planStateOf(user, sub);
  return { state: st.state, reason: st.reason, paymentIssue: st.paymentIssue, managed: user.billingExempt || user.role === "admin", firstAccess: Boolean(sub?.firstAccess) };
}

// ---------- Locking (1.6): what an inactive plan can't do ----------

export function requireActivePlan(req: Request, _res: Response, next: NextFunction) {
  const me = currentUser(req);
  planFor(me.id).then((p) => {
    if (p.state === "active") return next();
    next(new AppError(402, p.state === "needs_checkout" ? "plan_not_started" : "plan_inactive", p.state === "needs_checkout"
      ? "Start your plan to use Duke."
      : "Your plan is paused. Renew it to keep planning, generating and validating."));
  }, next);
}

// ---------- Stripe actions ----------

async function customerFor(userId: string) {
  const { user, sub } = await load(userId);
  const customerId = await stripeApi.ensureCustomer(sub?.stripeCustomerId ?? null, { id: user.id, email: user.email, businessName: user.business?.businessName ?? null });
  if (sub?.stripeCustomerId !== customerId) {
    await db.subscription.upsert({ where: { userId }, update: { stripeCustomerId: customerId }, create: { userId, stripeCustomerId: customerId } });
  }
  return { user, sub, customerId };
}

export async function startPlanCheckout(userId: string) {
  const { user, sub } = await load(userId);
  const st = planStateOf(user, sub);
  if (st.state === "active") throw new BillingInputError("Your plan is already active.");
  const { customerId } = await customerFor(userId);
  // First Access gets the free month once, on the first subscription.
  const firstAccess = Boolean(sub?.firstAccess) && !sub?.stripeSubscriptionId;
  return stripeApi.planCheckout({ customerId, userId, firstAccess, successUrl: appUrl("/plan/done?session={CHECKOUT_SESSION_ID}"), cancelUrl: appUrl("/plan/start") });
}

export async function startRenewCheckout(userId: string) {
  const { user } = await load(userId);
  const usage = await usageFor(userId, user.timezone);
  if (!usage.canRenew) throw new BillingInputError("Renewing is available when a limit is used up.");
  const { customerId } = await customerFor(userId);
  return stripeApi.renewCheckout({ customerId, userId, successUrl: appUrl("/settings/plan?renewed={CHECKOUT_SESSION_ID}"), cancelUrl: appUrl("/settings/plan") });
}

export async function cardPortal(userId: string) {
  const { sub } = await load(userId);
  if (!sub?.stripeCustomerId) throw new BillingInputError("There’s no card on file yet.");
  return stripeApi.portalUrl(sub.stripeCustomerId, appUrl("/settings/plan"));
}

export async function cancelPlan(userId: string, reason: string | null) {
  const { user, sub } = await load(userId);
  if (!sub?.stripeSubscriptionId || planStateOf(user, sub).state !== "active") throw new BillingInputError("There’s no active plan to cancel.");
  const info = await stripeApi.setCancelAtPeriodEnd(sub.stripeSubscriptionId, true, reason);
  await applySubscription(info, { cancelReason: reason });
  if (!sub.cancelAtPeriodEnd && info.currentPeriodEnd) {
    await sendEmail(user.email, planCancelledEmail({ endsOn: dateLabel(info.currentPeriodEnd, user.timezone), url: appUrl("/settings/plan") }), userId);
  }
  return planPage(userId);
}

export async function resumePlan(userId: string) {
  const { sub } = await load(userId);
  if (!sub?.stripeSubscriptionId || !sub.cancelAtPeriodEnd) throw new BillingInputError("Your plan isn’t set to end.");
  await applySubscription(await stripeApi.setCancelAtPeriodEnd(sub.stripeSubscriptionId, false, null), { cancelReason: null });
  return planPage(userId);
}

// Back from Checkout: read the session right away instead of waiting for the webhook.
export async function syncCheckout(userId: string, sessionId: string) {
  const session = await stripeApi.getCheckoutSession(sessionId);
  if (session.userId !== userId) throw new BillingInputError("This payment belongs to another account.");
  await applyCheckout(session);
  return planPage(userId);
}

// ---------- Applying what Stripe says (webhooks and syncs) ----------

export async function applySubscription(info: stripeApi.SubInfo, extra: { cancelReason?: string | null } = {}) {
  const row = await db.subscription.findFirst({ where: { OR: [{ stripeSubscriptionId: info.id }, { stripeCustomerId: info.customerId }, ...(info.userId ? [{ userId: info.userId }] : [])] } });
  if (!row) return null;
  // An older subscription's events don't overwrite a newer one.
  if (row.stripeSubscriptionId && row.stripeSubscriptionId !== info.id && info.status === "canceled") return row;
  const data = {
    stripeSubscriptionId: info.id,
    stripeCustomerId: info.customerId,
    status: info.status,
    currentPeriodEnd: info.currentPeriodEnd,
    cancelAtPeriodEnd: info.cancelAtPeriodEnd,
    endedAt: info.endedAt,
    syncedAt: new Date(),
    ...(info.status === "active" || info.status === "trialing" ? { graceUntil: null } : {}),
    ...(extra.cancelReason !== undefined ? { cancelReason: extra.cancelReason } : {}),
  };
  return db.subscription.update({ where: { id: row.id }, data });
}

export async function applyCheckout(session: stripeApi.CheckoutInfo) {
  if (!session.userId) return;
  if (session.customerId) {
    await db.subscription.upsert({ where: { userId: session.userId }, update: { stripeCustomerId: session.customerId }, create: { userId: session.userId, stripeCustomerId: session.customerId } });
  }
  if (session.mode === "subscription" && session.subscriptionId) {
    await applySubscription(await stripeApi.getSubscription(session.subscriptionId));
  }
  if (session.kind === "renew_limits" && session.paid) await applyRenewal(session.userId, session.id, session.paymentIntentId);
}

// Paid renewal: every monthly counter back to zero now; the monthly reset date doesn't move.
export async function applyRenewal(userId: string, sessionId: string, paymentId: string | null) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  try {
    await db.limitRenewal.create({ data: { userId, kind: "limits", stripeSessionId: sessionId, stripePaymentId: paymentId } });
  } catch {
    return false; // already applied (webhook and sync both arrive)
  }
  await db.usage.updateMany({ where: { userId, periodStart: monthStart(user.timezone), kind: { in: Object.keys(LIMITS) } }, data: { count: 0 } });
  const usage = await usageFor(userId, user.timezone);
  await sendEmail(user.email, limitsRenewedEmail({ resetsOn: usage.resetsLabel }), userId);
  return true;
}

export async function paymentFailed(subscriptionId: string | null, customerId: string | null) {
  const row = await db.subscription.findFirst({ where: { OR: [...(subscriptionId ? [{ stripeSubscriptionId: subscriptionId }] : []), ...(customerId ? [{ stripeCustomerId: customerId }] : [])] }, include: { user: true } });
  if (!row) return;
  if (row.graceUntil && row.graceUntil > new Date()) return; // already warned for this failure
  const graceUntil = new Date(Date.now() + GRACE_DAYS * 864e5);
  await db.subscription.update({ where: { id: row.id }, data: { graceUntil, status: row.status === "active" || row.status === "trialing" ? "past_due" : row.status } });
  await sendEmail(row.user.email, paymentFailedEmail({ until: dateLabel(graceUntil, row.user.timezone), url: appUrl("/settings/plan") }), row.userId);
}

export async function paymentSucceeded(subscriptionId: string | null) {
  if (!subscriptionId) return;
  await db.subscription.updateMany({ where: { stripeSubscriptionId: subscriptionId }, data: { graceUntil: null } });
}

export async function handleEvent(e: stripeApi.BillingEvent) {
  if (e.type === "subscription") await applySubscription(e.sub);
  else if (e.type === "checkout") await applyCheckout(e.session);
  else if (e.type === "payment_failed") await paymentFailed(e.subscriptionId, e.customerId);
  else if (e.type === "payment_succeeded") await paymentSucceeded(e.subscriptionId);
}
