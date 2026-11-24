import { Router } from "express";
import { requireActivePlan } from "../billing/service.js";
import { z } from "zod";
import { currentUser, requireUser } from "../auth/middleware.js";
import { AppError, notFound } from "../http/errors.js";
import { FORMATS } from "../plan/service.js";
import { DailyCapReached, refundHeavyGeneration, useHeavyGeneration } from "../plan/limits.js";
import { regenerateSection, writeCaption } from "../plan/details.js";
import { addMedia, getFullPost, PostInputError, removeMedia, reorderMedia, requestUpload, setPostStatus, updatePost } from "./service.js";
import { validatePost, ValidationLimitReached } from "./validate.js";
import { postPreview } from "./preview.js";

// One post (6.1, 6.2). Everything is scoped to the owner.
export const postsRouter = Router();
postsRouter.use(requireUser);

const idParam = z.object({ id: z.string().uuid() });

function wrap(error: unknown): never {
  if (error instanceof PostInputError) throw new AppError(400, "invalid_post", error.message);
  if (error instanceof ValidationLimitReached) throw new AppError(429, "validation_limit", "You used this month’s validations. They come back on the 1st.");
  if (error instanceof DailyCapReached) throw new AppError(429, "daily_limit", "You reached today’s limit for new plans. It resets tomorrow.");
  throw error;
}

async function run<T>(fn: () => Promise<T | null>, missing = "Post not found."): Promise<T> {
  try {
    const out = await fn();
    if (out === null) throw notFound(missing);
    return out;
  } catch (error) {
    wrap(error);
  }
}

postsRouter.get("/:id", async (req, res) => {
  const me = currentUser(req);
  const { id } = idParam.parse(req.params);
  res.json(await run(() => getFullPost(me.id, id)));
});

// Preview: the owner's profile and the grid around this post.
postsRouter.get("/:id/preview", async (req, res) => {
  const me = currentUser(req);
  const { id } = idParam.parse(req.params);
  res.json(await run(() => postPreview(me.id, id)));
});

const patchBody = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  format: z.enum(FORMATS).optional(),
  reminderEmail: z.boolean().optional(),
  caption: z.string().max(2200).optional(),
  hashtags: z.array(z.string().max(80)).max(30).optional(),
  note: z.string().max(1000).nullable().optional(),
  title: z.string().trim().min(1).max(120).optional(),
});

postsRouter.patch("/:id", async (req, res) => {
  const me = currentUser(req);
  const { id } = idParam.parse(req.params);
  const patch = patchBody.parse(req.body);
  res.json(await run(() => updatePost(me.id, me.timezone, id, patch)));
});

postsRouter.post("/:id/status", async (req, res) => {
  const me = currentUser(req);
  const { id } = idParam.parse(req.params);
  const { action } = z.object({ action: z.enum(["schedule", "draft", "cancel"]) }).parse(req.body);
  res.json(await run(() => setPostStatus(me.id, id, action)));
});

// "Regenerate" on Creative direction or What to produce. Counts toward the daily limit.
postsRouter.post("/:id/regenerate", requireActivePlan, async (req, res) => {
  const me = currentUser(req);
  const { id } = idParam.parse(req.params);
  const { section } = z.object({ section: z.enum(["creativeDirection", "whatToProduce"]) }).parse(req.body);
  res.json(await run(async () => {
    const post = await getFullPost(me.id, id);
    if (!post) return null;
    if (!post.editable) throw new PostInputError("A posted post can't be changed.");
    await useHeavyGeneration(me.id, me.timezone);
    try {
      await regenerateSection(id, section);
    } catch (error) {
      await refundHeavyGeneration(me.id, me.timezone);
      throw error;
    }
    return getFullPost(me.id, id);
  }));
});

// "New caption": returns a caption to try; nothing is saved. Counts toward the daily limit.
postsRouter.post("/:id/caption", requireActivePlan, async (req, res) => {
  const me = currentUser(req);
  const { id } = idParam.parse(req.params);
  const { style, current } = z.object({ style: z.enum(["shorter", "casual", "direct"]).optional(), current: z.string().max(4000).optional() }).parse(req.body ?? {});
  res.json(await run(async () => {
    const post = await getFullPost(me.id, id);
    if (!post) return null;
    if (!post.editable) throw new PostInputError("A posted post can't be changed.");
    await useHeavyGeneration(me.id, me.timezone);
    try {
      return { caption: await writeCaption(id, current ?? post.caption ?? null, style) };
    } catch (error) {
      await refundHeavyGeneration(me.id, me.timezone);
      throw error;
    }
  }));
});

// Media: 1) ask for an upload URL, 2) the app uploads straight to Storage, 3) confirm.
postsRouter.post("/:id/media/upload-url", async (req, res) => {
  const me = currentUser(req);
  const { id } = idParam.parse(req.params);
  const body = z.object({ mimeType: z.string().max(80), size: z.number().int().positive(), purpose: z.enum(["media", "frame"]).default("media") }).parse(req.body);
  res.json(await run(() => requestUpload(me.id, id, body)));
});

postsRouter.post("/:id/media", async (req, res) => {
  const me = currentUser(req);
  const { id } = idParam.parse(req.params);
  const body = z.object({ path: z.string().max(300), framePaths: z.array(z.string().max(300)).max(6).default([]) }).parse(req.body);
  res.json(await run(() => addMedia(me.id, id, body)));
});

postsRouter.delete("/:id/media/:mediaId", async (req, res) => {
  const me = currentUser(req);
  const { id, mediaId } = z.object({ id: z.string().uuid(), mediaId: z.string().uuid() }).parse(req.params);
  res.json(await run(() => removeMedia(me.id, id, mediaId), "File not found."));
});

postsRouter.put("/:id/media/order", async (req, res) => {
  const me = currentUser(req);
  const { id } = idParam.parse(req.params);
  const { ids } = z.object({ ids: z.array(z.string().uuid()).max(10) }).parse(req.body);
  res.json(await run(() => reorderMedia(me.id, id, ids)));
});

postsRouter.post("/:id/validate", requireActivePlan, async (req, res) => {
  const me = currentUser(req);
  const { id } = idParam.parse(req.params);
  res.json(await run(() => validatePost(me.id, me.timezone, id)));
});
