import { db } from "../db.js";
import { cachedInstagram } from "../instagram/own.js";

// Notes (8.1-8.5): ideas saved from the chat, from a post idea, or written by hand, with
// references to the owner's own posts (Explore references come with phase 6).

export class NoteInputError extends Error {}

const SOURCE_LABEL: Record<string, string> = { chat: "from chat", post_idea: "post idea", manual: "", explore: "from Explore" };
const day = (d: Date, tz: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: tz }).format(d);

// A title from the first words, when none is given.
export function titleFrom(text: string) {
  const first = text.trim().split(/(?<=[.!?])\s|\n/)[0] ?? text;
  const words = first.replace(/^note this for later:\s*/i, "").split(/\s+/).slice(0, 6).join(" ");
  return words.replace(/[,;:.!?]+$/, "").replace(/^\w/, (c) => c.toUpperCase()).slice(0, 60) || "Untitled note";
}

type NoteRow = NonNullable<Awaited<ReturnType<typeof loadNote>>>;
async function loadNote(userId: string, id: string) {
  return db.note.findFirst({ where: { id, userId }, include: { references: { orderBy: { createdAt: "asc" } } } });
}

function presentNote(n: NoteRow, tz: string) {
  const refs = n.references.length;
  const origin = refs ? `${refs} ${refs === 1 ? "reference" : "references"}` : SOURCE_LABEL[n.source] ?? "";
  return {
    id: n.id,
    title: n.title ?? titleFrom(n.text),
    text: n.text,
    excerpt: n.text.length > 140 ? `${n.text.slice(0, 137)}…` : n.text,
    source: n.source,
    meta: [day(n.createdAt, tz), origin].filter(Boolean).join(" · "),
    postId: n.postId,
    references: n.references.map((r) => ({ id: r.id, kind: r.kind, label: r.label, url: r.url, thumbnailUrl: r.thumbnailUrl, instagramPostId: r.instagramPostId })),
    history: [
      ...(n.updatedAt.getTime() - n.createdAt.getTime() > 60_000 ? [`${day(n.updatedAt, tz)} · edited`] : []),
      `${day(n.createdAt, tz)} · created`,
    ],
  };
}
export type NoteView = ReturnType<typeof presentNote>;

export async function createNote(userId: string, tz: string, input: { text: string; title?: string | undefined; source?: string | undefined }) {
  const text = input.text.trim();
  if (!text) throw new NoteInputError("Write something first.");
  const n = await db.note.create({ data: { userId, text: text.slice(0, 4000), title: (input.title?.trim() || titleFrom(text)).slice(0, 80), source: input.source ?? "manual" }, include: { references: true } });
  return presentNote(n, tz);
}

export async function listNotes(userId: string, tz: string, q?: string) {
  const query = q?.trim();
  const rows = await db.note.findMany({
    where: { userId, ...(query ? { OR: [{ text: { contains: query, mode: "insensitive" as const } }, { title: { contains: query, mode: "insensitive" as const } }] } : {}) },
    include: { references: true },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
  return rows.map((n) => presentNote(n, tz));
}

export async function getNote(userId: string, tz: string, id: string) {
  const n = await loadNote(userId, id);
  return n ? presentNote(n, tz) : null;
}

export async function updateNote(userId: string, tz: string, id: string, patch: { text?: string | undefined; title?: string | undefined }) {
  const n = await loadNote(userId, id);
  if (!n) return null;
  await db.note.update({ where: { id }, data: { ...(patch.text !== undefined ? { text: patch.text.slice(0, 4000) } : {}), ...(patch.title !== undefined ? { title: patch.title.trim().slice(0, 80) || null } : {}) } });
  return getNote(userId, tz, id);
}

export async function deleteNote(userId: string, id: string) {
  return (await db.note.deleteMany({ where: { id, userId } })).count > 0;
}

// "+ Add from your posts": one of the owner's recent Instagram posts.
export async function addOwnReference(userId: string, tz: string, noteId: string, instagramPostId: string) {
  const n = await loadNote(userId, noteId);
  if (!n) return null;
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const bundle = user.instagramHandle ? await cachedInstagram(user.instagramHandle) : null;
  const post = bundle?.posts.find((p) => p.id === instagramPostId);
  if (!post) throw new NoteInputError("That post isn't in your recent posts.");
  if (n.references.some((r) => r.instagramPostId === instagramPostId)) return presentNote(n, tz);
  await db.noteReference.create({ data: { noteId, instagramPostId, url: post.url, kind: "own", label: `@${user.instagramHandle} · your post`, thumbnailUrl: post.thumbnailUrl } });
  await db.note.update({ where: { id: noteId }, data: { updatedAt: new Date() } });
  return getNote(userId, tz, noteId);
}

export async function removeReference(userId: string, tz: string, noteId: string, refId: string) {
  const r = await db.noteReference.deleteMany({ where: { id: refId, noteId, note: { userId } } });
  return r.count ? getNote(userId, tz, noteId) : null;
}

// What Duke sees when turning a note into a post (8.5).
export async function noteForDuke(userId: string, id: string) {
  const n = await loadNote(userId, id);
  if (!n) return null;
  return {
    noteId: n.id,
    title: n.title ?? titleFrom(n.text),
    text: n.text,
    references: n.references.map((r) => `${r.label ?? r.kind}${r.url ? ` (${r.url})` : ""}`),
  };
}
