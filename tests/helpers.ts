import request from "supertest";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/mvp/auth/password.js";
import { db } from "../src/mvp/db.js";

export const app = createApp();

let n = 0;
// Test users are exempt from billing unless a test says otherwise (billing.test.ts).
export async function makeUser(password = "test-password-123", { billingExempt = true } = {}) {
  n += 1;
  const email = `user${n}-${Date.now()}@hustleq.test`;
  const user = await db.user.create({ data: { email, passwordHash: await hashPassword(password), billingExempt } });
  const res = await request(app).post("/v1/auth/login").send({ email, password });
  return { user, email, password, token: res.body.token as string };
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
