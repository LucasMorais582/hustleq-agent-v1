import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { db } from "../db.js";
import { FIELD_KEYS, fieldLabel, PROFILE_FIELDS, profileValues, type ProfileField } from "../business/fields.js";
import { cachedInstagram, formatStats, syncInstagram } from "../instagram/own.js";
import { DailyCapReached, refundHeavyGeneration, useHeavyGeneration } from "../plan/limits.js";
import { DAYS, postingPace, weekStartFor } from "../plan/timing.js";
import {
  BASE_PILLARS, createDraftStrategy, createDraftWeek, FORMATS, getStrategy, planningContext, PlanInputError, presentStrategy, revisePost,
} from "../plan/service.js";

// Duke's tools. Order and wording are part of the cached prefix: keep them stable.
// Tools read, or propose; nothing that changes data runs without the owner's tap.

export type ToolContext = { userId: string; conversationId: string | null; timezone: string; emitCard: (card: Record<string, unknown>) => void };

const CAP_MESSAGE = { blocked: true, reason: "daily_limit", note: "The owner reached today's limit for new plans. Tell them kindly it resets tomorrow, and offer to talk the plan through in the chat meanwhile." };

// Heavy generations count against the hidden daily cap; a failure gives the use back.
async function heavy<T>(ctx: ToolContext, fn: () => Promise<T>): Promise<T | typeof CAP_MESSAGE> {
  try {
    await useHeavyGeneration(ctx.userId, ctx.timezone);
  } catch (error) {
    if (error instanceof DailyCapReached) return CAP_MESSAGE;
    throw error;
  }
  try {
    return await fn();
  } catch (error) {
    await refundHeavyGeneration(ctx.userId, ctx.timezone);
    throw error;
  }
}

const pillarSchema = z.object({ name: z.string().min(1).max(40), baseType: z.string().optional(), description: z.string().max(120).optional(), goal: z.string().max(120).optional() });
const dayEnum = z.enum(DAYS as unknown as [string, ...string[]]);
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM, 24 h");
const formatEnum = z.enum(FORMATS as unknown as [string, ...string[]]);

type ToolDef = { tool: Anthropic.Tool; input: z.ZodTypeAny; run: (input: any, ctx: ToolContext) => Promise<unknown> };

const fieldEnum = z.enum(FIELD_KEYS as [ProfileField, ...ProfileField[]]);

