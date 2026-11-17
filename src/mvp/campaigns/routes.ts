import { Router } from "express";
import { requireActivePlan } from "../billing/service.js";
import { z } from "zod";
import { currentUser, requireUser } from "../auth/middleware.js";
import { AppError, notFound } from "../http/errors.js";
import { activeLink, createShareLink, DEFAULT_INCLUDE, ExportError, exportFor, signedFilePath, type Include } from "../production/export.js";
import { addOwnDate, CampaignInputError, datesPage, getCampaign, listCampaigns, removeOwnDate, saveCampaign, skipDate } from "./service.js";

// Campaigns (7.3, 7.4) and commercial dates (7.5, 7.6). Owner only.
export const campaignsRouter = Router();
export const datesRouter = Router();
for (const r of [campaignsRouter, datesRouter]) r.use(requireUser);

const idParam = z.object({ id: z.string().uuid() });
function wrap(error: unknown): never {
  if (error instanceof CampaignInputError) throw new AppError(400, "invalid_campaign", error.message);
  if (error instanceof ExportError) throw new AppError(400, "export_not_ready", error.message);
  throw error;
}

campaignsRouter.get("/", async (req, res) => {
  res.json({ items: await listCampaigns(currentUser(req).id) });
});

campaignsRouter.get("/:id", async (req, res) => {
  const { id } = idParam.parse(req.params);
  const c = await getCampaign(currentUser(req).id, id);
  if (!c) throw notFound("Campaign not found.");
  res.json(c);
});

campaignsRouter.post("/:id/save", requireActivePlan, async (req, res) => {
  const { id } = idParam.parse(req.params);
  const c = await saveCampaign(currentUser(req).id, id);
  if (!c) throw notFound("Campaign not found.");
  res.json(c);
});

// Export, the same as a week (5.8-5.10)
const includeSchema = z.object({ captions: z.boolean(), creativeDirection: z.boolean(), whatToProduce: z.boolean(), shotList: z.boolean(), hashtags: z.boolean() }).partial()
  .transform((v): Include => ({ ...DEFAULT_INCLUDE, ...Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)) }));

campaignsRouter.get("/:id/export", async (req, res) => {
  const me = currentUser(req);
  const { id } = idParam.parse(req.params);
  const c = await getCampaign(me.id, id);
  if (!c) throw notFound("Campaign not found.");
  res.json({ weekId: id, saved: c.saved, link: await activeLink(me.id, id, "campaign"), defaults: DEFAULT_INCLUDE });
});

campaignsRouter.post("/:id/export", async (req, res) => {
  const me = currentUser(req);
  const { id } = idParam.parse(req.params);
  const body = z.object({ format: z.enum(["link", "pdf", "csv"]), include: includeSchema.optional() }).parse(req.body);
  const inc = body.include ?? DEFAULT_INCLUDE;
  try {
    if (body.format === "link") {
      const link = await createShareLink(me.id, id, inc, "campaign");
      if (!link) throw notFound("Campaign not found.");
      return res.json({ format: "link", ...link });
    }
    if (!(await exportFor("campaign", id, { userId: me.id, requireSaved: true }))) throw notFound("Campaign not found.");
    res.json({ format: body.format, path: signedFilePath(id, body.format, inc, 15 * 60e3, "campaign") });
  } catch (error) {
    wrap(error);
  }
});

campaignsRouter.post("/:id/calendar", async (req, res) => {
  const me = currentUser(req);
  const { id } = idParam.parse(req.params);
  try {
    if (!(await exportFor("campaign", id, { userId: me.id, requireSaved: true }))) throw notFound("Campaign not found.");
    res.json({ path: signedFilePath(id, "ics", DEFAULT_INCLUDE, 24 * 3600e3, "campaign") });
  } catch (error) {
    wrap(error);
  }
});

// ---------- Commercial dates ----------

datesRouter.get("/", async (req, res) => {
  const me = currentUser(req);
  res.json(await datesPage(me.id, me.timezone));
});

datesRouter.post("/", async (req, res) => {
  const me = currentUser(req);
  const body = z.object({ name: z.string().trim().min(1).max(60), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), repeats: z.boolean().default(false), suggestCampaign: z.boolean().default(true) }).parse(req.body);
  await addOwnDate(me.id, body);
  res.status(201).json(await datesPage(me.id, me.timezone));
});

datesRouter.delete("/own/:id", async (req, res) => {
  const me = currentUser(req);
  const { id } = idParam.parse(req.params);
  if (!(await removeOwnDate(me.id, id))) throw notFound("Date not found.");
  res.json(await datesPage(me.id, me.timezone));
});

// "Not this year"
datesRouter.post("/skip", async (req, res) => {
  const me = currentUser(req);
  const { dateId } = z.object({ dateId: z.string().min(1).max(60) }).parse(req.body);
  if (!(await skipDate(me.id, me.timezone, dateId))) throw notFound("Date not found.");
  res.json(await datesPage(me.id, me.timezone));
});
