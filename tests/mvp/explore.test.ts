import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "../../src/mvp/db.js";
import { app, auth, makeUser } from "../helpers.js";

afterAll(() => db.$disconnect());

const post = {
  key: `ig_${Date.now()}`, url: "https://www.instagram.com/p/x/", format: "reel", caption: "Samba night", thumbnailUrl: null,
  publishedAt: "2026-11-20T23:00:00.000Z", handle: "samba_nyc", name: null, views: 1800, likes: 212, likesHidden: false, comments: 9,
  source: "explore",
};

describe("explore · saved and notes (9.2, 9.6)", () => {
  it("saves a post with its data, lists it, and removes it", async () => {
    const o = await makeUser();
    expect((await request(app).post("/v1/explore/saved").set(auth(o.token)).send(post)).status).toBe(201);
    await request(app).post("/v1/explore/saved").set(auth(o.token)).send(post); // twice is fine
    let list = await request(app).get("/v1/explore/saved").set(auth(o.token));
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({ key: post.key, handle: "samba_nyc", views: 1800, source: "explore" });
    expect((await request(app).get("/v1/explore/saved/keys").set(auth(o.token))).body.keys).toEqual([post.key]);
    await request(app).delete(`/v1/explore/saved/${post.key}`).set(auth(o.token));
    list = await request(app).get("/v1/explore/saved").set(auth(o.token));
    expect(list.body.items).toHaveLength(0);
  });

  it("adds a post to a new note, then to the same note only once", async () => {
    const o = await makeUser();
    const r = await request(app).post("/v1/explore/to-note").set(auth(o.token)).send({ post });
    expect(r.status).toBe(201);
    const note = await db.note.findUniqueOrThrow({ where: { id: r.body.noteId }, include: { references: true } });
    expect(note.title).toBe("Idea from @samba_nyc");
    expect(note.references).toEqual([expect.objectContaining({ kind: "explore", instagramPostId: post.key, label: "@samba_nyc · Explore" })]);
    await request(app).post("/v1/explore/to-note").set(auth(o.token)).send({ post, noteId: note.id });
    expect(await db.noteReference.count({ where: { noteId: note.id } })).toBe(1);
    const other = await makeUser();
    expect((await request(app).post("/v1/explore/to-note").set(auth(other.token)).send({ post, noteId: note.id })).status).toBe(404);
  });
});
