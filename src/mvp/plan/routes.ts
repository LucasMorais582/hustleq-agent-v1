import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { currentUser, requireUser } from "../auth/middleware.js";
import { AppError, notFound } from "../http/errors.js";
import {
  BASE_PILLARS, getStrategy, getWeek, PlanInputError, presentPost, presentStrategy, saveStrategy, saveWeek, updateStrategy,
} from "./service.js";

// Strategies (4.5-4.7), weeks (5.1-5.4) and posts (5.2, 5.2b). Everything is scoped to the owner.
export const strategiesRouter = Router();
export const weeksRouter = Router();
export const postsRouter = Router();
for (const r of [strategiesRouter, weeksRouter, postsRouter]) r.use(requireUser);

const idParam = z.object({ id: z.string().uuid() });

function wrap(error: unknown): never {
  if (error instanceof PlanInputError) throw new AppError(400, "invalid_plan", error.message);
  throw error;
}

// ---------- Strategies ----------

strategiesRouter.get("/", async (req, res) => {
  const me = currentUser(req);
  const rows = await db.strategy.findMany({ where: { userId: me.id, status: "saved" }, include: { pillars: true }, orderBy: { startsOn: "desc" } });
  const items = rows.map((r) => presentStrategy(r, me.timezone));
  // Active first, then upcoming, then ended (4.5).
  const order = { active: 0, upcoming: 1, ended: 2, draft: 3 } as const;
  items.sort((a, b) => order[a.status] - order[b.status]);
  res.json({ items, basePillars: BASE_PILLARS });
});

strategiesRouter.get("/:id", async (req, res) => {
  const me = currentUser(req);
  const { id } = idParam.parse(req.params);
  const s = await getStrategy(me.id, id);
  if (!s) throw notFound("Strategy not found.");
  res.json({ ...presentStrategy(s, me.timezone), basePillars: BASE_PILLARS });
});

strategiesRouter.post("/:id/save", async (req, res) => {
  const me = currentUser(req);
  const { id } = idParam.parse(req.params);
  const s = await saveStrategy(me.id, id, me.timezone);
  if (!s) throw notFound("Strategy not found.");
  res.json(presentStrategy(s, me.timezone));
});

const count = z.number().int().min(0).max(14);
const patchBody = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  objective: z.string().trim().min(1).max(300).optional(),
  durationWeeks: z.number().int().min(1).max(26).optional(),
  staticPerWeek: count.optional(),
  videosPerWeek: count.optional(),
  storiesPerWeek: count.optional(),
  pillars: z.array(z.object({
    name: z.string().trim().min(1).max(40),
    baseType: z.string().max(20).optional(),
    description: z.string().max(120).optional(),
    goal: z.string().max(120).optional(),
  })).optional(),
});

strategiesRouter.patch("/:id", async (req, res) => {
  const me = currentUser(req);
  const { id } = idParam.parse(req.params);
  try {
    const s = await updateStrategy(me.id, id, patchBody.parse(req.body));
    if (!s) throw notFound("Strategy not found.");
    res.json(presentStrategy(s, me.timezone));
  } catch (error) {
    wrap(error);
  }
});

// ---------- Weeks ----------

weeksRouter.get("/:id", async (req, res) => {
  const me = currentUser(req);
  const { id } = idParam.parse(req.params);
  const w = await getWeek(me.id, id, me.timezone);
  if (!w) throw notFound("Week not found.");
  res.json(w);
});

const saveBody = z.object({
  posts: z.array(z.object({ id: z.string().uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })).max(30),
  reminders: z.boolean(),
});

weeksRouter.post("/:id/save", async (req, res) => {
  const me = currentUser(req);
  const { id } = idParam.parse(req.params);
  try {
    const w = await saveWeek(me.id, me.timezone, id, saveBody.parse(req.body));
    if (!w) throw notFound("Week not found.");
    res.json(w);
  } catch (error) {
    wrap(error);
  }
});

// ---------- Posts ----------

postsRouter.get("/:id", async (req, res) => {
  const me = currentUser(req);
  const { id } = idParam.parse(req.params);
  const p = await db.post.findFirst({ where: { id, userId: me.id }, include: { pillar: true, week: true } });
  if (!p) throw notFound("Post not found.");
  res.json({ ...presentPost(p, me.timezone), weekLabel: p.week ? `Week of ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(p.week.startsOn)}` : null });
});
