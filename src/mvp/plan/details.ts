import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { parseClaude } from "../ai/client.js";
import { db } from "../db.js";
import { PROFILE_FIELDS, profileValues } from "../business/fields.js";

// Week in parts (decided 17/11): Duke writes the skeleton in the chat; the full details of each
// post (screen 5.2b) are written here, one post per background job, and appear card by card.

const DetailsSchema = z.object({
  idea: z.object({
    hook: z.string().describe("The idea in one line, as the first thing a viewer sees or hears"),
    goal: z.string().describe("What this post should do for the business, e.g. 'Reach new local customers'"),
    funnelStage: z.string().describe("'Top of funnel · Attract', 'Middle of funnel · Trust' or 'Bottom of funnel · Sell'"),
  }),
  caption: z.object({
    hook: z.string().describe("First line of the caption"),
    body: z.string().describe("2 to 4 short sentences"),
    callToAction: z.string().describe("Ends with a question or a clear next step"),
  }),
  hashtags: z.array(z.string()).describe("4 to 8 hashtags, each starting with #"),
  creativeDirection: z.object({
    visualConcept: z.string(),
    openingImpact: z.string(),
    visualNarrative: z.string(),
    mood: z.string(),
    colorAndType: z.string(),
    audienceEmotion: z.string(),
    platformElements: z.string(),
    execution: z.string(),
  }),
  whatToProduce: z.object({
    objective: z.string().describe("What to make, e.g. 'A 20 to 30 second vertical video of the dish being made'"),
    recordingPlan: z.array(z.string()).describe("Numbered shots or slides, in order"),
    editing: z.string(),
    assets: z.string().describe("What the owner needs at hand"),
    checklist: z.array(z.string()).describe("3 to 5 short checks before posting"),
  }),
  postingReminders: z.array(z.string()).describe("1 to 3 short reminders for the posting day"),
});

export type PostDetails = z.infer<typeof DetailsSchema>;

const SYSTEM = `You are Duke, the content strategist inside HustleQ. You write the full plan for one Instagram post of a small business in the US.

Rules:
- Make it concrete for this business and this post: real dishes, products, places and moments from the Business Profile. No generic marketing talk, no jargon.
- Plain English, short sentences. The owner films with a phone, alone or with one helper.
- Respect "Don't post" from the Business Profile in every part (caption, shots, ideas).
- Never invent facts about the business: no prices, servings, quantities, sizes, years, awards, names or results that aren't in the Business Profile. "This tray feeds 12" is invented unless the profile says it. If something isn't known, write around it ("a full tray", "for your guests").
- Numbers about the video itself are fine (seconds per shot, number of slides).
- Match the format: a Reel is a vertical video; a carousel is 3 to 7 slides; a feed post is one image; a story is 1 to 3 frames.`;

export async function writePostDetails(postId: string) {
  const post = await db.post.findUniqueOrThrow({ where: { id: postId }, include: { pillar: true, week: { include: { strategy: true } } } });
  const bp = await db.businessProfile.findUnique({ where: { userId: post.userId } });
  const values = profileValues(bp as Record<string, unknown> | null);
  const profile = PROFILE_FIELDS.map((f) => `${f.label}: ${values[f.key] ?? "—"}`).join("\n");
  const strategy = post.week?.strategy;

  const brief = [
    `Business: ${bp?.businessName ?? "—"}`,
    profile,
    strategy ? `Strategy: ${strategy.title}. Objective: ${strategy.objective ?? "—"}` : "No strategy.",
    `Pillar: ${post.pillar?.name ?? "—"}${post.pillar?.description ? ` (${post.pillar.description})` : ""}`,
    `Format: ${post.format}`,
    `Title: ${post.title}`,
    post.hook ? `Hook idea: ${post.hook}` : "",
  ].filter(Boolean).join("\n");

  try {
    const d = await parseClaude(
      { role: "duke", feature: "post_details", userId: post.userId, effort: "low" },
      { max_tokens: 8000, system: SYSTEM, messages: [{ role: "user", content: `${brief}\n\nWrite the full plan for this post.` }] },
      zodOutputFormat(DetailsSchema)
    );
    const caption = [d.caption.hook, d.caption.body, d.caption.callToAction].join("\n\n");
    await db.post.update({
      where: { id: postId },
      data: {
        idea: d.idea,
        captionParts: d.caption,
        caption,
        hashtags: d.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).slice(0, 10),
        creativeDirection: d.creativeDirection,
        productionGuidance: d.whatToProduce,
        postingReminders: d.postingReminders,
        detailsStatus: "ready",
      },
    });
  } catch (error) {
    console.error("[plan] post details failed", postId, error);
    await db.post.update({ where: { id: postId }, data: { detailsStatus: "failed" } });
  }
}
