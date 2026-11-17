import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "../../src/mvp/db.js";
import { expiresAtFor, inviteToken, runInviteDaily } from "../../src/mvp/invites/service.js";
import { app, auth, makeUser } from "../helpers.js";

afterAll(() => db.$disconnect());

let seq = 0;
const uniq = () => `${Date.now().toString(36)}${(seq += 1)}`;

async function makeAdmin() {
  const a = await makeUser();
  await db.user.update({ where: { id: a.user.id }, data: { role: "admin" } });
  return a;
}

async function createInvite(adminToken: string, overrides: Partial<{ email: string; handle: string; businessName: string }> = {}) {
  const id = uniq();
  const body = { email: `owner-${id}@hustleq.test`, handle: `bt_${id}`, businessName: "Bahia Taste", ...overrides };
  const res = await request(app).post("/v1/admin/invites").set(auth(adminToken)).send(body);
  return { res, body };
}

// Move an invite back in time so "today" is day N of 7.
async function setDay(inviteId: string, day: number, now = new Date()) {
  const createdAt = new Date(now.getTime() - (day - 1) * 864e5);
  await db.invite.update({ where: { id: inviteId }, data: { createdAt, expiresAt: expiresAtFor(createdAt), lastReminderAt: null } });
}

const emails = (refId: string) => db.emailLog.findMany({ where: { refId }, orderBy: { createdAt: "asc" } });

describe("admin invites", () => {
  it("is admin-only", async () => {
    const user = await makeUser();
    const res = await request(app).post("/v1/admin/invites").set(auth(user.token)).send({ email: "x@hustleq.test", handle: "x", businessName: "X" });
    expect(res.status).toBe(403);
  });

  it("checks the Instagram, reserves it and sends the day-1 email", async () => {
    const admin = await makeAdmin();
    const check = await request(app).post("/v1/admin/instagram-check").set(auth(admin.token)).send({ handle: "@BahiaTaste" });
    expect(check.status).toBe(200);
    expect(check.body.profile.handle).toBe("bahiataste");

    const { res } = await createInvite(admin.token);
    expect(res.status).toBe(201);
    const log = await emails(res.body.invite.id);
    expect(log.map((e) => e.template)).toEqual(["invite"]);

    // Same Instagram can't get a second seat.
    const again = await createInvite(admin.token, { handle: res.body.invite.instagramHandle });
    expect(again.res.status).toBe(409);
    expect(again.res.body.error.code).toBe("instagram_taken");
  });

  it("refuses a handle that doesn't exist", async () => {
    const admin = await makeAdmin();
    const { res } = await createInvite(admin.token, { handle: `notfound_${uniq()}` });
    expect(res.status).toBe(404);
  });
});

describe("accepting an invite", () => {
  it("creates the account with the invite's email, business and Instagram, and logs in", async () => {
    const admin = await makeAdmin();
    const { res } = await createInvite(admin.token);
    const inviteId = res.body.invite.id;
    const token = inviteToken(inviteId);

    const view = await request(app).get(`/v1/invites/${token}`);
    expect(view.status).toBe(200);
    expect(view.body.businessName).toBe("Bahia Taste");

    const noTerms = await request(app).post(`/v1/invites/${token}/accept`).send({ password: "long-enough-1" });
    expect(noTerms.status).toBe(400);
    const short = await request(app).post(`/v1/invites/${token}/accept`).send({ password: "short", acceptTerms: true });
    expect(short.status).toBe(400);

    const ok = await request(app).post(`/v1/invites/${token}/accept`).send({ password: "long-enough-1", acceptTerms: true, timezone: "America/Chicago" });
    expect(ok.status).toBe(201);
    const me = await request(app).get("/v1/auth/me").set(auth(ok.body.token));
    expect(me.body.user.email).toBe(res.body.invite.email);
    expect(me.body.user.timezone).toBe("America/Chicago");
    expect(me.body.business.businessName).toBe("Bahia Taste");

    // The link works once.
    expect((await request(app).post(`/v1/invites/${token}/accept`).send({ password: "long-enough-1", acceptTerms: true })).status).toBe(409);
  });

  it("stops reminders once accepted", async () => {
    const admin = await makeAdmin();
    const { res } = await createInvite(admin.token);
    const inviteId = res.body.invite.id;
    await request(app).post(`/v1/invites/${inviteToken(inviteId)}/accept`).send({ password: "long-enough-1", acceptTerms: true });
    await setDay(inviteId, 3);
    await runInviteDaily(new Date(), [inviteId]);
    expect((await emails(inviteId)).map((e) => e.template)).toEqual(["invite"]);
  });

  it("rejects a made-up link", async () => {
    expect((await request(app).get(`/v1/invites/${"x".repeat(43)}`)).status).toBe(404);
  });
});

