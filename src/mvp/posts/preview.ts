import { db } from "../db.js";
import { cachedInstagram } from "../instagram/own.js";
import { signedReadUrls } from "./storage.js";

// Post preview (6.1): what the post page needs to draw the post as it will look on Instagram,
// beyond the post itself: the owner's profile (photo, handle) and the profile grid around it:
// posts already scheduled before this one (newest first), then the latest published posts.

const GRID = 12;

export async function postPreview(userId: string, postId: string) {
  const post = await db.post.findFirst({ where: { id: postId, userId }, select: { id: true, scheduledAt: true } });
  if (!post) return null;
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { instagramHandle: true, business: { select: { businessName: true } } } });
  const bundle = user.instagramHandle ? await cachedInstagram(user.instagramHandle) : null;

  // Scheduled posts that will be published before this one sit above it in the grid.
  const before = post.scheduledAt
    ? await db.post.findMany({
        where: { userId, id: { not: post.id }, status: "scheduled", format: { not: "story" }, scheduledAt: { gt: new Date(), lt: post.scheduledAt } },
        orderBy: { scheduledAt: "desc" },
        take: GRID - 1,
        select: { id: true, title: true, format: true, media: { orderBy: { position: "asc" }, take: 1, select: { kind: true, storagePath: true, framePaths: true } } },
      })
    : [];
  const paths = before.map((p) => p.media[0]).filter(Boolean).map((m) => (m!.kind === "video" ? m!.framePaths[0] : m!.storagePath)).filter((x): x is string => Boolean(x));
  const urls = await signedReadUrls(paths, 3600);
  const planned = before.map((p) => {
    const m = p.media[0];
    const path = m ? (m.kind === "video" ? m.framePaths[0] : m.storagePath) : null;
    return { id: p.id, kind: "planned" as const, format: p.format ?? "feed", title: p.title, imageUrl: path ? urls.get(path) ?? null : null };
  });
  const published = (bundle?.posts ?? [])
    .slice(0, Math.max(0, GRID - 1 - planned.length))
    .map((p) => ({ id: p.id, kind: "published" as const, format: p.format, title: null, imageUrl: p.thumbnailUrl }));

  return {
    handle: user.instagramHandle,
    name: bundle?.profile.name ?? user.business?.businessName ?? null,
    photoUrl: bundle?.profile.photoUrl ?? null,
    grid: [...planned, ...published],
  };
}
