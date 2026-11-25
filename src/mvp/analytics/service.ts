import { db } from "../db.js";
import { AppError } from "../http/errors.js";
import { addDays, dayInTz, daysBetween } from "../lib/time.js";
import { callClaude, textOf } from "../ai/client.js";
import { planStateOf } from "../billing/service.js";
import { linkUser } from "../instagram/link.js";
import { lastingImages } from "../instagram/thumbs.js";
import { isApiMode } from "../socialData/index.js";
import { sda, SocialDataApiError, toFormat, type ApiPost, type ApiProfileSnapshot } from "../socialData/api.js";
import { SocialDataUnavailable } from "../socialData/types.js";

// Analytics (spec 5.11, screens 11.1 to 11.7c). Raw data comes from the Social Data API; every number
// here is computed by us. Duke's lines are short Claude calls, cached for the day.

export const REFRESH_PER_DAY = 2;
const EARLY_DAYS = 14; // before 2 weeks of history: show the last 12 posts (11.4)
const BADGE_FROM = 1.5; // "N× usual" from 1.5×
const FORMAT_LABEL: Record<string, string> = { reel: "Reel", carousel: "Carousel", image: "Feed post" };

export type Ctx = { userId: string; tz: string; profileId: string; joinedDay: string; planActive: boolean };

export async function ctx(userId: string): Promise<Ctx> {
  if (!isApiMode()) throw new AppError(503, "analytics_unavailable", "Analytics needs the Instagram data connection, which isn't on here.");
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, include: { subscription: true } });
  let profileId: string | null;
  try {
    profileId = await linkUser(userId);
  } catch (error) {
    throw unavailable(error);
  }
  if (!profileId) throw new AppError(409, "instagram_missing", "Add your Instagram first.");
  return { userId, tz: user.timezone, profileId, joinedDay: dayInTz(user.createdAt, user.timezone), planActive: planStateOf(user, user.subscription).state === "active" };
}

function unavailable(error: unknown) {
  if (error instanceof AppError) return error;
  if (error instanceof SocialDataUnavailable) return new AppError(503, "instagram_unavailable", "We couldn't reach your Instagram data right now. Try again in a minute.");
  if (error instanceof SocialDataApiError && error.status === 404) return new AppError(404, "not_found", "We couldn't find this post.");
  if (error instanceof SocialDataApiError && error.status === 403) return new AppError(404, "not_found", "We couldn't find this post.");
  return error;
}

async function guard<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (error) {
    throw unavailable(error);
  }
}

// ---------- Periods ----------

export type PeriodInput = { days?: number | undefined; from?: string | undefined; to?: string | undefined };
type Period = { from: string; to: string; days: number };

function period(c: Ctx, p: PeriodInput): Period {
  const today = dayInTz(new Date(), c.tz);
  if (p.from && p.to && p.from <= p.to) {
    const to = p.to > today ? today : p.to;
    return { from: p.from, to, days: daysBetween(p.from, to) + 1 };
  }
  const days = [7, 15, 30, 90].includes(p.days ?? 0) ? p.days! : 30;
  return { from: addDays(today, -(days - 1)), to: today, days };
}

// Day boundaries in the account's time zone, as instants for the API.
const startOf = (day: string, tz: string) => zonedMidnight(day, tz).toISOString();
const endOf = (day: string, tz: string) => new Date(zonedMidnight(addDays(day, 1), tz).getTime() - 1).toISOString();
function zonedMidnight(day: string, tz: string) {
  const guess = new Date(`${day}T00:00:00Z`);
  const local = new Date(guess.toLocaleString("en-US", { timeZone: tz }));
  return new Date(guess.getTime() + (guess.getTime() - local.getTime()));
}

// ---------- Posts and averages ----------

async function postsIn(c: Ctx, q: { from?: string; to?: string; type?: "IMAGE" | "CAROUSEL" | "REEL" }, max = 200) {
  const out: ApiPost[] = [];
  for (let page = 1; out.length < max; page++) {
    const r = await sda.posts(c.profileId, c.userId, { ...q, page, limit: 50 });
    out.push(...r.posts);
    if (page >= r.pagination.totalPages) break;
  }
  return out.slice(0, max);
}

// The number a post is judged by: views for Reels, likes otherwise (comments when likes are hidden).
export function score(p: ApiPost): { metric: "views" | "likes" | "comments"; value: number | null } {
  const m = p.metrics;
  if (p.type === "REEL" && m?.viewsCount != null) return { metric: "views", value: m.viewsCount };
  if (m?.likesHidden) return { metric: "comments", value: m.commentsCount };
  return { metric: "likes", value: m?.likesCount ?? null };
}

