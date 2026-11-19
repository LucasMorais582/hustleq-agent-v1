import { db } from "../db.js";
import { cachedInstagram } from "../instagram/own.js";
import { addDays, dayInTz, zonedTime } from "../lib/time.js";
import { activeStrategy, FORMAT_LABEL, type Format } from "../plan/service.js";
import { campaignSuggestion } from "../campaigns/service.js";
import { DAYS, mondayOf, timeLabel } from "../plan/timing.js";
import { signedReadUrls } from "../posts/storage.js";
import type { IgPost } from "../socialData/index.js";

// Home (3.1-3.4), Calendar (10.1-10.5) and "Is this the post you planned?" (6.4).

export class CalendarInputError extends Error {}

// Instagram sends -1 when the owner hides the count.
const count = (n: number | null) => (n != null && n > 0 ? n : 0);
const igLabel = (f: string) => FORMAT_LABEL[(f === "image" ? "feed" : f) as Format] ?? "Post";
const STATUS_LABEL = { draft: "Draft", scheduled: "Scheduled", posted: "Posted", cancelled: "Cancelled" } as const;
const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { ...opts, timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
const dayLabel = (iso: string) => `${fmt(iso, { weekday: "short" })} ${Number(iso.slice(8))}`;
const rangeLabel = (start: string, end: string) => `${fmt(start, { month: "short", day: "numeric" })} to ${start.slice(5, 7) === end.slice(5, 7) ? Number(end.slice(8)) : fmt(end, { month: "short", day: "numeric" })}`;

type PostRow = Awaited<ReturnType<typeof postsBetween>>[number];

// Posts whose time falls between two local days (inclusive), in the owner's timezone.
async function postsBetween(userId: string, tz: string, from: string, to: string) {
  return db.post.findMany({
    where: { userId, scheduledAt: { gte: zonedTime(from, "00:00:00", tz), lt: zonedTime(addDays(to, 1), "00:00:00", tz) } },
    include: { pillar: true, media: { select: { id: true } }, campaign: { select: { id: true, name: true, color: true, status: true } } },
    orderBy: [{ scheduledAt: "asc" }, { position: "asc" }],
  });
}

function presentCalPost(p: PostRow, tz: string) {
  const at = p.scheduledAt!;
  const date = dayInTz(at, tz);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
  const media = p.media.length;
  return {
    id: p.id,
    weekId: p.weekId,
    title: p.title,
    status: p.status,
    statusLabel: STATUS_LABEL[p.status],
    format: p.format,
    formatLabel: FORMAT_LABEL[(p.format ?? "feed") as Format] ?? p.format,
    pillar: p.pillar?.name ?? null,
    campaign: p.campaign ? { id: p.campaign.id, name: p.campaign.name, color: p.campaign.color } : null,
    date,
    dayLabel: dayLabel(date),
    time,
    timeLabel: timeLabel(time),
    mediaCount: media,
    reminderOn: p.reminderEmail,
    summary: [media ? `${media} ${p.format === "reel" ? (media === 1 ? "video" : "videos") : media === 1 ? "image" : "images"} ready` : "No media yet", p.reminderEmail ? "Email reminder on" : "Reminder off"].join(" · "),
  };
}
export type CalPost = ReturnType<typeof presentCalPost>;

// "Week plan complete · N of N posts": scheduled or posted, against the strategy's posts per week.
function weekPlan(strategy: Awaited<ReturnType<typeof activeStrategy>>, posts: CalPost[]) {
  const planned = strategy ? strategy.staticPerWeek + strategy.videosPerWeek + strategy.storiesPerWeek : 0;
  const have = posts.filter((p) => p.status === "scheduled" || p.status === "posted").length;
  return {
    planned,
    have,
    complete: planned > 0 && have >= planned,
    label: planned > 0 && have >= planned ? `Week plan complete · ${have} of ${planned} posts` : planned > 0 ? `${have} of ${planned} posts planned` : null,
  };
}

function weekDays(weekStart: string, today: string, posts: CalPost[]) {
  return DAYS.map((_, i) => {
    const date = addDays(weekStart, i);
    return { date, label: dayLabel(date), isToday: date === today, marks: posts.filter((p) => p.date === date).map((p) => p.status) };
  });
}

// ---------- Your numbers ----------

function numbers(bundle: Awaited<ReturnType<typeof cachedInstagram>>) {
  if (!bundle) return null;
  const posts = bundle.posts.slice(0, 12);
  const reels = posts.filter((p) => p.format === "reel");
  return {
    followers: bundle.profile.followers,
    likes: posts.reduce((s, p) => s + count(p.likes), 0),
    views: reels.reduce((s, p) => s + count(p.views), 0),
    basedOn: posts.length,
    // Weekly comparisons need daily snapshots (Social Data API, phase 6); until then, the last posts.
    note: `From your last ${posts.length} posts. Weekly numbers start next week.`,
    fetchedAt: bundle.fetchedAt,
  };
}

// E.6: numbers older than a day and a bit mean today's update didn't work.
function staleNotice(bundle: Awaited<ReturnType<typeof cachedInstagram>>, fetchedAt: Date | null, tz: string) {
  if (!bundle || !fetchedAt) return null;
  if (Date.now() - fetchedAt.getTime() < 30 * 3600_000) return null;
  const since = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: tz }).format(fetchedAt);
  return `Your numbers are from ${since}. We couldn’t reach Instagram today. We’ll try again automatically.`;
}

