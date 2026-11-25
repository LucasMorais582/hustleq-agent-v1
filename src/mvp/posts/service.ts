import { db } from "../db.js";
import { dayInTz, zonedTime } from "../lib/time.js";
import { contentTypeOf, FORMAT_LABEL, FORMATS, postSlot, presentPost, type Format } from "../plan/service.js";
import { IMAGE_TYPES, MAX_BYTES, VIDEO_TYPES, fileInfo, removeFiles, signedReadUrls, signedUpload } from "./storage.js";

// One post (6.1): edit, status, media. Validation (6.2) is in validate.ts, reminders (6.3) in reminders.ts.

export class PostInputError extends Error {}

export const VALIDATIONS_PER_MONTH = Number(process.env.VALIDATIONS_PER_MONTH ?? 30);

type Guidance = { recordingPlan?: string[] } | null;

// Media slots by type: what the post needs ("N of N uploaded") and the most it can hold.
export function mediaSlots(format: string | null, guidance: Guidance) {
  const planned = guidance?.recordingPlan?.length ?? 0;
  switch (format) {
    case "carousel": return { expected: Math.min(Math.max(planned || 3, 2), 10), max: 10, accepts: "image" as const };
    case "story": return { expected: Math.min(Math.max(planned || 1, 1), 3), max: 10, accepts: "any" as const };
    case "reel": return { expected: 1, max: 1, accepts: "video" as const };
    default: return { expected: 1, max: 1, accepts: "image" as const };
  }
}

// First day of the owner's month: monthly limits until billing periods exist (phase 7).
export function monthStart(tz: string, now = new Date()) {
  return new Date(`${dayInTz(now, tz).slice(0, 8)}01T00:00:00Z`);
}

export async function validationsLeft(userId: string, tz: string) {
  const row = await db.usage.findUnique({ where: { userId_kind_periodStart: { userId, kind: "validation", periodStart: monthStart(tz) } } });
  return Math.max(VALIDATIONS_PER_MONTH - (row?.count ?? 0), 0);
}

