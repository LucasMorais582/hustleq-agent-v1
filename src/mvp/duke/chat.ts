import type Anthropic from "@anthropic-ai/sdk";
import { db } from "../db.js";
import { callClaude, streamClaude, textOf } from "../ai/client.js";
import { DUKE_INSTRUCTIONS } from "./instructions.js";
import { RepliesFilter } from "./replies.js";
import { DUKE_TOOLS, runTool } from "./tools.js";

// One owner message → Duke's answer, as an agent loop:
// Claude answers with text and/or tool calls; the backend runs the tools and loops until Claude is done.
// Text streams to the app as it is written. Nothing is saved unless the whole turn succeeds, so a
// failure loses nothing and "Try again" sends the same message again.

const MAX_STEPS = 6;
export const TURN_TIMEOUT_MS = 45_000;

export type TurnEvents = {
  text: (delta: string) => void;
  card: (card: Record<string, unknown>) => void;
  replies: (options: string[]) => void;
};

type StoredContent = Anthropic.ContentBlockParam[] | Anthropic.ContentBlock[];

function contextBlock(user: { timezone: string; instagramHandle: string | null }, businessName: string | null) {
  const today = new Intl.DateTimeFormat("en-US", { timeZone: user.timezone, weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(new Date());
  return [
    `Today is ${today} (${user.timezone}).`,
    `Business: ${businessName ?? "unknown"}${user.instagramHandle ? ` · Instagram @${user.instagramHandle}` : ""}.`,
    // Remove lines from here as the features ship.
    "In this test version you can read and update the Business Profile and read the Instagram numbers. Strategies, weekly plans, campaigns, notes and Explore are coming soon: if asked, say they're coming soon and offer what you can do now.",
  ].join("\n");
}

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
  messages.push({ role: "user", content: userText });

  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: DUKE_INSTRUCTIONS, cache_control: { type: "ephemeral" } },
    { type: "text", text: contextBlock(user, user.business?.businessName ?? null) },
  ];

  const rows: { role: "user" | "assistant"; content: unknown; display: Record<string, unknown> | null }[] = [];
  const toolLog: { name: string; input: unknown; output: string; status: string; durationMs: number }[] = [];
  let replies: string[] = [];

  for (let step = 0; step < MAX_STEPS; step++) {
    const filter = new RepliesFilter();
    const cards: Record<string, unknown>[] = [];
    const message = await streamClaude(
      { role: "duke", feature: "chat", userId, effort: "medium" },
      { max_tokens: 16000, system, tools: DUKE_TOOLS, messages },
      (delta) => {
        const out = filter.push(delta);
        if (out) on.text(out);
      },
      signal
    );
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
      const result = await runTool(use.name, use.input, {
        userId,
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
