import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { parseClaude } from "../ai/client.js";
import { db } from "../db.js";
import { addDays, dayInTz } from "../lib/time.js";

// Commercial dates by niche (decided 24/11, option b): Duke lists the dates that matter for this
// business, once, from its Business Profile. They show to the owner right away (Commercial dates,
// Calendar, campaign suggestions); the team can fix, reject (hide) or delete them in Admin.

const NicheDates = z.object({
  dates: z.array(z.object({
    name: z.string().describe("The observance as people know it, e.g. 'National Margarita Day'"),
    date: z.string().describe("Its next date, YYYY-MM-DD, within the window given"),
    tip: z.string().describe("One short line on why it fits this business, e.g. 'Good for a cocktail special'"),
  })).describe("4 to 8 dates"),
});

const SYSTEM = `You pick commercial dates for a small business in the US: observances, food and drink days, trade and industry days, seasonal moments that matter to its customers.
Rules:
- Only real, recurring dates that are widely observed in the US, with the date they actually fall on in the window given. If you aren't sure of a date, leave it out: the owner sees these right away, and a wrong date is worse than a missing one.
- Specific to this niche and its customers. Skip the general US dates listed (they're already covered) and anything the business's "Don't post" rules out.
- 4 to 8 dates, spread across the year when possible.`;

export async function generateNicheDates(userId: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { timezone: true, business: true } });
  const bp = user.business;
  if (!bp?.niche && !bp?.whatYouDo) return { created: 0 };
  const today = dayInTz(new Date(), user.timezone);
  const until = addDays(today, 365);
  const [general, existing] = await Promise.all([
    db.commercialDate.findMany({ where: { country: "US", date: { gte: new Date(`${today}T00:00:00Z`), lte: new Date(`${until}T00:00:00Z`) } }, select: { name: true } }),
    db.userCommercialDate.findMany({ where: { userId, source: "niche" }, select: { name: true } }),
  ]);
  const brief = [
    `Business: ${bp.businessName}`,
    `What it does: ${bp.whatYouDo ?? "—"}`,
    `Niche: ${bp.niche ?? "—"}`,
    `Location: ${bp.location ?? "—"}`,
    `Offers: ${bp.offers ?? "—"}`,
    `Ideal customer: ${bp.idealCustomer ?? "—"}`,
    `Don't post: ${bp.doNotPost ?? "—"}`,
    `Window: ${today} to ${until}`,
    `General US dates already covered: ${general.map((g) => g.name).join(", ") || "none"}`,
    existing.length ? `Already suggested for this business (don't repeat): ${existing.map((e) => e.name).join(", ")}` : "",
  ].filter(Boolean).join("\n");
  const out = await parseClaude(
    { role: "duke", feature: "niche_dates", userId, effort: "medium" },
    { max_tokens: 4000, system: SYSTEM, messages: [{ role: "user", content: `${brief}\n\nList the commercial dates for this business.` }] },
    zodOutputFormat(NicheDates)
  );
  const known = new Set([...general, ...existing].map((d) => d.name!.toLowerCase()));
  const rows = out.dates
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date) && d.date >= today && d.date <= until && !known.has(d.name.toLowerCase()))
    .slice(0, 8)
    .map((d) => ({ userId, source: "niche", reviewStatus: "approved", name: d.name.slice(0, 60), date: new Date(`${d.date}T00:00:00Z`), tip: d.tip.slice(0, 160), repeats: true, suggestCampaign: true }));
  if (rows.length) await db.userCommercialDate.createMany({ data: rows });
  return { created: rows.length };
}

// Admin: each business's niche dates (and the businesses that have none yet).
export async function nicheDatesForReview() {
  const [rows, users] = await Promise.all([
    db.userCommercialDate.findMany({ where: { source: "niche" }, orderBy: [{ userId: "asc" }, { date: "asc" }], include: { user: { select: { email: true, business: { select: { businessName: true, niche: true } } } } } }),
    db.user.findMany({ where: { role: "user", business: { completedAt: { not: null } } }, select: { id: true, email: true, business: { select: { businessName: true, niche: true } } } }),
  ]);
  const byUser = new Map<string, { userId: string; businessName: string; niche: string | null; email: string; dates: { id: string; name: string; date: string; tip: string | null; status: string }[] }>();
  for (const u of users) byUser.set(u.id, { userId: u.id, businessName: u.business?.businessName ?? u.email, niche: u.business?.niche ?? null, email: u.email, dates: [] });
  for (const r of rows) {
    const entry = byUser.get(r.userId) ?? { userId: r.userId, businessName: r.user.business?.businessName ?? r.user.email, niche: r.user.business?.niche ?? null, email: r.user.email, dates: [] };
    entry.dates.push({ id: r.id, name: r.name ?? "", date: r.date ? r.date.toISOString().slice(0, 10) : "", tip: r.tip, status: r.reviewStatus });
    byUser.set(r.userId, entry);
  }
  return { items: [...byUser.values()] };
}

export async function deleteNicheDate(id: string) {
  const r = await db.userCommercialDate.deleteMany({ where: { id, source: "niche" } });
  return r.count > 0;
}

export async function reviewNicheDate(id: string, input: { status: "approved" | "rejected"; name?: string | undefined; date?: string | undefined }) {
  const data: Record<string, unknown> = { reviewStatus: input.status };
  if (input.name) data.name = input.name.trim().slice(0, 60);
  if (input.date) data.date = new Date(`${input.date}T00:00:00Z`);
  const r = await db.userCommercialDate.updateMany({ where: { id, source: "niche" }, data });
  return r.count > 0;
}
