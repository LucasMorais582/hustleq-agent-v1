import request from "supertest";
import { afterAll, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";

const script = vi.hoisted(() => ({ turns: [] as Anthropic.Message[] }));
vi.mock("../../src/mvp/ai/client.js", () => ({
  streamClaude: vi.fn(async (_m: unknown, _p: unknown, onText?: (d: string) => void) => {
    const msg = script.turns.shift()!;
    for (const b of msg.content) if (b.type === "text" && onText) onText(b.text);
    return msg;
  }),
  callClaude: vi.fn(async () => ({ content: [{ type: "text", text: "Plan" }] })),
  parseClaude: vi.fn(async () => ({
    idea: { hook: "h", goal: "Reach new local customers", funnelStage: "Top of funnel · Attract" },
    caption: { hook: "30 seconds from pan to plate.", body: "Body.", callToAction: "Which dish next?" },
    hashtags: ["brazilianfood", "#njfood"],
    creativeDirection: { visualConcept: "a", openingImpact: "b", visualNarrative: "c", mood: "d", colorAndType: "e", audienceEmotion: "f", platformElements: "g", execution: "h" },
    whatToProduce: { objective: "A video", recordingPlan: ["1", "2"], editing: "Fast cuts", assets: "Phone", checklist: ["Light"] },
    postingReminders: ["Reply to comments in the first hour"],
  })),
  textOf: (m: Anthropic.Message) => m.content.map((b) => (b.type === "text" ? b.text : "")).join(""),
}));

import { db } from "../../src/mvp/db.js";
import { bestTime, mondayOf, scheduledAt } from "../../src/mvp/plan/timing.js";
import { app, auth, makeUser } from "../helpers.js";

afterAll(() => db.$disconnect());

const msg = (content: unknown[], stop: Anthropic.StopReason) =>
  ({ id: "m", type: "message", role: "assistant", model: "claude-sonnet-5-5", content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }) as unknown as Anthropic.Message;
const tool = (id: string, name: string, input: unknown) => ({ type: "tool_use", id, name, input });
const text = (t: string) => ({ type: "text", text: t });

function sse(res: request.Response) {
  return String(res.body).trim().split("\n\n").map((c) => {
    const [e, d] = c.split("\n");
    return { event: e!.slice(7), data: JSON.parse(d!.slice(6)) };
  });
}
async function say(token: string, convId: string, t: string) {
  const res = await request(app).post(`/v1/conversations/${convId}/messages`).set(auth(token)).send({ text: t }).buffer(true)
    .parse((r, cb) => { let d = ""; r.on("data", (c: Buffer) => (d += c)); r.on("end", () => cb(null, d)); });
  return sse(res);
}

async function owner() {
  const u = await makeUser();
  await db.user.update({ where: { id: u.user.id }, data: { timezone: "America/New_York" } });
  await db.businessProfile.create({ data: { userId: u.user.id, businessName: "Bahia Taste", doNotPost: "Prices", completedAt: new Date() } });
  const conv = await request(app).post("/v1/conversations").set(auth(u.token)).send({});
  return { ...u, convId: conv.body.id as string };
}

const STRATEGY = {
  name: "Taste the Tradition", objective: "More catering orders for the holidays", durationWeeks: 8, staticPerWeek: 2, videosPerWeek: 2, storiesPerWeek: 3,
  pillars: [
    { name: "Attract", baseType: "attract", description: "Dishes people are curious about", goal: "New followers" },
    { name: "Trust", baseType: "trust", description: "Kitchen, team and customers at events", goal: "Saves and shares" },
    { name: "Sell", baseType: "sell", description: "Trays, menus and how to order", goal: "DMs asking to order" },
  ],
};

describe("timing", () => {
  it("finds Monday in the owner's timezone", () => {
    // Monday Nov 16 2026, 1 AM UTC is still Sunday Nov 15 in New York.
    expect(mondayOf(new Date("2026-11-16T01:00:00Z"), "America/New_York")).toBe("2026-11-09");
    expect(mondayOf(new Date("2026-11-18T15:00:00Z"), "America/New_York")).toBe("2026-11-16");
  });
  it("schedules in the owner's timezone", () => {
    expect(scheduledAt("2026-11-16", "Wed", "19:00", "America/New_York").toISOString()).toBe("2026-11-19T00:00:00.000Z");
  });
  it("takes the best hour with 2+ posts, else 7 PM by default", () => {
    const at = (h: number, likes: number) => ({ id: String(h + likes), url: null, format: "reel" as const, caption: null, publishedAt: `2026-11-10T${String(h).padStart(2, "0")}:10:00Z`, likes, comments: 0, views: null, thumbnailUrl: null });
    expect(bestTime([at(23, 100), at(23, 120), at(15, 10), at(15, 20)], "America/New_York")).toEqual({ time: "18:00", fromData: true });
    expect(bestTime([at(23, 100)], "America/New_York")).toEqual({ time: "19:00", fromData: false });
  });
});

describe("strategy (4.1-4.7)", () => {
  it("drafts a strategy as a card, saves it with a tap, and Duke asks how to use it", async () => {
    const o = await owner();
    script.turns = [msg([tool("t1", "draft_strategy", STRATEGY)], "tool_use"), msg([text("Here’s your strategy:")], "end_turn")];
    const ev = await say(o.token, o.convId, "8 weeks, 2 posts, 2 reels, 3 stories");
    const card = ev.find((e) => e.event === "card")!.data.card;
    expect(card.type).toBe("strategy");

    const draft = await request(app).get(`/v1/strategies/${card.strategyId}`).set(auth(o.token));
    expect(draft.body.status).toBe("draft");
    expect(draft.body.pillars.map((p: { name: string }) => p.name)).toEqual(["Attract", "Trust", "Sell"]);
    expect((await request(app).get("/v1/strategies").set(auth(o.token))).body.items).toHaveLength(0); // drafts aren't listed

    const saved = await request(app).post(`/v1/strategies/${card.strategyId}/save`).set(auth(o.token));
    expect(saved.body.status).toBe("active");
    expect(saved.body.weekNumber).toBe(1);
    const conv = await request(app).get(`/v1/conversations/${o.convId}`).set(auth(o.token));
    const last = conv.body.messages.at(-1).display;
    expect(last.text).toBe("Saved. How do you want to use Taste the Tradition now?");
    expect(last.replies.options).toEqual(["Plan this week", "Just one post", "A few posts", "A campaign"]);

    const list = await request(app).get("/v1/conversations").set(auth(o.token));
    expect(list.body.items.find((c: { id: string }) => c.id === o.convId).linked).toBe("Strategy · Taste the Tradition");
  });

  it("refuses 0 or 5 pillars when editing", async () => {
    const o = await owner();
    script.turns = [msg([tool("t1", "draft_strategy", STRATEGY)], "tool_use"), msg([text("ok")], "end_turn")];
    const id = (await say(o.token, o.convId, "go")).find((e) => e.event === "card")!.data.card.strategyId;
    expect((await request(app).patch(`/v1/strategies/${id}`).set(auth(o.token)).send({ pillars: [] })).status).toBe(400);
    const five = Array.from({ length: 5 }, (_, i) => ({ name: `P${i}` }));
    expect((await request(app).patch(`/v1/strategies/${id}`).set(auth(o.token)).send({ pillars: five })).status).toBe(400);
    const ok = await request(app).patch(`/v1/strategies/${id}`).set(auth(o.token)).send({ name: "New name", pillars: [{ name: "Attract" }, { name: "Educate", baseType: "educate" }] });
    expect(ok.body.name).toBe("New name");
    expect(ok.body.pillars.map((p: { name: string }) => p.name)).toEqual(["Attract", "Educate"]);
  });

  it("hides other people's strategies", async () => {
    const a = await owner();
    const b = await owner();
    script.turns = [msg([tool("t1", "draft_strategy", STRATEGY)], "tool_use"), msg([text("ok")], "end_turn")];
    const id = (await say(a.token, a.convId, "go")).find((e) => e.event === "card")!.data.card.strategyId;
    expect((await request(app).get(`/v1/strategies/${id}`).set(auth(b.token))).status).toBe(404);
    expect((await request(app).post(`/v1/strategies/${id}/save`).set(auth(b.token))).status).toBe(404);
  });
});

describe("week (5.1-5.5)", () => {
  it("drafts a week, writes the details in the background, refines a post and saves", async () => {
    const o = await owner();
    script.turns = [
      msg([tool("t1", "draft_week", { week: "next", posts: [
        { day: "Mon", time: "19:00", format: "reel", pillar: "Attract", title: "How we make moqueca in 30 seconds" },
        { day: "Wed", time: "19:00", format: "carousel", title: "A day in our kitchen before an event" },
        { day: "Fri", time: "19:00", format: "feed", title: "Holiday trays: how to order" },
      ] })], "tool_use"),
      msg([text("Here’s next week.")], "end_turn"),
    ];
    const ev = await say(o.token, o.convId, "Plan next week");
    const weekId = ev.find((e) => e.event === "card")!.data.card.weekId;

    let week = (await request(app).get(`/v1/weeks/${weekId}`).set(auth(o.token))).body;
    expect(week.status).toBe("draft");
    expect(week.posts.map((p: { slot: { label: string } }) => p.slot.label.split(" ")[0])).toEqual(["Mon", "Wed", "Fri"]);
    expect(week.posts[0].slot.label).toContain("7:00 PM");
    expect(week.posts[0].detailsStatus).toBe("ready"); // no worker in tests: written inline
    expect(week.posts[0].hashtags).toEqual(["#brazilianfood", "#njfood"]);

    // "Make Wednesday a Reel": format changes, details are rewritten; moving a post keeps them.
    const wed = week.posts[1].id;
    script.turns = [msg([tool("t2", "revise_week_post", { postId: wed, format: "reel" })], "tool_use"), msg([text("Done.")], "end_turn")];
    await say(o.token, o.convId, "Make Wednesday a Reel.");
    script.turns = [msg([tool("t3", "revise_week_post", { postId: week.posts[2].id, day: "Sat" })], "tool_use"), msg([text("Moved.")], "end_turn")];
    await say(o.token, o.convId, "Move the trays to Saturday.");
    week = (await request(app).get(`/v1/weeks/${weekId}`).set(auth(o.token))).body;
    expect(week.posts.find((p: { id: string }) => p.id === wed).format).toBe("reel");
    expect(week.posts.at(-1).slot.day).toBe("Sat");
    expect(week.posts.at(-1).detailsStatus).toBe("ready");

    // 5.4: change a day in the sheet, then save.
    const sunday = week.days.at(-1).date;
    const saved = await request(app).post(`/v1/weeks/${weekId}/save`).set(auth(o.token)).send({ posts: [{ id: week.posts[0].id, date: sunday }], reminders: true });
    expect(saved.body.status).toBe("saved");
    expect(saved.body.posts.every((p: { status: string }) => p.status === "scheduled")).toBe(true);
    expect(saved.body.posts.at(-1).slot.day).toBe("Sun");
    expect(saved.body.posts.at(-1).slot.time).toBe("19:00");

    const conv = await request(app).get(`/v1/conversations/${o.convId}`).set(auth(o.token));
    expect(conv.body.messages.at(-1).display.card.text).toBe("Week saved · 3 posts");

    // A post can't leave its week.
    expect((await request(app).post(`/v1/weeks/${weekId}/save`).set(auth(o.token)).send({ posts: [{ id: week.posts[0].id, date: "2020-01-01" }], reminders: true })).status).toBe(400);
  });

  it("stops new plans after 10 heavy generations a day and tells Duke why", async () => {
    const o = await owner();
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
    await db.usage.create({ data: { userId: o.user.id, kind: "heavy_generation", periodStart: new Date(`${day}T00:00:00Z`), count: 10 } });
    script.turns = [msg([tool("t1", "draft_strategy", STRATEGY)], "tool_use"), msg([text("You hit today’s limit.")], "end_turn")];
    const ev = await say(o.token, o.convId, "New strategy");
    expect(ev.find((e) => e.event === "card")).toBeUndefined();
    const call = await db.toolCall.findFirstOrThrow({ where: { conversationId: o.convId, name: "draft_strategy" } });
    expect(call.status).toBe("blocked");
    expect(await db.strategy.count({ where: { userId: o.user.id } })).toBe(0);
  });

  it("opens new conversations with Duke's question (4.0b)", async () => {
    const o = await owner();
    const conv = await request(app).get(`/v1/conversations/${o.convId}`).set(auth(o.token));
    expect(conv.body.messages[0].display.text).toBe("New conversation. What do you want to work on?");
    expect(conv.body.messages[0].display.replies.options).toEqual(["Plan next week", "A post idea", "A campaign", "Ask a question"]);
  });
});
