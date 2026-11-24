import { db, table } from "../db.js";
import { FIELD_KEYS, PROFILE_FIELDS, profileValues } from "../business/fields.js";
import { cachedInstagram, FORMAT_LABEL, formatStats, syncInstagram } from "../instagram/own.js";
import { appUrl, sendEmail } from "../email/send.js";
import { accountChangeTeamEmail } from "../email/templates.js";
import { enqueueSafe } from "../jobs/queue.js";
import { analyzeInstagram, type Analysis } from "./analysis.js";

// First conversation (spec 5.2): a fixed path with quick replies. Duke's words come from the
// screens; the model is used only to read the posts (analysis.ts). Everything is saved as it
// happens, so leaving and coming back resumes on the same step.

export const ONBOARDING_TITLE = "Getting to know your business";
export const JOB_PREPARE = "onboarding-prepare";

export const R = {
  yesUs: "Yes, that’s us",
  notMine: "Not my account",
  yes: "Yes",
  fix: "Let me fix something",
  somethingElse: "Something else",
  review: "Review my profile",
  looksGood: "Looks good",
  gotIt: "Got it",
  buildStrategy: "Build my strategy",
  lookAround: "Look around first",
} as const;

export type Replies = { options: string[]; multi?: boolean; placeholder?: string };
export type Display = { text?: string; card?: Record<string, unknown>; replies?: Replies };

type Data = {
  analysisStatus?: "none" | "running" | "ready" | "failed";
  analysis?: Analysis | null;
  correction?: string | null;
  igStatus?: "none" | "running" | "ready" | "missing" | "failed";
  sub?: "ask_handle" | "paused" | "fix" | "review" | null;
  introShown?: boolean;
  summaryShown?: boolean;
  fieldIndex?: number;
};

async function patchData(userId: string, patch: Data) {
  // jsonb merge in one statement, so the background job and a request don't overwrite each other.
  await db.$executeRaw`UPDATE ${table("OnboardingState")} SET "data" = COALESCE("data", '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb, "updatedAt" = now() WHERE "userId" = ${userId}`;
}

async function load(userId: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, include: { business: true, onboarding: true } });
  let state = user.onboarding ?? (await db.onboardingState.create({ data: { userId } }));
  if (!state.conversationId) {
    const conv = await db.conversation.create({ data: { userId, title: ONBOARDING_TITLE, objectType: "onboarding" } });
    state = await db.onboardingState.update({ where: { userId }, data: { conversationId: conv.id } });
  }
  return { user, state, data: (state.data ?? {}) as Data, conversationId: state.conversationId! };
}

async function say(conversationId: string, role: "assistant" | "user", display: Display) {
  const text = display.text ?? "";
  await db.message.create({
    data: { conversationId, role, content: [{ type: "text", text: text || "(card)" }], display: display as object },
  });
  await db.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
}

// ---------- Background preparation: Instagram + reading the posts ----------

export async function prepareOnboarding(userId: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, include: { business: true, onboarding: true } });
  const handle = user.instagramHandle;
  if (!handle) return;
  const data = (user.onboarding?.data ?? {}) as Data;

  let bundle = await cachedInstagram(handle);
  if (!bundle) {
    await patchData(userId, { igStatus: "running" });
    try {
      bundle = await syncInstagram(handle);
    } catch (error) {
      console.error("[onboarding] instagram sync failed", error);
      await patchData(userId, { igStatus: "failed" });
      return;
    }
    if (!bundle) {
      await patchData(userId, { igStatus: "missing" });
      return;
    }
  }
  await patchData(userId, { igStatus: "ready", analysisStatus: "running" });
  try {
    const analysis = await analyzeInstagram(bundle, { businessName: user.business?.businessName ?? handle, correction: data.correction ?? null, userId });
    await patchData(userId, { analysis, analysisStatus: "ready" });
  } catch (error) {
    console.error("[onboarding] analysis failed", error);
    await patchData(userId, { analysisStatus: "failed" });
  }
}

