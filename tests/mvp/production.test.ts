import request from "supertest";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("../../src/mvp/ai/client.js", () => ({
  streamClaude: vi.fn(),
  callClaude: vi.fn(async () => ({ content: [{ type: "text", text: "x" }] })),
  parseClaude: vi.fn(async (meta: { feature: string }) =>
    meta.feature === "shot_list"
      ? {
          title: "Film everything in one session",
          summary: "All posts happen in your kitchen.",
          importantNote: "Film the trays before they're served.",
          sessions: 1,
          people: ["You or the cook"],
          locations: ["Your kitchen"],
          assets: ["Holiday trays", "Phone tripod"],
          before: ["Prepare the holiday trays", "Set up the tripod"],
          filming: [{ text: "Cooking close-ups", post: 1 }, { text: "Team serving a tray", post: 0 }],
          after: ["Pick trending audio"],
        }
      : {
          idea: { hook: "h", goal: "g", funnelStage: "Top of funnel · Attract" },
          caption: { hook: "From pan to plate.", body: "Body, with a comma.", callToAction: "Which dish next?" },
          hashtags: ["#brazilianfood"],
          creativeDirection: { visualConcept: "Top-down", openingImpact: "b", visualNarrative: "c", mood: "d", colorAndType: "e", audienceEmotion: "f", platformElements: "g", execution: "h" },
          whatToProduce: { objective: "A 20 second video", recordingPlan: ["Pan", "Plate"], editing: "Fast cuts", assets: "Phone", checklist: ["Light"] },
          postingReminders: ["Reply in the first hour"],
        }
  ),
  textOf: () => "",
}));

import { db } from "../../src/mvp/db.js";
import { createDraftWeek, saveWeek } from "../../src/mvp/plan/service.js";
import { weekStartFor } from "../../src/mvp/plan/timing.js";
import { app, auth, makeUser } from "../helpers.js";

afterAll(() => db.$disconnect());
const TZ = "America/New_York";

async function savedWeek() {
  const u = await makeUser();
  await db.user.update({ where: { id: u.user.id }, data: { timezone: TZ } });
  await db.businessProfile.create({ data: { userId: u.user.id, businessName: "Bahia Taste", completedAt: new Date() } });
  const week = await createDraftWeek(u.user.id, TZ, null, {
    weekStart: weekStartFor("next", TZ),
    strategyId: null,
    posts: [
      { day: "Mon", time: "19:00", format: "reel", title: "Pre-order your holiday trays", hook: "Trays are back" },
      { day: "Wed", time: "12:00", format: "carousel", title: "=SUM(A1) what goes into a box" },
    ],
  });
  return { ...u, weekId: week.id };
}

const filePath = (p: string) => p; // the API returns a path on itself

