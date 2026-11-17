import request from "supertest";
import { afterAll, describe, expect, it, vi } from "vitest";

const claude = vi.hoisted(() => ({ fail: false, lastContent: null as unknown }));
vi.mock("../../src/mvp/ai/client.js", () => ({
  streamClaude: vi.fn(),
  callClaude: vi.fn(async () => ({ content: [{ type: "text", text: "x" }] })),
  parseClaude: vi.fn(async (meta: { feature: string }, params: { messages: { content: unknown }[] }) => {
    if (meta.feature === "validate_post") {
      claude.lastContent = params.messages[0]!.content;
      if (claude.fail) throw new Error("overloaded");
      return {
        points: [
          { good: true, title: "Hook in the first image", detail: "The full dish fills the frame.", media: 1 },
          { good: false, title: "Matches the creative direction", detail: "Image 1 is dark. Try one with more light.", media: 1 },
          { good: true, title: "Caption", detail: "Clear and ends with a question.", media: 0 },
        ],
        conclusion: "Almost ready. Fix image 1 and it's good to post.",
        replaceMedia: 1,
      };
    }
    if (meta.feature === "regenerate_creativeDirection") {
      return { creativeDirection: { visualConcept: "New concept", openingImpact: "b", visualNarrative: "c", mood: "d", colorAndType: "e", audienceEmotion: "f", platformElements: "g", execution: "h" } };
    }
    return {
      idea: { hook: "h", goal: "g", funnelStage: "Top of funnel · Attract" },
      caption: { hook: "From pan to plate.", body: "Body.", callToAction: "Which dish next?" },
      hashtags: ["#brazilianfood"],
      creativeDirection: { visualConcept: "Old concept", openingImpact: "b", visualNarrative: "c", mood: "d", colorAndType: "e", audienceEmotion: "f", platformElements: "g", execution: "h" },
      whatToProduce: { objective: "Three photos", recordingPlan: ["Dish", "Close-up", "Team"], editing: "e", assets: "a", checklist: ["Light"] },
      postingReminders: ["Reply in the first hour"],
    };
  }),
  textOf: () => "",
}));

import { db } from "../../src/mvp/db.js";
import { createDraftWeek, saveWeek } from "../../src/mvp/plan/service.js";
import { weekStartFor } from "../../src/mvp/plan/timing.js";
import { reminderAt, runReminders } from "../../src/mvp/posts/reminders.js";
import { app, auth, makeUser } from "../helpers.js";

afterAll(() => db.$disconnect());
const TZ = "America/New_York";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

async function ownerWithPost(format: "feed" | "carousel" | "reel" = "carousel") {
  const u = await makeUser();
  await db.user.update({ where: { id: u.user.id }, data: { timezone: TZ } });
  await db.businessProfile.create({ data: { userId: u.user.id, businessName: "Bahia Taste", completedAt: new Date() } });
  const week = await createDraftWeek(u.user.id, TZ, null, { weekStart: weekStartFor("next", TZ), strategyId: null, posts: [{ day: "Tue", time: "19:00", format, title: "The dish everyone asks about" }] });
  return { ...u, weekId: week.id, postId: week.posts[0]!.id };
}

async function upload(token: string, postId: string, mimeType = "image/png") {
  const url = await request(app).post(`/v1/posts/${postId}/media/upload-url`).set(auth(token)).send({ mimeType, size: PNG.length });
  if (url.status !== 200) return url;
  const fd = new FormData();
  fd.append("cacheControl", "3600");
  fd.append("", new Blob([PNG], { type: mimeType }));
  const put = await fetch(url.body.uploadUrl, { method: "PUT", body: fd });
  expect(put.status).toBe(200);
  return request(app).post(`/v1/posts/${postId}/media`).set(auth(token)).send({ path: url.body.path });
}

