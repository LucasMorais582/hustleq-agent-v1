import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Stripe is replaced: the app's own rules (state, grace, limits, emails, locking) are what's tested.
const s = vi.hoisted(() => ({
  checkouts: [] as Record<string, unknown>[],
  session: null as null | Record<string, unknown>,
  sub: null as null | Record<string, unknown>,
}));
vi.mock("../../src/mvp/billing/stripe.js", () => ({
  stripeConfigured: () => true,
  ensureCustomer: vi.fn(async (existing: string | null) => existing ?? `cus_${Math.random().toString(36).slice(2, 8)}`),
  planCheckout: vi.fn(async (input: Record<string, unknown>) => { s.checkouts.push({ kind: "plan", ...input }); return { id: "cs_plan", url: "https://checkout.stripe.test/plan" }; }),
  renewCheckout: vi.fn(async (input: Record<string, unknown>) => { s.checkouts.push({ kind: "renew", ...input }); return { id: "cs_renew", url: "https://checkout.stripe.test/renew" }; }),
  portalUrl: vi.fn(async () => "https://billing.stripe.test/portal"),
  setCancelAtPeriodEnd: vi.fn(async (_id: string, cancel: boolean) => ({ ...s.sub, cancelAtPeriodEnd: cancel })),
  getCheckoutSession: vi.fn(async () => s.session),
  getSubscription: vi.fn(async () => s.sub),
  parseWebhook: vi.fn((_body: Buffer, sig: string | undefined) => { if (sig !== "good") throw new Error("bad signature"); return { type: "ignored", name: "x" }; }),
}));

import { db } from "../../src/mvp/db.js";
import { applyCheckout, handleEvent, planStateOf } from "../../src/mvp/billing/service.js";
import { monthStart } from "../../src/mvp/posts/service.js";
import { app, auth, makeUser } from "../helpers.js";

afterAll(() => db.$disconnect());
beforeEach(() => { s.checkouts = []; });
const TZ = "America/New_York";
const periodEnd = new Date(Date.now() + 20 * 864e5);

async function payingOwner({ firstAccess = false } = {}) {
  const u = await makeUser("test-password-123", { billingExempt: false });
  await db.user.update({ where: { id: u.user.id }, data: { timezone: TZ } });
  await db.businessProfile.create({ data: { userId: u.user.id, businessName: "Bahia Taste", completedAt: new Date() } });
  await db.subscription.create({ data: { userId: u.user.id, firstAccess } });
  return u;
}
const subInfo = (userId: string, over: Record<string, unknown> = {}) => ({ id: `sub_${userId.slice(0, 8)}`, customerId: "", status: "trialing", currentPeriodEnd: periodEnd, cancelAtPeriodEnd: false, trialEnd: periodEnd, endedAt: null, userId, ...over });

describe("plan state", () => {
  it("follows Stripe's status, with 3 days of grace after a failed payment", () => {
    const user = { billingExempt: false };
    const sub = (o: Record<string, unknown>) => ({ status: "active", graceUntil: null, cancelAtPeriodEnd: false, ...o }) as never;
    expect(planStateOf({ billingExempt: true }, null).state).toBe("active");
    expect(planStateOf({ billingExempt: false, role: "admin" }, null).state).toBe("active");
    expect(planStateOf(user, null).state).toBe("needs_checkout");
    expect(planStateOf(user, sub({ status: "trialing" })).state).toBe("active");
    expect(planStateOf(user, sub({ status: "past_due", graceUntil: new Date(Date.now() + 864e5) }))).toMatchObject({ state: "active", paymentIssue: true });
    expect(planStateOf(user, sub({ status: "past_due", graceUntil: new Date(Date.now() - 1000) }))).toMatchObject({ state: "inactive", reason: "payment" });
    expect(planStateOf(user, sub({ status: "canceled" }))).toMatchObject({ state: "inactive", reason: "cancelled" });
  });
});