const TOOLS: ToolDef[] = [
  {
    tool: {
      name: "get_business_profile",
      description: "Read the owner's Business Profile: what the business does, niche, location, offers, ideal customer, customer problem, where customers come from, what not to post, goals.",
      input_schema: { type: "object", properties: {}, additionalProperties: false },
    },
    input: z.object({}).passthrough(),
    async run(_input, ctx) {
      const bp = await db.businessProfile.findUnique({ where: { userId: ctx.userId } });
      const values = profileValues(bp as Record<string, unknown> | null);
      return {
        businessName: bp?.businessName ?? null,
        complete: Boolean(bp?.completedAt),
        fields: PROFILE_FIELDS.map((f) => ({ field: f.key, label: f.label, value: values[f.key] })),
      };
    },
  },
  {
    tool: {
      name: "propose_profile_update",
      description: "Propose a change to one Business Profile field. The owner sees a card with the new value and confirms it; nothing changes until they tap. Use when the owner tells you something new about the business.",
      input_schema: {
        type: "object",
        properties: {
          field: { type: "string", enum: FIELD_KEYS, description: "Which field to change" },
          value: { type: "string", description: "The full new value for the field, short and plain" },
          reason: { type: "string", description: "One short sentence the owner will read: why you suggest it" },
        },
        required: ["field", "value", "reason"],
        additionalProperties: false,
      },
    },
    input: z.object({ field: fieldEnum, value: z.string().min(1).max(600), reason: z.string().max(300) }),
    async run(input: { field: ProfileField; value: string; reason: string }, ctx) {
      const bp = await db.businessProfile.findUnique({ where: { userId: ctx.userId } });
      const current = profileValues(bp as Record<string, unknown> | null)[input.field];
      ctx.emitCard({ type: "profile_update", field: input.field, label: fieldLabel(input.field), current, value: input.value, reason: input.reason });
      return { shown_to_owner: true, note: "The owner sees a card and decides. Nothing changed yet." };
    },
  },
  {
    tool: {
      name: "get_instagram_summary",
      description: "Read the owner's Instagram: followers, the most recent posts (up to 12) with format, date and numbers, and averages per format. Use before talking about their posts or numbers.",
      input_schema: { type: "object", properties: {}, additionalProperties: false },
    },
    input: z.object({}).passthrough(),
    async run(_input, ctx) {
      const user = await db.user.findUniqueOrThrow({ where: { id: ctx.userId } });
      if (!user.instagramHandle) return { error: "No Instagram linked to this account." };
      let bundle = await cachedInstagram(user.instagramHandle);
      try {
        bundle = (await syncInstagram(user.instagramHandle)) ?? bundle;
      } catch {
        // keep the last good data; its date is in fetchedAt
      }
      if (!bundle) return { error: "Instagram data isn't available right now." };
      const stats = formatStats(bundle.posts);
      return {
        handle: bundle.profile.handle,
        followers: bundle.profile.followers,
        fetchedAt: bundle.fetchedAt,
        testData: bundle.source === "fake" ? "These are placeholder test numbers, not the real account. Say so if you quote them." : undefined,
        perFormat: stats.formats,
        bestFormat: stats.bestFormat,
        postingPaceLast4Weeks: postingPace(bundle.posts),
        posts: bundle.posts.slice(0, 12).map((p) => ({
          date: p.publishedAt?.slice(0, 10) ?? null,
          format: p.format,
          likes: p.likes,
          comments: p.comments,
          views: p.views,
          caption: (p.caption ?? "").slice(0, 200),
        })),
      };
    },
  },
  {
    tool: {
      name: "list_strategies",
      description: "List the owner's strategies with status (draft, active, upcoming, ended), dates, posts per week and pillars.",
      input_schema: { type: "object", properties: {}, additionalProperties: false },
    },
    input: z.object({}).passthrough(),
    async run(_input, ctx) {
      const rows = await db.strategy.findMany({ where: { userId: ctx.userId }, include: { pillars: true }, orderBy: { createdAt: "desc" }, take: 10 });
      return { strategies: rows.map((r) => presentStrategy(r, ctx.timezone)), basePillars: BASE_PILLARS };
    },
  },
  {
    tool: {
      name: "ask_weekly_mix",
      description: "Show the owner the 'how much each week' picker (static posts, videos, stories) with your suggestion. Base the suggestion on postingPaceLast4Weeks from get_instagram_summary and on their goal. The owner answers in the chat.",
      input_schema: {
        type: "object",
        properties: {
          staticPerWeek: { type: "integer", minimum: 0, maximum: 7 },
          videosPerWeek: { type: "integer", minimum: 0, maximum: 7 },
          storiesPerWeek: { type: "integer", minimum: 0, maximum: 14 },
        },
        required: ["staticPerWeek", "videosPerWeek", "storiesPerWeek"],
        additionalProperties: false,
      },
    },
    input: z.object({ staticPerWeek: z.number().int().min(0).max(7), videosPerWeek: z.number().int().min(0).max(7), storiesPerWeek: z.number().int().min(0).max(14) }),
    async run(input, ctx) {
      ctx.emitCard({ type: "weekly_mix", ...input });
      return { shown_to_owner: true, note: "The owner adjusts and answers in the chat." };
    },
  },
  {
    tool: {
      name: "draft_strategy",
      description: "Show a strategy draft (name, objective, duration, posts per week, 1 to 4 pillars, each with a goal) as a card. Call it once you know the goal, the duration and the posts per week. The owner saves it with a tap or asks you to refine (call it again with the changes). Counts toward the daily limit.",
      input_schema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Short, memorable, specific to the business, e.g. 'Taste the Tradition'" },
          objective: { type: "string", description: "Measurable when the owner gave a number; never invent the number" },
          durationWeeks: { type: "integer", minimum: 1, maximum: 26 },
          staticPerWeek: { type: "integer", minimum: 0, maximum: 7 },
          videosPerWeek: { type: "integer", minimum: 0, maximum: 7 },
          storiesPerWeek: { type: "integer", minimum: 0, maximum: 14 },
          pillars: {
            type: "array",
            minItems: 1,
            maxItems: 4,
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                baseType: { type: "string", enum: ["attract", "educate", "trust", "sell", "community", "entertain", "custom"] },
                description: { type: "string", description: "What posts in this pillar show, specific to the business" },
                goal: { type: "string", description: "What this pillar should achieve, e.g. 'New followers'; no invented numbers" },
              },
              required: ["name", "baseType", "description", "goal"],
              additionalProperties: false,
            },
          },
        },
        required: ["name", "objective", "durationWeeks", "staticPerWeek", "videosPerWeek", "storiesPerWeek", "pillars"],
        additionalProperties: false,
      },
    },
    input: z.object({
      name: z.string().min(1).max(80), objective: z.string().min(1).max(300), durationWeeks: z.number().int().min(1).max(26),
      staticPerWeek: z.number().int().min(0).max(7), videosPerWeek: z.number().int().min(0).max(7), storiesPerWeek: z.number().int().min(0).max(14),
      pillars: z.array(pillarSchema).min(1).max(4),
    }),
    async run(input, ctx) {
      return heavy(ctx, async () => {
        const s = await createDraftStrategy(ctx.userId, ctx.conversationId, input);
        ctx.emitCard({ type: "strategy", strategyId: s.id });
        return { strategyId: s.id, shown_to_owner: true, note: "Card shown with Save strategy and Refine. Not saved until the owner taps Save." };
      });
    },
  },
  {
    tool: {
      name: "get_planning_context",
      description: "Before planning a week: the dates of this or next week, the best time to post (from the owner's last posts), posts already scheduled that week and the active strategy with its pillars and posts per week.",
      input_schema: { type: "object", properties: { week: { type: "string", enum: ["this", "next"] } }, required: ["week"], additionalProperties: false },
    },
    input: z.object({ week: z.enum(["this", "next"]) }),
    async run(input: { week: "this" | "next" }, ctx) {
      return planningContext(ctx.userId, ctx.timezone, weekStartFor(input.week, ctx.timezone));
    },
  },
  {
    tool: {
      name: "draft_week",
      description: "Show a week plan as a card: one line per post (day, time, format, pillar, title). Follow the strategy's posts per week (static = feed or carousel, videos = reel, stories = story); say so if you add more. Use the best time unless there's a reason not to. Full details (caption, hashtags, what to produce) are written in the background after you call this. Counts toward the daily limit.",
      input_schema: {
        type: "object",
        properties: {
          week: { type: "string", enum: ["this", "next"] },
          strategyId: { type: "string", description: "The strategy this week follows, if any" },
          posts: {
            type: "array",
            minItems: 1,
            maxItems: 21,
            items: {
              type: "object",
              properties: {
                day: { type: "string", enum: [...DAYS] },
                time: { type: "string", description: "HH:MM, 24 h, owner's timezone" },
                format: { type: "string", enum: [...FORMATS] },
                pillar: { type: "string", description: "Pillar name from the strategy" },
                title: { type: "string", description: "Concrete, specific to the business, under 70 characters" },
                hook: { type: "string", description: "The first line or first second of the post" },
              },
              required: ["day", "time", "format", "title"],
              additionalProperties: false,
            },
          },
        },
        required: ["week", "posts"],
        additionalProperties: false,
      },
    },
    input: z.object({
      week: z.enum(["this", "next"]),
      strategyId: z.string().uuid().optional(),
      posts: z.array(z.object({ day: dayEnum, time: timeSchema, format: formatEnum, pillar: z.string().max(40).optional(), title: z.string().min(1).max(120), hook: z.string().max(300).optional() })).min(1).max(21),
    }),
    async run(input, ctx) {
      if (input.strategyId && !(await getStrategy(ctx.userId, input.strategyId))) return { error: "Strategy not found." };
      return heavy(ctx, async () => {
        const weekStart = weekStartFor(input.week, ctx.timezone);
        const week = await createDraftWeek(ctx.userId, ctx.timezone, ctx.conversationId, { weekStart, strategyId: input.strategyId ?? null, posts: input.posts });
        ctx.emitCard({ type: "week", weekId: week.id });
        return {
          weekId: week.id,
          posts: week.posts.map((p) => ({ postId: p.id, title: p.title, format: p.format })),
          note: "Card shown with Save week and Refine. Details are being written now. Not saved until the owner taps Save.",
        };
      });
    },
  },
  {
    tool: {
      name: "revise_week_post",
      description: "Change one post of a week the owner is reviewing (or already saved): day, time, format, pillar, title or hook. The card updates and new details are written if the content changed. Counts toward the daily limit.",
      input_schema: {
        type: "object",
        properties: {
          postId: { type: "string" },
          day: { type: "string", enum: [...DAYS] },
          time: { type: "string", description: "HH:MM, 24 h" },
          format: { type: "string", enum: [...FORMATS] },
          pillar: { type: "string" },
          title: { type: "string" },
          hook: { type: "string" },
        },
        required: ["postId"],
        additionalProperties: false,
      },
    },
    input: z.object({ postId: z.string().uuid(), day: dayEnum.optional(), time: timeSchema.optional(), format: formatEnum.optional(), pillar: z.string().max(40).optional(), title: z.string().max(120).optional(), hook: z.string().max(300).optional() }),
    async run(input, ctx) {
      return heavy(ctx, async () => {
        const { postId, ...changes } = input;
        const post = await revisePost(ctx.userId, ctx.timezone, postId, changes);
        if (!post) throw new PlanInputError("Post not found.");
        ctx.emitCard({ type: "week", weekId: post.weekId });
        return { updated: true, postId };
      });
    },
  },
  {
    tool: {
      name: "propose_save_week",
      description: "Open the 'Save week' sheet for the owner (reorder, change days, email reminders). Use when the owner says the week looks good.",
      input_schema: { type: "object", properties: { weekId: { type: "string" } }, required: ["weekId"], additionalProperties: false },
    },
    input: z.object({ weekId: z.string().uuid() }),
    async run(input: { weekId: string }, ctx) {
      const week = await db.week.findFirst({ where: { id: input.weekId, userId: ctx.userId } });
      if (!week) return { error: "Week not found." };
      ctx.emitCard({ type: "save_week", weekId: week.id });
      return { shown_to_owner: true };
    },
  },
];

