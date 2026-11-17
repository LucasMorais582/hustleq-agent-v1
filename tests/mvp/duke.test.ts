import request from "supertest";
import { afterAll, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";

// A scripted Claude: first it calls tools, then it answers with quick replies.
const script = vi.hoisted(() => ({ turns: [] as Anthropic.Message[], calls: [] as unknown[] }));
vi.mock("../../src/mvp/ai/client.js", () => ({
  streamClaude: vi.fn(async (_meta: unknown, params: unknown, onText?: (d: string) => void) => {
    script.calls.push(JSON.parse(JSON.stringify(params)));
    const msg = script.turns.shift()!;
    for (const b of msg.content) if (b.type === "text" && onText) for (const piece of b.text.match(/.{1,7}/gs) ?? []) onText(piece);
    return msg;
  }),
  callClaude: vi.fn(async () => ({ content: [{ type: "text", text: "Profile Questions" }] })),
  textOf: (m: Anthropic.Message) => m.content.map((b) => (b.type === "text" ? b.text : "")).join(""),
}));

import { db } from "../../src/mvp/db.js";
import { RepliesFilter } from "../../src/mvp/duke/replies.js";
import { app, auth, makeUser } from "../helpers.js";

afterAll(() => db.$disconnect());

const msg = (content: Anthropic.ContentBlock[], stop: Anthropic.StopReason): Anthropic.Message =>
  ({ id: "m", type: "message", role: "assistant", model: "claude-sonnet-5-5", content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }) as unknown as Anthropic.Message;

function events(raw: string) {
  return raw.trim().split("\n\n").map((chunk) => {
    const [e, d] = chunk.split("\n");
    return { event: e!.slice(7), data: JSON.parse(d!.slice(6)) };
  });
}

describe("replies filter", () => {
  it("hides the tag even when it arrives in pieces", () => {
    const f = new RepliesFilter();
    let out = "";
    for (const p of ["Want a", " plan? <re", "plies>[\"Yes\", ", "\"Not now\"]</replies>"]) out += f.push(p);
    const end = f.finish();
    out += end.rest;
    expect(out).toBe("Want a plan? ");
    expect(end.replies).toEqual(["Yes", "Not now"]);
  });
  it("lets a normal '<' through", () => {
    const f = new RepliesFilter();
    const out = f.push("Under <5 posts") + f.finish().rest;
    expect(out).toBe("Under <5 posts");
  });
});

describe("Duke turn", () => {
  it("runs tools, streams text, shows a card and quick replies, and saves the turn in order", async () => {
    const u = await makeUser();
    await db.businessProfile.create({ data: { userId: u.user.id, businessName: "Bahia Taste", niche: "Food" } });
    const conv = await request(app).post("/v1/conversations").set(auth(u.token)).send({});

    script.turns = [
      msg([{ type: "tool_use", id: "t1", name: "get_business_profile", input: {} } as Anthropic.ToolUseBlock], "tool_use"),
      msg([
        { type: "text", text: "Your niche says Food. Brazilian food fits better." } as Anthropic.TextBlock,
        { type: "tool_use", id: "t2", name: "propose_profile_update", input: { field: "niche", value: "Brazilian food", reason: "Every post is Brazilian food." } } as Anthropic.ToolUseBlock,
      ], "tool_use"),
      msg([{ type: "text", text: "I sent the change for you to confirm. Anything else?\n<replies>[\"Plan next week\", \"A post idea\"]</replies>" } as Anthropic.TextBlock], "end_turn"),
    ];

    const res = await request(app).post(`/v1/conversations/${conv.body.id}/messages`).set(auth(u.token)).send({ text: "Is my profile right?" }).buffer(true).parse((r, cb) => { let d = ""; r.on("data", (c: Buffer) => (d += c)); r.on("end", () => cb(null, d)); });
    const ev = events(res.body as string);
    const streamed = ev.filter((e) => e.event === "text").map((e) => e.data.delta).join("");
    expect(streamed).not.toContain("<replies>");
    expect(streamed).toContain("I sent the change for you to confirm.");
    expect(ev.find((e) => e.event === "card")?.data.card).toMatchObject({ type: "profile_update", field: "niche", value: "Brazilian food", current: "Food" });
    expect(ev.find((e) => e.event === "replies")?.data.options).toEqual(["Plan next week", "A post idea"]);
    expect(ev.at(-1)?.event).toBe("done");

    // Nothing changed without the owner's tap.
    expect((await db.businessProfile.findUniqueOrThrow({ where: { userId: u.user.id } })).niche).toBe("Food");

    // The third call carried both tool results, in order.
    const third = script.calls.at(-1) as { messages: { role: string; content: unknown }[] };
    expect(third.messages.at(-1)?.role).toBe("user");

    const saved = await db.message.findMany({ where: { conversationId: conv.body.id }, orderBy: { createdAt: "asc" } });
    // The first row is Duke's opening question (4.0b).
    expect(saved.map((m) => m.role)).toEqual(["assistant", "user", "assistant", "user", "assistant", "user", "assistant"]);
    expect(await db.toolCall.count({ where: { conversationId: conv.body.id } })).toBe(2);

    const view = await request(app).get(`/v1/conversations/${conv.body.id}`).set(auth(u.token));
    expect(view.body.messages.at(-1).display.replies.options).toEqual(["Plan next week", "A post idea"]);
    expect(view.body.messages.every((m: { display: unknown }) => m.display)).toBe(true);
  });

  it("saves nothing when Duke fails, so Try again resends cleanly", async () => {
    const u = await makeUser();
    await db.businessProfile.create({ data: { userId: u.user.id, businessName: "X" } });
    const conv = await request(app).post("/v1/conversations").set(auth(u.token)).send({});
    script.turns = []; // streamClaude will throw on undefined
    const res = await request(app).post(`/v1/conversations/${conv.body.id}/messages`).set(auth(u.token)).send({ text: "hi" }).buffer(true).parse((r, cb) => { let d = ""; r.on("data", (c: Buffer) => (d += c)); r.on("end", () => cb(null, d)); });
    expect(events(res.body as string).at(-1)?.event).toBe("error");
    expect(await db.message.count({ where: { conversationId: conv.body.id } })).toBe(1); // only Duke's opening question
  });

  it("drops earlier thinking blocks from the history", async () => {
    const u = await makeUser();
    await db.businessProfile.create({ data: { userId: u.user.id, businessName: "X" } });
    const conv = await request(app).post("/v1/conversations").set(auth(u.token)).send({});
    await db.message.create({ data: { conversationId: conv.body.id, role: "user", content: [{ type: "text", text: "a" }], display: { text: "a" } } });
    await db.message.create({ data: { conversationId: conv.body.id, role: "assistant", content: [{ type: "thinking", thinking: "", signature: "s" }, { type: "text", text: "b" }], display: { text: "b" } } });
    script.turns = [msg([{ type: "text", text: "ok" } as Anthropic.TextBlock], "end_turn")];
    await request(app).post(`/v1/conversations/${conv.body.id}/messages`).set(auth(u.token)).send({ text: "c" });
    const sent = script.calls.at(-1) as { messages: { content: { type: string }[] | string }[] };
    expect(sent.messages[0]).toMatchObject({ role: "user" }); // the API needs a user turn first
    const types = sent.messages.flatMap((m) => (Array.isArray(m.content) ? m.content.map((b) => b.type) : ["text"]));
    expect(types).not.toContain("thinking");
  });
});
