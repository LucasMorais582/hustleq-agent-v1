import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { anthropic, parseClaude } from "../ai/client.js";
import { costUsd, MODELS } from "../ai/models.js";
import { monthFacts } from "../analytics/service.js";
import { planFor } from "../billing/service.js";
import { fieldLabel, profileValues, type ProfileField } from "../business/fields.js";
import { db } from "../db.js";
import { Prisma } from "../../generated/mvp/index.js";
import { AppError, notFound } from "../http/errors.js";
import { addDays, dayInTz, daysBetween } from "../lib/time.js";
import { activeStrategy } from "../plan/service.js";

// Phase 12 · Monthly review and milestones (spec 5.12, screens 12.0 to 12.4).
// Day 1 (account time zone): the month before is put in numbers and Duke's analysis is prepared in a
// Message Batch (half price). Days 1 to 7: the Home invites to the "<Month> review" conversation:
// 12.0 analysis, then 5 quick steps (offers; ideal customer + don't post; goals; watched accounts;
// what changed + keep or new strategy). Each review becomes a milestone (12.4). Like onboarding, the
// path is fixed: Duke's words are written here, the model only writes the analysis.

export const REVIEW_DAYS = 7; // the invite stays on the Home until the 7th
const MIN_DAYS_BEFORE = 7; // accounts onboarded less than a week before the 1st start next month
const BATCH_FALLBACK_MS = 6 * 3600_000; // a batch still running after this: write it directly

export const R = {
  start: "Start the review",
  later: "Later",
  same: "Still the same",
  update: "Update it",
  skip: "Skip for now",
  noChanges: "No changes",
  add: "Add something",
  keepAsIs: "Keep it as it was",
  switchOne: "Switch one",
  addAnother: "Add another",
  watchOne: "Watch an account",
  notNow: "Not now",
  keepStrategy: "Keep it",
  newStrategy: "New strategy",
} as const;

type Replies = { options: string[]; multi?: boolean; placeholder?: string };
type Display = { text?: string; card?: Record<string, unknown>; replies?: Replies };
type Data = { sub?: string | null; changes?: string[]; generatingSince?: string | null; failedAt?: string | null };

export type Analysis = {
  numbers: { posts: number | null; newFollowers: number | null; views: number | null };
  summary: string;
  insights: string[];
  forNext: string[];
};

// ---------- Months ----------

