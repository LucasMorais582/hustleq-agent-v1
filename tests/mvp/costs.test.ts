import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "../../src/mvp/db.js";
import { app, auth, makeUser } from "../helpers.js";

afterAll(() => db.$disconnect());

describe("admin costs", () => {
  it("adds up Claude cost per account and feature, for admins only", async () => {
    const admin = await makeUser();
    await db.user.update({ where: { id: admin.user.id }, data: { role: "admin" } });
    const owner = await makeUser();
    const month = "2031-03"; // a month nothing else writes to
    const at = new Date("2031-03-05T12:00:00Z");
    for (const [feature, cost] of [["chat", 0.01], ["chat", 0.02], ["post_details", 0.05]] as const) {
      await db.aiUsage.create({ data: { userId: owner.user.id, feature, model: "claude-sonnet-5-5", inputTokens: 100, outputTokens: 50, costUsd: cost, createdAt: at } });
    }
    expect((await request(app).get(`/v1/admin/costs?month=${month}`).set(auth(owner.token))).status).toBe(403);
    const r = await request(app).get(`/v1/admin/costs?month=${month}`).set(auth(admin.token));
    expect(r.status).toBe(200);
    const acc = r.body.accounts.find((a: { userId: string }) => a.userId === owner.user.id);
    expect(acc).toMatchObject({ kind: "managed", total: 0.08, calls: 3, features: { chat: { cost: 0.03, calls: 2 }, post_details: { cost: 0.05, calls: 1 } } });
    expect(r.body.features.find((f: { feature: string }) => f.feature === "post_details")).toMatchObject({ calls: 1, avgPerCall: 0.05 });
    expect(r.body.note).toContain("Claude only");
  });
});