describe("export (5.8-5.10) and .ics", () => {
  it("needs a saved week, then shares a view-only link that can be turned off", async () => {
    const o = await savedWeek();
    const early = await request(app).post(`/v1/weeks/${o.weekId}/export`).set(auth(o.token)).send({ format: "link" });
    expect(early.status).toBe(400);
    expect(early.body.error.code).toBe("export_not_ready");

    await saveWeek(o.user.id, TZ, o.weekId, { posts: [], reminders: true });
    const link = await request(app).post(`/v1/weeks/${o.weekId}/export`).set(auth(o.token)).send({ format: "link" });
    expect(link.status).toBe(200);
    expect(link.body.url).toMatch(/\/s\/[\w-]{10,}$/);

    // Same link the second time, with the new include.
    const again = await request(app).post(`/v1/weeks/${o.weekId}/export`).set(auth(o.token)).send({ format: "link", include: { hashtags: true, captions: false } });
    expect(again.body.linkId).toBe(link.body.linkId);

    const shared = await request(app).get(`/v1/shared/${link.body.linkId}`);
    expect(shared.status).toBe(200);
    expect(shared.headers["x-robots-tag"]).toContain("noindex");
    expect(shared.body.businessName).toBe("Bahia Taste");
    expect(shared.body.posts).toHaveLength(2);
    expect(shared.body.posts[0].caption).toBeNull(); // captions off
    expect(shared.body.posts[0].hashtags).toEqual(["#brazilianfood"]);
    expect(JSON.stringify(shared.body)).not.toContain(o.user.email);

    // Someone else can't turn it off.
    const other = await makeUser();
    expect((await request(app).post(`/v1/exports/${link.body.linkId}/off`).set(auth(other.token))).status).toBe(404);
    expect((await request(app).post(`/v1/exports/${link.body.linkId}/off`).set(auth(o.token))).status).toBe(200);
    const gone = await request(app).get(`/v1/shared/${link.body.linkId}`);
    expect(gone.status).toBe(410);
    expect(gone.body.error.message).toBe("This link is no longer active.");
  });

  it("serves CSV, PDF and .ics from signed links only", async () => {
    const o = await savedWeek();
    await saveWeek(o.user.id, TZ, o.weekId, { posts: [], reminders: false });
    // Another user can't export this week.
    const other = await makeUser();
    expect((await request(app).post(`/v1/weeks/${o.weekId}/export`).set(auth(other.token)).send({ format: "csv" })).status).toBe(404);

    const csv = await request(app).post(`/v1/weeks/${o.weekId}/export`).set(auth(o.token)).send({ format: "csv" });
    const file = await request(app).get(filePath(csv.body.path));
    expect(file.status).toBe(200);
    expect(file.headers["content-type"]).toContain("text/csv");
    const body = file.text;
    expect(body.charCodeAt(0)).toBe(0xfeff);
    const lines = body.slice(1).split("\r\n");
    expect(lines[0]).toBe("Date,Day,Time,Format,Pillar,Title,Hook,Caption,Creative direction,What to produce,Recording plan,Checklist,Shot list");
    expect(body).toContain('"From pan to plate.'); // quoted multi-line caption
    expect(body).toContain("'=SUM(A1) what goes into a box"); // no spreadsheet formula

    const tampered = csv.body.path.replace(/sig=[^&]+/, "sig=abc");
    expect((await request(app).get(tampered)).status).toBe(410);

    const pdf = await request(app).post(`/v1/weeks/${o.weekId}/export`).set(auth(o.token)).send({ format: "pdf" });
    const pdfFile = await request(app).get(pdf.body.path).buffer(true).parse((r, cb) => { const c: Buffer[] = []; r.on("data", (d: Buffer) => c.push(d)); r.on("end", () => cb(null, Buffer.concat(c))); });
    expect(pdfFile.headers["content-type"]).toBe("application/pdf");
    expect((pdfFile.body as Buffer).subarray(0, 4).toString()).toBe("%PDF");

    const cal = await request(app).post(`/v1/weeks/${o.weekId}/calendar`).set(auth(o.token));
    const ics = await request(app).get(cal.body.path);
    expect(ics.headers["content-type"]).toContain("text/calendar");
    expect(ics.text.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics.text).toContain("SUMMARY:Post: Pre-order your holiday trays (Reel)");
    expect(ics.text).toMatch(/DTSTART:\d{8}T000000Z/); // 7:00 PM New York = 00:00 UTC next day
    expect(ics.text.split("\r\n").every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
  });
});

describe("what to film (5.6, 5.7)", () => {
  it("builds the list from the week and keeps checked items, for the owner only", async () => {
    const o = await savedWeek();
    await saveWeek(o.user.id, TZ, o.weekId, { posts: [], reminders: true });
    const none = await request(app).get(`/v1/weeks/${o.weekId}/shot-list`).set(auth(o.token));
    expect(none.body.status).toBe("none");

    const built = await request(app).post(`/v1/weeks/${o.weekId}/shot-list`).set(auth(o.token)).send({});
    expect(built.status).toBe(202);
    const list = await request(app).get(`/v1/weeks/${o.weekId}/shot-list`).set(auth(o.token));
    expect(list.body.status).toBe("ready");
    expect(list.body.header).toBe("2 posts · 1 filming session");
    expect(list.body.groups.map((g: { total: number }) => g.total)).toEqual([2, 2, 1]);
    expect(list.body.byPost[0].shots.map((s: { text: string }) => s.text)).toEqual(["Cooking close-ups"]);

    const item = list.body.groups[0].items[0];
    const other = await makeUser();
    expect((await request(app).patch(`/v1/shot-list/items/${item.id}`).set(auth(other.token)).send({ done: true })).status).toBe(404);
    expect((await request(app).get(`/v1/weeks/${o.weekId}/shot-list`).set(auth(other.token))).status).toBe(404);
    await request(app).patch(`/v1/shot-list/items/${item.id}`).set(auth(o.token)).send({ done: true }).expect(200);
    const after = await request(app).get(`/v1/weeks/${o.weekId}/shot-list`).set(auth(o.token));
    expect(after.body.progress).toEqual({ done: 1, total: 5 });

    // The share link carries the shot list when it's included.
    const link = await request(app).post(`/v1/weeks/${o.weekId}/export`).set(auth(o.token)).send({ format: "link" });
    const shared = await request(app).get(`/v1/shared/${link.body.linkId}`);
    expect(shared.body.shotList.groups[1].items).toEqual(["Cooking close-ups", "Team serving a tray"]);
  });
});