const firstOf = (day: string) => `${day.slice(0, 7)}-01`;
const asDate = (day: string) => new Date(`${day}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
function shiftMonth(first: string, n: number) {
  const d = asDate(first);
  d.setUTCMonth(d.getUTCMonth() + n);
  return iso(d);
}
export const monthName = (first: string) => asDate(first).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
const shortDay = (day: string) => asDate(day).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const reviewTitle = (first: string) => `${monthName(first)} review`;
const clip = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

// The review that's open now for this account (days 1 to 7), or null.
async function window(userId: string, now = new Date()) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, include: { onboarding: true } });
  const today = dayInTz(now, user.timezone);
  const first = firstOf(today);
  const inWindow = Number(today.slice(8, 10)) <= REVIEW_DAYS;
  const done = user.onboarding?.status === "done";
  const since = user.onboarding?.completedAt ?? user.createdAt;
  const oldEnough = daysBetween(dayInTz(since, user.timezone), first) >= MIN_DAYS_BEFORE;
  return { user, today, first, open: inWindow && done && oldEnough };
}

// ---------- 12.0 · The analysis ----------

const AnalysisOut = z.object({
  summary: z.string().describe("2 or 3 short sentences on how the month went, from the facts"),
  insights: z.array(z.string()).describe("2 or 3 short insights, each backed by the facts"),
  forNext: z.array(z.string()).describe("2 or 3 short, concrete suggestions for the coming month"),
});

const SYSTEM = `You are Duke, the marketing assistant inside HustleQ, writing a small business owner's monthly Instagram review. Plain, warm, specific English; short sentences; no hashtags, no emojis, no jargon.
Rules:
- Every claim comes from the facts given. Never invent numbers, posts or trends.
- A pattern (a day, an hour, a format, a topic) needs at least 2 posts behind it; otherwise don't claim it.
- With fewer than 3 posts in the month, say there's too little to compare yet and keep the focus on the coming month.
- "plan" counts posts scheduled in the app and the ones the owner confirmed as posted there. Owners often post without confirming, so never say planned posts didn't go out; at most, invite them to mark what they posted.
- Suggestions fit the business, its goals, its current strategy and the dates coming up, and respect what it doesn't post. One action per line.`;

type FactsBundle = { facts: Awaited<ReturnType<typeof monthFacts>> | null; business: Record<string, unknown>; strategy: string | null; upcoming: string[] };

async function gatherFacts(userId: string, first: string): Promise<FactsBundle> {
  const from = shiftMonth(first, -1);
  const to = addDays(first, -1);
  let facts: FactsBundle["facts"] = null;
  try {
    facts = await monthFacts(userId, from, to);
  } catch (error) {
    // No Instagram data (fake mode, API down): the analysis says so and looks ahead.
    console.error("[review] month facts", userId, error instanceof Error ? error.message : error);
  }
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, include: { business: true } });
  const values = profileValues(user.business as Record<string, unknown> | null);
  const strategy = await activeStrategy(userId, user.timezone);
  const next = shiftMonth(first, 1);
  const [general, own] = await Promise.all([
    db.commercialDate.findMany({ where: { country: "US", date: { gte: asDate(first), lt: asDate(next) } }, orderBy: { date: "asc" }, select: { name: true, date: true } }),
    db.userCommercialDate.findMany({ where: { userId, commercialDateId: null, reviewStatus: "approved", date: { not: null } }, select: { name: true, date: true, repeats: true } }),
  ]);
  const ownThisMonth = own.filter((d) => d.date && (d.repeats ? iso(d.date).slice(5, 7) === first.slice(5, 7) : iso(d.date).slice(0, 7) === first.slice(0, 7)));
  return {
    facts,
    business: { name: user.business?.businessName ?? null, niche: values.niche, offers: values.offers, goals: values.goals, idealCustomer: values.idealCustomer, doNotPost: values.doNotPost },
    strategy: strategy ? `${strategy.name} (until ${strategy.endsOn})` : null,
    upcoming: [...general.map((d) => `${d.name} · ${shortDay(iso(d.date))}`), ...ownThisMonth.map((d) => `${d.name} · ${shortDay(`${first.slice(0, 4)}-${iso(d.date!).slice(5)}`)}`)],
  };
}

function analysisPrompt(first: string, b: FactsBundle) {
  const past = monthName(shiftMonth(first, -1));
  return [
    `Month in review: ${past}. Coming month: ${monthName(first)}.`,
    `Business: ${JSON.stringify(b.business)}`,
    `Current strategy: ${b.strategy ?? "none running"}`,
    `Dates coming up in ${monthName(first)}: ${b.upcoming.join("; ") || "none listed"}`,
    b.facts ? `Facts for ${past} (computed from Instagram): ${JSON.stringify(b.facts)}` : `No Instagram numbers were available for ${past}. Say so briefly and focus on ${monthName(first)}.`,
    "",
    `Write the ${past} review: summary, insights and suggestions for ${monthName(first)}.`,
  ].join("\n");
}

const toAnalysis = (b: FactsBundle | null, out: z.infer<typeof AnalysisOut>): Analysis => ({
  numbers: { posts: b?.facts?.posts ?? null, newFollowers: b?.facts?.newFollowers ?? null, views: b?.facts?.views ?? null },
  summary: out.summary.trim(),
  insights: out.insights.slice(0, 3),
  forNext: out.forNext.slice(0, 3),
});

const BASE = { model: MODELS.deep, max_tokens: 4000, thinking: { type: "adaptive" as const } };

// Written now (the owner opened the review before the batch was back, or the batch failed).
async function writeAnalysisNow(reviewId: string) {
  const r = await db.monthlyReview.findUniqueOrThrow({ where: { id: reviewId } });
  const first = iso(r.month);
  const bundle = (r.facts as FactsBundle | null) ?? (await gatherFacts(r.userId, first));
  const out = await parseClaude(
    { role: "deep", feature: "monthly_analysis", userId: r.userId, effort: "medium" },
    { max_tokens: BASE.max_tokens, system: SYSTEM, messages: [{ role: "user", content: analysisPrompt(first, bundle) }] },
    zodOutputFormat(AnalysisOut)
  );
  await db.monthlyReview.updateMany({
    where: { id: reviewId, analysis: { equals: Prisma.DbNull } },
    data: { analysis: toAnalysis(bundle, out) as object, facts: bundle as object, status: r.status === "preparing" ? "ready" : r.status, preparedAt: new Date() },
  });
}

