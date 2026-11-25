import { db } from "../db.js";
import { AppError } from "../http/errors.js";
import { LIMITS, usageFor, WATCH_SLOTS } from "../billing/service.js";
import { monthStart } from "../posts/service.js";
import { createNote, getNote } from "../notes/service.js";
import { averages, ctx, dukeLine, ratioOf, score, type Ctx } from "../analytics/service.js";
import { keepImages, lastingImages } from "../instagram/thumbs.js";
import { callClaude, textOf } from "../ai/client.js";
import { createHash } from "node:crypto";
import { sda, SocialDataApiError, toFormat, type ApiPost, type DiscoverPost } from "../socialData/api.js";
import { SocialDataUnavailable } from "../socialData/types.js";

// Explore (spec 5.9, screens 9.1 to 9.6): Discover, Watched and Saved.
// Discover reads Helio's /instagram/discover in the background (a cache miss can take minutes there)
// and keeps the result in ExploreCache. The default feed (niche + city) refreshes every 3 days for
// free; a new search term costs 1 of the 20 monthly searches, only when it really went to Instagram.

const FEED_DAYS = 3;
const SEARCH_HOURS = 24;
const MIN_MONTHS = 1;

export type ExplorePost = {
  key: string; // instagramPostId
  url: string | null;
  format: "reel" | "carousel" | "image";
  caption: string | null;
  thumbnailUrl: string | null;
  publishedAt: string | null;
  handle: string | null;
  name: string | null;
  views: number | null;
  likes: number | null;
  likesHidden: boolean;
  comments: number | null;
  source: "explore" | "watched";
  watched?: { id: string; label: string } | undefined;
  ratio?: number | null | undefined;
};

type CacheData = { posts?: DiscoverPost[]; fetchedAt?: string; searchingSince?: string | null; failedAt?: string | null };

const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim().replace(/\s+/g, " ");
const keyOf = (niche: string, city: string, query: string | null) => (query ? `q|${norm(niche)}|${norm(city)}|${norm(query)}` : `feed|${norm(niche)}|${norm(city)}`);

function guardSda(error: unknown): never {
  if (error instanceof AppError) throw error;
  if (error instanceof SocialDataUnavailable) throw new AppError(503, "instagram_unavailable", "We couldn't reach Instagram right now. Try again in a minute.");
  if (error instanceof SocialDataApiError) {
    if (error.code === "PROFILE_NOT_FOUND") throw new AppError(404, "instagram_not_found", "We couldn't find this account on Instagram. Check the @ and that it's public.");
    if (error.code === "COMPETITOR_LIMIT_REACHED") throw new AppError(409, "watch_limit", `You're watching ${WATCH_SLOTS} accounts already.`);
    if (error.code === "COMPETITOR_ALREADY_REGISTERED") throw new AppError(409, "already_watched", "You already watch this account.");
    if (error.status === 404) throw new AppError(404, "not_found", "Not found.");
  }
  throw error;
}

function fromDiscover(p: DiscoverPost): ExplorePost {
  return {
    key: p.instagramPostId, url: p.url, format: toFormat(p.type), caption: p.caption, thumbnailUrl: p.displayUrl, publishedAt: p.timestamp,
    handle: p.ownerUsername, name: p.ownerFullName, views: p.viewsCount, likes: p.likesHidden ? null : p.likesCount, likesHidden: p.likesHidden, comments: p.commentsCount, source: "explore",
  };
}

function fromApiPost(p: ApiPost, handle: string, w: { id: string; label: string }, ratio: number | null): ExplorePost {
  return {
    key: p.instagramPostId, url: p.url, format: toFormat(p.type), caption: p.caption, thumbnailUrl: p.displayUrl ?? p.images[0] ?? null, publishedAt: p.timestamp,
    handle, name: null, views: p.metrics?.viewsCount ?? null, likes: p.metrics?.likesHidden ? null : p.metrics?.likesCount ?? null, likesHidden: Boolean(p.metrics?.likesHidden),
    comments: p.metrics?.commentsCount ?? null, source: "watched", watched: w, ratio,
  };
}

// ---------- Discover (9.1, 9.1b, 9.1c, E.9) ----------

async function searchesLeft(userId: string, tz: string) {
  const u = await usageFor(userId, tz);
  const item = u.items.find((i) => i.kind === "search")!;
  const warning = u.warnings.find((w) => w.kind === "search") ?? null;
  return { used: item.used, limit: item.limit, left: item.left, resetsLabel: u.resetsLabel, warning, canRenew: u.canRenew };
}

