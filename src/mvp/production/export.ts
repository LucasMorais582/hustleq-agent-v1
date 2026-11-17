import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import PDFDocument from "pdfkit";
import { db } from "../db.js";
import { appUrl } from "../email/send.js";
import { FORMAT_LABEL, postSlot, type Format } from "../plan/service.js";
import { addDays } from "../lib/time.js";
import { getShotList } from "./shotList.js";

// Export (5.8-5.10): share link (view-only page), PDF, CSV, and the .ics of 5.4.
// Files are served from signed URLs so a plain link works on every phone (no token in the request).

export type Include = { captions: boolean; creativeDirection: boolean; whatToProduce: boolean; shotList: boolean; hashtags: boolean };
export const DEFAULT_INCLUDE: Include = { captions: true, creativeDirection: true, whatToProduce: true, shotList: true, hashtags: false };
const INCLUDE_KEYS = Object.keys(DEFAULT_INCLUDE) as (keyof Include)[];

export class ExportError extends Error {}

const fmtDay = (iso: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));

export const CREATIVE_LABELS: Record<string, string> = {
  visualConcept: "Visual concept",
  openingImpact: "Opening impact",
  visualNarrative: "Visual narrative",
  mood: "Mood",
  colorAndType: "Color and type",
  audienceEmotion: "Audience emotion",
  platformElements: "Platform elements",
  execution: "Execution",
};

// ---------- Signed file URLs ----------

const secret = () => {
  const s = process.env.INVITE_TOKEN_SECRET;
  if (!s) throw new Error("INVITE_TOKEN_SECRET is not set");
  return s;
};
const encodeInclude = (inc: Include) => INCLUDE_KEYS.map((k) => (inc[k] ? "1" : "0")).join("");
const decodeInclude = (s: string): Include => Object.fromEntries(INCLUDE_KEYS.map((k, i) => [k, s[i] === "1"])) as Include;
const sign = (payload: string) => createHmac("sha256", secret()).update(`export:${payload}`).digest("base64url");

export type FileKind = "pdf" | "csv" | "ics";

// A path on this API (the app adds its API base URL).
export function signedFilePath(weekId: string, kind: FileKind, inc: Include = DEFAULT_INCLUDE, ttlMs = 24 * 3600e3) {
  const exp = Date.now() + ttlMs;
  const i = encodeInclude(inc);
  const sig = sign(`${kind}:${weekId}:${i}:${exp}`);
  return `/v1/files/weeks/${weekId}.${kind}?i=${i}&exp=${exp}&sig=${sig}`;
}

export function verifyFileUrl(weekId: string, kind: FileKind, q: { i?: unknown; exp?: unknown; sig?: unknown }): Include | null {
  const i = typeof q.i === "string" && /^[01]{5}$/.test(q.i) ? q.i : null;
  const exp = Number(q.exp);
  if (!i || !Number.isFinite(exp) || exp < Date.now() || typeof q.sig !== "string") return null;
  const want = Buffer.from(sign(`${kind}:${weekId}:${i}:${exp}`));
  const got = Buffer.from(q.sig);
  return want.length === got.length && timingSafeEqual(want, got) ? decodeInclude(i) : null;
}

// ---------- What gets exported ----------

type Guidance = { objective?: string; recordingPlan?: string[]; editing?: string; assets?: string; checklist?: string[] };
type CaptionParts = { hook?: string; body?: string; callToAction?: string };