export async function startPreparation(userId: string) {
  await patchData(userId, { analysisStatus: "running" });
  const queued = await enqueueSafe(JOB_PREPARE, { userId }, { singletonKey: `prepare:${userId}` });
  // No worker (tests, scripts): run inline.
  if (!queued) await prepareOnboarding(userId);
}

// ---------- Messages Duke says (texts from screens 2.1-2.5, E.4) ----------

function instagramCard(bundle: NonNullable<Awaited<ReturnType<typeof cachedInstagram>>>) {
  const p = bundle.profile;
  return {
    type: "instagram",
    name: p.name ?? p.handle,
    handle: p.handle,
    followers: p.followers,
    bio: p.bio,
    photoUrl: p.photoUrl,
    thumbnails: bundle.posts.slice(0, 6).map((post) => ({ url: post.thumbnailUrl, format: post.format })),
    source: bundle.source,
  };
}

function summaryText(analysis: Analysis, bundle: NonNullable<Awaited<ReturnType<typeof cachedInstagram>>>, again: boolean) {
  const { bestFormat } = formatStats(bundle.posts);
  const n = Math.min(bundle.posts.length, 12);
  const lines = [
    again ? "Thanks. Here’s what I understand now:" : `I read your last ${n} posts. Here’s what I understood:`,
    `· ${analysis.offerAndPlace}`,
    `· ${analysis.topics}`,
  ];
  // The number claim is computed, not written by the model. Below 3 posts per format, no comparison.
  if (bestFormat) lines.push(`· ${FORMAT_LABEL[bestFormat] ?? bestFormat} got the most likes and comments.`);
  lines.push("Did I get it right?");
  return lines.join("\n");
}

function questionDisplay(analysis: Analysis | null | undefined, index: number, first: boolean): Display {
  const field = PROFILE_FIELDS[index]!;
  const a = analysis?.fields?.[field.key];
  const options = [...new Set([a?.guess, ...(a?.suggestions ?? [])].map((s) => s?.trim()).filter((s): s is string => Boolean(s)))].slice(0, 4);
  const intro = first ? "Great. A few questions to finish your Business Profile. " : "";
  // The options already come from the posts; Duke just asks (no "I'd guess").
  return {
    text: `${intro}${field.question}`,
    card: { type: "question", field: field.key, index: index + 1, total: PROFILE_FIELDS.length },
    replies: { options: [...options, R.somethingElse], multi: true, placeholder: "Or type your own…" },
  };
}

// ---------- Read the current state (and catch up on anything the job finished) ----------