type Averages = Map<string, number>; // key `${format}:${metric}`
export function averages(base: ApiPost[]): Averages {
  const sums = new Map<string, { total: number; n: number }>();
  for (const p of base) {
    const f = toFormat(p.type);
    const m = p.metrics;
    const add = (metric: string, v: number | null | undefined) => {
      if (v == null) return;
      const s = sums.get(`${f}:${metric}`) ?? { total: 0, n: 0 };
      s.total += v;
      s.n += 1;
      sums.set(`${f}:${metric}`, s);
    };
    if (p.type === "REEL") add("views", m?.viewsCount);
    if (!m?.likesHidden) add("likes", m?.likesCount);
    add("comments", m?.commentsCount);
  }
  // Fewer than 3 posts of a format: no comparison (spec 6: "not enough to compare").
  return new Map([...sums].filter(([, s]) => s.n >= 3).map(([k, s]) => [k, s.total / s.n]));
}

export function ratioOf(p: ApiPost, avg: Averages) {
  const s = score(p);
  const base = avg.get(`${toFormat(p.type)}:${s.metric}`);
  if (s.value == null || !base) return null;
  return Math.round((s.value / base) * 100) / 100;
}

// The latest 50 posts are the base for "usual".
const baseCache = new Map<string, { at: number; posts: ApiPost[] }>();
async function basePosts(c: Ctx) {
  const hit = baseCache.get(c.profileId);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.posts;
  const posts = (await sda.posts(c.profileId, c.userId, { limit: 50 })).posts;
  baseCache.set(c.profileId, { at: Date.now(), posts });
  return posts;
}

// Posts made with the app: plan title, pillar, campaign (with its color) or weekly plan.
async function planLinks(userId: string, ids: string[]) {
  if (!ids.length) return new Map<string, PlanLink>();
  const rows = await db.postPublication.findMany({
    where: { instagramPostId: { in: ids }, post: { userId } },
    include: { post: { include: { pillar: true, campaign: true } } },
  });
  const strategyIds = [...new Set(rows.map((r) => r.post.pillar?.strategyId).filter((x): x is string => Boolean(x)))];
  const strategies = strategyIds.length ? await db.strategy.findMany({ where: { id: { in: strategyIds } }, select: { id: true, name: true } }) : [];
  return new Map(
    rows.map((r) => [
      r.instagramPostId,
      {
        postId: r.post.id,
        title: r.post.title,
        pillar: r.post.pillar?.name ?? null,
        strategy: strategies.find((s) => s.id === r.post.pillar?.strategyId)?.name ?? null,
        campaign: r.post.campaign ? { id: r.post.campaign.id, name: r.post.campaign.name, color: r.post.campaign.color } : null,
        weekly: Boolean(r.post.weekId),
        scheduledAt: r.post.scheduledAt,
      },
    ])
  );
}
type PlanLink = { postId: string; title: string | null; pillar: string | null; strategy: string | null; campaign: { id: string; name: string; color: string } | null; weekly: boolean; scheduledAt: Date | null };

const firstLine = (caption: string | null) => (caption ?? "").split("\n").map((l) => l.trim()).find(Boolean)?.slice(0, 90) ?? null;

async function cards(c: Ctx, posts: ApiPost[], avg: Averages) {
  const [links, images] = await Promise.all([
    planLinks(c.userId, posts.map((p) => p.id)),
    lastingImages(c.profileId, posts.map((p) => ({ key: p.id, src: p.displayUrl ?? p.images[0] ?? null }))),
  ]);
  return posts.map((p) => {
    const plan = links.get(p.id) ?? null;
    return {
      id: p.id,
      format: toFormat(p.type),
      title: plan?.title ?? firstLine(p.caption) ?? FORMAT_LABEL[toFormat(p.type)],
      thumbnailUrl: images.get(p.id) ?? null,
      publishedAt: p.timestamp,
      url: p.url,
      views: p.metrics?.viewsCount ?? null,
      likes: p.metrics?.likesHidden ? null : p.metrics?.likesCount ?? null,
      likesHidden: Boolean(p.metrics?.likesHidden),
      comments: p.metrics?.commentsCount ?? null,
      ratio: ratioOf(p, avg),
      plan: plan && { postId: plan.postId, pillar: plan.pillar, campaign: plan.campaign, weekly: plan.weekly },
    };
  });
}
export type PostCard = Awaited<ReturnType<typeof cards>>[number];

// ---------- Duke's lines (cached for the day) ----------

