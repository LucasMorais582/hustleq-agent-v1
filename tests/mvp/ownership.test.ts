import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "../../src/mvp/db.js";
import { app, auth, makeUser } from "../helpers.js";

afterAll(() => db.$disconnect());

describe("ownership: nobody reaches someone else's data", () => {
  it("hides another user's conversation on read, edit and delete", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const created = await request(app).post("/v1/conversations").set(auth(a.token)).send({ title: "A's chat" });
    expect(created.status).toBe(201);
    const id = created.body.id;

    expect((await request(app).get(`/v1/conversations/${id}`).set(auth(b.token))).status).toBe(404);
    expect((await request(app).patch(`/v1/conversations/${id}`).set(auth(b.token)).send({ pinned: true })).status).toBe(404);
    expect((await request(app).delete(`/v1/conversations/${id}`).set(auth(b.token))).status).toBe(404);

    const still = await db.conversation.findUnique({ where: { id } });
    expect(still?.pinned).toBe(false);

    const listB = await request(app).get("/v1/conversations").set(auth(b.token));
    expect(listB.body.items.map((c: { id: string }) => c.id)).not.toContain(id);

    expect((await request(app).get(`/v1/conversations/${id}`).set(auth(a.token))).status).toBe(200);
  });

  it("rejects malformed ids before touching the database", async () => {
    const a = await makeUser();
    const res = await request(app).get("/v1/conversations/not-a-uuid").set(auth(a.token));
    expect(res.status).toBe(400);
  });
});
