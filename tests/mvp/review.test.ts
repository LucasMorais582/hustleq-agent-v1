import request from "supertest";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { db } from "../../src/mvp/db.js";
import { reviewInvite } from "../../src/mvp/review/service.js";
import { app, auth, makeUser } from "../helpers.js";

// Phase 12 · monthly review (12.0 to 12.3) and milestones (12.4). The analysis is put in place
// here, so no model is called; the path itself is fixed (no model either).

afterAll(() => db.$disconnect());
afterEach(() => vi.useRealTimers());

async function owner(completedAt: Date) {
  const o = await makeUser();
  await db.onboardingState.create({ data: { userId: o.user.id, status: "done", step: 4, completedAt } });
  await db.businessProfile.create({ data: { userId: o.user.id, businessName: "Bahia Taste", offers: "Brazilian lunch plates", idealCustomer: "Families and offices", goals: "More weekday orders" } });
  return o;
}

const analysis = { numbers: { posts: 9, newFollowers: 41, views: 5200 }, summary: "Reels carried November.", insights: ["Posts at 7 PM did better."], forNext: ["Keep two Reels a week."] };

describe("monthly review", () => {
  it("runs the 5 steps, saves the changes and the milestone", async () => {
    const o = await owner(new Date("2026-11-10T15:00:00Z"));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-12-02T15:00:00Z"));

    expect(await reviewInvite(o.user.id)).toMatchObject({ title: "December review", conversationId: null, until: "Dec 7" });
    await db.monthlyReview.create({ data: { userId: o.user.id, month: new Date("2026-12-01T00:00:00Z"), status: "ready", analysis } });

    const start = await request(app).post("/v1/review/start").set(auth(o.token));
    expect(start.status).toBe(200);
    const c = start.body.conversationId as string;
    let s = await request(app).get(`/v1/review/${c}`).set(auth(o.token));
    expect(s.body).toMatchObject({ title: "December review", step: 0, pending: null });
    expect(s.body.messages[0].display).toMatchObject({ text: "November is done. Here’s how it went.", card: { type: "month_analysis", numbers: { posts: 9 } }, replies: { options: ["Start the review", "Later"] } });

    const say = async (body: object) => (await request(app).post(`/v1/review/${c}/reply`).set(auth(o.token)).send(body)).body;
    s = { body: await say({ choices: ["Later"] }) } as never;
    expect(s.body.messages.at(-1).display.text).toContain("Dec 7");
    let r = await say({ choices: ["Start the review"] });
    expect(r.messages.at(-1).display).toMatchObject({ card: { type: "current", value: "Brazilian lunch plates" }, replies: { options: ["Still the same", "Update it"] } });
    r = await say({ choices: ["Update it"] });
    r = await say({ text: "Lunch plates and catering trays" });
    expect(r.step).toBe(2);
    r = await say({ choices: ["Still the same"] }); // ideal customer
    expect(r.messages.at(-1).display.replies.options).toEqual(["No changes", "Add something"]);
    r = await say({ choices: ["Add something"] });
    r = await say({ text: "no prices on the feed" });
    expect(r.step).toBe(3);
    r = await say({ text: "Catering orders for the holidays" }); // goals, typed straight away
    expect(r.step).toBe(4);
    expect(r.messages.at(-1).display.replies.options).toEqual(["Not now", "Watch an account"]);
    r = await say({ choices: ["Not now"] });
    expect(r.step).toBe(5);
    expect(r.messages.at(-1).display.text).toContain("Goals: now “Catering orders for the holidays”");
    r = await say({ choices: ["New strategy"] });
    expect(r).toMatchObject({ status: "done", next: "strategy" });

    const bp = await db.businessProfile.findUniqueOrThrow({ where: { userId: o.user.id } });
    expect(bp).toMatchObject({ offers: "Lunch plates and catering trays", idealCustomer: "Families and offices", doNotPost: "no prices on the feed", goals: "Catering orders for the holidays" });

    const m = (await request(app).get("/v1/milestones").set(auth(o.token))).body;
    expect(m.nextReview).toMatchObject({ date: "2027-01-01", label: "Jan 1", dueNow: false });
    expect(m.items.map((i: { title: string }) => i.title)).toEqual(["December review", "Started with HustleQ"]);
    expect(m.items[0].items).toEqual([
      "Offers: now “Lunch plates and catering trays”",
      "Don’t post: added “no prices on the feed”",
      "Goals: now “Catering orders for the holidays”",
      "Strategy: starting a new one",
    ]);
    expect(await reviewInvite(o.user.id)).toBeNull();
    expect((await request(app).post(`/v1/review/${c}/reply`).set(auth(o.token)).send({ choices: ["Keep it"] })).status).toBe(400);
  });

  it("waits a month for new accounts and closes after the 7th", async () => {
    // Users first: with the clock frozen, two test files could make the same email.
    const fresh = await owner(new Date("2026-11-28T15:00:00Z"));
    const old = await owner(new Date("2026-10-01T15:00:00Z"));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-12-02T15:00:00Z"));
    expect(await reviewInvite(fresh.user.id)).toBeNull();
    expect((await request(app).post("/v1/review/start").set(auth(fresh.token))).status).toBe(409);
    vi.setSystemTime(new Date("2026-12-08T15:00:00Z"));
    expect(await reviewInvite(old.user.id)).toBeNull();
    const m = (await request(app).get("/v1/milestones").set(auth(old.token))).body;
    expect(m.nextReview.label).toBe("Jan 1");
    expect(m.items).toEqual([expect.objectContaining({ title: "Started with HustleQ", label: "Oct 1", items: ["Business Profile created"] })]);
  });
});
