import { prisma } from "../lib/prisma.js";
import { callOpenAI } from "../ai/core/callOpenAI.js";
import { getLatestTrend } from "./demoTrends.service.js";
import { normalizeHandle } from "./demoProfile.service.js";
import { buildIdeaPrompt, DEMO_MONTHS } from "./demo.prompts.js";

export class DemoInputError extends Error {}

export type DemoAnswers = {
  handle: string;
  profile_confirmed: boolean;
  niche: string;
  offer: string;
  month: string;
};

export type DemoIdea = {
  trend: { name: string; what: string; signal: string };
  format: string;
  hook: string;
  film: string;
  caption: string;
  time: string;
};

const TREND_MAX_AGE_DAYS = 7;

export function parseAnswers(body: any): DemoAnswers {
  const a = body?.answers || {};
  const handle = normalizeHandle(String(a.handle || ""));
  const offer = String(a.offer || "").trim();

  if (!/^[a-z0-9._]{1,30}$/.test(handle)) throw new DemoInputError("Invalid handle");
  if (typeof a.niche !== "string" || !a.niche) throw new DemoInputError("Missing niche");
  if (!offer || offer.length > 200) throw new DemoInputError("Invalid offer");
  if (!DEMO_MONTHS[a.month]) throw new DemoInputError("Invalid month");

  return {
    handle,
    profile_confirmed: a.profile_confirmed === true,
    niche: a.niche,
    offer,
    month: a.month,
  };
}

function isValidIdea(i: any): i is DemoIdea {
  const text = (v: unknown) => typeof v === "string" && v.trim().length > 0;

  return text(i?.trend?.name) && text(i?.trend?.what) && text(i?.trend?.signal)
    && text(i.format) && text(i.hook) && text(i.film) && text(i.caption) && text(i.time);
}

export async function generateDemoIdea(answers: DemoAnswers) {
  const niche = await prisma.demoNiche.findFirst({
    where: { key: answers.niche, active: true },
  });

  if (!niche) throw new DemoInputError("Unknown niche");

  const [trend, cached] = await Promise.all([
    getLatestTrend(niche.key),
    answers.profile_confirmed
      ? prisma.demoProfileCache.findUnique({ where: { handle: answers.handle } })
      : null,
  ]);

  const freshTrend = trend
    && Date.now() - trend.collectedAt.getTime() < TREND_MAX_AGE_DAYS * 24 * 60 * 60 * 1000
    ? trend
    : null;

  /*
    Profile context: bio, numbers and the latest captions (their voice).
    Read from our own cache, never from what the browser sends.
  */
  let profileJson: string | null = null;
  let businessName = "@" + answers.handle;

  if (cached) {
    const profile = cached.profile as any;
    const posts = (cached.posts as any) || {};

    if (profile?.name) businessName = profile.name;

    profileJson = JSON.stringify({
      bio: profile?.biography,
      followers: profile?.followers,
      stats: posts.stats,
      recentCaptions: (posts.items || [])
        .slice(0, 8)
        .map((p: any) => ({ format: p.format, caption: String(p.caption || "").slice(0, 240) })),
    });
  }

  const prompt = buildIdeaPrompt({
    nicheLabel: niche.label,
    offer: answers.offer,
    monthContext: DEMO_MONTHS[answers.month]!,
    businessName,
    profileJson,
    trendJson: freshTrend ? JSON.stringify(freshTrend.summary) : null,
  });

  const started = Date.now();
  let idea: any = null;
  let error: string | null = null;

  try {
    for (let attempt = 1; attempt <= 2 && !isValidIdea(idea); attempt++) {
      idea = await callOpenAI({
        model: "gpt-4o",
        temperature: 0.8,
        messages: [{ role: "system", content: prompt }],
      });
    }

    if (!isValidIdea(idea)) {
      error = "Invalid idea from model";
      idea = null;
    }
  } catch (e: any) {
    error = e?.message || "Model call failed";
    idea = null;
  }

  // The run log must never break the response.
  await prisma.demoRun.create({
    data: {
      handle: answers.handle,
      nicheKey: niche.key,
      answers: { ...answers, trendSnapshotId: freshTrend?.id ?? null } as any,
      idea: idea ?? undefined,
      durationMs: Date.now() - started,
      error,
    },
  }).catch((e) => console.error("[demo] failed to log run:", e.message));

  if (!idea) throw new Error(error || "Idea generation failed");

  return idea as DemoIdea;
}
