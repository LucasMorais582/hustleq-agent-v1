import Anthropic from "@anthropic-ai/sdk";
import { db } from "../db.js";
import { costUsd, MODELS, type ModelRole } from "./models.js";

// Single entry point for Claude calls. Every call:
//  - uses the model for its role (models.ts),
//  - caches the stable prefix (system + tools) automatically,
//  - records tokens and cost per user and feature in AiUsage.
//
// Rules for Sonnet/Haiku/Opus 5.5 (see the claude-api notes):
//  - thinking is adaptive; never send budget_tokens or type "disabled" (400);
//  - no forced tool_choice (400 on Sonnet 5.5); steer with the prompt instead;
//  - send the history back append-only, with the assistant content blocks exactly as returned
//    (thinking blocks included), or preserved thinking breaks.

let client: Anthropic | null = null;
export const anthropic = () => (client ??= new Anthropic());

export type CallParams = Omit<Anthropic.MessageCreateParamsNonStreaming, "model" | "max_tokens" | "stream"> & {
  max_tokens?: number;
};

export type CallMeta = { role: ModelRole; feature: string; userId?: string | null; effort?: "low" | "medium" | "high" };

function buildBody(meta: CallMeta, params: CallParams) {
  return {
    model: MODELS[meta.role],
    max_tokens: params.max_tokens ?? 16000,
    cache_control: { type: "ephemeral" as const },
    thinking: { type: "adaptive" as const },
    output_config: { effort: meta.effort ?? "medium" },
    ...params,
  };
}

async function record(meta: CallMeta, model: string, usage: Anthropic.Usage, startedAt: number) {
  try {
    await db.aiUsage.create({
      data: {
        userId: meta.userId ?? null,
        feature: meta.feature,
        model,
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        cacheReadTokens: usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
        costUsd: costUsd(model, usage).toFixed(6),
        durationMs: Date.now() - startedAt,
      },
    });
  } catch (error) {
    // Logging cost must never break the user's request.
    console.error("[ai] could not record usage", error);
  }
}

export async function callClaude(meta: CallMeta, params: CallParams) {
  const startedAt = Date.now();
  const message = await anthropic().messages.create(buildBody(meta, params));
  await record(meta, message.model, message.usage, startedAt);
  return message;
}

// Streaming version: pass onText to forward text as it arrives; resolves with the final message.
export async function streamClaude(meta: CallMeta, params: CallParams, onText?: (delta: string) => void, signal?: AbortSignal) {
  const startedAt = Date.now();
  const stream = anthropic().messages.stream(buildBody(meta, params), signal ? { signal } : undefined);
  if (onText) stream.on("text", onText);
  const message = await stream.finalMessage();
  await record(meta, message.model, message.usage, startedAt);
  return message;
}

// Structured output: the model's answer is parsed against `format` (zodOutputFormat).
export async function parseClaude<T>(
  meta: CallMeta,
  params: CallParams,
  format: { type: "json_schema"; schema: Record<string, unknown>; parse(content: string): T }
) {
  const startedAt = Date.now();
  const body = buildBody(meta, params);
  const message = await anthropic().messages.parse({ ...body, output_config: { ...body.output_config, format } } as never);
  await record(meta, message.model, message.usage, startedAt);
  if (message.stop_reason === "refusal" || message.stop_reason === "max_tokens") {
    throw new Error(`Claude stopped: ${message.stop_reason}`);
  }
  const parsed = (message as unknown as { parsed_output: T | null }).parsed_output;
  if (parsed == null) throw new Error("Claude returned no parseable output");
  return parsed;
}

export const textOf = (message: Anthropic.Message) =>
  message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