async function startSearch(key: string, job: { niche: string; city: string; query: string | null; userId: string | null; tz?: string }) {
  const row = await db.exploreCache.findUnique({ where: { key } });
  const data = (row?.data ?? {}) as CacheData;
  // One search at a time per key; a stuck one (over 30 minutes) can be retried.
  if (data.searchingSince && Date.now() - Date.parse(data.searchingSince) < 30 * 60_000) return;
  const next = { ...data, searchingSince: new Date().toISOString(), failedAt: null };
  await db.exploreCache.upsert({ where: { key }, update: { data: next }, create: { key, data: next, fetchedAt: new Date(0) } });
  // In the background of this process (not pg-boss: a miss can take longer than a job may run).
  // A restart loses it; searchingSince expires after 30 minutes and the next visit starts again.
  void runSearch({ key, ...job });
}

// The job: ask the API until the posts arrive (a miss takes minutes over there), keep the result,
// count the search. The search runs in the API's worker, so a restart here only stops the asking:
// searchingSince expires after 30 minutes and the next visit asks again (by then it's cached there).
export const DISCOVER_POLL_MS = { every: 15_000, giveUpAfter: 28 * 60_000 };

export async function runSearch(job: { key: string; niche: string; city: string; query: string | null; userId: string | null; tz?: string }) {
  try {
    const caller = job.userId ? { userId: job.userId } : ("service" as const);
    const started = Date.now();
    let waited = false;
    let r = await sda.discover({ niche: job.niche, city: job.city, query: job.query }, caller);
    while ("status" in r) {
      if (Date.now() - started > DISCOVER_POLL_MS.giveUpAfter) throw new Error("discover still searching after the wait");
      waited = true;
      await new Promise((ok) => setTimeout(ok, DISCOVER_POLL_MS.every));
      r = await sda.discover({ niche: job.niche, city: job.city, query: job.query }, caller);
    }
    const data: CacheData = { posts: r.posts, fetchedAt: r.fetchedAt, searchingSince: null, failedAt: null };
    await db.exploreCache.update({ where: { key: job.key }, data: { data: data as object, fetchedAt: new Date(r.fetchedAt) } });
    // The reserved search is given back when the API already had it (no new search over there).
    if (job.userId && job.tz && r.fromCache && !waited) await refundSearch(job.userId, job.tz);
  } catch (error) {
    console.error("[explore] search failed", job.key, error);
    const row = await db.exploreCache.findUnique({ where: { key: job.key } });
    await db.exploreCache.update({ where: { key: job.key }, data: { data: { ...((row?.data ?? {}) as CacheData), searchingSince: null, failedAt: new Date().toISOString() } } });
    if (job.userId && job.tz) await refundSearch(job.userId, job.tz);
  }
}

async function reserveSearch(userId: string, tz: string) {
  const periodStart = monthStart(tz);
  const usage = await db.usage.upsert({
    where: { userId_kind_periodStart: { userId, kind: "search", periodStart } },
    update: { count: { increment: 1 } },
    create: { userId, kind: "search", periodStart, count: 1 },
  });
  if (usage.count > LIMITS.search.limit) {
    await db.usage.update({ where: { id: usage.id }, data: { count: { decrement: 1 } } });
    throw new AppError(429, "search_limit", `You’ve used all ${LIMITS.search.limit} searches this month.`);
  }
}
async function refundSearch(userId: string, tz: string) {
  await db.usage.updateMany({ where: { userId, kind: "search", periodStart: monthStart(tz), count: { gt: 0 } }, data: { count: { decrement: 1 } } });
}

async function watchedPosts(c: Ctx, days = 30) {
  const watched = await db.watchedAccount.findMany({ where: { userId: c.userId } });
  const from = new Date(Date.now() - days * 864e5).toISOString();
  const out: ExplorePost[] = [];
  await Promise.all(watched.map(async (w) => {
    try {
      const posts = (await sda.posts(w.instagramProfileId, c.userId, { limit: 50 })).posts;
      const avg = averages(posts);
      for (const p of posts) if ((p.timestamp ?? "") >= from) out.push(fromApiPost(p, w.handle, { id: w.id, label: w.label }, ratioOf(p, avg)));
    } catch (error) {
      console.error("[explore] watched posts failed", w.handle, error instanceof Error ? error.message : error);
    }
  }));
  return out;
}

