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
import { createDraftPost, createDraftStrategy, saveStrategy } from "../../src/mvp/plan/service.js";
import { mondayOf } from "../../src/mvp/plan/timing.js";
import { app, auth, makeUser } from "../helpers.js";

afterAll(() => db.$disconnect());
const TZ = "America/New_York";
let seq = 0;

async function owner({ strategy = true } = {}) {
  const u = await makeUser();
  const handle = `home_${Date.now().toString(36)}${(seq += 1)}`;
  await db.user.update({ where: { id: u.user.id }, data: { timezone: TZ, instagramHandle: handle } });
  await db.businessProfile.create({ data: { userId: u.user.id, businessName: "Bahia Taste", completedAt: new Date() } });
  if (strategy) {
    const s = await createDraftStrategy(u.user.id, null, { name: "Taste", objective: "Orders", durationWeeks: 4, staticPerWeek: 1, videosPerWeek: 1, storiesPerWeek: 0, pillars: [{ name: "Attract" }] });
    await saveStrategy(u.user.id, s.id, TZ);
  }
  return { ...u, handle };
}

const today = () => dayInTz(new Date(), TZ);

async function cache(handle: string, posts: { id: string; publishedAt: string; format?: string }[], fetchedAt = new Date()) {
  const data = {
    profile: { id: `p_${handle}`, handle, name: "Bahia Taste", bio: null, followers: 1358, following: 10, totalPosts: 40, photoUrl: null },
    posts: posts.map((p) => ({ id: p.id, url: null, format: p.format ?? "image", caption: "c", publishedAt: p.publishedAt, likes: 50, comments: 5, views: p.format === "reel" ? 900 : null, thumbnailUrl: null })),
    fetchedAt: fetchedAt.toISOString(),
    source: "fake",
  };
  await db.instagramCache.upsert({ where: { handle }, update: { data, fetchedAt }, create: { handle, profileId: `p_${handle}`, data, source: "fake", fetchedAt } });
}

describe("home (3.1-3.4)", () => {
  it("shows today, the week strip, numbers and the first-strategy block", async () => {
    const o = await owner({ strategy: false });
    await cache(o.handle, [{ id: "a", publishedAt: new Date(Date.now() - 3 * 864e5).toISOString(), format: "reel" }, { id: "b", publishedAt: new Date(Date.now() - 4 * 864e5).toISOString() }]);
    const post = await createDraftPost(o.user.id, TZ, { date: today(), time: "23:30", format: "feed", title: "Today's post" });
    await db.post.update({ where: { id: post.id }, data: { status: "scheduled" } });

    const h = await request(app).get("/v1/home").set(auth(o.token));
    expect(h.status).toBe(200);
    expect(h.body.hasStrategy).toBe(false);
    expect(h.body.days).toHaveLength(7);
    expect(h.body.days.find((d: { isToday: boolean }) => d.isToday).marks).toEqual(["scheduled"]);
    expect(h.body.today.map((p: { title: string }) => p.title)).toEqual(["Today's post"]);
    expect(h.body.today[0].summary).toBe("No media yet · Email reminder on");
    expect(h.body.numbers).toMatchObject({ followers: 1358, likes: 100, views: 900 });
    expect(h.body.numbers.note).toBe("From your last 2 posts. Weekly numbers start next week.");
    expect(h.body.stale).toBeNull();

    const next = await request(app).get("/v1/home?week=next").set(auth(o.token));
    expect(next.body.subtitle).toBe("Next week");
    expect(next.body.weekStart).toBe(addDays(mondayOf(new Date(), TZ), 7));

    const views = await request(app).get("/v1/home/numbers/views").set(auth(o.token));
    expect(views.body).toMatchObject({ title: "Views", value: 900, note: "From your last posts. Views count Reels only." });
    expect(views.body.items).toHaveLength(1);
  });

  it("warns when the Instagram numbers are old (E.6) and counts the week plan", async () => {
    const o = await owner();
    await cache(o.handle, [], new Date(Date.now() - 3 * 864e5));
    const h = await request(app).get("/v1/home").set(auth(o.token));
    expect(h.body.stale).toMatch(/^Your numbers are from .+\. We couldn’t reach Instagram today\. We’ll try again automatically\.$/);
    expect(h.body.plan).toMatchObject({ planned: 2, have: 0, complete: false });
  });
});

