import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { currentUser, requireUser } from "../auth/middleware.js";
import { AppError, notFound } from "../http/errors.js";
import { getShotList, requestShotList, setShotDone } from "./shotList.js";
import {
  activeLink, createShareLink, DEFAULT_INCLUDE, ExportError, sharedByLink, signedFilePath, turnOffLink, verifyFileUrl, weekCsv, weekExport, weekIcs, weekPdf, type FileKind, type Include, exportFor, type Scope,
} from "./export.js";

// What to film (5.6, 5.7), export (5.8-5.10) and the .ics of 5.4.
// Owner routes sit under /v1/weeks and /v1/shot-list; /v1/shared and /v1/files are public.

export const productionRouter = Router(); // mounted at /weeks, after the weeks router
export const shotItemsRouter = Router(); // /shot-list
export const exportsRouter = Router(); // /exports
export const sharedRouter = Router(); // /shared (public, view only)
export const filesRouter = Router(); // /files (public, signed URLs)
for (const r of [productionRouter, shotItemsRouter, exportsRouter]) r.use(requireUser);

const idParam = z.object({ id: z.string().uuid() });
const includeSchema = z.object({
  captions: z.boolean(),
  creativeDirection: z.boolean(),
  whatToProduce: z.boolean(),
  shotList: z.boolean(),
  hashtags: z.boolean(),
}).partial().transform((v): Include => ({
  captions: v.captions ?? DEFAULT_INCLUDE.captions,
  creativeDirection: v.creativeDirection ?? DEFAULT_INCLUDE.creativeDirection,
  whatToProduce: v.whatToProduce ?? DEFAULT_INCLUDE.whatToProduce,
  shotList: v.shotList ?? DEFAULT_INCLUDE.shotList,
  hashtags: v.hashtags ?? DEFAULT_INCLUDE.hashtags,
}));

function wrap(error: unknown): never {
  if (error instanceof ExportError) throw new AppError(400, "export_not_ready", error.message);
  throw error;
}

// ---------- What to film ----------

productionRouter.get("/:id/shot-list", async (req, res) => {
  const me = currentUser(req);
  const { id } = idParam.parse(req.params);
  const list = await getShotList(me.id, id, me.timezone);
  if (!list) {
    const week = await db.week.findFirst({ where: { id, userId: me.id }, select: { id: true } });
    if (!week) throw notFound("Week not found.");
    return res.json({ weekId: id, status: "none" });
  }
  res.json(list);
});

// Builds it the first time (or again with {rebuild:true}); the app polls the GET while it's pending.
productionRouter.post("/:id/shot-list", async (req, res) => {
  const me = currentUser(req);
  const { id } = idParam.parse(req.params);
  const { rebuild } = z.object({ rebuild: z.boolean().optional() }).parse(req.body ?? {});
  const list = await requestShotList(me.id, id, { rebuild: Boolean(rebuild) });
  if (!list) throw notFound("Week not found.");
  res.status(202).json(await getShotList(me.id, id, me.timezone));
});

shotItemsRouter.patch("/items/:id", async (req, res) => {
  const me = currentUser(req);
  const { id } = idParam.parse(req.params);
  const { done } = z.object({ done: z.boolean() }).parse(req.body);
  const item = await setShotDone(me.id, id, done);
  if (!item) throw notFound("Item not found.");
  res.json({ id: item.id, done: item.done });
});

// ---------- Export ----------

productionRouter.get("/:id/export", async (req, res) => {
  const me = currentUser(req);
  const { id } = idParam.parse(req.params);
  const week = await db.week.findFirst({ where: { id, userId: me.id }, select: { status: true, startsOn: true } });
  if (!week) throw notFound("Week not found.");
  res.json({ weekId: id, saved: week.status === "saved", link: await activeLink(me.id, id), defaults: DEFAULT_INCLUDE });
});

const exportBody = z.object({ format: z.enum(["link", "pdf", "csv"]), include: includeSchema.optional() });

productionRouter.post("/:id/export", async (req, res) => {
  const me = currentUser(req);
  const { id } = idParam.parse(req.params);
  const body = exportBody.parse(req.body);
  const inc = body.include ?? DEFAULT_INCLUDE;
  try {
    if (body.format === "link") {
      const link = await createShareLink(me.id, id, inc);
      if (!link) throw notFound("Week not found.");
      return res.json({ format: "link", ...link });
    }
    const data = await weekExport(id, { userId: me.id, requireSaved: true });
    if (!data) throw notFound("Week not found.");
    res.json({ format: body.format, path: signedFilePath(id, body.format, inc, 15 * 60e3) });
  } catch (error) {
    wrap(error);
  }
});

exportsRouter.post("/:linkId/off", async (req, res) => {
  const me = currentUser(req);
  const { linkId } = z.object({ linkId: z.string().min(6).max(40) }).parse(req.params);
  if (!(await turnOffLink(me.id, linkId))) throw notFound("Link not found.");
  res.json({ active: false });
});

// .ics of 5.4 ("Add to my calendar"): saved posts only.
productionRouter.post("/:id/calendar", async (req, res) => {
  const me = currentUser(req);
  const { id } = idParam.parse(req.params);
  const week = await db.week.findFirst({ where: { id, userId: me.id }, select: { status: true } });
  if (!week) throw notFound("Week not found.");
  if (week.status !== "saved") throw new AppError(400, "export_not_ready", "Save the week first.");
  res.json({ path: signedFilePath(id, "ics") });
});

// ---------- Public ----------

sharedRouter.get("/:linkId", async (req, res) => {
  const { linkId } = z.object({ linkId: z.string().min(6).max(40) }).parse(req.params);
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Cache-Control", "no-store");
  const view = await sharedByLink(linkId);
  if (!view) throw new AppError(410, "link_inactive", "This link is no longer active.");
  res.json(view);
});

const serveFile = (scope: Scope) => async (req: import("express").Request, res: import("express").Response) => {
  const m = /^([0-9a-f-]{36})\.(pdf|csv|ics)$/.exec(String(req.params.file));
  if (!m) throw notFound("File not found.");
  const [, weekId, kind] = m as unknown as [string, string, FileKind];
  const inc = verifyFileUrl(weekId, kind, req.query, scope);
  if (!inc) throw new AppError(410, "link_expired", "This download link expired. Export again from the app.");
  const data = await exportFor(scope, weekId);
  if (!data) throw notFound("File not found.");
  const name = `${data.businessName} ${data.label}`.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "week";
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Robots-Tag", "noindex");
  if (kind === "csv") {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${name}.csv"`);
    return res.send(weekCsv(data, inc));
  }
  if (kind === "ics") {
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", `inline; filename="${name}.ics"`);
    return res.send(weekIcs(data));
  }
  const pdf = await weekPdf(data, inc);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${name}.pdf"`);
  res.send(pdf);
};
filesRouter.get("/weeks/:file", serveFile("week"));
filesRouter.get("/campaigns/:file", serveFile("campaign"));