export async function weekExport(weekId: string, opts: { userId?: string; requireSaved?: boolean } = {}) {
  const week = await db.week.findFirst({
    where: { id: weekId, ...(opts.userId ? { userId: opts.userId } : {}) },
    include: {
      user: { select: { id: true, timezone: true } },
      posts: { where: { status: { not: "cancelled" } }, include: { pillar: true }, orderBy: [{ scheduledAt: "asc" }, { position: "asc" }] },
    },
  });
  if (!week) return null;
  if (opts.requireSaved && week.status !== "saved") throw new ExportError("Save the week first, then export it.");
  const tz = week.user.timezone;
  const bp = await db.businessProfile.findUnique({ where: { userId: week.userId }, select: { businessName: true } });
  const weekStart = week.startsOn.toISOString().slice(0, 10);
  const shotList = await getShotList(week.userId, week.id, tz);
  return {
    weekId: week.id,
    userId: week.userId,
    businessName: bp?.businessName ?? "Your business",
    label: `Week of ${fmtDay(weekStart)}`,
    rangeLabel: `${fmtDay(weekStart)} to ${fmtDay(addDays(weekStart, 6))}`,
    weekStart,
    timezone: tz,
    shotList: shotList?.status === "ready" ? shotList : null,
    posts: week.posts.map((p) => {
      const slot = postSlot(p.scheduledAt, tz);
      return {
        id: p.id,
        date: slot.date,
        day: slot.day,
        time: slot.time,
        slotLabel: slot.label,
        scheduledAt: p.scheduledAt,
        format: p.format,
        formatLabel: FORMAT_LABEL[(p.format ?? "feed") as Format] ?? p.format ?? "",
        pillar: p.pillar?.name ?? null,
        title: p.title ?? "",
        hook: p.hook,
        caption: p.caption,
        captionParts: (p.captionParts ?? null) as CaptionParts | null,
        hashtags: p.hashtags,
        creativeDirection: (p.creativeDirection ?? null) as Record<string, string> | null,
        whatToProduce: (p.productionGuidance ?? null) as Guidance | null,
      };
    }),
  };
}
export type WeekExport = NonNullable<Awaited<ReturnType<typeof weekExport>>>;

// The view-only payload (5.10): only what the owner chose to include.
export function presentShared(data: WeekExport, inc: Include) {
  return {
    businessName: data.businessName,
    label: data.label,
    rangeLabel: data.rangeLabel,
    include: inc,
    posts: data.posts.map((p) => ({
      id: p.id,
      slotLabel: p.slotLabel,
      formatLabel: p.formatLabel,
      pillar: p.pillar,
      title: p.title,
      hook: p.hook,
      caption: inc.captions ? p.caption : null,
      hashtags: inc.hashtags ? p.hashtags : [],
      creativeDirection: inc.creativeDirection && p.creativeDirection
        ? Object.entries(CREATIVE_LABELS).filter(([k]) => p.creativeDirection?.[k]).map(([k, label]) => ({ label, text: p.creativeDirection![k]! }))
        : [],
      whatToProduce: inc.whatToProduce ? p.whatToProduce : null,
    })),
    shotList: inc.shotList && data.shotList
      ? { header: data.shotList.header, title: data.shotList.title, summary: data.shotList.summary, importantNote: data.shotList.importantNote, people: data.shotList.people, locations: data.shotList.locations, assets: data.shotList.assets, groups: data.shotList.groups.map((g) => ({ label: g.label, items: g.items.map((i) => i.text) })) }
      : null,
  };
}

// ---------- Share link ----------

export async function activeLink(userId: string, weekId: string) {
  const e = await db.export.findFirst({ where: { userId, kind: "week", objectId: weekId, active: true }, orderBy: { createdAt: "desc" } });
  return e ? { linkId: e.linkId, url: appUrl(`/s/${e.linkId}`), include: { ...DEFAULT_INCLUDE, ...(e.include as Partial<Include> | null) } } : null;
}

export async function createShareLink(userId: string, weekId: string, inc: Include) {
  const data = await weekExport(weekId, { userId, requireSaved: true });
  if (!data) return null;
  const current = await db.export.findFirst({ where: { userId, kind: "week", objectId: weekId, active: true } });
  const e = current
    ? await db.export.update({ where: { id: current.id }, data: { include: inc } })
    : await db.export.create({ data: { userId, kind: "week", objectId: weekId, include: inc, linkId: randomBytes(9).toString("base64url") } });
  return { linkId: e.linkId, url: appUrl(`/s/${e.linkId}`), include: inc };
}

export async function turnOffLink(userId: string, linkId: string) {
  const r = await db.export.updateMany({ where: { userId, linkId }, data: { active: false } });
  return r.count > 0;
}