const lines = new Map<string, string>();
// `withDuke` false: return only a line already cached (the app asks again with it on, so the
// numbers show at once and Duke's line arrives a few seconds later).
export async function dukeLine(userId: string, key: string, instruction: string, facts: object, withDuke = true) {
  const k = `${userId}|${key}|${new Date().toISOString().slice(0, 10)}`;
  const hit = lines.get(k);
  if (hit || !withDuke) return hit ?? null;
  try {
    const msg = await callClaude(
      { role: "light", feature: "analytics_comment", userId, effort: "low" },
      {
        system:
          "You are Duke, the content strategist in HustleQ, talking to a small business owner about their own Instagram. " +
          "Write 1 or 2 short sentences, warm and direct, no greeting, no emoji, no markdown. Use only the numbers given; never invent or compute new percentages. " +
          "End with one concrete next step when there is one. " +
          instruction,
        messages: [{ role: "user", content: JSON.stringify(facts) }],
        max_tokens: 2000,
      }
    );
    const text = textOf(msg).trim();
    if (text) lines.set(k, text);
    return text || null;
  } catch (error) {
    console.error("[analytics] duke line failed", error);
    return null;
  }
}

// ---------- 11.1, 11.2, 11.4 Overview ----------

function followersIn(snaps: ApiProfileSnapshot[], tz: string) {
  // One point per day (the last of the day).
  const byDay = new Map<string, number>();
  for (const s of snaps) if (s.followers != null) byDay.set(dayInTz(new Date(s.collectedAt), tz), s.followers);
  return [...byDay].map(([day, followers]) => ({ day, followers }));
}

export async function overview(userId: string, input: PeriodInput, withDuke = true) {
  const c = await ctx(userId);
  return guard(async () => {
    const per = period(c, input);
    const [profile, allSnaps, base] = await Promise.all([
      sda.profile(c.profileId, c.userId),
      sda.snapshots(c.profileId, c.userId),
      basePosts(c),
    ]);
    const historyStart = allSnaps[0] ? dayInTz(new Date(allSnaps[0].collectedAt), c.tz) : dayInTz(new Date(), c.tz);
    const early = daysBetween(historyStart, dayInTz(new Date(), c.tz)) < EARLY_DAYS;
    const series = followersIn(allSnaps.filter((s) => { const d = dayInTz(new Date(s.collectedAt), c.tz); return d >= per.from && d <= per.to; }), c.tz);
    const followersChange = series.length >= 2 ? series.at(-1)!.followers - series[0]!.followers : null;

    const posts = early ? base.slice(0, 12) : await postsIn(c, { from: startOf(per.from, c.tz), to: endOf(per.to, c.tz) });
    const avg = averages(base);
    const sum = (f: (p: ApiPost) => number | null | undefined) => posts.reduce((s, p) => s + (f(p) ?? 0), 0);
    const byFormat = ["reel", "carousel", "image"].map((f) => {
      const list = posts.filter((p) => toFormat(p.type) === f && !p.metrics?.likesHidden && p.metrics?.likesCount != null);
      return { format: f, label: FORMAT_LABEL[f]!, posts: posts.filter((p) => toFormat(p.type) === f).length, avgLikes: list.length ? Math.round(list.reduce((s, p) => s + p.metrics!.likesCount!, 0) / list.length) : null };
    }).filter((f) => f.posts > 0);
    const ranked = [...posts].sort((a, b) => (ratioOf(b, avg) ?? 0) - (ratioOf(a, avg) ?? 0) || (score(b).value ?? 0) - (score(a).value ?? 0));
    const best = await cards(c, ranked.slice(0, 3), avg);
    const weeks = Math.max(1, per.days / 7);
    const stats = {
      count: posts.length,
      perWeek: early ? null : Math.round((posts.length / weeks) * 10) / 10,
      likes: sum((p) => (p.metrics?.likesHidden ? 0 : p.metrics?.likesCount)),
      comments: sum((p) => p.metrics?.commentsCount),
      views: sum((p) => p.metrics?.viewsCount),
      hiddenLikes: posts.filter((p) => p.metrics?.likesHidden).length,
    };
    const summary = await dukeLine(userId, `overview:${per.from}:${per.to}:${early}`, early
      ? "History is still forming (under 2 weeks). Say what the last 12 posts show and that period comparisons come after 2 to 3 weeks."
      : "Summarize how the account did in this period and what to keep doing.", {
      period: `${per.from} to ${per.to}`, followers: profile.metrics?.followers ?? null, followersChange, posts: stats, byFormat,
      bestPost: best[0] ? { format: best[0].format, views: best[0].views, likes: best[0].likes, timesUsual: best[0].ratio } : null,
    }, withDuke);
    return {
      period: { ...per, label: input.from ? "custom" : `${per.days}d` },
      early,
      historyStart,
      joinedDay: c.joinedDay,
      profile: { followers: profile.metrics?.followers ?? null, following: profile.metrics?.following ?? null, postsCount: profile.metrics?.postsCount ?? null, updatedAt: profile.lastSyncedAt },
      followersChange,
      followersSeries: series,
      posts: { ...stats, byFormat, best },
      summary,
    };
  });
}

