import request from "supertest";
import { afterAll, describe, expect, it, vi } from "vitest";

// Claude is replaced by a fixed reading of the posts; the flow is what's tested here.
const analyze = vi.hoisted(() => vi.fn());
vi.mock("../../src/mvp/onboarding/analysis.js", () => ({ analyzeInstagram: analyze }));

import { db } from "../../src/mvp/db.js";
import { FIELD_KEYS } from "../../src/mvp/business/fields.js";
import { app, auth, makeUser } from "../helpers.js";

afterAll(() => db.$disconnect());

const field = (guess: string) => ({ guess, suggestions: [`${guess} A`, `${guess} B`, `${guess} C`] });
analyze.mockImplementation(async (_bundle: unknown, opts: { correction?: string | null }) => ({
  offerAndPlace: opts.correction ? "You sell Bahian food and private dinners in New York." : "You sell Bahian food in New York.",
  topics: "Your posts show events, meal prep and the kitchen.",
  fields: Object.fromEntries(FIELD_KEYS.map((k) => [k, field(k)])),
}));

let seq = 0;
async function owner() {
  const u = await makeUser();
  const handle = `own_${Date.now().toString(36)}${(seq += 1)}`;
  await db.user.update({ where: { id: u.user.id }, data: { instagramHandle: handle } });
  await db.businessProfile.create({ data: { userId: u.user.id, businessName: "Bahia Taste" } });
  await db.onboardingState.create({ data: { userId: u.user.id } });
  return { ...u, handle };
}

const get = (t: string) => request(app).get("/v1/onboarding").set(auth(t));
const reply = (t: string, body: { choices?: string[]; text?: string }) => request(app).post("/v1/onboarding/reply").set(auth(t)).send(body);
type Msg = { role: string; display: { text?: string; replies?: { options: string[] } } };
const lastDuke = (body: { messages: Msg[] }) => [...body.messages].reverse().find((m) => m.role === "assistant")!.display as { text: string; replies: { options: string[] } };

describe("onboarding (2.1 to 2.5)", () => {
  it("goes from the Instagram to a saved Business Profile and the first-strategy choice", async () => {
    const o = await owner();

    let s = await get(o.token);
    expect(s.body.step).toBe(1);
    const intro = s.body.messages[0].display;
    expect(intro.text).toContain("Hi, I’m Duke");
    expect(intro.card.type).toBe("instagram");
    expect(intro.card.handle).toBe(o.handle);
    expect(lastDuke(s.body).replies.options).toEqual(["Yes, that’s us", "Not my account"]);

    s = await reply(o.token, { choices: ["Yes, that’s us"] });
    expect(s.body.step).toBe(2);
    expect(lastDuke(s.body).text).toContain("I read your last 12 posts");
    expect(lastDuke(s.body).text).toContain("You sell Bahian food in New York.");
    expect(lastDuke(s.body).replies.options).toEqual(["Yes", "Let me fix something"]);

    s = await reply(o.token, { choices: ["Yes"] });
    expect(s.body.step).toBe(3);
    expect(lastDuke(s.body).text).toContain("A few questions to finish your Business Profile");
    expect(lastDuke(s.body).replies.options).toContain("Something else");

    // Leaving and coming back resumes on the same question.
    s = await get(o.token);
    expect(s.body.fieldIndex).toBe(0);

    for (let i = 0; i < FIELD_KEYS.length; i++) {
      s = await reply(o.token, i === 4 ? { choices: ["idealCustomer A", "Something else"], text: "and offices too" } : { choices: [`${FIELD_KEYS[i]} A`] });
    }
    const bp = await db.businessProfile.findUniqueOrThrow({ where: { userId: o.user.id } });
    expect(bp.idealCustomer).toBe("idealCustomer A, and offices too");
    expect(bp.completedAt).toBeNull(); // only "Looks good" completes it
    expect(lastDuke(s.body).replies.options).toEqual(["Review my profile"]);

    // Edit in the review (2.4), then Looks good.
    const edit = await request(app).patch("/v1/business-profile").set(auth(o.token)).send({ goals: "More catering orders" });
    expect(edit.body.fields.find((f: { key: string }) => f.key === "goals").value).toBe("More catering orders");
    s = await reply(o.token, { choices: ["Looks good"] });
    expect(s.body.step).toBe(4);
    expect((await db.businessProfile.findUniqueOrThrow({ where: { userId: o.user.id } })).completedAt).not.toBeNull();
    expect(lastDuke(s.body).replies.options).toEqual(["Build my strategy", "Look around first"]);

    s = await reply(o.token, { choices: ["Look around first"] });
    expect(s.body.next).toBe("home");
    const me = await request(app).get("/v1/auth/me").set(auth(o.token));
    expect(me.body.onboarding.status).toBe("done");

    // The conversation stays in the list under its spec title.
    const list = await request(app).get("/v1/conversations").set(auth(o.token));
    expect(list.body.items[0].title).toBe("Getting to know your business");
  }, 600_000);

  it("re-reads the posts with the owner's correction (Let me fix something)", async () => {
    const o = await owner();
    await get(o.token);
    await reply(o.token, { choices: ["Yes, that’s us"] });
    let s = await reply(o.token, { choices: ["Let me fix something"] });
    expect(lastDuke(s.body).text).toContain("What did I get wrong?");
    s = await reply(o.token, { text: "We also do private dinners" });
    s = await get(o.token);
    expect(lastDuke(s.body).text).toContain("Here’s what I understand now");
    expect(lastDuke(s.body).text).toContain("private dinners");
    expect(analyze.mock.calls.at(-1)?.[1].correction).toBe("We also do private dinners");
  });

  it("pauses on Not my account, and starts over when the team fixes the handle", async () => {
    const o = await owner();
    await get(o.token);
    let s = await reply(o.token, { choices: ["Not my account"] });
    expect(lastDuke(s.body).text).toBe("No problem. What’s the right Instagram account?");
    s = await reply(o.token, { text: "not a handle!!" });
    expect(lastDuke(s.body).text).toContain("doesn’t look like");
    const right = `right_${Date.now().toString(36)}`;
    s = await reply(o.token, { text: `@${right}` });
    expect(s.body.status).toBe("paused");
    expect(lastDuke(s.body).text).toContain("within 24 hours on business days");

    const reqRow = await db.accountChangeRequest.findFirstOrThrow({ where: { userId: o.user.id } });
    expect(reqRow.requestedHandle).toBe(right);

    const admin = await makeUser();
    await db.user.update({ where: { id: admin.user.id }, data: { role: "admin" } });
    const fix = await request(app).post(`/v1/admin/account-requests/${reqRow.id}/resolve`).set(auth(admin.token)).send({ handle: right });
    expect(fix.status).toBe(200);

    s = await get(o.token);
    expect(s.body.status).toBe("active");
    expect(s.body.step).toBe(1);
    const cards = s.body.messages.filter((m: { display: { card?: { type: string; handle: string } } }) => m.display.card?.type === "instagram");
    expect(cards.at(-1).display.card.handle).toBe(right);
  });

  it("rejects unknown Business Profile fields", async () => {
    const o = await owner();
    expect((await request(app).patch("/v1/business-profile").set(auth(o.token)).send({ passwordHash: "x" })).status).toBe(400);
  });
});