describe("post (6.1)", () => {
  it("edits fields and moves through Draft, Scheduled and Cancelled", async () => {
    const o = await ownerWithPost();
    let r = await request(app).get(`/v1/posts/${o.postId}`).set(auth(o.token));
    expect(r.body.status).toBe("draft");
    expect(r.body.timeSuggested).toBe(true);
    expect(r.body.mediaSlots).toEqual({ expected: 3, max: 10, accepts: "image", uploaded: 0 });
    expect(r.body.validationsLeft).toBe(30);

    r = await request(app).patch(`/v1/posts/${o.postId}`).set(auth(o.token)).send({ time: "12:30", caption: "My own words", hashtags: ["njfood", "#bahia"], note: "Use the new plates" });
    expect(r.status).toBe(200);
    expect(r.body.slot.time).toBe("12:30");
    expect(r.body.timeSuggested).toBe(false);
    expect(r.body.caption).toBe("My own words");
    expect(r.body.captionParts).toBeNull();
    expect(r.body.hashtags).toEqual(["#njfood", "#bahia"]);
    expect(r.body.note).toBe("Use the new plates");

    r = await request(app).patch(`/v1/posts/${o.postId}`).set(auth(o.token)).send({ format: "reel" });
    expect(r.body.formatLabel).toBe("Reel");
    expect(r.body.mediaSlots.accepts).toBe("video");

    r = await request(app).post(`/v1/posts/${o.postId}/status`).set(auth(o.token)).send({ action: "schedule" });
    expect(r.body.status).toBe("scheduled");
    r = await request(app).post(`/v1/posts/${o.postId}/status`).set(auth(o.token)).send({ action: "cancel" });
    expect(r.body.status).toBe("cancelled");
    r = await request(app).post(`/v1/posts/${o.postId}/status`).set(auth(o.token)).send({ action: "schedule" });
    expect(r.status).toBe(400);
    r = await request(app).post(`/v1/posts/${o.postId}/status`).set(auth(o.token)).send({ action: "draft" });
    expect(r.body.status).toBe("draft");

    await db.post.update({ where: { id: o.postId }, data: { status: "posted" } });
    r = await request(app).patch(`/v1/posts/${o.postId}`).set(auth(o.token)).send({ caption: "late edit" });
    expect(r.status).toBe(400);

    const other = await makeUser();
    expect((await request(app).get(`/v1/posts/${o.postId}`).set(auth(other.token))).status).toBe(404);
    expect((await request(app).patch(`/v1/posts/${o.postId}`).set(auth(other.token)).send({ note: "x" })).status).toBe(404);
  });

  it("regenerates one section and counts it toward the daily limit", async () => {
    const o = await ownerWithPost();
    const r = await request(app).post(`/v1/posts/${o.postId}/regenerate`).set(auth(o.token)).send({ section: "creativeDirection" });
    expect(r.status).toBe(200);
    expect(r.body.creativeDirection.visualConcept).toBe("New concept");
    expect(r.body.whatToProduce.objective).toBe("Three photos");
    const usage = await db.usage.findFirst({ where: { userId: o.user.id, kind: "heavy_generation" } });
    expect(usage?.count).toBe(1);
  });
});