// The Business Profile says it in the owner's words ("Brazilian-inspired craft cocktails, ...",
// "100th & Lexington, NYC"); Instagram search needs a short niche and the city name. Made once per
// wording with the light model and kept in ExploreCache.
async function searchTerms(userId: string, niche: string, location: string) {
  const key = `terms|${createHash("sha1").update(`${niche}\n${location}`).digest("hex")}`;
  const hit = await db.exploreCache.findUnique({ where: { key } });
  if (hit) return hit.data as { niche: string; city: string };
  let terms = { niche: niche.split(/[,;]/)[0]!.trim().slice(0, 40), city: location.split(",").map((x) => x.trim()).filter(Boolean).slice(-1)[0] ?? location };
  try {
    const msg = await callClaude({ role: "light", feature: "explore_terms", userId, effort: "low" }, {
      system: "Turn a business niche and location into Instagram search terms. Reply with JSON only: {\"niche\": 1 to 3 plain words a customer would search (e.g. \"brazilian bar\", \"cake shop\"), \"city\": the city name only (e.g. \"New York\", \"Newark\")}.",
      messages: [{ role: "user", content: JSON.stringify({ niche, location }) }],
      max_tokens: 1000,
    });
    const parsed = JSON.parse(textOf(msg).replace(/^[^{]*/, "").replace(/[^}]*$/, "")) as { niche?: string; city?: string };
    if (parsed.niche && parsed.city) terms = { niche: parsed.niche.slice(0, 40), city: parsed.city.slice(0, 40) };
  } catch (error) {
    console.error("[explore] search terms", error instanceof Error ? error.message : error);
  }
  await db.exploreCache.upsert({ where: { key }, update: { data: terms }, create: { key, data: terms } });
  return terms;
}

export async function discover(userId: string, input: { query?: string | undefined }) {
  const c = await ctx(userId);
  const bp = await db.businessProfile.findUnique({ where: { userId } });
  const terms = bp?.niche?.trim() && bp.location?.trim() ? await searchTerms(userId, bp.niche.trim(), bp.location.trim()) : null;
  const niche = terms?.niche;
  const city = terms?.city;
  const query = input.query?.trim() || null;
  const searches = await searchesLeft(userId, c.tz);
  const watched = await watchedPosts(c);
  if (!niche || !city) {
    return { status: "missing_profile" as const, niche: niche ?? null, city: city ?? null, query, fetchedAt: null, posts: watched, searches };
  }

  const key = keyOf(niche, city, query);
  const row = await db.exploreCache.findUnique({ where: { key } });
  const data = (row?.data ?? {}) as CacheData;
  const age = data.fetchedAt ? Date.now() - Date.parse(data.fetchedAt) : Infinity;
  const fresh = age < (query ? SEARCH_HOURS * 3600_000 : FEED_DAYS * 864e5);
  let searching = Boolean(data.searchingSince && Date.now() - Date.parse(data.searchingSince) < 30 * 60_000);

  if (!fresh && !searching) {
    if (query) {
      if (searches.left <= 0) throw new AppError(429, "search_limit", `You’ve used all ${searches.limit} searches this month.`);
      await reserveSearch(userId, c.tz);
      await startSearch(key, { niche, city, query, userId, tz: c.tz });
    } else {
      await startSearch(key, { niche, city, query: null, userId: null });
    }
    searching = true;
  }

  const found = (data.posts ?? []).map(fromDiscover);
  const posts = [...found, ...(query ? [] : watched)].sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
  return {
    status: searching && !found.length ? ("searching" as const) : data.failedAt && !found.length ? ("failed" as const) : ("ready" as const),
    refreshing: searching && found.length > 0,
    niche, city, query,
    fetchedAt: data.fetchedAt ?? null,
    posts,
    searches: query || !fresh ? await searchesLeft(userId, c.tz) : searches,
  };
}

// ---------- Watched (9.3, 9.4, 9.4b, 9.5) ----------

const addMonths = (d: Date, n: number) => { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; };

export async function listWatched(userId: string) {
  const c = await ctx(userId);
  const rows = await db.watchedAccount.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
  const items = await Promise.all(rows.map(async (w) => {
    let p: Awaited<ReturnType<typeof sda.profile>> | null = null;
    try { p = await sda.profile(w.instagramProfileId, c.userId); } catch { /* shown without numbers */ }
    const photo = p?.profilePhoto ? (await lastingImages(w.instagramProfileId, [{ key: "profile", src: p.profilePhoto }])).get("profile") : null;
    return {
      id: w.id, handle: w.handle, label: w.label, name: p?.name ?? null, photoUrl: photo ?? null,
      followers: p?.metrics?.followers ?? null, syncing: p ? p.syncStatus !== "ready" && !p.lastSyncedAt : false,
      since: w.createdAt.toISOString(), canRemoveFrom: (w.minUntil ?? w.createdAt).toISOString(), canRemove: !w.minUntil || w.minUntil <= new Date(),
    };
  }));
  return { items, slots: WATCH_SLOTS, left: Math.max(0, WATCH_SLOTS - rows.length) };
}

