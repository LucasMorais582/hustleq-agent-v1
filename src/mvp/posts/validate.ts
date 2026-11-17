import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { parseClaude } from "../ai/client.js";
import { db } from "../db.js";
import { PROFILE_FIELDS, profileValues } from "../business/fields.js";
import { FORMAT_LABEL, type Format } from "../plan/service.js";
import { getFullPost, monthStart, PostInputError, VALIDATIONS_PER_MONTH } from "./service.js";
import { signedReadUrls } from "./storage.js";

// Validate with Duke (6.2): Claude looks at the uploaded images (or frames of the video) and the
// caption, against the creative direction. 30 a month; a technical failure doesn't count.

export class ValidationLimitReached extends Error {}

const ResultSchema = z.object({
  points: z.array(z.object({
    good: z.boolean().describe("true = ✓ works, false = ! to improve"),
    title: z.string().describe("2 to 5 words, e.g. 'Hook in the first image', 'Caption', 'Matches the creative direction', 'Image order'"),
    detail: z.string().describe("One or two short sentences: what you see and, if it needs work, exactly what to change"),
    media: z.number().int().describe("The image or video number this point is about (1-based), 0 if it's about the whole post"),
  })).describe("3 to 5 points, the most important first"),
  conclusion: z.string().describe("One or two sentences, e.g. 'Almost ready. Fix image 3 and it's good to post.'"),
  replaceMedia: z.number().int().describe("The number of the one image or video most worth replacing, 0 if none"),
});

const SYSTEM = `You are Duke, the content strategist inside HustleQ. The owner of a small business uploaded the media for one planned Instagram post and asks you to check it before posting.

Check, in this order of importance:
- The first image or first second: would it stop the scroll? Is the subject clear and filling the frame?
- Does it match the creative direction and what to produce for this post?
- Quality you can see: light, focus, framing, clutter, text readable on a phone.
- For a carousel: does the order tell the story? For a Reel: do the frames show a clear start and progression?
- The caption: clear, sounds like the business, ends with a question or next step, respects "Don't post".

Rules:
- Be specific about what you actually see ("image 3 is darker than the others"), never generic.
- Be kind and direct. Praise what works. At most 2 things to improve, each with a concrete fix.
- Never invent facts about the business. Don't comment on things you can't see.
- Plain English, short sentences.`;

export async function validatePost(userId: string, tz: string, postId: string) {
  const post = await db.post.findFirst({ where: { id: postId, userId }, include: { media: { orderBy: { position: "asc" } }, pillar: true } });
  if (!post) return null;
  if (!post.media.length) throw new PostInputError("Upload the photos or video first, then Duke can check them.");

  // Reserve one validation; given back if anything fails.
  const periodStart = monthStart(tz);
  const usage = await db.usage.upsert({
    where: { userId_kind_periodStart: { userId, kind: "validation", periodStart } },
    update: { count: { increment: 1 } },
    create: { userId, kind: "validation", periodStart, count: 1 },
  });
  if (usage.count > VALIDATIONS_PER_MONTH) {
    await db.usage.update({ where: { id: usage.id }, data: { count: { decrement: 1 } } });
    throw new ValidationLimitReached();
  }

  try {
    const urls = await signedReadUrls(post.media.flatMap((m) => (m.kind === "video" ? m.framePaths : [m.storagePath])), 600);
    const content: Anthropic.ContentBlockParam[] = [];
    post.media.forEach((m, i) => {
      const n = i + 1;
      if (m.kind === "video") {
        const frames = m.framePaths.map((f) => urls.get(f)).filter((u): u is string => Boolean(u));
        content.push({ type: "text", text: frames.length ? `Video ${n}: ${frames.length} still frames in order, from start to end.` : `Video ${n}: no frames available, judge from the plan only.` });
        for (const url of frames) content.push({ type: "image", source: { type: "url", url } });
      } else {
        const url = urls.get(m.storagePath);
        content.push({ type: "text", text: `Image ${n}:` });
        if (url) content.push({ type: "image", source: { type: "url", url } });
      }
    });

    const bp = await db.businessProfile.findUnique({ where: { userId } });
    const values = profileValues(bp as Record<string, unknown> | null);
    const g = post.productionGuidance as { objective?: string; recordingPlan?: string[] } | null;
    content.push({
      type: "text",
      text: [
        `Business: ${bp?.businessName ?? "—"}`,
        PROFILE_FIELDS.filter((f) => ["whatYouDo", "offers", "doNotPost"].includes(f.key)).map((f) => `${f.label}: ${values[f.key] ?? "—"}`).join("\n"),
        `Post: ${FORMAT_LABEL[(post.format ?? "feed") as Format] ?? post.format} · "${post.title}"${post.pillar ? ` · pillar ${post.pillar.name}` : ""}`,
        post.creativeDirection ? `Creative direction: ${JSON.stringify(post.creativeDirection)}` : "",
        g ? `What to produce: ${g.objective ?? ""} ${g.recordingPlan?.length ? `Plan: ${g.recordingPlan.join(" | ")}` : ""}` : "",
        `Caption: ${post.caption ?? "(none yet)"}`,
        post.hashtags.length ? `Hashtags: ${post.hashtags.join(" ")}` : "",
        "Check this post.",
      ].filter(Boolean).join("\n"),
    });

    const out = await parseClaude(
      { role: "duke", feature: "validate_post", userId, effort: "low" },
      { max_tokens: 6000, system: SYSTEM, messages: [{ role: "user", content }] },
      zodOutputFormat(ResultSchema)
    );
    const points = out.points.slice(0, 6);
    const result = {
      points,
      conclusion: out.conclusion,
      replaceMedia: out.replaceMedia > 0 && out.replaceMedia <= post.media.length ? out.replaceMedia : null,
      replaceMediaId: out.replaceMedia > 0 ? post.media[out.replaceMedia - 1]?.id ?? null : null,
      good: points.filter((p) => p.good).length,
      toImprove: points.filter((p) => !p.good).length,
      mediaCount: post.media.length,
    };
    await db.postValidation.create({ data: { postId, result } });
    return getFullPost(userId, postId);
  } catch (error) {
    await db.usage.updateMany({ where: { id: usage.id, count: { gt: 0 } }, data: { count: { decrement: 1 } } });
    throw error;
  }
}
