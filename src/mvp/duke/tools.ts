import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { db } from "../db.js";
import { FIELD_KEYS, fieldLabel, PROFILE_FIELDS, profileValues, type ProfileField } from "../business/fields.js";
import { cachedInstagram, formatStats, syncInstagram } from "../instagram/own.js";

// Duke's tools. Order and wording are part of the cached prefix: keep them stable.
// Tools read, or propose; nothing that changes data runs without the owner's tap.

export type ToolContext = { userId: string; emitCard: (card: Record<string, unknown>) => void };

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
];

export const DUKE_TOOLS: Anthropic.Tool[] = TOOLS.map((t) => t.tool);

export async function runTool(name: string, rawInput: unknown, ctx: ToolContext): Promise<{ content: string; isError: boolean; status: "ok" | "error" }> {
  const def = TOOLS.find((t) => t.tool.name === name);
  if (!def) return { content: JSON.stringify({ error: `Unknown tool ${name}` }), isError: true, status: "error" };
  const parsed = def.input.safeParse(rawInput ?? {});
  if (!parsed.success) return { content: JSON.stringify({ error: "Invalid input", issues: parsed.error.issues.slice(0, 3) }), isError: true, status: "error" };
  try {
    const out = await def.run(parsed.data, ctx);
    return { content: JSON.stringify(out), isError: false, status: "ok" };
  } catch (error) {
    console.error(`[duke] tool ${name} failed`, error);
    return { content: JSON.stringify({ error: "The tool failed. Tell the owner you couldn't read it right now." }), isError: true, status: "error" };
  }
}