export async function getOnboarding(userId: string) {
  const { user, state, conversationId } = await load(userId);
  let data = (state.data ?? {}) as Data;
  if (state.status === "done") return { status: "done" as const, conversationId };

  const handle = user.instagramHandle;
  let bundle = handle ? await cachedInstagram(handle) : null;
  let pending: "instagram" | "analysis" | null = null;
  let problem: "instagram_missing" | "instagram_failed" | "analysis_failed" | null = null;

  // Nothing read yet (the sync at invite time didn't run): start it. Without a worker it runs inline.
  if (!bundle && handle && data.igStatus !== "running" && data.igStatus !== "missing" && data.igStatus !== "failed") {
    await startPreparation(userId);
    data = ((await db.onboardingState.findUniqueOrThrow({ where: { userId } })).data ?? {}) as Data;
    bundle = await cachedInstagram(handle);
  }
  if (!bundle) {
    if (data.igStatus === "missing") problem = "instagram_missing";
    else if (data.igStatus === "failed") problem = "instagram_failed";
    else pending = "instagram";
  }

  if (bundle && !data.introShown) {
    await patchData(userId, { introShown: true });
    data.introShown = true;
    await say(conversationId, "assistant", {
      text: "Hi, I’m Duke, your content strategist. This is the Instagram your invite is linked to:",
      card: instagramCard(bundle),
    });
    await say(conversationId, "assistant", { text: "Is this your business?", replies: { options: [R.yesUs, R.notMine] } });
  }

  // Start reading the posts as soon as the profile is there.
  if (bundle && (!data.analysisStatus || data.analysisStatus === "none")) {
    await startPreparation(userId);
    data = ((await db.onboardingState.findUniqueOrThrow({ where: { userId } })).data ?? {}) as Data;
  }

  if (state.step === 2 && !data.summaryShown && bundle) {
    if (data.analysisStatus === "ready" && data.analysis) {
      await say(conversationId, "assistant", { text: summaryText(data.analysis, bundle, Boolean(data.correction)), replies: { options: [R.yes, R.fix] } });
      await patchData(userId, { summaryShown: true });
    } else if (data.analysisStatus === "failed") problem = "analysis_failed";
    else pending = "analysis";
  }

  const [messages, bp] = await Promise.all([
    db.message.findMany({ where: { conversationId }, orderBy: { createdAt: "asc" }, select: { id: true, role: true, display: true, createdAt: true } }),
    db.businessProfile.findUnique({ where: { userId } }),
  ]);
  return {
    status: state.status as "active" | "paused",
    step: state.step,
    sub: data.sub ?? null,
    pending,
    problem,
    conversationId,
    fieldIndex: data.fieldIndex ?? 0,
    totalFields: PROFILE_FIELDS.length,
    profile: profileValues(bp as Record<string, unknown> | null),
    messages: messages.filter((m) => m.display !== null),
  };
}

export async function retryPreparation(userId: string) {
  await patchData(userId, { igStatus: "none", analysisStatus: "none" });
  await startPreparation(userId);
}

// ---------- The owner answers ----------

export type ReplyInput = { choices?: string[] | undefined; text?: string | undefined };

export class OnboardingInputError extends Error {}