// ---------- 6.4 · Is this the post you planned? ----------

async function linkedIgIds(userId: string) {
  const rows = await db.postPublication.findMany({ where: { post: { userId } }, select: { instagramPostId: true } });
  return new Set(rows.map((r) => r.instagramPostId));
}

// A scheduled post from the last week, and a new post on the profile published that day or the next.
export async function findMatch(userId: string, tz: string, handle: string | null) {
  if (!handle) return null;
  const bundle = await cachedInstagram(handle);
  if (!bundle?.posts.length) return null;
  const today = dayInTz(new Date(), tz);
  const posts = await db.post.findMany({
    where: { userId, status: "scheduled", scheduledAt: { gte: zonedTime(addDays(today, -7), "00:00:00", tz), lte: new Date(Date.now() + 12 * 3600_000) } },
    include: { media: { orderBy: { position: "asc" }, take: 1 } },
    orderBy: { scheduledAt: "asc" },
  });
  if (!posts.length) return null;
  const linked = await linkedIgIds(userId);
  for (const p of posts) {
    const planned = dayInTz(p.scheduledAt!, tz);
    const candidates = bundle.posts.filter((ig) => {
      if (!ig.publishedAt || linked.has(ig.id) || p.dismissedMatches.includes(ig.id)) return false;
      const d = dayInTz(new Date(ig.publishedAt), tz);
      return d === planned || d === addDays(planned, 1);
    });
    if (!candidates.length) continue;
    const kind = (f: string | null) => (f === "reel" ? "reel" : f === "story" ? "story" : "static");
    const ig = candidates.sort((a, b) =>
      Number(kind(b.format) === kind(p.format)) - Number(kind(a.format) === kind(p.format)) ||
      Math.abs(Date.parse(a.publishedAt!) - p.scheduledAt!.getTime()) - Math.abs(Date.parse(b.publishedAt!) - p.scheduledAt!.getTime()))[0]!;
    const m = p.media[0];
    const imagePath = m ? (m.kind === "video" ? m.framePaths[0] : m.storagePath) : undefined;
    const urls = imagePath ? await signedReadUrls([imagePath]) : new Map<string, string>();
    return {
      postId: p.id,
      title: p.title,
      formatLabel: FORMAT_LABEL[(p.format ?? "feed") as Format] ?? p.format,
      plannedImage: imagePath ? urls.get(imagePath) ?? null : null,
      text: `We found a new post on @${handle} that looks like “${p.title}”.`,
      published: {
        id: ig.id,
        url: ig.url,
        thumbnailUrl: ig.thumbnailUrl,
        caption: ig.caption?.slice(0, 140) ?? null,
        label: `Published · ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: tz }).format(new Date(ig.publishedAt!))}`,
      },
    };
  }
  return null;
}