// Guarded: one writer at a time per review; a stuck one (over 5 minutes) can be retried.
async function ensureAnalysis(reviewId: string) {
  const r = await db.monthlyReview.findUniqueOrThrow({ where: { id: reviewId } });
  if (r.analysis) return;
  const data = (r.data ?? {}) as Data;
  if (data.generatingSince && Date.now() - Date.parse(data.generatingSince) < 5 * 60_000) return;
  await db.monthlyReview.update({ where: { id: reviewId }, data: { data: { ...data, generatingSince: new Date().toISOString(), failedAt: null } } });
  try {
    await writeAnalysisNow(reviewId);
    const fresh = await db.monthlyReview.findUniqueOrThrow({ where: { id: reviewId } });
    await db.monthlyReview.update({ where: { id: reviewId }, data: { data: { ...((fresh.data ?? {}) as Data), generatingSince: null } } });
  } catch (error) {
    console.error("[review] analysis failed", reviewId, error);
    const fresh = await db.monthlyReview.findUniqueOrThrow({ where: { id: reviewId } });
    await db.monthlyReview.update({ where: { id: reviewId }, data: { data: { ...((fresh.data ?? {}) as Data), generatingSince: null, failedAt: new Date().toISOString() } } });
  }
}

// ---------- The daily job: prepare on day 1 (batch), collect the batch ----------

export async function runMonthlyReviews(now = new Date()) {
  const collected = await collectBatches();
  const users = await db.user.findMany({ where: { onboarding: { status: "done" } }, select: { id: true } });
  const created: { id: string; userId: string; first: string; bundle: FactsBundle }[] = [];
  for (const u of users) {
    try {
      const w = await window(u.id, now);
      if (!w.open) continue;
      if ((await planFor(u.id)).state !== "active") continue;
      if (await db.monthlyReview.findUnique({ where: { userId_month: { userId: u.id, month: asDate(w.first) } } })) continue;
      const bundle = await gatherFacts(u.id, w.first);
      const row = await db.monthlyReview.create({ data: { userId: u.id, month: asDate(w.first), facts: bundle as object } });
      created.push({ id: row.id, userId: u.id, first: w.first, bundle });
    } catch (error) {
      console.error("[review] prepare failed", u.id, error);
    }
  }
  let batchId: string | null = null;
  if (created.length) {
    try {
      const format = zodOutputFormat(AnalysisOut);
      const batch = await anthropic().messages.batches.create({
        requests: created.map((c) => ({
          custom_id: c.id,
          params: {
            ...BASE,
            system: SYSTEM,
            messages: [{ role: "user" as const, content: analysisPrompt(c.first, c.bundle) }],
            output_config: { effort: "medium", format: { type: "json_schema", schema: format.schema } },
          } as never,
        })),
      });
      batchId = batch.id;
      await db.monthlyReview.updateMany({ where: { id: { in: created.map((c) => c.id) } }, data: { batchId } });
    } catch (error) {
      console.error("[review] batch create failed", error);
    }
  }
  // No batch (it failed) or a batch that takes too long: write those directly.
  const late = await db.monthlyReview.findMany({
    where: { status: "preparing", analysis: { equals: Prisma.DbNull }, OR: [{ batchId: null, createdAt: { lt: new Date(now.getTime() - 10 * 60_000) } }, { createdAt: { lt: new Date(now.getTime() - BATCH_FALLBACK_MS) } }] },
    select: { id: true },
  });
  for (const r of late) await ensureAnalysis(r.id);
  return { prepared: created.length, batchId, collected, direct: late.length };
}

