import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { AppError, notFound } from "../http/errors.js";
import { currentUser, requireUser } from "../auth/middleware.js";
import { runDukeTurn, TURN_TIMEOUT_MS } from "../duke/chat.js";

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

router.get("/", async (req, res) => {
  const me = currentUser(req);
  const items = await db.conversation.findMany({
    where: { userId: me.id },
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    select: { id: true, title: true, pinned: true, objectType: true, objectId: true, updatedAt: true },
  });
  res.json({ items });
});

router.post("/", async (req, res) => {
  const me = currentUser(req);
  const body = z.object({ title: z.string().trim().max(120).optional() }).parse(req.body ?? {});
  const conv = await db.conversation.create({ data: { userId: me.id, title: body.title ?? null } });
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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TURN_TIMEOUT_MS);
  res.on("close", () => { if (!res.writableEnded) controller.abort(); });
  activeTurns.add(id);
  try {
    await runDukeTurn(me.id, id, text, {
      text: (delta) => send("text", { delta }),
      card: (card) => send("card", { card }),
      replies: (options) => send("replies", { options }),
    }, controller.signal);
    send("done", {});
  } catch (error) {
    const timedOut = controller.signal.aborted;
    if (!timedOut) console.error("[duke] turn failed", error);
    send("error", { code: timedOut ? "timeout" : "duke_failed", message: "I couldn’t finish that. Nothing was lost.", time: new Date().toISOString() });
  } finally {
    clearTimeout(timer);
    activeTurns.delete(id);
    res.end();
  }
});

export default router;