export async function answerMatch(userId: string, postId: string, igPostId: string, yes: boolean) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const post = await db.post.findFirst({ where: { id: postId, userId } });
  if (!post) return null;
  const bundle = user.instagramHandle ? await cachedInstagram(user.instagramHandle) : null;
  const ig = bundle?.posts.find((p: IgPost) => p.id === igPostId);
  if (!ig) throw new CalendarInputError("That Instagram post isn't on your profile anymore.");
  if (!yes) {
    await db.post.update({ where: { id: postId }, data: { dismissedMatches: { push: igPostId } } });
    return { status: post.status };
  }
  if (post.status === "posted") return { status: "posted" };
  if (post.status !== "scheduled") throw new CalendarInputError("Only a scheduled post can be marked posted.");
  if ((await linkedIgIds(userId)).has(igPostId)) throw new CalendarInputError("That Instagram post is already linked to another post.");
  await db.$transaction([
    db.post.update({ where: { id: postId }, data: { status: "posted" } }),
    db.postPublication.create({ data: { postId, instagramPostId: igPostId } }),
  ]);
  return { status: "posted" };
}

// ---------- Home ----------

export async function getHome(userId: string, which: "this" | "next") {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const tz = user.timezone;
  const today = dayInTz(new Date(), tz);
  const weekStart = which === "next" ? addDays(mondayOf(new Date(), tz), 7) : mondayOf(new Date(), tz);
  const weekEnd = addDays(weekStart, 6);
  const [rows, strategy, cacheRow] = await Promise.all([
    postsBetween(userId, tz, weekStart, weekEnd),
    activeStrategy(userId, tz),
    user.instagramHandle ? db.instagramCache.findUnique({ where: { handle: user.instagramHandle } }) : null,
  ]);
  const posts = rows.map((p) => presentCalPost(p, tz));
  const bundle = cacheRow ? (cacheRow.data as unknown as Awaited<ReturnType<typeof cachedInstagram>>) : null;
  const live = posts.filter((p) => p.status !== "cancelled");
  return {
    which,
    title: which === "this" ? fmt(today, { weekday: "long", month: "short", day: "numeric" }) : rangeLabel(weekStart, weekEnd),
    subtitle: which === "this" ? "Your week" : "Next week",
    weekStart,
    days: weekDays(weekStart, today, posts),
    plan: weekPlan(strategy, posts),
    hasStrategy: Boolean(strategy),
    today: which === "this" ? live.filter((p) => p.date === today) : [],
    comingUp: which === "this" ? live.filter((p) => p.date > today).slice(0, 5) : live,
    numbers: which === "this" ? numbers(bundle) : null,
    stale: staleNotice(bundle, cacheRow?.fetchedAt ?? null, tz),
    match: which === "this" ? await findMatch(userId, tz, user.instagramHandle) : null,
    suggestion: which === "this" ? await campaignSuggestion(userId, tz) : null,
  };
}

// 3.3 · Read more: one number in detail, with a plain comment.
export async function getNumber(userId: string, metric: "followers" | "likes" | "views") {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const bundle = user.instagramHandle ? await cachedInstagram(user.instagramHandle) : null;
  if (!bundle) return null;
  const posts = bundle.posts.slice(0, 12);
  if (metric === "followers") {
    return { metric, title: "Followers", value: bundle.profile.followers, note: "Followers today. Growth week by week starts next week.", items: [], comment: null };
  }
  // Each post is named by type and day, with the start of its caption and its picture, so the
  // owner knows which one it is (not "Reel 1").
  const day = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: user.timezone }).format(new Date(iso)) : null);
  const excerpt = (c: string | null) => {
    const line = (c ?? "").split("\n").map((x) => x.trim()).find(Boolean) ?? "";
    return line.length > 70 ? `${line.slice(0, 68).trimEnd()}…` : line || null;
  };
  const list = (metric === "views" ? posts.filter((p) => p.format === "reel") : posts).map((p) => ({
    label: [igLabel(p.format), day(p.publishedAt)].filter(Boolean).join(" · "),
    caption: excerpt(p.caption),
    thumbnailUrl: p.thumbnailUrl,
    url: p.url,
    value: count(metric === "views" ? p.views : p.likes),
    hidden: (metric === "views" ? p.views : p.likes) === -1, // the owner hid the count on Instagram
    date: p.publishedAt,
  }));
  const value = list.reduce((s, x) => s + x.value, 0);
  let comment: string | null = null;
  if (metric === "views" && list.length) {
    const top = [...list].sort((a, b) => b.value - a.value)[0]!;
    comment = value > 0 ? `Your ${top.label.replace(" · ", " from ")}${top.caption ? ` (“${top.caption}”)` : ""} brought the most views. Reels are how new people find you, so I keep at least one in each week.` : null;
  }
  if (metric === "likes" && list.length >= 3) {
    const byFormat = new Map<string, { n: number; sum: number }>();
    posts.forEach((p) => { const s = byFormat.get(p.format) ?? { n: 0, sum: 0 }; s.n += 1; s.sum += count(p.likes); byFormat.set(p.format, s); });
    const best = [...byFormat.entries()].filter(([, s]) => s.n >= 3).sort((a, b) => b[1].sum / b[1].n - a[1].sum / a[1].n)[0];
    comment = best ? `${igLabel(best[0])}s got the most likes per post. I’ll keep using them.` : null;
  }
  return {
    metric,
    title: metric === "views" ? "Views" : "Likes",
    value,
    note: metric === "views" ? "From your last posts. Views count Reels only." : `From your last ${posts.length} posts.`,
    items: list,
    comment,
  };
}

