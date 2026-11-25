import { Router } from "express";
import { requireActivePlan } from "../billing/service.js";
import { z } from "zod";
import { emptyDayOpening } from "../home/service.js";
import { campaignOpening, noteOpening } from "./openings.js";
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
  const campaigns = await db.campaign.findMany({ where: { id: { in: convs.filter((c) => c.objectType === "campaign").map((c) => c.objectId!) } }, select: { id: true, name: true } });
  const weeks = await db.week.findMany({ where: { id: { in: convs.filter((c) => c.objectType === "week").map((c) => c.objectId!) } }, select: { id: true, startsOn: true } });
  const day = (d: Date) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(d);
  const items = convs.map((c) => {
    const last = lasts.find((l) => l.conversationId === c.id);
    const text = (last?.display as { text?: string } | null)?.text ?? "";
    let linked: string | null = null;
    if (c.objectType === "onboarding") linked = "Business Profile";
    if (c.objectType === "reminders") linked = "Your post-day reminders";
    if (c.objectType === "review") linked = "Monthly review";
    if (c.objectType === "strategy") linked = `Strategy · ${strategies.find((s) => s.id === c.objectId)?.title ?? ""}`;
    if (c.objectType === "campaign") linked = `Campaign · ${campaigns.find((x) => x.id === c.objectId)?.name ?? ""}`;
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
  const body = z.object({
    title: z.string().trim().max(120).optional(),
    emptyDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    campaignFor: z.string().min(1).max(60).optional(),
    fromNote: z.string().uuid().optional(),
    bare: z.boolean().optional(), // floating Duke: no opening message, the owner writes first
  }).parse(req.body ?? {});
  // Duke opens with the context the owner came from: an empty day (10.4), a commercial date (7.1) or a note (8.5).
  const opening = body.emptyDay ? await emptyDayOpening(me.id, body.emptyDay)
    : body.campaignFor ? await campaignOpening(me.id, me.timezone, body.campaignFor)
    : body.fromNote ? await noteOpening(me.id, me.timezone, body.fromNote)
    : null;
  const conv = await db.conversation.create({ data: { userId: me.id, title: body.title ?? opening?.title ?? null } });
  if (body.bare) { res.status(201).json(conv); return; }
  // 4.0b: Duke opens the conversation.
  const text = opening?.text ?? "New conversation. What do you want to work on?";
  const display = opening ? { text, card: opening.card, replies: opening.replies } : { text, replies: { options: ["Plan next week", "A post idea", "A campaign", "Ask a question"] } };
  const content = opening ? `(App note, not shown to the owner: ${opening.note})\n${text}` : text;
  await db.message.create({ data: { conversationId: conv.id, role: "assistant", content: [{ type: "text", text: content }], display } });
  res.status(201).json(conv);
});

// Floating Duke: the chat a screen came from (the post's week, campaign or chat; the campaign's;
// the strategy's). Screens with no chat get a title for a new one, created on the first message.
const SCREEN_NAME: Record<string, string> = {
  home: "Home", calendar: "Calendar", post: "Post", campaign: "Campaign", campaigns: "Campaigns", strategy: "Strategy", strategies: "Strategies",
  note: "Note", notes: "Notes", week: "Week", dates: "Commercial dates", settings: "Settings", more: "More", explore: "Explore", analytics: "Analytics",
};

router.get("/origin", async (req, res) => {
  const me = currentUser(req);
  const q = z.object({ screen: z.string().max(30), id: z.string().uuid().optional() }).parse(req.query);
  let conversationId: string | null = null;
  if (q.id) {
    if (q.screen === "post") {
      const p = await db.post.findFirst({ where: { id: q.id, userId: me.id }, select: { conversationId: true, week: { select: { conversationId: true } }, campaign: { select: { conversationId: true } } } });
      conversationId = p?.conversationId ?? p?.campaign?.conversationId ?? p?.week?.conversationId ?? null;
    } else if (q.screen === "campaign") {
      conversationId = (await db.campaign.findFirst({ where: { id: q.id, userId: me.id }, select: { conversationId: true } }))?.conversationId ?? null;
    } else if (q.screen === "strategy") {
      conversationId = (await db.strategy.findFirst({ where: { id: q.id, userId: me.id }, select: { conversationId: true } }))?.conversationId ?? null;
    } else if (q.screen === "week") {
      conversationId = (await db.week.findFirst({ where: { id: q.id, userId: me.id }, select: { conversationId: true } }))?.conversationId ?? null;
    }
  }
  // The chat may have been deleted since.
  if (conversationId && !(await db.conversation.findFirst({ where: { id: conversationId, userId: me.id }, select: { id: true } }))) conversationId = null;
  const day = new Intl.DateTimeFormat("en-US", { timeZone: me.timezone, month: "short", day: "numeric", year: "numeric" }).format(new Date());
  res.json({ conversationId, title: `From ${SCREEN_NAME[q.screen] ?? "HustleQ"} - ${day}` });
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

router.post("/:id/messages", requireActivePlan, async (req, res) => {
  const me = currentUser(req);
  const { id } = idParam.parse(req.params);
  const { text, screen } = z.object({
    text: z.string().trim().min(1).max(4000),
    screen: z.object({ screen: z.string().max(30), id: z.string().max(60).optional(), label: z.string().max(120).optional() }).optional(),
  }).parse(req.body);
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
    }, controller.signal, screen);
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