export async function replyOnboarding(userId: string, input: ReplyInput) {
  const { user, state, data, conversationId } = await load(userId);
  if (state.status === "done") throw new OnboardingInputError("Onboarding is already done.");

  const choices = (input.choices ?? []).map((c) => c.trim()).filter(Boolean);
  const text = (input.text ?? "").trim();
  const said = [...choices.filter((c) => c !== R.somethingElse), text].filter(Boolean).join(", ");
  if (!said) throw new OnboardingInputError("Pick an option or type an answer.");
  const has = (c: string) => choices.includes(c);

  await say(conversationId, "user", { text: said });

  // Step 1 · Instagram (2.1) and Not my account (E.4)
  if (state.step === 1) {
    if (data.sub === "paused") {
      return;
    }
    if (data.sub === "ask_handle") {
      const requested = text.replace(/^@/, "").trim().toLowerCase();
      if (!/^[a-z0-9._]{1,30}$/.test(requested)) {
        await say(conversationId, "assistant", { text: "That doesn’t look like an Instagram handle. What’s the right account?", replies: { options: [], placeholder: "@right_account" } });
        return;
      }
      await db.accountChangeRequest.create({ data: { userId, currentHandle: user.instagramHandle, requestedHandle: requested } });
      const team = process.env.TEAM_EMAIL;
      if (team) await sendEmail(team, accountChangeTeamEmail({ businessName: user.business?.businessName ?? "—", email: user.email, current: user.instagramHandle, requested }), userId);
      await say(conversationId, "assistant", {
        text: "Thanks. Our team will check it and email you within 24 hours on business days. Your seat stays saved while we check.",
        replies: { options: [R.gotIt] },
      });
      await db.onboardingState.update({ where: { userId }, data: { status: "paused" } });
      await patchData(userId, { sub: "paused" });
      return;
    }
    if (has(R.yesUs)) {
      await db.onboardingState.update({ where: { userId }, data: { step: 2 } });
      await patchData(userId, { summaryShown: false, sub: null });
      return;
    }
    if (has(R.notMine)) {
      await say(conversationId, "assistant", { text: "No problem. What’s the right Instagram account?", replies: { options: [], placeholder: "@right_account" } });
      await patchData(userId, { sub: "ask_handle" });
      return;
    }
    await say(conversationId, "assistant", { text: "Is this your business?", replies: { options: [R.yesUs, R.notMine] } });
    return;
  }

  // Step 2 · What Duke learned (2.2)
  if (state.step === 2) {
    if (data.sub === "fix") {
      await patchData(userId, { correction: said, summaryShown: false, sub: null });
      await startPreparation(userId);
      return;
    }
    if (has(R.yes)) {
      await db.onboardingState.update({ where: { userId }, data: { step: 3 } });
      await patchData(userId, { fieldIndex: 0, sub: null });
      // Pre-fill what the posts already say (the owner confirms each one anyway).
      await say(conversationId, "assistant", questionDisplay(data.analysis, 0, true));
      return;
    }
    if (has(R.fix)) {
      await say(conversationId, "assistant", { text: "What did I get wrong? Tell me in your own words.", replies: { options: [], placeholder: "e.g. we also do private dinners" } });
      await patchData(userId, { sub: "fix" });
      return;
    }
    // A free answer here is read as a correction.
    await patchData(userId, { correction: said, summaryShown: false, sub: null });
    await startPreparation(userId);
    return;
  }

  // Step 3 · Business Profile questions (2.3), then the review (2.4)
  if (state.step === 3) {
    if (data.sub === "review") {
      if (!has(R.looksGood)) {
        await say(conversationId, "assistant", { text: "Open your Business Profile, edit anything, then tap Looks good.", card: { type: "profile_review" }, replies: { options: [R.review] } });
        return;
      }
      await db.businessProfile.update({ where: { userId }, data: { completedAt: new Date() } });
      await db.onboardingState.update({ where: { userId }, data: { step: 4 } });
      await patchData(userId, { sub: null });
      await say(conversationId, "assistant", {
        text: "Your Business Profile is saved. Now let’s build your first strategy: what you want to achieve and how we’ll get there, week by week.",
        replies: { options: [R.buildStrategy, R.lookAround] },
      });
      return;
    }
    const index = data.fieldIndex ?? 0;
    const key = FIELD_KEYS[index]!;
    await db.businessProfile.update({ where: { userId }, data: { [key]: said.slice(0, 600) } });
    const next = index + 1;
    if (next < FIELD_KEYS.length) {
      await patchData(userId, { fieldIndex: next });
      await say(conversationId, "assistant", questionDisplay(data.analysis, next, false));
    } else {
      await patchData(userId, { fieldIndex: next, sub: "review" });
      await say(conversationId, "assistant", {
        text: "That’s everything. Here’s your Business Profile, pre-filled from Instagram and your answers. Check it and edit anything.",
        card: { type: "profile_review" },
        replies: { options: [R.review] },
      });
    }
    return;
  }

  // Step 4 · First strategy (2.5)
  if (state.step === 4) {
    if (!has(R.buildStrategy) && !has(R.lookAround)) {
      await say(conversationId, "assistant", { text: "Want to build your first strategy now?", replies: { options: [R.buildStrategy, R.lookAround] } });
      return;
    }
    await db.onboardingState.update({ where: { userId }, data: { status: "done", completedAt: new Date() } });
    return { next: has(R.buildStrategy) ? ("strategy" as const) : ("home" as const) };
  }
}

// Admin fixes the handle after "Not my account": link the new Instagram and start over.
export async function resetOnboardingForNewHandle(userId: string, conversationId: string | null) {
  await db.onboardingState.update({ where: { userId }, data: { step: 1, status: "active", data: {} } });
  if (conversationId) {
    await say(conversationId, "assistant", { text: "Our team linked the right Instagram. Let’s start again." });
  }
  await startPreparation(userId);
}

export const onboardingUrl = () => appUrl("/onboarding");