export async function sharedByLink(linkId: string) {
  const e = await db.export.findUnique({ where: { linkId } });
  if (!e || !e.active || e.kind !== "week") return null;
  const data = await weekExport(e.objectId);
  if (!data) return null;
  return presentShared(data, { ...DEFAULT_INCLUDE, ...(e.include as Partial<Include> | null) });
}

// ---------- CSV (Notion, Trello, Google Sheets) ----------

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  // Formula injection: a cell starting with = + - @ would run in a spreadsheet.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function weekCsv(data: WeekExport, inc: Include) {
  const header = ["Date", "Day", "Time", "Format", "Pillar", "Title", "Hook"];
  if (inc.captions) header.push("Caption");
  if (inc.hashtags) header.push("Hashtags");
  if (inc.creativeDirection) header.push("Creative direction");
  if (inc.whatToProduce) header.push("What to produce", "Recording plan", "Checklist");
  if (inc.shotList) header.push("Shot list");
  const rows = data.posts.map((p) => {
    const row: unknown[] = [p.date, p.day, p.time, p.formatLabel, p.pillar, p.title, p.hook];
    if (inc.captions) row.push(p.caption);
    if (inc.hashtags) row.push(p.hashtags.join(" "));
    if (inc.creativeDirection) row.push(p.creativeDirection ? Object.entries(CREATIVE_LABELS).filter(([k]) => p.creativeDirection?.[k]).map(([k, l]) => `${l}: ${p.creativeDirection![k]}`).join("\n") : "");
    if (inc.whatToProduce) {
      const g = p.whatToProduce;
      row.push(g?.objective ?? "", (g?.recordingPlan ?? []).map((s, i) => `${i + 1}. ${s}`).join("\n"), (g?.checklist ?? []).join("\n"));
    }
    if (inc.shotList) {
      const shots = data.shotList?.byPost.find((b) => b.id === p.id)?.shots ?? [];
      row.push(shots.map((s) => s.text).join("\n"));
    }
    return row.map(csvCell).join(",");
  });
  // BOM so Excel and Sheets read UTF-8 (curly quotes, accents).
  return `\uFEFF${[header.map(csvCell).join(","), ...rows].join("\r\n")}\r\n`;
}

// ---------- PDF ----------

// Standard PDF fonts only cover Latin-1 plus a few typographic marks; drop the rest (emoji).
const pdfText = (s: string | null | undefined) => (s ?? "").replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u2026\u20AC]/gu, "").trim();

