import request from "supertest";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("../../src/mvp/ai/client.js", () => ({
  streamClaude: vi.fn(),
  callClaude: vi.fn(async () => ({ content: [{ type: "text", text: "x" }] })),
  parseClaude: vi.fn(async () => ({
    idea: { hook: "h", goal: "g", funnelStage: "f" },
    caption: { hook: "a", body: "b", callToAction: "c" },
    hashtags: ["#x"],
    creativeDirection: { visualConcept: "a", openingImpact: "b", visualNarrative: "c", mood: "d", colorAndType: "e", audienceEmotion: "f", platformElements: "g", execution: "h" },
    whatToProduce: { objective: "o", recordingPlan: ["1"], editing: "e", assets: "a", checklist: ["c"] },
    postingReminders: [],
  })),
  textOf: () => "",
}));

import { db } from "../../src/mvp/db.js";
import { addDays, dayInTz } from "../../src/mvp/lib/time.js";
import { CAMPAIGN_COLORS, createDraftCampaign, howFar } from "../../src/mvp/campaigns/service.js";
import { runTool } from "../../src/mvp/duke/tools.js";
import { app, auth, makeUser } from "../helpers.js";

afterAll(() => db.$disconnect());
const TZ = "America/New_York";
const today = () => dayInTz(new Date(), TZ);
let seq = 0;

async function owner() {
  const u = await makeUser();
  const handle = `camp_${Date.now().toString(36)}${(seq += 1)}`;
  await db.user.update({ where: { id: u.user.id }, data: { timezone: TZ, instagramHandle: handle } });
  await db.businessProfile.create({ data: { userId: u.user.id, businessName: "Bahia Taste", completedAt: new Date() } });
  const data = { profile: { id: "p", handle, name: "B", bio: null, followers: 10, following: 1, totalPosts: 2, photoUrl: null }, posts: [{ id: "ig1", url: "https://instagram.com/p/1", format: "carousel", caption: "Trays", publishedAt: new Date().toISOString(), likes: 40, comments: 4, views: null, thumbnailUrl: "https://example.com/t.jpg" }], fetchedAt: new Date().toISOString(), source: "fake" };
  await db.instagramCache.create({ data: { handle, profileId: "p", data, source: "fake" } });
  return { ...u, handle };
}
const ctx = (userId: string, conversationId: string | null = null) => ({ userId, conversationId, timezone: TZ, emitCard: vi.fn() });

describe("commercial dates and suggestions (7.1, 7.5, 7.6)", () => {
  it("lists US and own dates, suggests the closest one, and remembers Not this year", async () => {
    expect(howFar(17)).toBe("about two and a half weeks away");
    expect(howFar(10)).toBe("about a week and a half away");
    expect(howFar(14)).toBe("about two weeks away");

    const o = await owner();
    const soon = addDays(today(), 3);
    await request(app).post("/v1/commercial-dates").set(auth(o.token)).send({ name: "Our 5th anniversary", date: soon, repeats: true, suggestCampaign: true }).expect(201);
    const page = await request(app).get("/v1/commercial-dates").set(auth(o.token));
    const own = page.body.items.find((d: { name: string }) => d.name === "Our 5th anniversary");
    expect(own).toMatchObject({ kind: "own", date: soon, canPlan: true });
    expect(page.body.items.some((d: { kind: string }) => d.kind === "us")).toBe(true);
    expect(page.body.items.map((d: { date: string }) => d.date)).toEqual([...page.body.items.map((d: { date: string }) => d.date)].sort());

    let home = await request(app).get("/v1/home").set(auth(o.token));
    expect(home.body.suggestion).toMatchObject({ dateId: own.id, headline: "Our 5th anniversary is in 3 days. Want a campaign?" });

    const conv = await request(app).post("/v1/conversations").set(auth(o.token)).send({ campaignFor: own.id });
    const first = (await request(app).get(`/v1/conversations/${conv.body.id}`).set(auth(o.token))).body.messages[0].display;
    expect(first.text).toMatch(/^Our 5th anniversary is on .+, in 3 days\. Want to plan a campaign for it\?$/);
    expect(first.replies.options).toEqual(["Plan a campaign", "Not this year"]);

    await request(app).post("/v1/commercial-dates/skip").set(auth(o.token)).send({ dateId: own.id }).expect(200);
    home = await request(app).get("/v1/home").set(auth(o.token));
    expect(home.body.suggestion?.dateId).not.toBe(own.id);
    const after = await request(app).get("/v1/commercial-dates").set(auth(o.token));
    expect(after.body.items.find((d: { id: string }) => d.id === own.id).state).toBe("Not this year");

    const other = await makeUser();
    expect((await request(app).delete(`/v1/commercial-dates/own/${own.id.slice(4)}`).set(auth(other.token))).status).toBe(404);
  });
});

