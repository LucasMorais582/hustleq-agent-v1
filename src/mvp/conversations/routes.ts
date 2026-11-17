import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { notFound } from "../http/errors.js";
import { currentUser, requireUser } from "../auth/middleware.js";

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
  res.json({ ...conv, messages });
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

export default router;