async function loadPost(userId: string, id: string) {
  return db.post.findFirst({
    where: { id, userId },
    include: { pillar: true, week: true, media: { orderBy: { position: "asc" } }, validations: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
}
type FullPost = NonNullable<Awaited<ReturnType<typeof loadPost>>>;

export async function presentFullPost(p: FullPost, user: { id: string; timezone: string; remindersOn: boolean; reminderTime: string }) {
  const urls = await signedReadUrls(p.media.flatMap((m) => [m.storagePath, ...m.framePaths]));
  const slots = mediaSlots(p.format, p.productionGuidance as Guidance);
  const latest = p.validations[0];
  return {
    ...presentPost(p, user.timezone),
    weekLabel: p.week ? `Week of ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(p.week.startsOn)}` : null,
    weekStatus: p.week?.status ?? null,
    dateLabel: p.scheduledAt ? new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: user.timezone }).format(p.scheduledAt) : null,
    timeSuggested: p.timeSuggested,
    note: p.note,
    reminder: { on: p.reminderEmail, accountOn: user.remindersOn, time: user.reminderTime, sentAt: p.reminderSentAt },
    media: p.media.map((m) => ({
      id: m.id,
      kind: m.kind,
      mimeType: m.mimeType,
      url: urls.get(m.storagePath) ?? null,
      frames: m.framePaths.map((f) => urls.get(f)).filter(Boolean),
      position: m.position,
    })),
    mediaSlots: { ...slots, uploaded: p.media.length },
    validation: latest ? { ...(latest.result as object), createdAt: latest.createdAt } : null,
    validationsLeft: await validationsLeft(user.id, user.timezone),
    editable: p.status !== "posted",
    // Posted and matched with the Instagram post (6.4): its results page (11.7).
    publishedPostId: (await db.postPublication.findUnique({ where: { postId: p.id }, select: { instagramPostId: true } }))?.instagramPostId ?? null,
  };
}

export async function getFullPost(userId: string, id: string) {
  const [p, user] = await Promise.all([loadPost(userId, id), db.user.findUniqueOrThrow({ where: { id: userId } })]);
  return p ? presentFullPost(p, user) : null;
}

export type SlidePatch = { shows: string; text: string; howToShoot: string };
export type PostPatch = {
  slides?: SlidePatch[] | undefined;
  date?: string | undefined;
  time?: string | undefined;
  format?: Format | undefined;
  reminderEmail?: boolean | undefined;
  caption?: string | undefined;
  hashtags?: string[] | undefined;
  note?: string | null | undefined;
  title?: string | undefined;
};

export async function updatePost(userId: string, tz: string, id: string, patch: PostPatch) {
  const p = await db.post.findFirst({ where: { id, userId } });
  if (!p) return null;
  if (p.status === "posted") throw new PostInputError("A posted post can't be edited.");
  const data: Record<string, unknown> = {};
  if (patch.date !== undefined || patch.time !== undefined) {
    const slot = postSlot(p.scheduledAt, tz);
    const date = patch.date ?? slot.date;
    const time = patch.time ?? slot.time ?? "19:00";
    if (!date) throw new PostInputError("Pick a date.");
    data.scheduledAt = zonedTime(date, `${time}:00`, tz);
    data.reminderSentAt = null; // moved: the reminder goes out again on the new day
    if (patch.time !== undefined) data.timeSuggested = false;
  }
  if (patch.format !== undefined) {
    if (!FORMATS.includes(patch.format)) throw new PostInputError("Unknown type.");
    data.format = patch.format;
    data.contentType = contentTypeOf(patch.format);
  }
  if (patch.reminderEmail !== undefined) data.reminderEmail = patch.reminderEmail;
  if (patch.caption !== undefined && patch.caption !== p.caption) {
    data.caption = patch.caption;
    data.captionParts = null; // the owner's text replaces Duke's parts
  }
  if (patch.hashtags !== undefined) data.hashtags = [...new Set(patch.hashtags.map((h) => h.trim()).filter(Boolean).map((h) => (h.startsWith("#") ? h : `#${h}`)))].slice(0, 30);
  if (patch.note !== undefined) data.note = patch.note?.trim() || null;
  if (patch.title !== undefined) data.title = patch.title.trim();
  // Carousel slides live inside What to produce; replacing them keeps the rest of it.
  if (patch.slides !== undefined) data.productionGuidance = { ...((p.productionGuidance as Record<string, unknown> | null) ?? {}), slides: patch.slides };
  await db.post.update({ where: { id }, data });
  return getFullPost(userId, id);
}

// Status (spec 5.6): Draft ↔ Scheduled, either → Cancelled, Cancelled → Draft. Posted is final (6.4, phase 4b).
const MOVES: Record<string, Record<string, string[]>> = {
  schedule: { to: ["scheduled"], from: ["draft"] },
  draft: { to: ["draft"], from: ["scheduled", "cancelled"] },
  cancel: { to: ["cancelled"], from: ["draft", "scheduled"] },
};

export async function setPostStatus(userId: string, id: string, action: keyof typeof MOVES) {
  const p = await db.post.findFirst({ where: { id, userId } });
  if (!p) return null;
  const move = MOVES[action]!;
  const to = move.to![0]!;
  if (p.status !== to) {
    if (!move.from!.includes(p.status)) throw new PostInputError(p.status === "posted" ? "This post is already posted." : `Can't ${action} a ${p.status} post.`);
    if (to === "scheduled" && !p.scheduledAt) throw new PostInputError("Pick a date and time first.");
    await db.post.update({ where: { id }, data: { status: to as "draft" | "scheduled" | "cancelled", ...(to === "scheduled" ? { reminderSentAt: null } : {}) } });
  }
  return getFullPost(userId, id);
}

// ---------- Media ----------

export async function requestUpload(userId: string, postId: string, input: { mimeType: string; size: number; purpose: "media" | "frame" }) {
  const p = await db.post.findFirst({ where: { id: postId, userId }, include: { media: true } });
  if (!p) return null;
  if (p.status === "posted") throw new PostInputError("A posted post can't be changed.");
  const isVideo = VIDEO_TYPES.includes(input.mimeType);
  const isImage = IMAGE_TYPES.includes(input.mimeType);
  if (!isVideo && !isImage) throw new PostInputError("Use a photo (JPG, PNG, WebP, HEIC) or a video (MP4, MOV).");
  if (input.size > MAX_BYTES) throw new PostInputError("This file is over 50 MB. Export the video at 1080p and try again.");
  if (input.purpose === "frame") {
    if (!isImage) throw new PostInputError("Frames are images.");
  } else {
    const slots = mediaSlots(p.format, p.productionGuidance as Guidance);
    if (p.media.length >= slots.max) throw new PostInputError(slots.max === 1 ? "This post has room for one file. Remove it to add another." : `This post holds up to ${slots.max} files.`);
    if (slots.accepts === "image" && !isImage) throw new PostInputError(`A ${FORMAT_LABEL[(p.format ?? "feed") as Format].toLowerCase()} takes photos.`);
    if (slots.accepts === "video" && !isVideo) throw new PostInputError("A Reel takes a video.");
  }
  return signedUpload(userId, postId, input.mimeType);
}

export async function addMedia(userId: string, postId: string, input: { path: string; framePaths: string[] }) {
  const p = await db.post.findFirst({ where: { id: postId, userId }, include: { media: true } });
  if (!p) return null;
  const prefix = `${userId}/${postId}/`;
  for (const path of [input.path, ...input.framePaths]) {
    if (!path.startsWith(prefix) || path.includes("..")) throw new PostInputError("Upload the file again.");
  }
  const info = await fileInfo(input.path);
  if (!info) throw new PostInputError("The upload didn't finish. Try again.");
  const mimeType = info.contentType ?? "application/octet-stream";
  const kind = VIDEO_TYPES.includes(mimeType) ? "video" : "image";
  const slots = mediaSlots(p.format, p.productionGuidance as Guidance);
  if (p.media.length >= slots.max) {
    await removeFiles([input.path, ...input.framePaths]);
    throw new PostInputError(`This post holds up to ${slots.max} ${slots.max === 1 ? "file" : "files"}.`);
  }
  await db.postMedia.create({
    data: { postId, storagePath: input.path, kind, framePaths: kind === "video" ? input.framePaths.slice(0, 6) : [], mimeType, sizeBytes: info.size, position: (p.media.at(-1)?.position ?? -1) + 1 },
  });
  return getFullPost(userId, postId);
}

export async function removeMedia(userId: string, postId: string, mediaId: string) {
  const m = await db.postMedia.findFirst({ where: { id: mediaId, postId, post: { userId } } });
  if (!m) return null;
  await db.postMedia.delete({ where: { id: m.id } });
  await removeFiles([m.storagePath, ...m.framePaths]);
  return getFullPost(userId, postId);
}

export async function reorderMedia(userId: string, postId: string, ids: string[]) {
  const media = await db.postMedia.findMany({ where: { postId, post: { userId } } });
  if (!media.length) return null;
  if (ids.length !== media.length || !media.every((m) => ids.includes(m.id))) throw new PostInputError("Send every file once.");
  await db.$transaction(ids.map((id, position) => db.postMedia.update({ where: { id }, data: { position } })));
  return getFullPost(userId, postId);
}
