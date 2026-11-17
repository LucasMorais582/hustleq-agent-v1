import { Router } from "express";
import { z } from "zod";
import { currentUser, requireUser } from "../auth/middleware.js";
import { db } from "../db.js";
import { cachedInstagram } from "../instagram/own.js";
import { AppError, notFound } from "../http/errors.js";
import { addOwnReference, createNote, deleteNote, getNote, listNotes, NoteInputError, removeReference, updateNote } from "./service.js";

// Notes (8.3, 8.4). Owner only.
export const notesRouter = Router();
notesRouter.use(requireUser);

const idParam = z.object({ id: z.string().uuid() });
async function run<T>(fn: () => Promise<T | null>): Promise<T> {
  try {
    const out = await fn();
    if (out === null) throw notFound("Note not found.");
    return out;
  } catch (error) {
    if (error instanceof NoteInputError) throw new AppError(400, "invalid_note", error.message);
    throw error;
  }
}

notesRouter.get("/", async (req, res) => {
  const me = currentUser(req);
  const { q } = z.object({ q: z.string().max(80).optional() }).parse(req.query);
  res.json({ items: await listNotes(me.id, me.timezone, q) });
});

// "+ Add from your posts": the owner's recent posts to pick from.
notesRouter.get("/own-posts", async (req, res) => {
  const me = currentUser(req);
  const user = await db.user.findUniqueOrThrow({ where: { id: me.id } });
  const bundle = user.instagramHandle ? await cachedInstagram(user.instagramHandle) : null;
  res.json({ items: (bundle?.posts ?? []).slice(0, 12).map((p) => ({ id: p.id, url: p.url, thumbnailUrl: p.thumbnailUrl, caption: p.caption?.slice(0, 80) ?? null, format: p.format, publishedAt: p.publishedAt })) });
});

notesRouter.post("/", async (req, res) => {
  const me = currentUser(req);
  const body = z.object({ text: z.string().max(4000), title: z.string().max(80).optional() }).parse(req.body);
  res.status(201).json(await run(() => createNote(me.id, me.timezone, body)));
});

notesRouter.get("/:id", async (req, res) => {
  const me = currentUser(req);
  const { id } = idParam.parse(req.params);
  res.json(await run(() => getNote(me.id, me.timezone, id)));
});

notesRouter.patch("/:id", async (req, res) => {
  const me = currentUser(req);
  const { id } = idParam.parse(req.params);
  const body = z.object({ text: z.string().max(4000).optional(), title: z.string().max(80).optional() }).parse(req.body);
  res.json(await run(() => updateNote(me.id, me.timezone, id, body)));
});

notesRouter.delete("/:id", async (req, res) => {
  const me = currentUser(req);
  const { id } = idParam.parse(req.params);
  if (!(await deleteNote(me.id, id))) throw notFound("Note not found.");
  res.status(204).end();
});

notesRouter.post("/:id/references", async (req, res) => {
  const me = currentUser(req);
  const { id } = idParam.parse(req.params);
  const { instagramPostId } = z.object({ instagramPostId: z.string().min(1).max(100) }).parse(req.body);
  res.json(await run(() => addOwnReference(me.id, me.timezone, id, instagramPostId)));
});

notesRouter.delete("/:id/references/:refId", async (req, res) => {
  const me = currentUser(req);
  const { id, refId } = z.object({ id: z.string().uuid(), refId: z.string().uuid() }).parse(req.params);
  res.json(await run(() => removeReference(me.id, me.timezone, id, refId)));
});