// ---------- 11.6, 11.6b Your posts ----------

export async function yourPosts(userId: string, input: PeriodInput & { type?: string | undefined; sort?: string | undefined }) {
  const c = await ctx(userId);
  return guard(async () => {
    const per = period(c, input);
    const type = ({ reel: "REEL", carousel: "CAROUSEL", image: "IMAGE" } as const)[input.type as "reel"] ?? undefined;
    const monthStart = `${dayInTz(new Date(), c.tz).slice(0, 8)}01`;
    const [profile, snaps, base, posts] = await Promise.all([
      sda.profile(c.profileId, c.userId),
      sda.snapshots(c.profileId, c.userId, { from: startOf(monthStart, c.tz) }),
      basePosts(c),
      postsIn(c, { from: startOf(per.from, c.tz), to: endOf(per.to, c.tz), ...(type ? { type } : {}) }),
    ]);
    const avg = averages(base);
    const list = input.sort === "best"
      ? [...posts].sort((a, b) => (ratioOf(b, avg) ?? -1) - (ratioOf(a, avg) ?? -1))
      : posts;
    const firstFollowers = snaps.find((s) => s.followers != null)?.followers ?? null;
    const photo = profile.profilePhoto ? (await lastingImages(c.profileId, [{ key: "profile", src: profile.profilePhoto }])).get("profile") : null;
    return {
      period: { ...per, label: input.from ? "custom" : `${per.days}d` },
      profile: {
        name: profile.name, handle: profile.username, photoUrl: photo ?? null,
        posts: profile.metrics?.postsCount ?? null, followers: profile.metrics?.followers ?? null, following: profile.metrics?.following ?? null,
        followersThisMonth: firstFollowers != null && profile.metrics?.followers != null ? profile.metrics.followers - firstFollowers : null,
        updatedAt: profile.lastSyncedAt,
      },
      badgeFrom: BADGE_FROM,
      posts: await cards(c, list, avg),
    };
  });
}

// ---------- 11.7, 11.7b, 11.7c Published post ----------

async function refreshState(c: Ctx) {
  const day = new Date(`${dayInTz(new Date(), c.tz)}T00:00:00Z`);
  const row = await db.refreshUsage.findUnique({ where: { userId_instagramProfileId_day: { userId: c.userId, instagramProfileId: c.profileId, day } } });
  const used = row?.count ?? 0;
  return { used, left: Math.max(0, REFRESH_PER_DAY - used), limit: REFRESH_PER_DAY, day };
}

export async function publishedPost(userId: string, postId: string, withDuke = true) {
  const c = await ctx(userId);
  return guard(async () => {
    // Older than 24 h: the API starts the open-time fetch on its own and answers with the last numbers.
    const [{ post, refreshing }, metrics, base, refresh] = await Promise.all([
      sda.post(postId, c.userId),
      sda.postMetrics(postId, c.userId),
      basePosts(c),
      refreshState(c),
    ]);
    const avg = averages(base);
    const [card] = await cards(c, [post], avg);
    const links = await planLinks(c.userId, [post.id]);
    const plan = links.get(post.id) ?? null;
    const recent = base.slice(0, 12).some((p) => p.id === post.id);
    const s = score(post);
    const format = toFormat(post.type);
    const usual = avg.get(`${format}:${s.metric}`) ?? null;
    const ageDays = post.timestamp ? (Date.now() - Date.parse(post.timestamp)) / 864e5 : 0;
    const young = ageDays < 3; // compare with the usual only after 3 days
    const comment = await dukeLine(userId, `post:${post.id}:${post.metrics?.collectedAt ?? ""}`,
      young
        ? "The post is under 3 days old: describe its numbers so far without judging them, and say you'll compare it with their usual after 3 days."
        : post.metrics?.likesHidden
          ? "Likes are hidden on this post, so compare comments with the usual for the format."
          : "Compare this post with the usual for its format (timesUsual is the ratio) and say what to repeat.",
      { format: FORMAT_LABEL[format], views: post.metrics?.viewsCount, likes: post.metrics?.likesHidden ? "hidden" : post.metrics?.likesCount, comments: post.metrics?.commentsCount, ...(young ? {} : { timesUsual: card!.ratio, usual: usual && Math.round(usual), comparedBy: s.metric }), daysSincePosting: Math.floor(ageDays), fromPlan: plan ? { pillar: plan.pillar, campaign: plan.campaign?.name } : null }, withDuke);
    return {
      post: { ...card!, caption: post.caption, hashtags: post.hashtags, images: post.images.length },
      updatedAt: post.metrics?.collectedAt ?? null,
      updating: refreshing,
      recent, // one of the 12 latest: updates every morning
      series: metrics.map((m) => ({ at: m.collectedAt, views: m.viewsCount, likes: m.likesHidden ? null : m.likesCount, comments: m.commentsCount })),
      usual: { metric: s.metric, value: usual && Math.round(usual) },
      comment,
      plan: plan && { ...plan, scheduledAt: plan.scheduledAt?.toISOString() ?? null },
      refresh: { left: refresh.left, limit: refresh.limit, allowed: c.planActive && !refreshing },
    };
  });
}