async function collectBatches() {
  const open = await db.monthlyReview.findMany({ where: { batchId: { not: null }, analysis: { equals: Prisma.DbNull } }, select: { batchId: true }, distinct: ["batchId"] });
  let n = 0;
  for (const { batchId } of open) {
    try {
      const batch = await anthropic().messages.batches.retrieve(batchId!);
      if (batch.processing_status !== "ended") continue;
      for await (const item of await anthropic().messages.batches.results(batchId!)) {
        const row = await db.monthlyReview.findUnique({ where: { id: item.custom_id } });
        if (!row || row.analysis) continue;
        if (item.result.type !== "succeeded") {
          console.error("[review] batch item", item.custom_id, item.result.type);
          continue; // written directly later (the fallback above)
        }
        const message = item.result.message;
        try {
          await db.aiUsage.create({
            data: {
              userId: row.userId, feature: "monthly_analysis_batch", model: message.model,
              inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens,
              cacheReadTokens: message.usage.cache_read_input_tokens ?? 0, cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
              costUsd: costUsd(message.model, message.usage, { batch: true }).toFixed(6), durationMs: 0,
            },
          });
        } catch (error) {
          console.error("[review] usage record", error);
        }
        const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
        const parsed = AnalysisOut.safeParse((() => { try { return JSON.parse(text); } catch { return null; } })());
        if (!parsed.success || message.stop_reason === "max_tokens" || message.stop_reason === "refusal") continue;
        await db.monthlyReview.updateMany({
          where: { id: row.id, analysis: { equals: Prisma.DbNull } },
          data: { analysis: toAnalysis(row.facts as FactsBundle | null, parsed.data) as object, status: row.status === "preparing" ? "ready" : row.status, preparedAt: new Date() },
        });
        n += 1;
      }
    } catch (error) {
      console.error("[review] batch collect failed", batchId, error);
    }
  }
  return n;
}

// ---------- Milestones (12.4) ----------

export async function ensureStartMilestone(userId: string) {
  if (await db.milestone.findFirst({ where: { userId, kind: "start" } })) return;
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, include: { onboarding: true, business: true } });
  if (user.onboarding?.status !== "done") return;
  const [strategy, watched] = await Promise.all([
    db.strategy.findFirst({ where: { userId, status: "saved" }, orderBy: { createdAt: "asc" }, select: { title: true } }),
    db.watchedAccount.count({ where: { userId } }),
  ]);
  const items = [
    "Business Profile created",
    ...(strategy ? [`First strategy: ${strategy.title}`] : []),
    ...(watched ? [`Watching ${watched} account${watched === 1 ? "" : "s"}`] : []),
  ];
  await db.milestone.create({ data: { userId, kind: "start", date: asDate(dayInTz(user.onboarding.completedAt ?? user.createdAt, user.timezone)), title: "Started with HustleQ", items } });
}

export async function listMilestones(userId: string) {
  await ensureStartMilestone(userId);
  const w = await window(userId);
  const [rows, current] = await Promise.all([
    db.milestone.findMany({ where: { userId }, orderBy: [{ date: "desc" }, { createdAt: "desc" }] }),
    db.monthlyReview.findUnique({ where: { userId_month: { userId, month: asDate(w.first) } } }),
  ]);
  const dueNow = w.open && current?.status !== "done";
  const next = dueNow ? w.first : shiftMonth(w.first, 1);
  return {
    nextReview: { date: next, label: shortDay(next), dueNow, conversationId: dueNow ? current?.conversationId ?? null : null },
    items: rows.map((m) => ({ id: m.id, kind: m.kind, date: iso(m.date), label: shortDay(iso(m.date)), title: m.title, items: m.items })),
  };
}

// ---------- The Home invite and starting ----------

export async function reviewInvite(userId: string) {
  const w = await window(userId);
  if (!w.open) return null;
  const r = await db.monthlyReview.findUnique({ where: { userId_month: { userId, month: asDate(w.first) } } });
  if (r?.status === "done") return null;
  return { title: reviewTitle(w.first), text: "New month. Five minutes with Duke to keep your profile current.", conversationId: r?.conversationId ?? null, started: Boolean(r?.startedAt), until: shortDay(addDays(w.first, REVIEW_DAYS - 1)) };
}

export async function startReview(userId: string) {
  const w = await window(userId);
  if (!w.open) throw new AppError(409, "no_review", "There's no review open right now. The next one starts on the 1st.");
  let r = await db.monthlyReview.findUnique({ where: { userId_month: { userId, month: asDate(w.first) } } });
  r ??= await db.monthlyReview.create({ data: { userId, month: asDate(w.first) } });
  if (!r.conversationId) {
    const conv = await db.conversation.create({ data: { userId, title: reviewTitle(w.first), objectType: "review", objectId: r.id } });
    r = await db.monthlyReview.update({ where: { id: r.id }, data: { conversationId: conv.id, startedAt: new Date(), status: r.status === "done" ? "done" : r.analysis ? "active" : r.status } });
  }
  if (!r.analysis) void ensureAnalysis(r.id); // the page waits for it (pending: "analysis")
  return { conversationId: r.conversationId! };
}