describe("calendar (10.x)", () => {
  it("lists only the owner's posts in the range, and moves a post with its reminder", async () => {
    const o = await owner();
    const other = await owner();
    const day = addDays(today(), 2);
    const mine = await createDraftPost(o.user.id, TZ, { date: day, time: "19:00", format: "reel", title: "Mine" });
    await createDraftPost(other.user.id, TZ, { date: day, time: "19:00", format: "reel", title: "Theirs" });
    await db.post.update({ where: { id: mine.id }, data: { status: "scheduled", reminderSentAt: new Date() } });

    const cal = await request(app).get(`/v1/calendar?from=${today()}&to=${addDays(today(), 6)}`).set(auth(o.token));
    expect(cal.body.posts.map((p: { title: string }) => p.title)).toEqual(["Mine"]);
    expect(cal.body.posts[0]).toMatchObject({ date: day, timeLabel: "7:00 PM", formatLabel: "Reel", statusLabel: "Scheduled" });
    expect(cal.body.weeks.length).toBeGreaterThanOrEqual(1);
    expect((await request(app).get(`/v1/calendar?from=2026-01-01&to=2026-06-01`).set(auth(o.token))).status).toBe(400);

    const to = addDays(today(), 3);
    const moved = await request(app).patch(`/v1/posts/${mine.id}`).set(auth(o.token)).send({ date: to });
    expect(moved.body.slot.date).toBe(to);
    expect(moved.body.slot.time).toBe("19:00");
    expect(moved.body.reminder.sentAt).toBeNull();
  });

  it("opens Duke from an empty day with the week's count (10.4)", async () => {
    const o = await owner();
    const day = addDays(today(), 1);
    const conv = await request(app).post("/v1/conversations").set(auth(o.token)).send({ emptyDay: day });
    expect(conv.status).toBe(201);
    const c = await request(app).get(`/v1/conversations/${conv.body.id}`).set(auth(o.token));
    const first = c.body.messages[0].display;
    expect(first.text).toMatch(/^Your plan is 2 posts a week, and .+ has 0 so far\. Want one on .+\?$/);
    expect(first.replies.options).toEqual(["Yes, suggest one", "Use a note", "Leave it free"]);
    expect(first.card.text).toMatch(/^From Calendar · .+ · 0 of 2 posts$/);
  });
});

describe("is this the post you planned? (6.4)", () => {
  it("suggests a new post published that day, and remembers the answer", async () => {
    const o = await owner();
    const d = today();
    const post = await createDraftPost(o.user.id, TZ, { date: d, time: "00:30", format: "feed", title: "Planned dish" });
    await db.post.update({ where: { id: post.id }, data: { status: "scheduled" } });
    const at = (h: number) => new Date(post.scheduledAt!.getTime() + h * 3600_000).toISOString();
    await cache(o.handle, [{ id: "ig_same_day", publishedAt: at(1) }, { id: "ig_old", publishedAt: new Date(Date.now() - 20 * 864e5).toISOString() }]);

    let h = await request(app).get("/v1/home").set(auth(o.token));
    expect(h.body.match).toMatchObject({ postId: post.id, title: "Planned dish", published: { id: "ig_same_day" } });
    expect(h.body.match.text).toBe(`We found a new post on @${o.handle} that looks like “Planned dish”.`);

    await request(app).post("/v1/home/match").set(auth(o.token)).send({ postId: post.id, igPostId: "ig_same_day", answer: "no" }).expect(200);
    h = await request(app).get("/v1/home").set(auth(o.token));
    expect(h.body.match).toBeNull();

    await cache(o.handle, [{ id: "ig_same_day", publishedAt: at(1) }, { id: "ig_next", publishedAt: at(20) }]);
    h = await request(app).get("/v1/home").set(auth(o.token));
    expect(h.body.match.published.id).toBe("ig_next");
    const other = await makeUser();
    expect((await request(app).post("/v1/home/match").set(auth(other.token)).send({ postId: post.id, igPostId: "ig_next", answer: "yes" })).status).toBe(404);
    const yes = await request(app).post("/v1/home/match").set(auth(o.token)).send({ postId: post.id, igPostId: "ig_next", answer: "yes" });
    expect(yes.body.status).toBe("posted");
    expect(await db.postPublication.findUnique({ where: { postId: post.id } })).toMatchObject({ instagramPostId: "ig_next" });
    expect((await request(app).patch(`/v1/posts/${post.id}`).set(auth(o.token)).send({ date: d })).status).toBe(400); // posted can't move
  });
});

describe("post-day reminder in chat", () => {
  it("goes to one 'Post reminders' conversation, once per post", async () => {
    const o = await owner({ strategy: false });
    const other = await db.conversation.create({ data: { userId: o.user.id, title: "Week plan" } });
    const post = await createDraftPost(o.user.id, TZ, { date: today(), time: "23:30", format: "feed", title: "Samba night" });
    await db.post.update({ where: { id: post.id }, data: { status: "scheduled" } });

    const first = await request(app).post("/v1/home/today-message").set(auth(o.token));
    expect(first.body.conversationId).toBeTruthy();
    expect(first.body.conversationId).not.toBe(other.id);
    const conv = await db.conversation.findUniqueOrThrow({ where: { id: first.body.conversationId } });
    expect(conv).toMatchObject({ title: "Post reminders", objectType: "reminders" });

    expect((await request(app).post("/v1/home/today-message").set(auth(o.token))).body.conversationId).toBeNull();

    const second = await createDraftPost(o.user.id, TZ, { date: today(), time: "23:45", format: "reel", title: "Caipirinha reel" });
    await db.post.update({ where: { id: second.id }, data: { status: "scheduled" } });
    expect((await request(app).post("/v1/home/today-message").set(auth(o.token))).body.conversationId).toBe(conv.id);
    expect(await db.conversation.count({ where: { userId: o.user.id, objectType: "reminders" } })).toBe(1);
  });
});
