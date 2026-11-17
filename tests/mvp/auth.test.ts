import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "../../src/mvp/db.js";
import { app, auth, makeUser } from "../helpers.js";

afterAll(() => db.$disconnect());

describe("auth", () => {
  it("rejects a wrong password with the same message as an unknown email", async () => {
    const { email } = await makeUser();
    const wrong = await request(app).post("/v1/auth/login").send({ email, password: "nope-nope" });
    const unknown = await request(app).post("/v1/auth/login").send({ email: "nobody@hustleq.test", password: "nope-nope" });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
    expect(wrong.body.error.time).toBeTruthy();
  });

  it("logs in and never returns the password hash", async () => {
    const { token } = await makeUser();
    expect(token).toBeTruthy();
    const me = await request(app).get("/v1/auth/me").set(auth(token));
    expect(me.status).toBe(200);
    expect(JSON.stringify(me.body)).not.toMatch(/passwordHash|\$2[aby]\$/);
  });

  it("revokes the session on logout", async () => {
    const { token } = await makeUser();
    expect((await request(app).post("/v1/auth/logout").set(auth(token))).status).toBe(204);
    expect((await request(app).get("/v1/auth/me").set(auth(token))).status).toBe(401);
  });

  it("stores only a hash of the session token", async () => {
    const { user, token } = await makeUser();
    const sessions = await db.session.findMany({ where: { userId: user.id } });
    expect(sessions.length).toBeGreaterThan(0);
    for (const s of sessions) expect(s.tokenHash).not.toBe(token);
  });

  it("requires a session for protected routes", async () => {
    expect((await request(app).get("/v1/conversations")).status).toBe(401);
    expect((await request(app).get("/v1/conversations").set(auth("made-up-token"))).status).toBe(401);
  });

  it("only allows the app's origins", async () => {
    const ok = await request(app).options("/v1/auth/login").set("Origin", "http://localhost:5173").set("Access-Control-Request-Method", "POST");
    const bad = await request(app).options("/v1/auth/login").set("Origin", "https://evil.example").set("Access-Control-Request-Method", "POST");
    expect(ok.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(bad.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