// 9.4b: confirm the account before watching it (one profile lookup).
export async function checkAccount(userId: string, rawHandle: string) {
  const c = await ctx(userId);
  const handle = rawHandle.replace(/^@/, "").trim().toLowerCase();
  if ((await db.watchedAccount.count({ where: { userId } })) >= WATCH_SLOTS) throw new AppError(409, "watch_limit", `You're watching ${WATCH_SLOTS} accounts already. Each one stays at least a month.`);
  if (await db.watchedAccount.findFirst({ where: { userId, handle } })) throw new AppError(409, "already_watched", "You already watch this account.");
  const own = await db.user.findUnique({ where: { id: userId }, select: { instagramHandle: true } });
  if (own?.instagramHandle === handle) throw new AppError(400, "own_account", "That's your own account. Its numbers are in Analytics.");
  try {
    const found = await sda.search(handle, c.userId);
    if (!found) throw new AppError(404, "instagram_not_found", `We couldn't find @${handle} on Instagram. Check the @ and that it's public.`);
    return { profile: found.profile };
  } catch (error) {
    guardSda(error);
  }
}

export async function watchAccount(userId: string, rawHandle: string, label: "competitor" | "inspiration") {
  const c = await ctx(userId);
  const handle = rawHandle.replace(/^@/, "").trim().toLowerCase();
  if ((await db.watchedAccount.count({ where: { userId } })) >= WATCH_SLOTS) throw new AppError(409, "watch_limit", `You're watching ${WATCH_SLOTS} accounts already.`);
  try {
    const rel = await sda.addCompetitor(c.profileId, c.userId, handle);
    const now = new Date();
    const row = await db.watchedAccount.upsert({
      where: { userId_instagramProfileId: { userId, instagramProfileId: rel.competitorProfileId } },
      update: { handle, label, minUntil: addMonths(now, MIN_MONTHS), createdAt: now },
      create: { userId, instagramProfileId: rel.competitorProfileId, handle, label, minUntil: addMonths(now, MIN_MONTHS) },
    });
    return { id: row.id };
  } catch (error) {
    guardSda(error);
  }
}

export async function unwatchAccount(userId: string, id: string) {
  const c = await ctx(userId);
  const w = await db.watchedAccount.findFirst({ where: { id, userId } });
  if (!w) throw new AppError(404, "not_found", "Account not found.");
  if (w.minUntil && w.minUntil > new Date()) {
    throw new AppError(409, "too_soon", `Each account stays at least a month. You can change this one from ${w.minUntil.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: c.tz })}.`);
  }
  try {
    const rel = (await sda.competitors(c.profileId, c.userId)).find((r) => r.competitorProfileId === w.instagramProfileId);
    if (rel) await sda.endCompetitor(c.profileId, c.userId, rel.id);
  } catch (error) {
    guardSda(error);
  }
  await db.watchedAccount.delete({ where: { id } });
  return { ok: true };
}