describe("campaigns (7.2-7.4)", () => {
  it("drafts, saves and shows a campaign, with its color in the calendar and its own export", async () => {
    const o = await owner();
    const d1 = addDays(today(), 2);
    const d2 = addDays(today(), 9);
    const c = await createDraftCampaign(o.user.id, TZ, null, {
      name: "Black Friday 2026", objective: "More holiday orders",
      posts: [{ date: d1, time: "19:00", format: "reel", title: "Pre-order your trays" }, { date: d2, time: "12:00", format: "story", title: "Last call" }],
    });
    expect(c.color).toBe(CAMPAIGN_COLORS[0]);
    let page = await request(app).get(`/v1/campaigns/${c.id}`).set(auth(o.token));
    expect(page.body).toMatchObject({ name: "Black Friday 2026", saved: false, status: "draft", progress: { label: "0 of 2 posted", detail: "2 drafts" } });
    expect(page.body.weeks.reduce((s: number, w: { posts: number }) => s + w.posts, 0)).toBe(2);
    expect(page.body.resultsNote).toBe("Starts adding up after the first post goes live.");
    expect((await request(app).get("/v1/campaigns").set(auth(o.token))).body.items).toHaveLength(0); // drafts aren't listed

    page = await request(app).post(`/v1/campaigns/${c.id}/save`).set(auth(o.token));
    expect(page.body.saved).toBe(true);
    expect(page.body.progress.detail).toBe("2 scheduled");
    const list = await request(app).get("/v1/campaigns").set(auth(o.token));
    expect(list.body.items[0]).toMatchObject({ name: "Black Friday 2026", status: "upcoming" });

    const cal = await request(app).get(`/v1/calendar?from=${today()}&to=${addDays(today(), 13)}`).set(auth(o.token));
    expect(cal.body.campaigns[0]).toMatchObject({ name: "Black Friday 2026", color: CAMPAIGN_COLORS[0], posts: 2 });
    expect(cal.body.posts.every((p: { campaign: { name: string } }) => p.campaign?.name === "Black Friday 2026")).toBe(true);

    const link = await request(app).post(`/v1/campaigns/${c.id}/export`).set(auth(o.token)).send({ format: "link" });
    const shared = await request(app).get(`/v1/shared/${link.body.linkId}`);
    expect(shared.body).toMatchObject({ label: "Black Friday 2026", businessName: "Bahia Taste" });
    expect(shared.body.posts).toHaveLength(2);
    const csv = await request(app).post(`/v1/campaigns/${c.id}/export`).set(auth(o.token)).send({ format: "csv" });
    expect(csv.body.path).toMatch(/^\/v1\/files\/campaigns\//);
    expect((await request(app).get(csv.body.path)).text).toContain("Pre-order your trays");
    // A week signature can't open a campaign file.
    expect((await request(app).get(csv.body.path.replace("/campaigns/", "/weeks/"))).status).toBe(410);

    const other = await makeUser();
    expect((await request(app).get(`/v1/campaigns/${c.id}`).set(auth(other.token))).status).toBe(404);
    expect((await request(app).post(`/v1/campaigns/${c.id}/save`).set(auth(other.token))).status).toBe(404);

    const second = await createDraftCampaign(o.user.id, TZ, null, { name: "Christmas", posts: [{ date: d2, time: "10:00", format: "feed", title: "Holiday menu" }] });
    expect(second.color).toBe(CAMPAIGN_COLORS[1]);
  });
});

describe("notes (8.1-8.5)", () => {
  it("saves from the chat, edits, references own posts and turns into a post", async () => {
    const o = await owner();
    const r = await runTool("save_note", { title: "Film the team setting up", text: "Film the team setting up at the next event, people love that.", source: "chat" }, ctx(o.user.id));
    expect(r.status).toBe("ok");
    const noteId = JSON.parse(r.content).noteId as string;

    let list = await request(app).get("/v1/notes").set(auth(o.token));
    expect(list.body.items[0]).toMatchObject({ title: "Film the team setting up" });
    expect(list.body.items[0].meta).toMatch(/· from chat$/);
    expect((await request(app).get("/v1/notes?q=setting").set(auth(o.token))).body.items).toHaveLength(1);
    expect((await request(app).get("/v1/notes?q=nothing-like-this").set(auth(o.token))).body.items).toHaveLength(0);

    const manual = await request(app).post("/v1/notes").set(auth(o.token)).send({ text: "Carousel format to try. Step-by-step slides." });
    expect(manual.body.title).toBe("Carousel format to try");
    const own = await request(app).get("/v1/notes/own-posts").set(auth(o.token));
    expect(own.body.items[0].id).toBe("ig1");
    const withRef = await request(app).post(`/v1/notes/${manual.body.id}/references`).set(auth(o.token)).send({ instagramPostId: "ig1" });
    expect(withRef.body.references[0]).toMatchObject({ kind: "own", label: `@${o.handle} · your post` });
    list = await request(app).get("/v1/notes").set(auth(o.token));
    expect(list.body.items.find((n: { id: string }) => n.id === manual.body.id).meta).toMatch(/· 1 reference$/);
    expect((await request(app).post(`/v1/notes/${manual.body.id}/references`).set(auth(o.token)).send({ instagramPostId: "nope" })).status).toBe(400);

    const other = await makeUser();
    expect((await request(app).get(`/v1/notes/${noteId}`).set(auth(other.token))).status).toBe(404);
    expect((await request(app).patch(`/v1/notes/${noteId}`).set(auth(other.token)).send({ text: "x" })).status).toBe(404);

    // 8.5 · Turn into post
    const conv = await request(app).post("/v1/conversations").set(auth(o.token)).send({ fromNote: noteId });
    const first = (await request(app).get(`/v1/conversations/${conv.body.id}`).set(auth(o.token))).body.messages[0].display;
    expect(first.text).toBe("Let’s turn this note into a post. Which strategy?");
    expect(first.card).toEqual({ type: "note", noteId });
    expect(first.replies.options.at(-1)).toBe("No strategy");

    const post = await runTool("draft_post", { date: addDays(today(), 4), time: "18:00", format: "reel", title: "Team setting up", noteId }, ctx(o.user.id, conv.body.id));
    expect(post.status).toBe("ok");
    const note = await request(app).get(`/v1/notes/${noteId}`).set(auth(o.token));
    expect(note.body.postId).toBe(JSON.parse(post.content).postId);
  });
});
