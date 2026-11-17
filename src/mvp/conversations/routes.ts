import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { Prisma } from "../../generated/mvp/index.js";
import { AppError, notFound } from "../http/errors.js";
import { currentUser, requireUser } from "../auth/middleware.js";
import { runDukeTurn } from "../duke/chat.js";

// Phase 0: list, create, read, delete, pin. Every query is scoped to the logged-in user;
// someone else's id answers 404, never 403, so ids can't be probed.
const router = Router();
router.use(requireUser);

const idParam = z.object({ id: z.string().uuid() });

async function ownConversation(userId: string, id: string) {
  const conv = await db.conversation.findFirst({ where: { id, userId } });
  if (!conv) throw notFound("Conversation not found.");
  return conv;
}

// 4.0: pinned first, then recent; each with the last message and the object it's tied to.
router.get("/", async (req, res) => {
  const me = currentUser(req);
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 80) : "";
  const convs = await db.conversation.findMany({
    where: { userId: me.id, ...(q ? { title: { contains: q, mode: "insensitive" as const } } : {}) },
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    take: 100,
    select: { id: true, title: true, pinned: true, objectType: true, objectId: true, updatedAt: true },
  });
  const ids = convs.map((c) => c.id);
  const lasts = ids.length
    ? await db.message.findMany({ where: { conversationId: { in: ids }, NOT: { display: { equals: Prisma.DbNull } } }, orderBy: { createdAt: "desc" }, distinct: ["conversationId"], select: { conversationId: true, role: true, display: true } })
    : [];
  const strategies = await db.strategy.findMany({ where: { id: { in: convs.filter((c) => c.objectType === "strategy").map((c) => c.objectId!) } }, select: { id: true, title: true } });
  const weeks = await db.week.findMany({ where: { id: { in: convs.filter((c) => c.objectType === "week").map((c) => c.objectId!) } }, select: { id: true, startsOn: true } });
  const day = (d: Date) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(d);
  const items = convs.map((c) => {
    const last = lasts.find((l) => l.conversationId === c.id);
    const text = (last?.display as { text?: string } | null)?.text ?? "";
    let linked: string | null = null;
    if (c.objectType === "onboarding") linked = "Business Profile";
    if (c.objectType === "strategy") linked = `Strategy · ${strategies.find((s) => s.id === c.objectId)?.title ?? ""}`;
    if (c.objectType === "week") {
      const w = weeks.find((x) => x.id === c.objectId);
      if (w) linked = `Week · ${day(w.startsOn)} to ${day(new Date(w.startsOn.getTime() + 6 * 864e5))}`;
    }
    return { ...c, lastMessage: text ? `${last!.role === "user" ? "You" : "Duke"}: ${text.replace(/\s+/g, " ").slice(0, 90)}` : null, linked };
  });
  res.json({ items });
});

router.post("/", async (req, res) => {
  const me = currentUser(req);
  const body = z.object({ title: z.string().trim().max(120).optional() }).parse(req.body ?? {});
  const conv = await db.conversation.create({ data: { userId: me.id, title: body.title ?? null } });
  // 4.0b: Duke opens the conversation.
  const text = "New conversation. What do you want to work on?";
  await db.message.create({
    data: { conversationId: conv.id, role: "assistant", content: [{ type: "text", text }], display: { text, replies: { options: ["Plan next week", "A post idea", "A campaign", "Ask a question"] } } },
  });
  res.status(201).json(conv);
});

router.get("/:id", async (req, res) => {
  const me = currentUser(req);
  const { id } = idParam.parse(req.params);
  const conv = await ownConversation(me.id, id);
  const messages = await db.message.findMany({
    where: { conversationId: conv.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, role: true, display: true, createdAt: true },
  });
  // Tool results have no display: the app never shows them.
  res.json({ ...conv, messages: messages.filter((m) => m.display !== null) });
});

router.patch("/:id", async (req, res) => {
  const me = currentUser(req);
  const { id } = idParam.parse(req.params);
  const body = z.object({ pinned: z.boolean().optional(), title: z.string().trim().max(120).optional() }).parse(req.body);
  await ownConversation(me.id, id);
  const data: { pinned?: boolean; title?: string } = {};
  if (body.pinned !== undefined) data.pinned = body.pinned;
  if (body.title !== undefined) data.title = body.title;
  res.json(await db.conversation.update({ where: { id }, data }));
});

router.delete("/:id", async (req, res) => {
  const me = currentUser(req);
  const { id } = idParam.parse(req.params);
  await ownConversation(me.id, id);
  await db.conversation.delete({ where: { id } });
  res.status(204).end();
});

// Send a message to Duke. The answer streams back as server-sent events:
// text {delta} · card {card} · replies {options} · done · error {code, message}.
const activeTurns = new Set<string>();

router.post("/:id/messages", async (req, res) => {
  const me = currentUser(req);
  const { id } = idParam.parse(req.params);
  const { text } = z.object({ text: z.string().trim().min(1).max(4000) }).parse(req.body);
  await ownConversation(me.id, id);
  if (activeTurns.has(id)) throw new AppError(409, "busy", "Duke is still answering the last message.");

  res.status(200).set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.flushHeaders();
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  // Stalls are handled per model call inside the turn; this only stops work when the app goes away.
  const controller = new AbortController();
  res.on("close", () => { if (!res.writableEnded) controller.abort(); });
  activeTurns.add(id);
  try {
    await runDukeTurn(me.id, id, text, {
      text: (delta) => send("text", { delta }),
      status: (label) => send("status", { label }),
      card: (card) => send("card", { card }),
      replies: (options) => send("replies", { options }),
    }, controller.signal);
    send("done", {});
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "AbortError" || /abort/i.test(error.message));
    if (!timedOut) console.error("[duke] turn failed", error);
    send("error", { code: timedOut ? "timeout" : "duke_failed", message: "I couldn’t finish that. Nothing was lost.", time: new Date().toISOString() });
  } finally {
    activeTurns.delete(id);
    res.end();
  }
});

export default router;