export async function watchedAccount(userId: string, id: string, withDuke = true) {
  const c = await ctx(userId);
  const w = await db.watchedAccount.findFirst({ where: { id, userId } });
  if (!w) throw new AppError(404, "not_found", "Account not found.");
  try {
    const [p, posts] = await Promise.all([sda.profile(w.instagramProfileId, c.userId), sda.posts(w.instagramProfileId, c.userId, { limit: 50 })]);
    const avg = averages(posts.posts);
    const last30 = posts.posts.filter((x) => (x.timestamp ?? "") >= new Date(Date.now() - 30 * 864e5).toISOString());
    const likes = last30.filter((x) => !x.metrics?.likesHidden && x.metrics?.likesCount != null);
    const recent = posts.posts.slice(0, 12).map((x) => fromApiPost(x, w.handle, { id: w.id, label: w.label }, ratioOf(x, avg)));
    const images = await lastingImages(w.instagramProfileId, [{ key: "profile", src: p.profilePhoto }, ...recent.map((r) => ({ key: r.key, src: r.thumbnailUrl }))]);
    const stats = {
      followers: p.metrics?.followers ?? null,
      postsPerWeek: Math.round((last30.length / (30 / 7)) * 10) / 10,
      avgLikes: likes.length ? Math.round(likes.reduce((s, x) => s + x.metrics!.likesCount!, 0) / likes.length) : null,
    };
    const best = [...posts.posts].sort((a, b) => (ratioOf(b, avg) ?? 0) - (ratioOf(a, avg) ?? 0))[0];
    const comment = posts.posts.length >= 3
      ? await dukeLine(userId, `watched:${w.id}`, "This is an account the owner watches (a competitor or an inspiration). Say what works for them and one idea the owner could borrow, in their own way. Never suggest copying.", {
          handle: w.handle, label: w.label, ...stats,
          bestPost: best ? { format: toFormat(best.type), timesTheirUsual: ratioOf(best, avg), caption: best.caption?.slice(0, 300), metric: score(best).metric } : null,
        }, withDuke)
      : null;
    return {
      id: w.id, handle: w.handle, label: w.label, name: p.name, bio: p.bio, photoUrl: images.get("profile") ?? null,
      since: w.createdAt.toISOString(), canRemoveFrom: (w.minUntil ?? w.createdAt).toISOString(), canRemove: !w.minUntil || w.minUntil <= new Date(),
      syncing: p.syncStatus !== "ready" && !p.lastSyncedAt,
      stats,
      posts: recent.map((r) => ({ ...r, thumbnailUrl: images.get(r.key) ?? r.thumbnailUrl })),
      comment,
    };
  } catch (error) {
    guardSda(error);
  }
}

// ---------- Saved (9.6) and actions from a post (9.2) ----------

export async function listSaved(userId: string) {
  const rows = await db.savedPost.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 200 });
  const posts = rows.map((r) => ({ ...(r.data as ExplorePost | null), key: r.instagramPostId, source: r.source, savedAt: r.createdAt.toISOString(), id: r.id }));
  const images = await lastingImages(`saved-${userId}`, posts.map((p) => ({ key: p.key, src: p.thumbnailUrl ?? null })));
  return { items: posts.map((p) => ({ ...p, thumbnailUrl: images.get(p.key) ?? null })) };
}

export async function savePost(userId: string, post: ExplorePost) {
  const row = await db.savedPost.upsert({
    where: { userId_instagramPostId: { userId, instagramPostId: post.key } },
    update: { data: post as object, source: post.source },
    create: { userId, instagramPostId: post.key, data: post as object, source: post.source },
  });
  void keepImages(`saved-${userId}`, [{ key: post.key, src: post.thumbnailUrl }]).catch(() => undefined);
  return { id: row.id, saved: true };
}

export async function unsavePost(userId: string, key: string) {
  await db.savedPost.deleteMany({ where: { userId, instagramPostId: key } });
  return { saved: false };
}

export async function savedKeys(userId: string) {
  return (await db.savedPost.findMany({ where: { userId }, select: { instagramPostId: true } })).map((r) => r.instagramPostId);
}

const refLabel = (p: ExplorePost) => `@${p.handle ?? "account"} · ${p.source === "watched" ? `watched ${p.watched?.label ?? ""}`.trim() : "Explore"}`;

// "Add to a note": an existing note, or a new one with this post as its reference.
export async function addToNote(userId: string, tz: string, post: ExplorePost, noteId?: string) {
  let id = noteId;
  if (id) {
    if (!(await getNote(userId, tz, id))) throw new AppError(404, "not_found", "Note not found.");
  } else {
    const text = `Idea from @${post.handle ?? "an account"}'s ${post.format === "reel" ? "Reel" : post.format === "carousel" ? "carousel" : "post"}.${post.caption ? `\n\nTheir caption: ${post.caption.slice(0, 400)}` : ""}`;
    id = (await createNote(userId, tz, { text, title: `Idea from @${post.handle ?? "Explore"}`, source: "explore" })).id;
  }
  const exists = await db.noteReference.findFirst({ where: { noteId: id, instagramPostId: post.key } });
  if (!exists) await db.noteReference.create({ data: { noteId: id, instagramPostId: post.key, url: post.url, kind: "explore", label: refLabel(post), thumbnailUrl: post.thumbnailUrl } });
  void keepImages(`saved-${userId}`, [{ key: post.key, src: post.thumbnailUrl }]).catch(() => undefined);
  return { noteId: id };
}