// ---------- The conversation ----------

async function say(conversationId: string, role: "assistant" | "user", display: Display) {
  await db.message.create({ data: { conversationId, role, content: [{ type: "text", text: display.text || "(card)" }], display: display as object } });
  await db.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
}

async function load(userId: string, conversationId: string) {
  const r = await db.monthlyReview.findFirst({ where: { userId, conversationId }, include: { user: { include: { business: true } } } });
  if (!r) throw notFound("Review not found.");
  return r;
}
type Row = Awaited<ReturnType<typeof load>>;

const FIELD_STEPS: Record<number, ProfileField> = { 1: "offers", 2: "idealCustomer", 3: "goals" };
const ASK: Record<string, { question: string; empty: string; edit: string }> = {
  offers: { question: "New month, quick check. Are your offers still the same?", empty: "Your offers aren’t in your Business Profile yet. What do you sell right now?", edit: "What changed? Write your offers the way you’d tell a customer." },
  idealCustomer: { question: "Is your ideal customer still the same?", empty: "Who is your ideal customer these days?", edit: "Who is it now? A line or two is enough." },
  goals: { question: "And your goals for Instagram, still the same?", empty: "What do you want Instagram to do for your business this month?", edit: "What do you want now? I’ll plan around it." },
};

// Duke's message for where the review stands. Called after every answer.
async function prompt(r: Row) {
  const conv = r.conversationId!;
  const data = (r.data ?? {}) as Data;
  const values = profileValues(r.user.business as Record<string, unknown> | null);
  const first = iso(r.month);
  if (r.step === 0) {
    const a = r.analysis as Analysis;
    await say(conv, "assistant", {
      text: `${monthName(shiftMonth(first, -1))} is done. Here’s how it went.`,
      card: { type: "month_analysis", month: monthName(shiftMonth(first, -1)), nextMonth: monthName(first), ...a },
      replies: { options: [R.start, R.later] },
    });
    return;
  }
  const field = FIELD_STEPS[r.step];
  if (field && !data.sub) {
    const value = values[field];
    if (!value) return say(conv, "assistant", { text: ASK[field]!.empty, replies: { options: [R.skip], placeholder: fieldLabel(field) } });
    return say(conv, "assistant", { text: ASK[field]!.question, card: { type: "current", label: `${fieldLabel(field)} today`, value }, replies: { options: [R.same, R.update] } });
  }
  if (field && data.sub === "edit") return say(conv, "assistant", { text: ASK[field]!.edit, replies: { options: [R.keepAsIs], placeholder: fieldLabel(field) } });
  if (r.step === 2 && data.sub === "dnp") {
    return say(conv, "assistant", {
      text: "Anything new you don’t want to post, see or follow?",
      ...(values.doNotPost ? { card: { type: "current", label: "Don’t post today", value: values.doNotPost } } : {}),
      replies: { options: [R.noChanges, R.add] },
    });
  }
  if (r.step === 2 && data.sub === "dnp_edit") return say(conv, "assistant", { text: "What should I keep out of your posts?", replies: { options: [R.noChanges], placeholder: "e.g. no prices on the feed" } });
  if (r.step === 4) {
    const watched = await db.watchedAccount.findMany({ where: { userId: r.userId }, orderBy: { createdAt: "asc" } });
    if (!watched.length) {
      return say(conv, "assistant", { text: "You don’t watch any account yet. A competitor or an inspiration shows what works near you.", replies: { options: [R.notNow, R.watchOne] } });
    }
    const today = dayInTz(new Date(), r.user.timezone);
    const keep = watched.length === 1 ? "Keep it" : watched.length === 2 ? "Keep both" : "Keep all";
    return say(conv, "assistant", {
      text: `You’ve been watching ${watched.length === 1 ? "this account" : "these accounts"}. Keep ${watched.length === 1 ? "it" : "them"}, or switch?`,
      card: { type: "watched", items: watched.map((w) => ({ handle: w.handle, label: w.label, since: sinceLabel(dayInTz(w.createdAt, r.user.timezone), today) })) },
      replies: { options: [keep, R.switchOne, ...(watched.length < 3 ? [R.addAnother] : [])] },
    });
  }
  if (r.step === 5) {
    const changes = data.changes ?? [];
    const s = await activeStrategy(r.userId, r.user.timezone);
    const lines = ["Review saved.", ...(changes.length ? ["What changed", ...changes.map((c) => `· ${c}`)] : ["Nothing changed this month."])];
    if (s?.endsOn) {
      const left = Math.max(1, Math.ceil(daysBetween(dayInTz(new Date(), r.user.timezone), s.endsOn) / 7));
      lines.push("", `${s.name} has ${left} week${left === 1 ? "" : "s"} left. Keep it or start a new strategy?`);
      return say(conv, "assistant", { text: lines.join("\n"), replies: { options: [R.keepStrategy, R.newStrategy] } });
    }
    lines.push("", "No strategy is running right now. Want to start one with me?");
    return say(conv, "assistant", { text: lines.join("\n"), replies: { options: [R.newStrategy, R.notNow] } });
  }
}

