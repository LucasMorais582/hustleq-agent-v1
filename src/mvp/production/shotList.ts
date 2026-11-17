import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { parseClaude } from "../ai/client.js";
import { db } from "../db.js";
import { enqueueSafe } from "../jobs/queue.js";
import { PROFILE_FIELDS, profileValues } from "../business/fields.js";
import { FORMAT_LABEL, postSlot, type Format } from "../plan/service.js";

// What to film (5.6, 5.7): one list for the whole week, built from each post's "What to produce".
// Built in the background (one Claude call); items checked by the owner are kept on the server.

export const JOB_SHOT_LIST = "shot-list";
export const STAGES = [
  { key: "before", label: "Before filming" },
  { key: "filming", label: "Filming" },
  { key: "after", label: "After filming" },
] as const;
type Stage = (typeof STAGES)[number]["key"];

const ShotListSchema = z.object({
  title: z.string().describe("One line on how to film the week, e.g. 'Film everything in one session'"),
  summary: z.string().describe("1 or 2 sentences: where it happens and the order to film in"),
  importantNote: z.string().describe("The one thing not to miss, e.g. 'Film the trays before they're served. Two posts use the same shots.' Empty string if nothing stands out"),
  sessions: z.number().int().describe("How many filming sessions the week needs, usually 1 or 2"),
  people: z.array(z.string()).describe("Who appears or helps, 1 to 4 short items, e.g. 'You or the cook'"),
  locations: z.array(z.string()).describe("Where to film, 1 to 3 short items, e.g. 'Your kitchen · counter with natural light'"),
  assets: z.array(z.string()).describe("What to have ready: products, props, gear. 3 to 10 short items"),
  before: z.array(z.string()).describe("Things to do before filming, 2 to 5 short items"),
  filming: z.array(z.object({ text: z.string(), post: z.number().int().describe("Number of the post this shot is for (1-based); 0 if it serves several posts") })).describe("Shots to film, grouped so shared shots are filmed once, 3 to 12 items"),
  after: z.array(z.string()).describe("Things to do after filming (editing, audio, text, upload), 2 to 4 short items"),
});

const SYSTEM = `You are Duke, the content strategist inside HustleQ. You turn a week of planned Instagram posts into one list of what to film, for a small business owner who films with a phone, alone or with one helper.

Rules:
- Group the work so it can be done in as few sessions as possible. When two posts can use the same shots, say so and list the shot once.
- Short, concrete items in plain English, starting with a verb when it's an action ("Prepare the holiday trays").
- Use the real products, places and people from the Business Profile and the posts. Never invent prices, quantities, names or facts that aren't given.
- Respect "Don't post" from the Business Profile.
- The owner never sees post numbers: in the text, name a post by its day and format ("Monday's Reel"), never "Post 1".`;

export async function requestShotList(userId: string, weekId: string, { rebuild = false } = {}) {
  const week = await db.week.findFirst({ where: { id: weekId, userId }, select: { id: true } });
  if (!week) return null;
  const existing = await db.shotList.findUnique({ where: { weekId } });
  if (existing && !rebuild && existing.status !== "failed") return existing;
  const list = existing
    ? await db.shotList.update({ where: { id: existing.id }, data: { status: "pending" } })
    : await db.shotList.create({ data: { userId, weekId } });
  const queued = await enqueueSafe(JOB_SHOT_LIST, { shotListId: list.id }, { singletonKey: list.id });
  if (!queued) await writeShotList(list.id);
  return list;
}

// Details of each post are written in the background too; give them a moment before using them.
async function waitForDetails(weekId: string, timeoutMs = 120_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const pending = await db.post.count({ where: { weekId, detailsStatus: "pending", status: { not: "cancelled" } } });
    if (pending === 0) return;
    await new Promise((r) => setTimeout(r, 3000));
  }
}

