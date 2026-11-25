import { db } from "../db.js";
import { isApiMode, socialData, type IgPost, type IgProfileBundle } from "../socialData/index.js";
import { ownBundle } from "../socialData/api.js";
import { linkUser } from "./link.js";
import { keepImages } from "./thumbs.js";

// The user's own Instagram, read through the Social Data adapter and kept for a day.
// Synced when the invite is created, so onboarding (2.1, 2.2) opens with data.

const DAY = 24 * 3600_000;

export async function cachedInstagram(handle: string): Promise<IgProfileBundle | null> {
  const row = await db.instagramCache.findUnique({ where: { handle } });
  return row ? (row.data as unknown as IgProfileBundle) : null;
}

export async function syncInstagram(handle: string, { maxAgeMs = DAY, waitMs = 150_000 } = {}) {
  const row = await db.instagramCache.findUnique({ where: { handle } });
  if (row && Date.now() - row.fetchedAt.getTime() < maxAgeMs) return row.data as unknown as IgProfileBundle;
  const bundle = isApiMode() ? await readFromApi(handle, waitMs) : await socialData().lookupProfile(handle);
  if (!bundle) return null;
  await db.instagramCache.upsert({
    where: { handle },
    update: { profileId: bundle.profile.id, data: bundle as object, source: bundle.source, fetchedAt: new Date() },
    create: { handle, profileId: bundle.profile.id, data: bundle as object, source: bundle.source },
  });
  return bundle;
}

// api mode: the API collects on its own (first sync at invite time, then every day at 4 AM New York);
// we read what it stored. Only a user who owns the profile there can read it.
async function readFromApi(handle: string, waitMs: number): Promise<IgProfileBundle | null> {
  const user = await db.user.findFirst({ where: { instagramHandle: handle }, orderBy: { createdAt: "desc" }, select: { id: true } });
  if (!user) return null; // invite not accepted yet: nothing we may read
  const profileId = await linkUser(user.id);
  if (!profileId) return null;
  const deadline = Date.now() + waitMs;
  for (;;) {
    const read = await ownBundle(profileId, user.id);
    if (read.syncStatus === "ready" || read.lastSyncedAt) {
      // Keep our own copy of the covers while Instagram's links still work (they expire in ~5 days).
      void keepImages(profileId, read.bundle.posts.map((p) => ({ key: p.id, src: p.thumbnailUrl }))).catch((e) => console.error("[thumbs]", e));
      return read.bundle; // a failed daily run keeps the last data
    }
    if (read.syncStatus === "failed") throw new Error(`Social Data API sync failed for @${handle}`);
    // First sync still running over there (about 2 minutes after the invite).
    if (Date.now() > deadline) throw new Error(`Social Data API still syncing @${handle}`);
    await new Promise((r) => setTimeout(r, 10_000));
  }
}

// Numbers Duke may quote: computed here, never by the model.
export function formatStats(posts: IgPost[]) {
  const by: Record<string, { posts: number; likes: number; comments: number; views: number; viewsCount: number }> = {};
  for (const p of posts) {
    const s = (by[p.format] ??= { posts: 0, likes: 0, comments: 0, views: 0, viewsCount: 0 });
    s.posts += 1;
    s.likes += p.likes ?? 0;
    s.comments += p.comments ?? 0;
    if (p.views != null) { s.views += p.views; s.viewsCount += 1; }
  }
  const formats = Object.entries(by).map(([format, s]) => ({
    format,
    posts: s.posts,
    avgLikes: Math.round(s.likes / s.posts),
    avgComments: Math.round(s.comments / s.posts),
    avgViews: s.viewsCount ? Math.round(s.views / s.viewsCount) : null,
  }));
  // "Best" = most interactions per post, only among formats with 3+ posts (spec: no comparison below 3).
  const comparable = formats.filter((f) => f.posts >= 3);
  const best = comparable.sort((a, b) => b.avgLikes + b.avgComments - (a.avgLikes + a.avgComments))[0] ?? null;
  return { formats, bestFormat: best?.format ?? null };
}

export const FORMAT_LABEL: Record<string, string> = { reel: "Reels", carousel: "Carousels", image: "Single images" };
