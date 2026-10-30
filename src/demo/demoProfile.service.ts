import { prisma } from "../lib/prisma.js";
import { fetchInstagramProfile, SocialDataError } from "./socialData.client.js";
import { interactions, normalizeProfilePost, type MediaFormat, type NormalizedPost } from "./normalize.js";

const CACHE_HOURS = 24;
const DAY_MS = 24 * 60 * 60 * 1000;

export type DemoProfile = {
  username: string;
  name: string | null;
  image_url: string | null;
  followers: number | null;
  following: number | null;
  biography: string | null;
  totalPosts: number | null;
};

export type ProfileStats = {
  postsAnalyzed: number;
  daysSinceLastPost: number | null;
  daysBetweenPosts: number | null;
  formatMix: Partial<Record<MediaFormat, number>>;
  avgInteractionsByFormat: Partial<Record<MediaFormat, number>>;
  engagementRate: number | null;
};

export class DemoCapacityError extends Error {}

export function normalizeHandle(raw: string) {
  return raw.trim().replace(/^@+/, "").toLowerCase();
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function computeProfileStats(posts: NormalizedPost[], followers: number | null): ProfileStats {
  const dated = posts
    .filter((p) => p.publishedAt)
    .map((p) => ({ ...p, time: new Date(p.publishedAt!).getTime() }))
    .sort((a, b) => b.time - a.time);

  const gaps = dated.slice(1).map((p, i) => (dated[i]!.time - p.time) / DAY_MS);

  const formatMix: ProfileStats["formatMix"] = {};
  const totals: Partial<Record<MediaFormat, number>> = {};

  for (const p of posts) {
    formatMix[p.format] = (formatMix[p.format] ?? 0) + 1;
    totals[p.format] = (totals[p.format] ?? 0) + interactions(p);
  }

  const avgInteractionsByFormat: ProfileStats["avgInteractionsByFormat"] = {};
  for (const f of Object.keys(formatMix) as MediaFormat[]) {
    avgInteractionsByFormat[f] = Math.round(totals[f]! / formatMix[f]!);
  }

  const avgInteractions = posts.length
    ? posts.reduce((sum, p) => sum + interactions(p), 0) / posts.length
    : null;

  return {
    postsAnalyzed: posts.length,
    daysSinceLastPost: dated[0] ? Math.floor((Date.now() - dated[0].time) / DAY_MS) : null,
    daysBetweenPosts: median(gaps) === null ? null : Math.round(median(gaps)!),
    formatMix,
    avgInteractionsByFormat,
    engagementRate: avgInteractions !== null && followers
      ? Number(((avgInteractions / followers) * 100).toFixed(1))
      : null,
  };
}

const FORMAT_LABEL: Record<MediaFormat, string> = {
  photo: "single photos",
  carousel: "carousels",
  reel: "Reels",
};

function describeGap(days: number) {
  if (days >= 365) return `${Math.floor(days / 365)} year${days >= 730 ? "s" : ""}`;
  if (days >= 60) return `${Math.floor(days / 30)} months`;
  return `${days} days`;
}

/*
  One sentence shown under "Why this should work · Your profile".
  Written from real numbers only, never by the model, so it can't invent anything.
*/
export function buildInsight(stats: ProfileStats) {
  if (!stats.postsAnalyzed) {
    return "I couldn't see any public posts yet, so this idea is built to work as a strong first post.";
  }

  if (stats.daysSinceLastPost !== null && stats.daysSinceLastPost >= 60) {
    return `Your last post was about ${describeGap(stats.daysSinceLastPost)} ago, so this idea is built to restart your feed with something easy to film.`;
  }

  const parts: string[] = [];

  if (stats.daysBetweenPosts !== null) {
    parts.push(stats.daysBetweenPosts <= 1
      ? "You post almost every day"
      : `You post about every ${stats.daysBetweenPosts} days`);
  }

  const ranked = (Object.entries(stats.avgInteractionsByFormat) as [MediaFormat, number][])
    .sort((a, b) => b[1] - a[1]);

  if (ranked.length >= 2 && ranked[1]![1] > 0) {
    const [best, bestAvg] = ranked[0]!;
    const [other, otherAvg] = ranked[1]!;
    const lift = Math.round(((bestAvg - otherAvg) / otherAvg) * 100);

    if (lift >= 15) {
      parts.push(`your ${FORMAT_LABEL[best]} get about ${lift}% more likes and comments than your ${FORMAT_LABEL[other]}`);
    }
  }

  if (parts.length < 2 && ranked[0]) {
    parts.push(`your recent posts average ${ranked[0][1]} likes and comments`);
  }

  const sentence = parts.join(", and ");
  return sentence.charAt(0).toUpperCase() + sentence.slice(1) + ".";
}

async function assertDailyCapacity() {
  const max = Number(process.env.DEMO_MAX_PROFILE_LOOKUPS_PER_DAY || 500);
  const since = new Date(Date.now() - DAY_MS);

  const used = await prisma.demoProfileCache.count({
    where: { fetchedAt: { gte: since } },
  });

  if (used >= max) throw new DemoCapacityError("Daily profile lookup limit reached");
}

export async function getDemoProfile(rawHandle: string) {
  const handle = normalizeHandle(rawHandle);

  const cached = await prisma.demoProfileCache.findUnique({ where: { handle } });

  if (cached && Date.now() - cached.fetchedAt.getTime() < CACHE_HOURS * 60 * 60 * 1000) {
    return {
      profile: cached.profile as DemoProfile,
      insight: cached.insight,
    };
  }

  await assertDailyCapacity();

  let data;
  try {
    data = await fetchInstagramProfile(handle);
  } catch (error) {
    // 404 means the account doesn't exist or is private: the page asks for the handle again.
    // Anything else (401 auth, 429 Apify limit, 503) is our failure, never "not found".
    if (error instanceof SocialDataError && error.status === 404) return null;
    throw error;
  }

  if (!data?.profile?.username) return null;

  const p = data.profile;
  const profile: DemoProfile = {
    username: p.username,
    name: p.name || null,
    image_url: p.profilePicUrlHD && /^https:\/\//.test(p.profilePicUrlHD) ? p.profilePicUrlHD : null,
    followers: p.followersCount ?? null,
    following: p.followingCount ?? null,
    biography: p.biography || null,
    totalPosts: p.totalPosts ?? null,
  };

  const posts = (data.posts || []).map(normalizeProfilePost);
  const stats = computeProfileStats(posts, profile.followers);
  const insight = buildInsight(stats);

  const record = {
    profile,
    posts: { items: posts, stats } as any,
    insight,
    fetchedAt: new Date(),
  };

  await prisma.demoProfileCache.upsert({
    where: { handle },
    create: { handle, ...record },
    update: record,
  });

  return { profile, insight };
}

/*
  Profile photo for the demo card. Instagram's CDN answers with
  Cross-Origin-Resource-Policy: same-origin, so the browser can't show the URL on our site.
  We serve it from here, only for handles already in the cache and only from Instagram hosts.
*/
const IMAGE_HOSTS = /^https:\/\/[a-z0-9.-]+\.(cdninstagram\.com|fbcdn\.net)\//i;
const imageMemo = new Map<string, { body: Buffer; type: string }>();

export async function getDemoProfileImage(rawHandle: string) {
  const handle = normalizeHandle(rawHandle);
  const memo = imageMemo.get(handle);
  if (memo) return memo;

  const cached = await prisma.demoProfileCache.findUnique({ where: { handle } });
  const url = (cached?.profile as DemoProfile | undefined)?.image_url;
  if (!url || !IMAGE_HOSTS.test(url)) return null;

  const res = await fetch(url, { signal: AbortSignal.timeout(8000) }).catch(() => null);
  const type = res?.headers.get("content-type") || "";
  if (!res?.ok || !type.startsWith("image/")) return null;

  const image = { body: Buffer.from(await res.arrayBuffer()), type };
  if (imageMemo.size >= 300) imageMemo.delete(imageMemo.keys().next().value!);
  imageMemo.set(handle, image);
  return image;
}
