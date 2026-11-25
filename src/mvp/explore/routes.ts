import { Router } from "express";
import { z } from "zod";
import { currentUser, requireUser } from "../auth/middleware.js";
import { requireActivePlan } from "../billing/service.js";
import { addToNote, checkAccount, discover, listSaved, listWatched, savedKeys, savePost, unsavePost, unwatchAccount, watchAccount, watchedAccount } from "./service.js";

// Explore (9.1 to 9.6): Discover, Watched and Saved.
export const exploreRouter = Router();
exploreRouter.use(requireUser);

exploreRouter.get("/discover", async (req, res) => {
  const { query } = z.object({ query: z.string().max(80).optional() }).parse(req.query);
  res.json(await discover(currentUser(req).id, { query }));
});

const handle = z.string().trim().min(1).max(31).transform((h) => h.replace(/^@/, "").toLowerCase()).pipe(z.string().regex(/^[a-z0-9._]{1,30}$/, "Not a valid Instagram handle"));

exploreRouter.get("/watched", async (req, res) => {
  res.json(await listWatched(currentUser(req).id));
});
exploreRouter.post("/watched/check", requireActivePlan, async (req, res) => {
  res.json(await checkAccount(currentUser(req).id, z.object({ handle }).parse(req.body).handle));
});
exploreRouter.post("/watched", requireActivePlan, async (req, res) => {
  const body = z.object({ handle, label: z.enum(["competitor", "inspiration"]) }).parse(req.body);
  res.status(201).json(await watchAccount(currentUser(req).id, body.handle, body.label));
});
const idParam = z.object({ id: z.string().uuid() });
exploreRouter.get("/watched/:id", async (req, res) => {
  res.json(await watchedAccount(currentUser(req).id, idParam.parse(req.params).id, (req.query as { duke?: string }).duke !== "0"));
});
exploreRouter.delete("/watched/:id", async (req, res) => {
  res.json(await unwatchAccount(currentUser(req).id, idParam.parse(req.params).id));
});

const post = z.object({
  key: z.string().min(1).max(100),
  url: z.string().max(500).nullable(),
  format: z.enum(["reel", "carousel", "image"]),
  caption: z.string().max(5000).nullable(),
  thumbnailUrl: z.string().max(2000).nullable(),
  publishedAt: z.string().max(40).nullable(),
  handle: z.string().max(40).nullable(),
  name: z.string().max(200).nullable(),
  views: z.number().int().nullable(),
  likes: z.number().int().nullable(),
  likesHidden: z.boolean(),
  comments: z.number().int().nullable(),
  source: z.enum(["explore", "watched"]),
  watched: z.object({ id: z.string(), label: z.string() }).optional(),
  ratio: z.number().nullable().optional(),
});

exploreRouter.get("/saved", async (req, res) => {
  res.json(await listSaved(currentUser(req).id));
});
exploreRouter.get("/saved/keys", async (req, res) => {
  res.json({ keys: await savedKeys(currentUser(req).id) });
});
exploreRouter.post("/saved", async (req, res) => {
  res.status(201).json(await savePost(currentUser(req).id, post.parse(req.body) as never));
});
exploreRouter.delete("/saved/:key", async (req, res) => {
  res.json(await unsavePost(currentUser(req).id, z.object({ key: z.string().min(1).max(100) }).parse(req.params).key));
});
exploreRouter.post("/to-note", async (req, res) => {
  const me = currentUser(req);
  const body = z.object({ post, noteId: z.string().uuid().optional() }).parse(req.body);
  res.status(201).json(await addToNote(me.id, me.timezone, body.post as never, body.noteId));
});
