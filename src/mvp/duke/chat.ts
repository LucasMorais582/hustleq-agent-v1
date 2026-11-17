import type Anthropic from "@anthropic-ai/sdk";
import { db } from "../db.js";
import { callClaude, streamClaude, textOf } from "../ai/client.js";
import { DUKE_INSTRUCTIONS } from "./instructions.js";
import { RepliesFilter } from "./replies.js";
import { DUKE_TOOLS, runTool } from "./tools.js";
import { campaignSuggestion } from "../campaigns/service.js";
import { activeStrategy } from "../plan/service.js";
import { cachedInstagram } from "../instagram/own.js";
import { bestTime, timeLabel, weekStartFor } from "../plan/timing.js";

// One owner message → Duke's answer, as an agent loop:
// Claude answers with text and/or tool calls; the backend runs the tools and loops until Claude is done.
// Text streams to the app as it is written. Nothing is saved unless the whole turn succeeds, so a
// failure loses nothing and "Try again" sends the same message again.

const MAX_STEPS = 6;
// A turn fails when nothing happens for this long (no text, no tool finishing), not after a fixed total.
export const STALL_TIMEOUT_MS = 40_000;

export type TurnEvents = {
  text: (delta: string) => void;
  status?: (label: string) => void;
  card: (card: Record<string, unknown>) => void;
  replies: (options: string[]) => void;
};

type StoredContent = Anthropic.ContentBlockParam[] | Anthropic.ContentBlock[];

async function contextBlock(userId: string, user: { timezone: string; instagramHandle: string | null }, businessName: string | null) {
  const tz = user.timezone;
  const today = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(new Date());
  // What planning needs, given up front so Duke can draft a week in one step.
  const [strategy, bundle, weeks] = await Promise.all([
    activeStrategy(userId, tz),
    user.instagramHandle ? cachedInstagram(user.instagramHandle) : null,
    db.week.findMany({ where: { userId }, orderBy: { updatedAt: "desc" }, take: 3, select: { id: true, startsOn: true, status: true } }),
  ]);
  const [campaigns, suggestion] = await Promise.all([
    db.campaign.findMany({ where: { userId, status: "saved", endsOn: { gte: new Date() } }, orderBy: { startsOn: "asc" }, take: 5, select: { id: true, name: true, startsOn: true, endsOn: true } }),
    campaignSuggestion(userId, tz),
  ]);
  const best = bestTime(bundle?.posts ?? [], tz);
  const lines = [
    `Today is ${today} (${tz}). This week starts ${weekStartFor("this", tz)}, next week starts ${weekStartFor("next", tz)} (Mondays).`,
    `Business: ${businessName ?? "unknown"}${user.instagramHandle ? ` · Instagram @${user.instagramHandle}` : ""}.`,
    `Best time to post: ${timeLabel(best.time)} (${best.time})${best.fromData ? ", from the engagement of their last posts" : ", a default: not enough posts to know yet"}.`,
    strategy
      ? `Active strategy: "${strategy.name}" (id ${strategy.id}), week ${strategy.weekNumber} of ${strategy.durationWeeks}. Each week: ${strategy.staticPerWeek} static (feed or carousel), ${strategy.videosPerWeek} videos (reel), ${strategy.storiesPerWeek} stories. Pillars: ${strategy.pillars.map((p) => `${p.name} (${p.description ?? ""})`).join("; ")}.`
      : "No active strategy.",
    weeks.length
      ? `Latest weeks: ${weeks.map((w) => `week starting ${w.startsOn.toISOString().slice(0, 10)} (id ${w.id}, ${w.status === "saved" ? "saved" : "draft, not saved"})`).join("; ")}.`
      : "No weeks planned yet.",
    campaigns.length
      ? `Saved campaigns: ${campaigns.map((c) => `"${c.name}" (id ${c.id}, ${c.startsOn.toISOString().slice(0, 10)} to ${c.endsOn.toISOString().slice(0, 10)})`).join("; ")}.`
      : "No saved campaigns.",
    suggestion ? `Coming up: ${suggestion.name} on ${suggestion.date} (dateId ${suggestion.dateId}), no campaign yet. Bring it up once if it fits the conversation.` : "",
    // Remove lines from here as the features ship.
    "In this version you can: read and update the Business Profile, read the Instagram numbers, create strategies, plan weeks (draft, refine, save), list what to film for a saved week and export it (share link, PDF, CSV). The Home shows today, this week and campaign suggestions; the Calendar shows day, week and month, and posts move there. On each post's page (tap the post) the owner edits date, time, type, caption and hashtags, uploads photos or video, and taps \"Validate with Duke\" (30 a month) to have you check them. Campaigns for commercial dates and notes work too. Explore, Analytics and the monthly review are coming soon: if asked, say so and offer what you can do now.",
  ];
  return lines.filter(Boolean).join("\n");
}

const STATUS: Record<string, string> = {
  get_business_profile: "Reading your Business Profile…",
  get_instagram_summary: "Reading your Instagram…",
  list_strategies: "Looking at your strategies…",
  draft_strategy: "Building your strategy…",
  get_planning_context: "Checking your week…",
  draft_week: "Planning your week…",
  revise_week_post: "Changing the post…",
  build_shot_list: "Listing what to film…",
  open_export: "Opening export…",
  draft_post: "Writing the post…",
  draft_campaign: "Planning your campaign…",
  save_note: "Saving the note…",
  search_notes: "Reading your notes…",
};