describe("start, cancel and resume (13.3-13.6)", () => {
  it("asks for Checkout first, then unlocks Duke; First Access gets the free month", async () => {
    const o = await payingOwner({ firstAccess: true });
    let me = await request(app).get("/v1/auth/me").set(auth(o.token));
    expect(me.body.plan).toMatchObject({ state: "needs_checkout", firstAccess: true, managed: false });
    const conv = await request(app).post("/v1/conversations").set(auth(o.token)).send({});
    const blocked = await request(app).post(`/v1/conversations/${conv.body.id}/messages`).set(auth(o.token)).send({ text: "Hi" });
    expect(blocked.status).toBe(402);
    expect(blocked.body.error.code).toBe("plan_not_started");

    const co = await request(app).post("/v1/billing/checkout").set(auth(o.token));
    expect(co.body.url).toBe("https://checkout.stripe.test/plan");
    expect(s.checkouts[0]).toMatchObject({ kind: "plan", firstAccess: true, userId: o.user.id });
    expect(String(s.checkouts[0]!.successUrl)).toContain("/plan/done?session={CHECKOUT_SESSION_ID}");

    const row = await db.subscription.findUniqueOrThrow({ where: { userId: o.user.id } });
    s.session = { id: "cs_plan", mode: "subscription", status: "complete", paid: true, userId: o.user.id, kind: "plan", customerId: row.stripeCustomerId, subscriptionId: `sub_${o.user.id.slice(0, 8)}`, paymentIntentId: null };
    s.sub = subInfo(o.user.id, { customerId: row.stripeCustomerId });
    const sync = await request(app).post("/v1/billing/sync").set(auth(o.token)).send({ sessionId: "cs_plan_123456" });
    expect(sync.body).toMatchObject({ state: "active", statusLabel: "Active", canCancel: true });
    expect(sync.body.line).toMatch(/^Duke First Access: first month free\. Next charge on .+\.$/);
    me = await request(app).get("/v1/auth/me").set(auth(o.token));
    expect(me.body.plan.state).toBe("active");

    // Someone else's session can't be applied to this account.
    const other = await payingOwner();
    expect((await request(app).post("/v1/billing/sync").set(auth(other.token)).send({ sessionId: "cs_plan_123456" })).status).toBe(400);

    // Cancel at the end of the period (EM-6), then resume.
    const cancel = await request(app).post("/v1/billing/cancel").set(auth(o.token)).send({ reason: "Too expensive" });
    expect(cancel.body.statusLabel).toMatch(/^Ends /);
    expect(cancel.body.canResume).toBe(true);
    expect(await db.emailLog.count({ where: { refId: o.user.id, template: "plan_cancelled" } })).toBe(1);
    expect((await db.subscription.findUniqueOrThrow({ where: { userId: o.user.id } })).cancelReason).toBe("Too expensive");
    const resume = await request(app).post("/v1/billing/resume").set(auth(o.token));
    expect(resume.body).toMatchObject({ statusLabel: "Active", cancelAtPeriodEnd: false });
  });

  it("exempt (FPP) accounts never see Stripe", async () => {
    const u = await makeUser();
    const page = await request(app).get("/v1/billing").set(auth(u.token));
    expect(page.body).toMatchObject({ state: "active", managed: true, line: "Managed by the HustleQ team.", canCancel: false });
    expect((await request(app).post("/v1/billing/checkout").set(auth(u.token))).status).toBe(400);
  });
});

describe("failed payment and inactive plan (EM-5, 1.6)", () => {
  it("keeps the plan for 3 days, then locks generating but not viewing", async () => {
    const o = await payingOwner();
    const subId = `sub_${o.user.id.slice(0, 8)}`;
    await db.subscription.update({ where: { userId: o.user.id }, data: { stripeSubscriptionId: subId, stripeCustomerId: `cus_${o.user.id.slice(0, 6)}`, status: "active", currentPeriodEnd: periodEnd } });
    await handleEvent({ type: "payment_failed", subscriptionId: subId, customerId: null });
    await handleEvent({ type: "payment_failed", subscriptionId: subId, customerId: null }); // Stripe retries: one email
    let page = await request(app).get("/v1/billing").set(auth(o.token));
    expect(page.body).toMatchObject({ state: "active", statusLabel: "Payment failed" });
    expect(await db.emailLog.count({ where: { refId: o.user.id, template: "payment_failed" } })).toBe(1);

    await db.subscription.update({ where: { userId: o.user.id }, data: { graceUntil: new Date(Date.now() - 1000) } });
    page = await request(app).get("/v1/billing").set(auth(o.token));
    expect(page.body).toMatchObject({ state: "inactive", statusLabel: "Inactive", inactive: { reason: "payment" } });
    const post = await db.post.create({ data: { userId: o.user.id, title: "A post", format: "feed", status: "scheduled", scheduledAt: new Date(Date.now() + 864e5) } });
    expect((await request(app).get(`/v1/posts/${post.id}`).set(auth(o.token))).status).toBe(200); // viewing works
    const v = await request(app).post(`/v1/posts/${post.id}/validate`).set(auth(o.token));
    expect(v.status).toBe(402);
    expect(v.body.error.code).toBe("plan_inactive");

    // Paid again: back to active.
    await handleEvent({ type: "subscription", sub: subInfo(o.user.id, { id: subId, customerId: `cus_${o.user.id.slice(0, 6)}`, status: "active" }) });
    page = await request(app).get("/v1/billing").set(auth(o.token));
    expect(page.body.state).toBe("active");
  });
});

