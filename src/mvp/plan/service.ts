import { db } from "../db.js";
import { addDays, dayInTz, shortDate } from "../lib/time.js";
import { cachedInstagram } from "../instagram/own.js";
import { enqueueSafe } from "../jobs/queue.js";
import { bestTime, DAYS, dateForDay, mondayOf, scheduledAt, timeLabel, type DayName } from "./timing.js";
import { writePostDetails } from "./details.js";

// Strategies (4.1-4.7) and weeks (5.1-5.5). Used by Duke's tools and by the app's routes.

export const FORMATS = ["reel", "carousel", "feed", "story"] as const;
export type Format = (typeof FORMATS)[number];
export const FORMAT_LABEL: Record<Format, string> = { reel: "Reel", carousel: "Carousel", feed: "Feed post", story: "Story" };
export const contentTypeOf = (f: Format) => (f === "reel" ? "video" : f === "story" ? "story" : "static");

export const BASE_PILLARS = [
  { baseType: "attract", name: "Attract", description: "Reach new people" },
  { baseType: "educate", name: "Educate", description: "Teach and answer questions" },
  { baseType: "trust", name: "Trust", description: "Behind the scenes, team, customers" },
  { baseType: "sell", name: "Sell", description: "Offers and how to buy" },
  { baseType: "community", name: "Community", description: "Interaction and events" },
  { baseType: "entertain", name: "Entertain", description: "Humor and trends" },
] as const;

export class PlanInputError extends Error {}