export function weekPdf(data: WeekExport, inc: Include): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 54, info: { Title: `${data.businessName} · ${data.label}`, Author: "HustleQ" } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const ink = "#1F1442";
    const muted = "#6B6680";
    const accent = "#5B3DF5";
    const h = (t: string) => doc.moveDown(0.6).font("Helvetica-Bold").fontSize(10).fillColor(accent).text(pdfText(t).toUpperCase(), { characterSpacing: 0.5 }).moveDown(0.2).font("Helvetica").fontSize(10.5).fillColor(ink);
    const para = (t: string | null | undefined) => { if (pdfText(t)) doc.font("Helvetica").fontSize(10.5).fillColor(ink).text(pdfText(t), { lineGap: 2 }); };
    const list = (items: string[], numbered = false) => items.forEach((it, i) => doc.font("Helvetica").fontSize(10.5).fillColor(ink).text(`${numbered ? `${i + 1}.` : "•"} ${pdfText(it)}`, { indent: 10, lineGap: 2 }));

    doc.font("Helvetica").fontSize(10).fillColor(muted).text(pdfText(data.businessName));
    doc.font("Helvetica-Bold").fontSize(22).fillColor(ink).text(pdfText(data.label));
    doc.font("Helvetica").fontSize(11).fillColor(muted).text(`${pdfText(data.rangeLabel)} · ${data.posts.length} ${data.posts.length === 1 ? "post" : "posts"}`);

    data.posts.forEach((p, idx) => {
      if (idx > 0) doc.addPage();
      else doc.moveDown(1.2);
      doc.font("Helvetica").fontSize(10).fillColor(muted).text(pdfText([p.slotLabel, p.formatLabel, p.pillar].filter(Boolean).join(" · ")));
      doc.font("Helvetica-Bold").fontSize(16).fillColor(ink).text(pdfText(p.title), { lineGap: 2 });
      if (p.hook) doc.font("Helvetica-Oblique").fontSize(11).fillColor(ink).text(`“${pdfText(p.hook)}”`);
      if (inc.captions && p.caption) { h("Caption"); para(p.caption); }
      if (inc.hashtags && p.hashtags.length) { h("Hashtags"); para(p.hashtags.join(" ")); }
      if (inc.creativeDirection && p.creativeDirection) {
        h("Creative direction");
        for (const [k, label] of Object.entries(CREATIVE_LABELS)) {
          const v = p.creativeDirection[k];
          if (v) doc.font("Helvetica-Bold").fontSize(10.5).fillColor(ink).text(`${label}: `, { continued: true }).font("Helvetica").text(pdfText(v), { lineGap: 2 });
        }
      }
      if (inc.whatToProduce && p.whatToProduce) {
        const g = p.whatToProduce;
        h("What to produce");
        para(g.objective);
        if (g.recordingPlan?.length) { doc.moveDown(0.3).font("Helvetica-Bold").text("Recording plan"); list(g.recordingPlan, true); }
        if (g.editing) { doc.moveDown(0.3).font("Helvetica-Bold").text("Editing"); para(g.editing); }
        if (g.assets) { doc.moveDown(0.3).font("Helvetica-Bold").text("Assets"); para(g.assets); }
        if (g.checklist?.length) { doc.moveDown(0.3).font("Helvetica-Bold").text("Checklist"); list(g.checklist); }
      }
    });

    if (inc.shotList && data.shotList) {
      const s = data.shotList;
      doc.addPage();
      doc.font("Helvetica-Bold").fontSize(20).fillColor(ink).text("What to film");
      doc.font("Helvetica").fontSize(11).fillColor(muted).text(pdfText(s.header));
      if (s.title) { doc.moveDown(0.6).font("Helvetica-Bold").fontSize(12).fillColor(ink).text(pdfText(s.title)); }
      para(s.summary);
      if (s.importantNote) { doc.moveDown(0.4).font("Helvetica-Bold").fontSize(10.5).fillColor(accent).text(`! ${pdfText(s.importantNote)}`); }
      if (s.people.length) { h("People"); list(s.people); }
      if (s.locations.length) { h("Location"); list(s.locations); }
      if (s.assets.length) { h("What to have ready"); list(s.assets); }
      for (const g of s.groups) if (g.items.length) { h(g.label); g.items.forEach((i) => doc.font("Helvetica").fontSize(10.5).fillColor(ink).text(`[ ] ${pdfText(i.text)}`, { indent: 10, lineGap: 2 })); }
    }

    doc.moveDown(2).font("Helvetica").fontSize(9).fillColor(muted).text("Made with HustleQ", { align: "center" });
    doc.end();
  });
}

// ---------- .ics (Google, Apple, Outlook) ----------

const icsEscape = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const icsDate = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
// Lines longer than 75 octets are folded (RFC 5545 §3.1).
function fold(line: string) {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let cur = "";
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch, "utf8") > (parts.length ? 74 : 75)) {
      parts.push(cur);
      cur = "";
    }
    cur += ch;
  }
  parts.push(cur);
  return parts.join("\r\n ");
}

export function weekIcs(data: WeekExport) {
  const now = icsDate(new Date());
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//HustleQ//Content plan//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${icsEscape(`${data.businessName} · ${data.label}`)}`];
  for (const p of data.posts) {
    if (!p.scheduledAt) continue;
    const link = appUrl(`/posts/${p.id}`);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${p.id}@hustleq.tech`,
      `DTSTAMP:${now}`,
      `DTSTART:${icsDate(p.scheduledAt)}`,
      "DURATION:PT30M",
      `SUMMARY:${icsEscape(`Post: ${p.title} (${p.formatLabel})`)}`,
      `DESCRIPTION:${icsEscape(`${p.hook ? `${p.hook}\n\n` : ""}Open in HustleQ: ${link}`)}`,
      `URL:${link}`,
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