// Earlier turns go back without thinking blocks: the system context can change between turns
// (date, profile), and old thinking would then be rejected. The current turn keeps them.
function withoutThinking(content: StoredContent): Anthropic.ContentBlockParam[] {
  return (content as Anthropic.ContentBlockParam[]).filter((b) => b.type !== "thinking" && b.type !== "redacted_thinking");
}

export async function runDukeTurn(userId: string, conversationId: string, userText: string, on: TurnEvents, signal?: AbortSignal) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, include: { business: true } });
  const history = await db.message.findMany({ where: { conversationId }, orderBy: { createdAt: "asc" }, select: { role: true, content: true } });

  const messages: Anthropic.MessageParam[] = history.map((m) => ({
    role: m.role as "user" | "assistant",
    content: withoutThinking(m.content as unknown as StoredContent),
  }));
  // Some conversations open with Duke (onboarding, "New conversation"); the API needs a user turn first.
  if (messages[0]?.role === "assistant") messages.unshift({ role: "user", content: "(The owner opened this conversation.)" });
  messages.push({ role: "user", content: userText });

  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: DUKE_INSTRUCTIONS, cache_control: { type: "ephemeral" } },
    { type: "text", text: await contextBlock(userId, user, user.business?.businessName ?? null) },
  ];

  const rows: { role: "user" | "assistant"; content: unknown; display: Record<string, unknown> | null }[] = [];
  const toolLog: { name: string; input: unknown; output: string; status: string; durationMs: number }[] = [];
  let replies: string[] = [];

  for (let step = 0; step < MAX_STEPS; step++) {
    const filter = new RepliesFilter();
    const cards: Record<string, unknown>[] = [];
    // Each model call gets its own stall timer, reset by every piece of text that arrives.
    const step_ = new AbortController();
    let timer = setTimeout(() => step_.abort(), STALL_TIMEOUT_MS);
    const onOuterAbort = () => step_.abort();
    signal?.addEventListener("abort", onOuterAbort);
    let message: Anthropic.Message;
    try {
      message = await streamClaude(
        { role: "duke", feature: "chat", userId, effort: "low" },
        { max_tokens: 16000, system, tools: DUKE_TOOLS, messages },
        (delta) => {
          clearTimeout(timer);
          timer = setTimeout(() => step_.abort(), STALL_TIMEOUT_MS);
          const out = filter.push(delta);
          if (out) on.text(out);
        },
        step_.signal
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onOuterAbort);
    }
    const { rest, replies: found } = filter.finish();
    if (rest) on.text(rest);
    if (found.length) replies = found;

    if (message.stop_reason === "refusal") {
      const text = "I can’t help with that one. I can help with your Instagram: ideas, posts and your profile.";
      on.text(text);
      rows.push({ role: "assistant", content: [{ type: "text", text }], display: { text } });
      break;
    }

    messages.push({ role: "assistant", content: message.content });
    const assistantRow = { role: "assistant" as const, content: message.content, display: { text: filter.shown.trim(), cards } as Record<string, unknown> };
    rows.push(assistantRow);

    const toolUses = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (message.stop_reason !== "tool_use" || toolUses.length === 0) break;

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const use of toolUses) {
      const started = Date.now();
      on.status?.(STATUS[use.name] ?? "Working on it…");
      const result = await runTool(use.name, use.input, {
        userId,
        conversationId,
        timezone: user.timezone,
        emitCard: (card) => {
          cards.push(card);
          on.card(card);
        },
      });
      toolLog.push({ name: use.name, input: use.input, output: result.content, status: result.status, durationMs: Date.now() - started });
      results.push({ type: "tool_result", tool_use_id: use.id, content: result.content, ...(result.isError ? { is_error: true } : {}) });
    }
    messages.push({ role: "user", content: results });
    rows.push({ role: "user", content: results, display: null });
  }

  if (replies.length) on.replies(replies);
  const lastAssistant = [...rows].reverse().find((r) => r.role === "assistant");
  if (lastAssistant?.display) lastAssistant.display.replies = replies.length ? { options: replies } : undefined;

  // Save the whole turn at once.
  const conversation = await db.conversation.findUniqueOrThrow({ where: { id: conversationId } });
  // Explicit, increasing timestamps keep the order of the turn's messages exact.
  const base = Date.now();
  let tick = 0;
  const at = () => new Date(base + tick++);
  await db.$transaction(async (tx) => {
    await tx.message.create({ data: { conversationId, role: "user", content: [{ type: "text", text: userText }], display: { text: userText }, createdAt: at() } });
    for (const r of rows) {
      await tx.message.create({ data: { conversationId, role: r.role, content: r.content as object, createdAt: at(), ...(r.display ? { display: r.display as object } : {}) } });
    }
    for (const t of toolLog) {
      await tx.toolCall.create({ data: { conversationId, name: t.name, input: t.input as object, output: JSON.parse(t.output), status: t.status, durationMs: t.durationMs } });
    }
    await tx.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
  });

  if (!conversation.title) nameConversation(userId, conversationId, userText).catch(() => {});
}

// "Black Friday campaign", "Week of Nov 16": a short title from the first message (Haiku).
async function nameConversation(userId: string, conversationId: string, firstMessage: string) {
  const msg = await callClaude(
    { role: "light", feature: "conversation_title", userId, effort: "low" },
    {
      max_tokens: 2000,
      system: "Write a title of 2 to 5 words for a conversation that starts with the message below. Title case, no quotes, no punctuation at the end. Reply with the title only.",
      messages: [{ role: "user", content: firstMessage.slice(0, 800) }],
    }
  );
  const title = textOf(msg).trim().replace(/^["']|["']$/g, "").slice(0, 60);
  if (title) await db.conversation.update({ where: { id: conversationId }, data: { title } });
}