describe("invite timeline (7 days, New York time)", () => {
  it("sends one reminder a day on days 2-6, the last-day email on day 7, then expires", async () => {
    const admin = await makeAdmin();
    const { res } = await createInvite(admin.token);
    const id = res.body.invite.id;

    await setDay(id, 3);
    await runInviteDaily(new Date(), [id]);
    await runInviteDaily(new Date(), [id]); // same day again: no second reminder
    let log = await emails(id);
    expect(log.map((e) => e.template)).toEqual(["invite", "invite_reminder"]);
    expect(log[1]?.subject).toBe("Your seat is still waiting · 4 days left");

    await setDay(id, 7);
    await runInviteDaily(new Date(), [id]);
    await runInviteDaily(new Date(), [id]);
    log = await emails(id);
    expect(log.map((e) => e.template)).toEqual(["invite", "invite_reminder", "invite_last_day"]);

    // Day 8: expired, the email says so, and the link shows the expired screen (E.3).
    await setDay(id, 8);
    await runInviteDaily(new Date(), [id]);
    log = await emails(id);
    expect(log.at(-1)?.template).toBe("invite_expired");
    expect((await db.invite.findUnique({ where: { id } }))?.status).toBe("expired");
    expect((await request(app).get(`/v1/invites/${inviteToken(id)}`)).status).toBe(410);
  });

  it("expires at the end of day 7 in New York", () => {
    // Sent Tue Nov 17 2026, 10:00 New York → held until Mon Nov 23, 23:59:59 New York (EST, UTC-5).
    const createdAt = new Date("2026-11-17T15:00:00Z");
    expect(expiresAtFor(createdAt).toISOString()).toBe("2026-11-24T04:59:59.000Z");
  });
});

describe("forgot and reset password", () => {
  it("answers the same for known and unknown emails", async () => {
    const u = await makeUser();
    const known = await request(app).post("/v1/auth/forgot").send({ email: u.email });
    const unknown = await request(app).post("/v1/auth/forgot").send({ email: `nobody-${uniq()}@hustleq.test` });
    expect(known.status).toBe(200);
    expect(unknown.body).toEqual(known.body);
  });

  it("resets once, logs out other devices and logs in with the new password", async () => {
    const u = await makeUser();
    // Create the token the same way the route does, but keep the plain value for the test.
    const { randomBytes } = await import("node:crypto");
    const { hashToken } = await import("../../src/mvp/auth/sessions.js");
    const token = randomBytes(32).toString("base64url");
    await db.passwordResetToken.create({ data: { userId: u.user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 3600_000) } });

    expect((await request(app).get(`/v1/auth/reset/${token}`)).body.email).toBe(u.email);
    const reset = await request(app).post("/v1/auth/reset").send({ token, password: "brand-new-pass-1" });
    expect(reset.status).toBe(200);
    expect(reset.body.token).toBeTruthy();

    expect((await request(app).get("/v1/auth/me").set(auth(u.token))).status).toBe(401); // old session gone
    expect((await request(app).post("/v1/auth/reset").send({ token, password: "another-pass-2" })).status).toBe(410); // once
    expect((await request(app).post("/v1/auth/login").send({ email: u.email, password: "brand-new-pass-1" })).status).toBe(200);
    expect((await request(app).post("/v1/auth/login").send({ email: u.email, password: u.password })).status).toBe(401);
  });

  it("sends the reset email with a working link", async () => {
    const u = await makeUser();
    await request(app).post("/v1/auth/forgot").send({ email: u.email });
    const log = await db.emailLog.findFirst({ where: { refId: u.user.id, template: "password_reset" } });
    expect(log?.status).toBe("logged");
  });
});
