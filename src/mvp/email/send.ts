import { db } from "../db.js";
import type { Email } from "./templates.js";

// Sends through Resend when RESEND_API_KEY is set. Without it (local dev, tests, or before the
// domain is verified) the email is only logged in EmailLog, so every flow still works end to end.

const FROM = () => process.env.EMAIL_FROM || "Duke from HustleQ <duke@hustleq.tech>";
// Replies ("Questions? Reply to this email.") go to the team inbox.
const REPLY_TO = () => process.env.EMAIL_REPLY_TO || "contact@hustleqai.com";
export const appUrl = (path = "") => (process.env.APP_URL || "http://localhost:5173").replace(/\/$/, "") + path;
export const WAITLIST_URL = "https://hustleq.tech/#waitlist";

export async function sendEmail(to: string, email: Email, refId?: string) {
  const key = process.env.RESEND_API_KEY;
  const base = { to, template: email.template, subject: email.subject, refId: refId ?? null };

  if (!key) {
    if (process.env.NODE_ENV !== "test" && !process.env.VITEST) console.log(`[email] (not sent, no RESEND_API_KEY) ${email.template} → ${to}`);
    return db.emailLog.create({ data: { ...base, status: "logged" } });
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM(), to: [to], reply_to: REPLY_TO(), subject: email.subject, html: email.html, text: email.text }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) throw new Error(`Resend ${res.status}: ${data.message ?? "unknown error"}`);
    return db.emailLog.create({ data: { ...base, status: "sent", providerId: data.id ?? null } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[email] failed ${email.template} → ${to}: ${message}`);
    return db.emailLog.create({ data: { ...base, status: "failed", error: message.slice(0, 500) } });
  }
}