describe("media and validation (6.1, 6.2)", () => {
  it("uploads to storage through signed URLs, only where it belongs", async () => {
    const o = await ownerWithPost("feed");
    expect((await request(app).post(`/v1/posts/${o.postId}/media/upload-url`).set(auth(o.token)).send({ mimeType: "application/pdf", size: 10 })).status).toBe(400);
    expect((await request(app).post(`/v1/posts/${o.postId}/media/upload-url`).set(auth(o.token)).send({ mimeType: "image/jpeg", size: 60 * 1024 * 1024 })).body.error.message).toContain("50 MB");
    expect((await request(app).post(`/v1/posts/${o.postId}/media/upload-url`).set(auth(o.token)).send({ mimeType: "video/mp4", size: 100 })).body.error.message).toContain("takes photos");

    const added = await upload(o.token, o.postId);
    expect(added.status).toBe(200);
    expect(added.body.media).toHaveLength(1);
    expect(added.body.media[0].url).toMatch(/^https:\/\//);
    expect(added.body.mediaSlots.uploaded).toBe(1);

    // A feed post holds one file.
    expect((await request(app).post(`/v1/posts/${o.postId}/media/upload-url`).set(auth(o.token)).send({ mimeType: "image/png", size: 10 })).status).toBe(400);

    // Someone else's path, or a path outside this post, is refused.
    const other = await ownerWithPost("feed");
    expect((await request(app).post(`/v1/posts/${o.postId}/media`).set(auth(o.token)).send({ path: `${other.user.id}/${other.postId}/x.png` })).status).toBe(400);
    expect((await request(app).post(`/v1/posts/${o.postId}/media`).set(auth(other.token)).send({ path: "x" })).status).toBe(404);

    const removed = await request(app).delete(`/v1/posts/${o.postId}/media/${added.body.media[0].id}`).set(auth(o.token));
    expect(removed.body.media).toHaveLength(0);
  });

  it("validates with the images, keeps the result, and counts only what worked", async () => {
    const o = await ownerWithPost();
    expect((await request(app).post(`/v1/posts/${o.postId}/validate`).set(auth(o.token))).body.error.message).toContain("Upload");
    await upload(o.token, o.postId);
    await upload(o.token, o.postId);

    const v = await request(app).post(`/v1/posts/${o.postId}/validate`).set(auth(o.token));
    expect(v.status).toBe(200);
    expect(v.body.validation.good).toBe(2);
    expect(v.body.validation.toImprove).toBe(1);
    expect(v.body.validation.replaceMediaId).toBe(v.body.media[0].id);
    expect(v.body.validationsLeft).toBe(29);
    const images = (claude.lastContent as { type: string }[]).filter((b) => b.type === "image");
    expect(images).toHaveLength(2);

    // A technical failure doesn't count.
    claude.fail = true;
    expect((await request(app).post(`/v1/posts/${o.postId}/validate`).set(auth(o.token))).status).toBe(500);
    claude.fail = false;
    expect((await request(app).get(`/v1/posts/${o.postId}`).set(auth(o.token))).body.validationsLeft).toBe(29);

    // 30 a month.
    await db.usage.updateMany({ where: { userId: o.user.id, kind: "validation" }, data: { count: 30 } });
    const out = await request(app).post(`/v1/posts/${o.postId}/validate`).set(auth(o.token));
    expect(out.status).toBe(429);
    expect(out.body.error.code).toBe("validation_limit");
  });
});

describe("reminder email (6.3)", () => {
  it("goes out once on the morning of the post, in the owner's timezone", async () => {
    // 7:00 PM post: reminder at 9:00 AM that day. 8:00 AM post: 1 hour before.
    expect(reminderAt(new Date("2026-11-24T00:00:00Z"), TZ, "09:00").toISOString()).toBe("2026-11-23T14:00:00.000Z");
    expect(reminderAt(new Date("2026-11-23T13:00:00Z"), TZ, "09:00").toISOString()).toBe("2026-11-23T12:00:00.000Z");

    const o = await ownerWithPost("feed");
    await saveWeek(o.user.id, TZ, o.weekId, { posts: [], reminders: true });
    const post = await db.post.findUniqueOrThrow({ where: { id: o.postId } });
    const morning = reminderAt(post.scheduledAt!, TZ, "09:00");

    await runReminders(new Date(morning.getTime() - 60_000));
    expect(await db.emailLog.count({ where: { refId: o.postId } })).toBe(0);

    await runReminders(new Date(morning.getTime() + 60_000));
    await runReminders(new Date(morning.getTime() + 120_000));
    const logs = await db.emailLog.findMany({ where: { refId: o.postId } });
    expect(logs).toHaveLength(1);
    expect(logs[0]!.subject).toBe("Today at 7:00 PM: The dish everyone asks about");

    // Moving the post sends it again on the new day.
    const moved = await request(app).patch(`/v1/posts/${o.postId}`).set(auth(o.token)).send({ date: new Date(post.scheduledAt!.getTime() + 864e5).toISOString().slice(0, 10) });
    expect(moved.body.reminder.sentAt).toBeNull();

    // Reminders off in Account: nothing goes out.
    const off = await request(app).patch("/v1/auth/me/reminders").set(auth(o.token)).send({ on: false, time: "08:30" });
    expect(off.body.reminders).toEqual({ on: false, time: "08:30" });
    const after = await db.post.findUniqueOrThrow({ where: { id: o.postId } });
    await runReminders(new Date(after.scheduledAt!.getTime() - 60 * 60_000));
    expect(await db.emailLog.count({ where: { refId: o.postId } })).toBe(1);
  });
});