const fmtDay = (iso: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
const isoDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

async function sayInConversation(conversationId: string | null, display: { text: string; card?: Record<string, unknown>; replies?: { options: string[] } }) {
  if (!conversationId) return;
  await db.message.create({ data: { conversationId, role: "assistant", content: [{ type: "text", text: display.text }], display: display as object } });
  await db.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
}

// ---------------- Strategies ----------------

export type StrategyInput = {
  name: string;
  objective: string;
  durationWeeks: number;
  staticPerWeek: number;
  videosPerWeek: number;
  storiesPerWeek: number;
  pillars: { name: string; baseType?: string | undefined; description?: string | undefined; goal?: string | undefined }[];
};

export function validatePillars(pillars: StrategyInput["pillars"]) {
  if (pillars.length < 1 || pillars.length > 4) throw new PlanInputError("A strategy needs 1 to 4 pillars.");
}

type StrategyRow = Awaited<ReturnType<typeof db.strategy.findFirstOrThrow>> & { pillars: { id: string; name: string; baseType: string | null; description: string | null; goal: string | null; position: number }[] };

export function presentStrategy(s: StrategyRow, tz: string) {
  const today = dayInTz(new Date(), tz);
  const start = isoDate(s.startsOn);
  const end = isoDate(s.endsOn);
  let status: "draft" | "active" | "ended" | "upcoming" = "draft";
  if (s.status === "saved" && start && end) status = today < start ? "upcoming" : today > end ? "ended" : "active";
  const weekNumber = status === "active" && start ? Math.floor((Date.parse(today) - Date.parse(start)) / (7 * 864e5)) + 1 : null;
  return {
    id: s.id,
    name: s.title,
    objective: s.objective,
    durationWeeks: s.durationWeeks,
    staticPerWeek: s.staticPerWeek,
    videosPerWeek: s.videosPerWeek,
    storiesPerWeek: s.storiesPerWeek,
    status,
    startsOn: start,
    endsOn: end,
    datesLabel: start && end ? `${fmtDay(start)} to ${fmtDay(end)}` : null,
    weekNumber,
    conversationId: s.conversationId,
    pillars: [...s.pillars].sort((a, b) => a.position - b.position).map((p) => ({ id: p.id, name: p.name, baseType: p.baseType, description: p.description, goal: p.goal })),
  };
}

export async function createDraftStrategy(userId: string, conversationId: string | null, input: StrategyInput) {
  validatePillars(input.pillars);
  const s = await db.strategy.create({
    data: {
      userId,
      conversationId,
      title: input.name.slice(0, 80),
      objective: input.objective.slice(0, 300),
      durationWeeks: input.durationWeeks,
      staticPerWeek: input.staticPerWeek,
      videosPerWeek: input.videosPerWeek,
      storiesPerWeek: input.storiesPerWeek,
      pillars: {
        create: input.pillars.map((p, i) => ({ name: p.name.slice(0, 40), baseType: p.baseType ?? "custom", description: p.description ?? null, goal: p.goal ?? null, position: i })),
      },
    },
    include: { pillars: true },
  });
  if (conversationId) await db.conversation.update({ where: { id: conversationId }, data: { objectType: "strategy", objectId: s.id } });
  return s;
}

export async function getStrategy(userId: string, id: string) {
  return db.strategy.findFirst({ where: { id, userId }, include: { pillars: true } });
}

export async function saveStrategy(userId: string, id: string, tz: string) {
  const s = await getStrategy(userId, id);
  if (!s) return null;
  if (s.status === "saved") return s;
  const start = mondayOf(new Date(), tz);
  const end = addDays(start, s.durationWeeks * 7 - 1);
  const saved = await db.strategy.update({
    where: { id },
    data: { status: "saved", startsOn: new Date(`${start}T00:00:00Z`), endsOn: new Date(`${end}T00:00:00Z`) },
    include: { pillars: true },
  });
  // 4.4: back in the chat
  await sayInConversation(s.conversationId, {
    text: `Saved. How do you want to use ${s.title} now?`,
    card: { type: "notice", text: "Strategy saved", link: `/strategies/${s.id}`, linkLabel: "View" },
    replies: { options: ["Plan this week", "Just one post", "A few posts", "A campaign"] },
  });
  return saved;
}

export type StrategyPatch = { [K in keyof Omit<StrategyInput, "pillars">]?: StrategyInput[K] | undefined } & { pillars?: StrategyInput["pillars"] | undefined };

export async function updateStrategy(userId: string, id: string, patch: StrategyPatch) {
  const s = await getStrategy(userId, id);
  if (!s) return null;
  if (patch.pillars) validatePillars(patch.pillars);
  const data: Record<string, unknown> = {};
  if (patch.name !== undefined) data.title = patch.name.slice(0, 80);
  if (patch.objective !== undefined) data.objective = patch.objective.slice(0, 300);
  for (const k of ["durationWeeks", "staticPerWeek", "videosPerWeek", "storiesPerWeek"] as const) if (patch[k] !== undefined) data[k] = patch[k];
  if (patch.durationWeeks !== undefined && s.startsOn) {
    data.endsOn = new Date(`${addDays(isoDate(s.startsOn)!, patch.durationWeeks * 7 - 1)}T00:00:00Z`);
  }
  await db.$transaction(async (tx) => {
    await tx.strategy.update({ where: { id }, data });
    if (patch.pillars) {
      // Posts keep their pillar when the name still matches; others lose the link.
      const old = await tx.pillar.findMany({ where: { strategyId: id } });
      const keep = new Map(old.map((p) => [p.name.toLowerCase(), p.id]));
      const seen = new Set<string>();
      for (const [i, p] of patch.pillars.entries()) {
        const existing = keep.get(p.name.toLowerCase());
        if (existing) {
          seen.add(existing);
          await tx.pillar.update({ where: { id: existing }, data: { position: i, description: p.description ?? null, goal: p.goal ?? null, ...(p.baseType ? { baseType: p.baseType } : {}) } });
        } else {
          await tx.pillar.create({ data: { strategyId: id, name: p.name.slice(0, 40), baseType: p.baseType ?? "custom", description: p.description ?? null, goal: p.goal ?? null, position: i } });
        }
      }
      await tx.pillar.deleteMany({ where: { strategyId: id, id: { notIn: [...seen] }, NOT: { name: { in: patch.pillars.map((p) => p.name) } } } });
    }
  });
  return getStrategy(userId, id);
}

export async function activeStrategy(userId: string, tz: string) {
  const list = await db.strategy.findMany({ where: { userId, status: "saved" }, include: { pillars: true }, orderBy: { startsOn: "desc" } });
  return list.map((s) => presentStrategy(s, tz)).find((s) => s.status === "active") ?? null;
}

// ---------------- Weeks ----------------

export type WeekPostInput = { day: DayName; time: string; format: Format; pillar?: string | undefined; title: string; hook?: string | undefined };

export async function planningContext(userId: string, tz: string, weekStart: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const bundle = user.instagramHandle ? await cachedInstagram(user.instagramHandle) : null;
  const best = bestTime(bundle?.posts ?? [], tz);
  const end = addDays(weekStart, 6);
  const scheduled = await db.post.findMany({
    where: { userId, status: "scheduled", scheduledAt: { gte: new Date(`${weekStart}T00:00:00Z`), lte: new Date(`${end}T23:59:59Z`) } },
    select: { scheduledAt: true, title: true, format: true },
  });
  return {
    weekStart,
    weekLabel: `Week of ${fmtDay(weekStart)}`,
    days: DAYS.map((d) => ({ day: d, date: dateForDay(weekStart, d) })),
    bestTime: best.time,
    bestTimeLabel: timeLabel(best.time),
    bestTimeFromData: best.fromData,
    alreadyScheduled: scheduled.map((p) => ({ when: p.scheduledAt?.toISOString(), title: p.title, format: p.format })),
    strategy: await activeStrategy(userId, tz),
  };
}

async function queueDetails(postIds: string[]) {
  for (const postId of postIds) {
    const queued = await enqueueSafe("post-details", { postId });
    if (!queued) await writePostDetails(postId);
  }
}

export async function createDraftWeek(userId: string, tz: string, conversationId: string | null, args: { weekStart: string; strategyId: string | null; posts: WeekPostInput[] }) {
  if (args.posts.length < 1 || args.posts.length > 21) throw new PlanInputError("A week has 1 to 21 posts.");
  const strategy = args.strategyId ? await getStrategy(userId, args.strategyId) : null;
  const ctx = await planningContext(userId, tz, args.weekStart);
  const pillarId = (name?: string) => (name ? strategy?.pillars.find((p) => p.name.toLowerCase() === name.toLowerCase())?.id ?? null : null);

  const week = await db.week.create({
    data: {
      userId,
      strategyId: strategy?.id ?? null,
      startsOn: new Date(`${args.weekStart}T00:00:00Z`),
      bestTime: ctx.bestTime,
      conversationId,
      posts: {
        create: args.posts.map((p, i) => ({
          userId,
          pillarId: pillarId(p.pillar),
          format: p.format,
          contentType: contentTypeOf(p.format),
          title: p.title.slice(0, 120),
          hook: p.hook?.slice(0, 300) ?? null,
          scheduledAt: scheduledAt(args.weekStart, p.day, p.time, tz),
          position: i,
        })),
      },
    },
    include: { posts: true },
  });
  if (conversationId) await db.conversation.update({ where: { id: conversationId }, data: { objectType: "week", objectId: week.id } });
  // Details come in the background; the app polls the week until they're ready.
  void queueDetails(week.posts.map((p) => p.id)).catch((e) => console.error("[plan] queue details", e));
  return week;
}

export type PostChanges = { day?: DayName | undefined; time?: string | undefined; format?: Format | undefined; pillar?: string | undefined; title?: string | undefined; hook?: string | undefined };

export async function revisePost(userId: string, tz: string, postId: string, changes: PostChanges) {
  const post = await db.post.findFirst({ where: { id: postId, userId }, include: { week: { include: { strategy: { include: { pillars: true } } } } } });
  if (!post || !post.week) return null;
  const weekStart = isoDate(post.week.startsOn)!;
  const current = post.scheduledAt ? new Date(post.scheduledAt) : null;
  const curDay = current ? DAYS[(new Date(`${new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(current)}T12:00:00Z`).getUTCDay() + 6) % 7]! : "Mon";
  const curTime = current ? new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(current) : post.week.bestTime ?? "19:00";
  const data: Record<string, unknown> = {};
  if (changes.day || changes.time) data.scheduledAt = scheduledAt(weekStart, changes.day ?? curDay, changes.time ?? curTime, tz);
  if (changes.format) { data.format = changes.format; data.contentType = contentTypeOf(changes.format); }
  if (changes.title) data.title = changes.title.slice(0, 120);
  if (changes.hook) data.hook = changes.hook.slice(0, 300);
  if (changes.pillar) data.pillarId = post.week.strategy?.pillars.find((p) => p.name.toLowerCase() === changes.pillar!.toLowerCase())?.id ?? post.pillarId;
  // Only what changed the content needs new details; moving a post keeps them.
  const contentChanged = Boolean(changes.format || changes.title || changes.hook || changes.pillar);
  if (contentChanged) data.detailsStatus = "pending";
  const updated = await db.post.update({ where: { id: postId }, data });
  if (contentChanged) void queueDetails([postId]).catch((e) => console.error("[plan] queue details", e));
  return updated;
}

type WeekWithPosts = NonNullable<Awaited<ReturnType<typeof loadWeek>>>;
async function loadWeek(userId: string, weekId: string) {
  return db.week.findFirst({ where: { id: weekId, userId }, include: { posts: { include: { pillar: true }, orderBy: [{ scheduledAt: "asc" }, { position: "asc" }] }, strategy: true } });
}

export function postSlot(at: Date | null, tz: string) {
  if (!at) return { day: null, date: null, time: null, label: "Not scheduled" };
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(at);
  const day = DAYS[(new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7]!;
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
  return { day, date, time, label: `${day} ${Number(date.slice(8))} · ${timeLabel(time)}` };
}

export function presentPost(p: WeekWithPosts["posts"][number], tz: string) {
  return {
    id: p.id,
    weekId: p.weekId,
    status: p.status,
    slot: postSlot(p.scheduledAt, tz),
    scheduledAt: p.scheduledAt,
    format: p.format,
    formatLabel: FORMAT_LABEL[(p.format ?? "feed") as Format] ?? p.format,
    pillar: p.pillar?.name ?? null,
    title: p.title,
    hook: p.hook,
    detailsStatus: p.detailsStatus,
    caption: p.caption,
    captionParts: p.captionParts,
    hashtags: p.hashtags,
    idea: p.idea,
    creativeDirection: p.creativeDirection,
    whatToProduce: p.productionGuidance,
    postingReminders: p.postingReminders,
    reminderEmail: p.reminderEmail,
  };
}

export async function getWeek(userId: string, weekId: string, tz: string) {
  const w = await loadWeek(userId, weekId);
  if (!w) return null;
  const weekStart = isoDate(w.startsOn)!;
  const end = addDays(weekStart, 6);
  // Days that already have a saved post from another week (grey in 5.4, a warning only).
  const others = await db.post.findMany({
    where: { userId, status: "scheduled", weekId: { not: w.id }, scheduledAt: { gte: new Date(`${weekStart}T00:00:00Z`), lte: new Date(`${end}T23:59:59Z`) } },
    select: { scheduledAt: true },
  });
  return {
    id: w.id,
    status: w.status,
    weekStart,
    label: `Week of ${fmtDay(weekStart)}`,
    rangeLabel: `${fmtDay(weekStart)} to ${fmtDay(end)}`,
    days: DAYS.map((d) => ({ day: d, date: dateForDay(weekStart, d), label: `${d} ${Number(dateForDay(weekStart, d).slice(8))}` })),
    busyDays: [...new Set(others.map((o) => postSlot(o.scheduledAt, tz).date))],
    strategy: w.strategy ? { id: w.strategy.id, name: w.strategy.title } : null,
    bestTime: w.bestTime,
    bestTimeLabel: w.bestTime ? timeLabel(w.bestTime) : null,
    conversationId: w.conversationId,
    posts: w.posts.map((p) => presentPost(p, tz)),
  };
}

export async function saveWeek(userId: string, tz: string, weekId: string, input: { posts: { id: string; date: string }[]; reminders: boolean }) {
  const w = await loadWeek(userId, weekId);
  if (!w) return null;
  const weekStart = isoDate(w.startsOn)!;
  const allowed = new Set(DAYS.map((d) => dateForDay(weekStart, d)));
  await db.$transaction(async (tx) => {
    for (const p of w.posts) {
      const choice = input.posts.find((x) => x.id === p.id);
      const date = choice?.date ?? postSlot(p.scheduledAt, tz).date ?? weekStart;
      if (!allowed.has(date)) throw new PlanInputError("Posts must stay inside the week.");
      const time = postSlot(p.scheduledAt, tz).time ?? w.bestTime ?? "19:00";
      const day = DAYS[(new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7]!;
      await tx.post.update({ where: { id: p.id }, data: { status: "scheduled", scheduledAt: scheduledAt(weekStart, day, time, tz), reminderEmail: input.reminders } });
    }
    await tx.week.update({ where: { id: weekId }, data: { status: "saved" } });
  });
  const n = w.posts.length;
  // 5.5: back in the chat
  await sayInConversation(w.conversationId, {
    text: input.reminders
      ? "Saved. I’ll email you on each post day. Want to start producing? I can list everything to shoot this week in one place."
      : "Saved. Want to start producing? I can list everything to shoot this week in one place.",
    card: { type: "notice", text: `Week saved · ${n} ${n === 1 ? "post" : "posts"}`, link: "/calendar", linkLabel: "Open calendar" },
    replies: { options: ["Shot list for the week", "Export week", "Later"] },
  });
  return getWeek(userId, weekId, tz);
}

export const weekLabelFor = (weekStart: string) => `Week of ${fmtDay(weekStart)}`;
export { shortDate };
