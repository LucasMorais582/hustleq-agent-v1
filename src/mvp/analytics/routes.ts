import { Router } from "express";
import { z } from "zod";
import { currentUser, requireUser } from "../auth/middleware.js";
import { compare, overview, publishedPost, refreshPost, yourPosts } from "./service.js";

// Analytics (11.1 to 11.7c): Overview, Your posts, Compare and the published post.
export const analyticsRouter = Router();
analyticsRouter.use(requireUser);

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const periodQuery = z.object({
  duke: z.string().optional(),
  days: z.coerce.number().int().optional(),
  from: day.optional(),
  to: day.optional(),
});
// ?duke=0: numbers only (fast); the app then asks again with Duke's line.
const withDuke = (q: unknown) => (q as { duke?: string }).duke !== "0";

analyticsRouter.get("/overview", async (req, res) => {
  res.json(await overview(currentUser(req).id, periodQuery.parse(req.query), withDuke(req.query)));
});

analyticsRouter.get("/posts", async (req, res) => {
  const q = periodQuery.extend({ type: z.enum(["all", "reel", "carousel", "image"]).optional(), sort: z.enum(["newest", "best"]).optional() }).parse(req.query);
  res.json(await yourPosts(currentUser(req).id, q));
});

analyticsRouter.get("/compare", async (req, res) => {
  res.json(await compare(currentUser(req).id, periodQuery.parse(req.query), withDuke(req.query)));
});

const postParam = z.object({ id: z.string().min(1).max(200) });

analyticsRouter.get("/posts/:id", async (req, res) => {
  res.json(await publishedPost(currentUser(req).id, postParam.parse(req.params).id, withDuke(req.query)));
});

analyticsRouter.post("/posts/:id/refresh", async (req, res) => {
  res.status(202).json(await refreshPost(currentUser(req).id, postParam.parse(req.params).id));
});