function sinceLabel(from: string, today: string) {
  const days = daysBetween(from, today);
  if (days < 14) return `${Math.max(days, 1)} day${days === 1 ? "" : "s"}`;
  if (days < 45) return days < 21 ? "2 weeks" : days < 28 ? "3 weeks" : "1 month";
  return `${Math.round(days / 30)} months`;
}

export async function getReview(userId: string, conversationId: string) {
  let r = await load(userId, conversationId);
  // The analysis arrived: show it once.
  if (r.step === 0 && r.analysis && !(await db.message.count({ where: { conversationId } }))) {
    await prompt(r);
    if (r.status !== "done") await db.monthlyReview.update({ where: { id: r.id }, data: { status: "active" } });
    r = await load(userId, conversationId);
  }
  const data = (r.data ?? {}) as Data;
  const messages = await db.message.findMany({ where: { conversationId }, orderBy: { createdAt: "asc" }, select: { id: true, role: true, display: true, createdAt: true } });
  const first = iso(r.month);
  return {
    id: r.id,
    title: reviewTitle(first),
    status: r.status,
    step: Math.min(r.step, 5),
    totalSteps: 5,
    pending: !r.analysis ? ("analysis" as const) : null,
    problem: !r.analysis && data.failedAt && !data.generatingSince ? ("analysis_failed" as const) : null,
    messages: messages.map((m) => ({ id: m.id, role: m.role, display: m.display ?? {}, createdAt: m.createdAt })),
  };
}

export async function retryAnalysis(userId: string, conversationId: string) {
  const r = await load(userId, conversationId);
  if (!r.analysis) await ensureAnalysis(r.id);
  return getReview(userId, conversationId);
}

export class ReviewInputError extends Error {}

