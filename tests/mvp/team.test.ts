import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "../../src/mvp/db.js";
import { app, auth, makeUser } from "../helpers.js";

afterAll(() => db.$disconnect());

describe("admin team", () => {
  it("makes and removes admins, never yourself, logged", async () => {
    const admin = await makeUser();
    await db.user.update({ where: { id: admin.user.id }, data: { role: "admin" } });
    const other = await makeUser();

    expect((await request(app).get("/v1/admin/users").set(auth(other.token))).status).toBe(403);
    const list = await request(app).get(`/v1/admin/users?q=${encodeURIComponent(other.email)}`).set(auth(admin.token));
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({ id: other.user.id, role: "user", isMe: false });

    expect((await request(app).post(`/v1/admin/users/${admin.user.id}/role`).set(auth(admin.token)).send({ role: "user" })).body.error.code).toBe("own_role");
    await request(app).post(`/v1/admin/users/${other.user.id}/role`).set(auth(admin.token)).send({ role: "admin" }).expect(200);
    expect((await request(app).get("/v1/admin/users").set(auth(other.token))).status).toBe(200); // now an admin
    expect(await db.adminAuditLog.count({ where: { targetUserId: other.user.id, action: "admin_granted" } })).toBe(1);

    await request(app).post(`/v1/admin/users/${other.user.id}/role`).set(auth(admin.token)).send({ role: "user" }).expect(200);
    expect((await request(app).get("/v1/admin/users").set(auth(other.token))).status).toBe(403);
    expect(await db.adminAuditLog.count({ where: { targetUserId: other.user.id, action: "admin_revoked" } })).toBe(1);
  });
});