describe("limits (9.1b, 9.1c, EM-7)", () => {
  it("warns at 80%, offers renewal at 100%, and a paid renewal zeroes the counters once", async () => {
    const o = await payingOwner();
    await db.subscription.update({ where: { userId: o.user.id }, data: { status: "active", stripeCustomerId: `cus_${o.user.id.slice(0, 6)}` } });
    const periodStart = monthStart(TZ);
    await db.usage.create({ data: { userId: o.user.id, kind: "validation", periodStart, count: 24 } });
    let page = await request(app).get("/v1/billing").set(auth(o.token));
    expect(page.body.usage.items.find((i: { kind: string }) => i.kind === "validation")).toMatchObject({ used: 24, limit: 30, left: 6 });
    expect(page.body.usage.warnings[0]).toMatchObject({ level: "near", title: "You’ve used 80% of your post validations" });
    expect(page.body.usage.canRenew).toBe(false);
    expect((await request(app).post("/v1/billing/renew").set(auth(o.token))).status).toBe(400);

    await db.usage.updateMany({ where: { userId: o.user.id, kind: "validation" }, data: { count: 30 } });
    await db.usage.create({ data: { userId: o.user.id, kind: "search", periodStart, count: 7 } });
    page = await request(app).get("/v1/billing").set(auth(o.token));
    expect(page.body.usage.canRenew).toBe(true);
    expect(page.body.usage.warnings[0]).toMatchObject({ level: "full", title: "You’ve used all 30 post validations" });
    const renew = await request(app).post("/v1/billing/renew").set(auth(o.token));
    expect(renew.body.url).toBe("https://checkout.stripe.test/renew");

    const session = { id: `cs_renew_${o.user.id}`, mode: "payment", status: "complete", paid: true, userId: o.user.id, kind: "renew_limits", customerId: null, subscriptionId: null, paymentIntentId: "pi_1" };
    await applyCheckout(session);
    await applyCheckout(session); // webhook and sync both arrive
    const rows = await db.usage.findMany({ where: { userId: o.user.id, periodStart } });
    expect(rows.every((r) => r.count === 0)).toBe(true);
    expect(await db.limitRenewal.count({ where: { userId: o.user.id } })).toBe(1);
    expect(await db.emailLog.count({ where: { refId: o.user.id, template: "limits_renewed" } })).toBe(1);
  });
});

describe("webhook and invites", () => {
  it("refuses an unsigned webhook", async () => {
    expect((await request(app).post("/v1/billing/webhook").set("content-type", "application/json").send("{}")).status).toBe(400);
    expect((await request(app).post("/v1/billing/webhook").set("content-type", "application/json").set("stripe-signature", "good").send("{}")).status).toBe(200);
  });

  it("carries First Access and Managed by HustleQ team from the invite to the account", async () => {
    const admin = await makeUser();
    await db.user.update({ where: { id: admin.user.id }, data: { role: "admin" } });
    const mk = async (email: string, flags: Record<string, boolean>) => {
      const r = await request(app).post("/v1/admin/invites").set(auth(admin.token)).send({ email, businessName: "Biz", handle: `h${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, ...flags });
      expect(r.status).toBe(201);
      return r.body.invite;
    };
    const fa = await mk(`fa-${Date.now()}@hustleq.test`, { firstAccess: true });
    const fpp = await mk(`fpp-${Date.now()}@hustleq.test`, { billingExempt: true });
    expect(fa.firstAccess).toBe(true);
    expect(fpp.billingExempt).toBe(true);
    const { inviteToken } = await import("../../src/mvp/invites/service.js");
    const accept = async (id: string) => request(app).post(`/v1/invites/${inviteToken(id)}/accept`).send({ password: "a-good-password-1", acceptTerms: true, timezone: TZ });
    const a = await accept(fa.id);
    expect(a.status).toBe(201);
    const faUser = await db.user.findUniqueOrThrow({ where: { email: fa.email }, include: { subscription: true } });
    expect(faUser.billingExempt).toBe(false);
    expect(faUser.subscription).toMatchObject({ firstAccess: true, status: "none" });
    await accept(fpp.id);
    const fppUser = await db.user.findUniqueOrThrow({ where: { email: fpp.email }, include: { subscription: true } });
    expect(fppUser.billingExempt).toBe(true);
    expect(fppUser.subscription).toBeNull();
    const email = await db.emailLog.findFirst({ where: { refId: fa.id, template: "invite" } });
    expect(email).not.toBeNull();
  });
});