// "Refresh now": 2 a day per account (all posts together), reset at midnight in the account's time zone.
export async function refreshPost(userId: string, postId: string) {
  const c = await ctx(userId);
  if (!c.planActive) throw new AppError(402, "plan_inactive", "Your plan is paused. Numbers keep updating every morning.");
  const r = await refreshState(c);
  if (r.left <= 0) throw new AppError(429, "refresh_limit", "You used your 2 refreshes. Numbers still update on their own every morning while this is one of your 12 latest posts.");
  await guard(() => sda.refreshPost(postId, c.userId));
  await db.refreshUsage.upsert({
    where: { userId_instagramProfileId_day: { userId: c.userId, instagramProfileId: c.profileId, day: r.day } },
    update: { count: { increment: 1 } },
    create: { userId: c.userId, instagramProfileId: c.profileId, day: r.day, count: 1 },
  });
  return { refreshing: true, left: r.left - 1 };
}

// ---------- 11.3 Compare ----------

// Growth goes to Duke as "-0.3%" text, so it can't be read as a fraction.
const pct = <T extends { followerGrowth: number | null }>(s: T) => ({ ...s, followerGrowth: s.followerGrowth == null ? null : `${s.followerGrowth}%` });

export async function compare(userId: string, input: PeriodInput, withDuke = true) {
  const c = await ctx(userId);
  return guard(async () => {
    const per = period(c, input);
    const watched = await db.watchedAccount.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
    const range = { from: startOf(per.from, c.tz), to: endOf(per.to, c.tz) };
    const statsFor = async (profileId: string) => {
      const [posts, snaps] = await Promise.all([
        postsIn({ ...c, profileId }, range, 120),
        sda.snapshots(profileId, c.userId, range),
      ]);
      const likes = posts.filter((p) => !p.metrics?.likesHidden && p.metrics?.likesCount != null);
      const reels = posts.filter((p) => p.type === "REEL" && p.metrics?.viewsCount != null);
      const f = snaps.filter((s) => s.followers != null);
      return {
        posts: posts.length,
        postsPerWeek: Math.round((posts.length / Math.max(1, per.days / 7)) * 10) / 10,
        avgLikes: likes.length ? Math.round(likes.reduce((s, p) => s + p.metrics!.likesCount!, 0) / likes.length) : null,
        avgReelViews: reels.length ? Math.round(reels.reduce((s, p) => s + p.metrics!.viewsCount!, 0) / reels.length) : null,
        followerGrowth: f.length >= 2 && f[0]!.followers ? Math.round(((f.at(-1)!.followers! - f[0]!.followers!) / f[0]!.followers!) * 1000) / 10 : null,
      };
    };
    const you = await statsFor(c.profileId);
    const accounts = [];
    for (const w of watched) {
      try {
        accounts.push({ id: w.id, handle: w.handle, label: w.label, stats: await statsFor(w.instagramProfileId) });
      } catch (error) {
        console.error("[analytics] compare failed", w.handle, error);
        accounts.push({ id: w.id, handle: w.handle, label: w.label, stats: null });
      }
    }
    const comment = accounts.length
      ? await dukeLine(userId, `compare:${per.from}:${per.to}`, "Compare the owner with the watched accounts in one or two sentences and suggest one thing to try.", { you: pct(you), accounts: accounts.map((a) => ({ handle: a.handle, label: a.label, ...(a.stats ? pct(a.stats) : {}) })) }, withDuke)
      : null;
    return { period: { ...per, label: input.from ? "custom" : `${per.days}d` }, you, accounts, comment };
  });
}
