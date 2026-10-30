import { prisma } from "../lib/prisma.js";
import { callOpenAI } from "../ai/core/callOpenAI.js";
import { fetchInstagramTrends } from "./socialData.client.js";
import { interactions, normalizeTrendPost, type MediaFormat, type NormalizedPost } from "./normalize.js";
import { buildTrendSummaryPrompt } from "./demo.prompts.js";

const MAX_POSTS = 25;

// Reels carry plays; a play is worth far less than a like, so it only breaks ties.
function score(p: NormalizedPost) {
  return interactions(p) + (p.plays ?? 0) / 100;
}

function trendStats(posts: NormalizedPost[]) {
  const byFormat: Partial<Record<MediaFormat, { posts: number; avgInteractions: number }>> = {};

  for (const f of ["photo", "carousel", "reel"] as MediaFormat[]) {
    const group = posts.filter((p) => p.format === f);
    if (!group.length) continue;

    byFormat[f] = {
      posts: group.length,
      avgInteractions: Math.round(group.reduce((s, p) => s + interactions(p), 0) / group.length),
    };
  }

  const tagCount = new Map<string, number>();
  for (const p of posts) for (const t of p.hashtags) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);

  return {
    postsAnalyzed: posts.length,
    byFormat,
    topHashtags: [...tagCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([t]) => t),
  };
}

function isValidSummary(s: any) {
  return typeof s?.trend?.name === "string" && s.trend.name
    && typeof s.trend.what === "string" && s.trend.what
    && typeof s.trend.signal === "string" && s.trend.signal;
}

export async function refreshNicheTrends(niche: { key: string; label: string; keywords: string[] }) {
  const seen = new Map<string, NormalizedPost>();

  // One keyword at a time: each Apify run already takes close to a minute.
  for (const keyword of niche.keywords) {
    try {
      const res = await fetchInstagramTrends(keyword);
      for (const raw of res.posts || []) {
        const post = normalizeTrendPost(raw);
        if (post.caption) seen.set(post.id, post);
      }
    } catch (error: any) {
      console.error(`[demo] trends "${keyword}" failed:`, error.message);
    }
  }

  const posts = [...seen.values()].sort((a, b) => score(b) - score(a)).slice(0, MAX_POSTS);

  if (!posts.length) {
    console.warn(`[demo] ${niche.key}: no posts collected, keeping the previous snapshot`);
    return null;
  }

  const stats = trendStats(posts);

  const compact = posts.map((p) => ({
    format: p.format,
    likes: p.likes,
    comments: p.comments,
    plays: p.plays,
    hashtags: p.hashtags.slice(0, 8),
    caption: p.caption.slice(0, 300),
  }));

  let summary: any = null;

  for (let attempt = 1; attempt <= 2 && !isValidSummary(summary); attempt++) {
    summary = await callOpenAI({
      model: "gpt-4o",
      temperature: 0.4,
      messages: [{
        role: "system",
        content: buildTrendSummaryPrompt(niche.label, JSON.stringify(compact), JSON.stringify(stats)),
      }],
    });
  }

  if (!isValidSummary(summary)) {
    console.error(`[demo] ${niche.key}: model returned an invalid trend summary`);
    return null;
  }

  return prisma.demoTrendSnapshot.create({
    data: {
      nicheKey: niche.key,
      posts: posts as any,
      summary: { ...summary, stats },
    },
  });
}

export async function getLatestTrend(nicheKey: string) {
  return prisma.demoTrendSnapshot.findFirst({
    where: { nicheKey },
    orderBy: { collectedAt: "desc" },
  });
}
