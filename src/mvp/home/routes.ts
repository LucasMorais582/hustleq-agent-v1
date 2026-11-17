import { Router } from "express";
import { z } from "zod";
import { currentUser, requireUser } from "../auth/middleware.js";
import { AppError, notFound } from "../http/errors.js";
import { answerMatch, CalendarInputError, getCalendar, getHome, getNumber } from "./service.js";

// Home (3.1-3.4), Calendar (10.x) and the 6.4 match. Owner only.
export const homeRouter = Router();
export const calendarRouter = Router();
for (const r of [homeRouter, calendarRouter]) r.use(requireUser);

function wrap(error: unknown): never {
  if (error instanceof CalendarInputError) throw new AppError(400, "invalid_calendar", error.message);
  throw error;
}

homeRouter.get("/", async (req, res) => {
  const me = currentUser(req);
  const { week } = z.object({ week: z.enum(["this", "next"]).default("this") }).parse(req.query);
  res.json(await getHome(me.id, week));
});

homeRouter.get("/numbers/:metric", async (req, res) => {
  const me = currentUser(req);
  const { metric } = z.object({ metric: z.enum(["followers", "likes", "views"]) }).parse(req.params);
  const n = await getNumber(me.id, metric);
  if (!n) throw notFound("No Instagram numbers yet.");
  res.json(n);
});

// 6.4: "Yes, mark posted" / "No, different post"
homeRouter.post("/match", async (req, res) => {
  const me = currentUser(req);
  const body = z.object({ postId: z.string().uuid(), igPostId: z.string().min(1).max(100), answer: z.enum(["yes", "no"]) }).parse(req.body);
  try {
    const r = await answerMatch(me.id, body.postId, body.igPostId, body.answer === "yes");
    if (!r) throw notFound("Post not found.");
    res.json(r);
  } catch (error) {
    wrap(error);
  }
});

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
calendarRouter.get("/", async (req, res) => {
  const me = currentUser(req);
  const { from, to } = z.object({ from: day, to: day }).parse(req.query);
  try {
    res.json(await getCalendar(me.id, from, to));
  } catch (error) {
    wrap(error);
  }
});