// ---------- Calendar ----------

export async function getCalendar(userId: string, from: string, to: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const tz = user.timezone;
  if (to < from || Date.parse(to) - Date.parse(from) > 62 * 864e5) throw new CalendarInputError("Pick up to two months.");
  const [rows, strategy] = await Promise.all([postsBetween(userId, tz, from, to), activeStrategy(userId, tz)]);
  const posts = rows.map((p) => presentCalPost(p, tz));
  const weeks: { weekStart: string; label: string; plan: ReturnType<typeof weekPlan> }[] = [];
  for (let w = mondayOf(new Date(`${from}T12:00:00Z`), "UTC"); w <= to; w = addDays(w, 7)) {
    const end = addDays(w, 6);
    weeks.push({ weekStart: w, label: rangeLabel(w, end), plan: weekPlan(strategy, posts.filter((p) => p.date >= w && p.date <= end)) });
  }
  const campaigns = await db.campaign.findMany({
    where: { userId, status: "saved", startsOn: { lte: new Date(`${to}T00:00:00Z`) }, endsOn: { gte: new Date(`${from}T00:00:00Z`) } },
    select: { id: true, name: true, color: true, startsOn: true, endsOn: true },
  });
  const commercial = await db.commercialDate.findMany({ where: { country: "US", date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } }, select: { name: true, date: true } });
  return {
    today: dayInTz(new Date(), tz), from, to, posts, weeks,
    campaigns: campaigns.map((c) => ({ id: c.id, name: c.name, color: c.color, startsOn: c.startsOn.toISOString().slice(0, 10), endsOn: c.endsOn.toISOString().slice(0, 10), posts: posts.filter((p) => p.campaign?.id === c.id).length })),
    dates: commercial.map((d) => ({ name: d.name, date: d.date.toISOString().slice(0, 10) })),
  };
}

// 10.4 · tapping an empty day of an incomplete week opens Duke with this question.
export async function emptyDayOpening(userId: string, date: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const tz = user.timezone;
  const weekStart = mondayOf(new Date(`${date}T12:00:00Z`), "UTC");
  const end = addDays(weekStart, 6);
  const [rows, strategy] = await Promise.all([postsBetween(userId, tz, weekStart, end), activeStrategy(userId, tz)]);
  const plan = weekPlan(strategy, rows.map((p) => presentCalPost(p, tz)));
  const longDay = fmt(date, { weekday: "long", month: "short", day: "numeric" });
  const shortDay = fmt(date, { weekday: "short", month: "short", day: "numeric" });
  const text = plan.planned
    ? `Your plan is ${plan.planned} posts a week, and ${rangeLabel(weekStart, end)} has ${plan.have} so far. Want one on ${longDay}?`
    : `${rangeLabel(weekStart, end)} has ${plan.have} ${plan.have === 1 ? "post" : "posts"} so far. Want one on ${longDay}?`;
  return {
    text,
    card: { type: "notice", text: `From Calendar · ${shortDay} · ${plan.have} of ${plan.planned || plan.have} posts` },
    replies: { options: ["Yes, suggest one", "Use a note", "Leave it free"] },
    title: `Post for ${shortDay}`,
    note: `opened from the calendar, empty day ${date}. "Yes, suggest one" means draft_post for that date. "Use a note" means search_notes, then draft_post with that noteId.`,
  };
}