export async function replyReview(userId: string, conversationId: string, input: { choices?: string[] | undefined; text?: string | undefined }) {
  const r = await load(userId, conversationId);
  if (!r.analysis) throw new ReviewInputError("Duke is still preparing your month. One moment.");
  if (r.status === "done") throw new ReviewInputError("This review is saved. The next one starts on the 1st.");
  const choice = input.choices?.[0] ?? null;
  const text = input.text?.trim().slice(0, 600) || null;
  if (!choice && !text) throw new ReviewInputError("Pick an option or write an answer.");
  await say(r.conversationId!, "user", { text: [choice, text].filter(Boolean).join(" · ") });

  const data = (r.data ?? {}) as Data;
  const changes = [...(data.changes ?? [])];
  let step = r.step;
  let sub: string | null = data.sub ?? null;
  let next: "strategy" | "watched" | null = null;
  const values = profileValues(r.user.business as Record<string, unknown> | null);
  const setField = async (field: ProfileField, value: string) => {
    await db.businessProfile.update({ where: { userId }, data: { [field]: value } });
  };
  const field = FIELD_STEPS[step];

  if (step === 0) {
    if (choice === R.later && !text) {
      await say(r.conversationId!, "assistant", { text: `No problem. It stays on your Home until ${shortDay(addDays(iso(r.month), REVIEW_DAYS - 1))}.`, replies: { options: [R.start] } });
      return { next: null };
    }
    step = 1;
    sub = null;
  } else if (field && !sub) {
    if (text) {
      await setField(field, text);
      changes.push(values[field] ? `${fieldLabel(field)}: now “${clip(text)}”` : `${fieldLabel(field)}: added “${clip(text)}”`);
      ({ step, sub } = after(step));
    } else if (choice === R.update) {
      sub = "edit";
    } else {
      ({ step, sub } = after(step)); // Still the same / Skip for now
    }
  } else if (field && sub === "edit") {
    if (text) {
      await setField(field, text);
      changes.push(`${fieldLabel(field)}: now “${clip(text)}”`);
    }
    ({ step, sub } = after(step));
  } else if (step === 2 && sub === "dnp") {
    if (text) {
      await setField("doNotPost", values.doNotPost ? `${values.doNotPost}; ${text}` : text);
      changes.push(`Don’t post: added “${clip(text)}”`);
      ({ step, sub } = { step: 3, sub: null });
    } else if (choice === R.add) sub = "dnp_edit";
    else ({ step, sub } = { step: 3, sub: null });
  } else if (step === 2 && sub === "dnp_edit") {
    if (text) {
      await setField("doNotPost", values.doNotPost ? `${values.doNotPost}; ${text}` : text);
      changes.push(`Don’t post: added “${clip(text)}”`);
    }
    ({ step, sub } = { step: 3, sub: null });
  } else if (step === 4) {
    if (choice === R.switchOne || choice === R.addAnother || choice === R.watchOne) {
      changes.push(choice === R.switchOne ? "Watched accounts: switching one" : "Watched accounts: adding one");
      await say(r.conversationId!, "assistant", { text: "You can do it in Explore whenever you’re ready. Each account stays at least a month.", card: { type: "link", label: "Open watched accounts", to: "/explore/watched" } });
    } else if (choice && choice !== R.notNow) {
      changes.push(`Watched accounts: ${choice === "Keep it" ? "kept it" : choice === "Keep both" ? "kept both" : "kept all"}`);
    }
    step = 5;
    sub = null;
  } else if (step === 5) {
    const s = await activeStrategy(userId, r.user.timezone);
    const fresh = choice === R.newStrategy || (text != null && /new/i.test(text));
    const strategyLine = fresh ? "Strategy: starting a new one" : s ? `Strategy: kept ${s.name}` : null;
    await saveMilestone(r, [...changes, ...(strategyLine ? [strategyLine] : [])]);
    await db.monthlyReview.update({ where: { id: r.id }, data: { step: 6, status: "done", completedAt: new Date(), data: { ...data, changes, sub: null } } });
    const nextDate = shortDay(shiftMonth(iso(r.month), 1));
    await say(r.conversationId!, "assistant", { text: fresh ? "Let’s build the next one. Opening a new strategy chat." : `Saved. See you on ${nextDate} for the next review.`, card: { type: "link", label: "See your milestones", to: "/settings/milestones" } });
    return { next: fresh ? ("strategy" as const) : null };
  }

  await db.monthlyReview.update({ where: { id: r.id }, data: { step, data: { ...data, sub, changes }, status: "active" } });
  const fresh = await load(userId, conversationId);
  if (step === 5) await saveMilestone(fresh, changes); // "Review saved" is true from here
  await prompt(fresh);
  return { next };
}

// Field steps: offers -> ideal customer -> (don't post) -> goals -> watched.
function after(step: number): { step: number; sub: string | null } {
  if (step === 2) return { step: 2, sub: "dnp" };
  return { step: step + 1, sub: null };
}

async function saveMilestone(r: Row, items: string[]) {
  await ensureStartMilestone(r.userId);
  const first = iso(r.month);
  await db.milestone.upsert({
    where: { reviewId: r.id },
    update: { items: items.length ? items : ["No changes"] },
    create: { userId: r.userId, kind: "review", date: asDate(first), title: reviewTitle(first), items: items.length ? items : ["No changes"], reviewId: r.id },
  });
}

// For checks and scripts: the analysis for one account and month, not saved.
export async function previewAnalysis(userId: string, first: string) {
  const bundle = await gatherFacts(userId, first);
  const out = await parseClaude(
    { role: "deep", feature: "monthly_analysis_preview", userId, effort: "medium" },
    { max_tokens: BASE.max_tokens, system: SYSTEM, messages: [{ role: "user", content: analysisPrompt(first, bundle) }] },
    zodOutputFormat(AnalysisOut)
  );
  return { bundle, analysis: toAnalysis(bundle, out) };
}