export const DUKE_TOOLS: Anthropic.Tool[] = TOOLS.map((t) => t.tool);

export async function runTool(name: string, rawInput: unknown, ctx: ToolContext): Promise<{ content: string; isError: boolean; status: "ok" | "error" | "blocked" }> {
  const def = TOOLS.find((t) => t.tool.name === name);
  if (!def) return { content: JSON.stringify({ error: `Unknown tool ${name}` }), isError: true, status: "error" };
  const parsed = def.input.safeParse(rawInput ?? {});
  if (!parsed.success) return { content: JSON.stringify({ error: "Invalid input", issues: parsed.error.issues.slice(0, 3) }), isError: true, status: "error" };
  try {
    const out = await def.run(parsed.data, ctx);
    const blocked = typeof out === "object" && out !== null && (out as { blocked?: boolean }).blocked === true;
    return { content: JSON.stringify(out), isError: false, status: blocked ? "blocked" : "ok" };
  } catch (error) {
    if (error instanceof PlanInputError) return { content: JSON.stringify({ error: error.message }), isError: true, status: "error" };
    console.error(`[duke] tool ${name} failed`, error);
    return { content: JSON.stringify({ error: "The tool failed. Tell the owner you couldn't read it right now." }), isError: true, status: "error" };
  }
}