export async function writeShotList(shotListId: string) {
  const list = await db.shotList.findUniqueOrThrow({ where: { id: shotListId } });
  try {
    await waitForDetails(list.weekId);
    const week = await db.week.findUniqueOrThrow({
      where: { id: list.weekId },
      include: { posts: { where: { status: { not: "cancelled" } }, include: { pillar: true }, orderBy: [{ scheduledAt: "asc" }, { position: "asc" }] } },
    });
    const owner = await db.user.findUniqueOrThrow({ where: { id: list.userId }, select: { timezone: true } });
    const bp = await db.businessProfile.findUnique({ where: { userId: list.userId } });
    const values = profileValues(bp as Record<string, unknown> | null);
    const profile = PROFILE_FIELDS.map((f) => `${f.label}: ${values[f.key] ?? "—"}`).join("\n");
    const posts = week.posts.map((p, i) => {
      const g = (p.productionGuidance ?? {}) as { objective?: string; recordingPlan?: string[]; assets?: string; checklist?: string[] };
      return [
        `Post ${i + 1}: ${postSlot(p.scheduledAt, owner.timezone).label} · ${FORMAT_LABEL[(p.format ?? "feed") as Format] ?? p.format} · "${p.title}"`,
        g.objective ? `  Make: ${g.objective}` : "",
        g.recordingPlan?.length ? `  Shots: ${g.recordingPlan.join(" | ")}` : "",
        g.assets ? `  Needs: ${g.assets}` : "",
      ].filter(Boolean).join("\n");
    });

    const out = await parseClaude(
      { role: "duke", feature: "shot_list", userId: list.userId, effort: "low" },
      {
        max_tokens: 8000,
        system: SYSTEM,
        messages: [{ role: "user", content: `Business: ${bp?.businessName ?? "—"}\n${profile}\n\nThe week's posts:\n${posts.join("\n")}\n\nWrite the list of what to film this week.` }],
      },
      zodOutputFormat(ShotListSchema)
    );

    const items: { stage: Stage; text: string; postId: string | null }[] = [
      ...out.before.map((text) => ({ stage: "before" as const, text, postId: null })),
      ...out.filming.map((f) => ({ stage: "filming" as const, text: f.text, postId: week.posts[f.post - 1]?.id ?? null })),
      ...out.after.map((text) => ({ stage: "after" as const, text, postId: null })),
    ].filter((i) => i.text.trim());

    await db.$transaction([
      db.shotListItem.deleteMany({ where: { shotListId } }),
      db.shotListItem.createMany({ data: items.map((it, position) => ({ shotListId, position, stage: it.stage, text: it.text.trim().slice(0, 300), postId: it.postId })) }),
      db.shotList.update({
        where: { id: shotListId },
        data: {
          status: "ready",
          title: out.title,
          summary: out.summary,
          importantNote: out.importantNote.trim() || null,
          sessions: Math.min(Math.max(out.sessions, 1), 7),
          people: out.people.slice(0, 6),
          locations: out.locations.slice(0, 4),
          assets: out.assets.slice(0, 15),
        },
      }),
    ]);
  } catch (error) {
    console.error("[production] shot list failed", shotListId, error);
    await db.shotList.update({ where: { id: shotListId }, data: { status: "failed" } });
  }
}

export async function getShotList(userId: string, weekId: string, tz: string) {
  const list = await db.shotList.findFirst({ where: { weekId, userId }, include: { items: { orderBy: { position: "asc" } } } });
  if (!list) return null;
  const week = await db.week.findUniqueOrThrow({
    where: { id: weekId },
    include: { posts: { where: { status: { not: "cancelled" } }, orderBy: [{ scheduledAt: "asc" }, { position: "asc" }] } },
  });
  const done = list.items.filter((i) => i.done).length;
  const n = week.posts.length;
  return {
    id: list.id,
    weekId,
    status: list.status,
    header: `${n} ${n === 1 ? "post" : "posts"} · ${list.sessions} filming ${list.sessions === 1 ? "session" : "sessions"}`,
    title: list.title,
    summary: list.summary,
    importantNote: list.importantNote,
    people: list.people,
    locations: list.locations,
    assets: list.assets,
    progress: { done, total: list.items.length },
    groups: STAGES.map((s) => {
      const items = list.items.filter((i) => i.stage === s.key);
      return { stage: s.key, label: s.label, done: items.filter((i) => i.done).length, total: items.length, items: items.map((i) => ({ id: i.id, text: i.text, done: i.done, postId: i.postId })) };
    }),
    byPost: week.posts.map((p) => {
      const g = (p.productionGuidance ?? {}) as { objective?: string; recordingPlan?: string[]; checklist?: string[] };
      return {
        id: p.id,
        title: p.title,
        slot: postSlot(p.scheduledAt, tz).label,
        formatLabel: FORMAT_LABEL[(p.format ?? "feed") as Format] ?? p.format,
        objective: g.objective ?? null,
        recordingPlan: g.recordingPlan ?? [],
        checklist: g.checklist ?? [],
        shots: list.items.filter((i) => i.postId === p.id).map((i) => ({ id: i.id, text: i.text, done: i.done })),
      };
    }),
  };
}

export async function setShotDone(userId: string, itemId: string, done: boolean) {
  const item = await db.shotListItem.findFirst({ where: { id: itemId, shotList: { userId } } });
  if (!item) return null;
  return db.shotListItem.update({ where: { id: itemId }, data: { done } });
}
