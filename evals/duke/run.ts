import "../../src/config/env.js";
// Duke eval: real Claude calls on the Bahia Taste fixture. Run after any change to Duke's
// instructions, tools or the onboarding analysis:   npm run eval:duke
// Costs a few cents per run. Uses the mvp_test schema.
process.env.MVP_DATABASE_URL = process.env.MVP_TEST_DATABASE_URL;
process.env.MVP_DIRECT_URL = process.env.MVP_TEST_DIRECT_URL;
const { db } = await import("../../src/mvp/db.js");
const { analyzeInstagram } = await import("../../src/mvp/onboarding/analysis.js");
const { runDukeTurn } = await import("../../src/mvp/duke/chat.js");
const { BAHIA_TASTE } = await import("./bahia-taste.fixture.js");
const { PROFILE_FIELDS } = await import("../../src/mvp/business/fields.js");

type Check = { name: string; ok: boolean; detail?: string };
const results: Check[] = [];
const check = (name: string, ok: boolean, detail?: string) => results.push({ name, ok, ...(detail ? { detail } : {}) });
const numbersIn = (s: string) => (s.match(/\d[\d,.]*/g) ?? []).map((n) => n.replace(/,/g, "").replace(/\.$/, ""));
const started = new Date();

// ---------- 1. Onboarding: reading the posts ----------
const a = await analyzeInstagram(BAHIA_TASTE, { businessName: "Bahia Taste" });
const summary = `${a.offerAndPlace} ${a.topics}`;
check("summary starts as the screen says", a.offerAndPlace.startsWith("You sell") && a.topics.startsWith("Your posts show"), summary);
check("summary names the food", /bahia|brazil/i.test(summary), summary);
check("summary names the place", /new york|new jersey|\bny\b|\bnj\b/i.test(a.offerAndPlace), a.offerAndPlace);
check("summary mentions events or meal prep", /event|catering|meal/i.test(summary), summary);
for (const f of PROFILE_FIELDS) {
  const s = a.fields[f.key].suggestions;
  check(`${f.key}: 3-4 short suggestions`, s.length >= 3 && s.length <= 4 && s.every((x) => x.split(/\s+/).length <= 9), JSON.stringify(s));
}
check("doNotPost ends with Nothing, all good", a.fields.doNotPost.suggestions.at(-1) === "Nothing, all good", JSON.stringify(a.fields.doNotPost.suggestions));
const sourceNumbers = new Set(numbersIn(JSON.stringify(BAHIA_TASTE)));
const invented = numbersIn(JSON.stringify(a)).filter((n) => !sourceNumbers.has(n) && !/^[1-4]$/.test(n));
check("no invented numbers in the analysis", invented.length === 0, invented.join(", "));

// ---------- 2. Chat: tools, honesty, scope ----------
const handle = "bahiataste_eval";
const user = await db.user.upsert({
  where: { email: "eval-bahia@hustleq.test" },
  update: { instagramHandle: handle },
  create: { email: "eval-bahia@hustleq.test", passwordHash: "x", instagramHandle: handle, timezone: "America/New_York" },
});
const profile = { businessName: "Bahia Taste", whatYouDo: "Bahian food for events and weekly meal delivery", niche: "Brazilian food", location: "New York and New Jersey", offers: "Event catering, weekly meal prep", doNotPost: "Prices", completedAt: new Date() };
await db.businessProfile.upsert({ where: { userId: user.id }, update: profile, create: { userId: user.id, ...profile } });
const cached = { ...BAHIA_TASTE, profile: { ...BAHIA_TASTE.profile, handle } };
await db.instagramCache.upsert({
  where: { handle },
  update: { data: cached as object, fetchedAt: new Date() },
  create: { handle, profileId: "bt_fixture", source: "demo", data: cached as object },
});

async function turn(text: string) {
  const conv = await db.conversation.create({ data: { userId: user.id, title: "eval" } });
  let out = "";
  const cards: Record<string, unknown>[] = [];
  let replies: string[] = [];
  await runDukeTurn(user.id, conv.id, text, { text: (d) => (out += d), card: (c) => cards.push(c), replies: (r) => (replies = r) });
  const calls = await db.toolCall.findMany({ where: { conversationId: conv.id } });
  return { out, cards, replies, tools: calls.map((t) => t.name), toolOutputs: JSON.stringify(calls.map((c) => c.output)) };
}

const t1 = await turn("How many followers do I have?");
check("followers: reads Instagram with a tool", t1.tools.includes("get_instagram_summary"), t1.tools.join(","));
check("followers: says 1,358", /1,?358/.test(t1.out), t1.out);

const q2 = "Are Reels working better for me than carousels?";
const t2 = await turn(q2);
check("reels: reads Instagram", t2.tools.includes("get_instagram_summary"), t2.tools.join(","));
const known = new Set([...numbersIn(t2.toolOutputs), ...numbersIn(q2)]);
const made = numbersIn(t2.out).filter((n) => !known.has(n) && !/^(1|2|3|4|5|6|7|8|9|10|12)$/.test(n));
check("reels: every number comes from the data", made.length === 0, `extra: ${made.join(", ")} · ${t2.out.slice(0, 400)}`);
check("reels: ends with 2-4 quick replies", t2.replies.length >= 2 && t2.replies.length <= 4, JSON.stringify(t2.replies));

const t3 = await turn("We also do private chef dinners at home now.");
check("new offer: proposes a profile update card", t3.cards.some((c) => c.type === "profile_update"), JSON.stringify(t3.cards));
check("new offer: doesn't change the profile itself", (await db.businessProfile.findUniqueOrThrow({ where: { userId: user.id } })).offers === profile.offers);

const t4 = await turn("Can you do my taxes for this year?");
check("out of scope: no tools", t4.tools.length === 0, t4.tools.join(","));
check("out of scope: short, and offers Instagram help instead", /instagram|post|content/i.test(t4.out) && t4.out.length < 700, t4.out);

const t5 = await turn("Write a caption for our weekly meal prep post. Boxes are $14.");
check("don't post: keeps the price out of the caption (profile says Prices)", !/\$\s?14/.test(t5.out) || /price/i.test(t5.out), t5.out.slice(0, 500));

// ---------- 3. Strategy and week (phase 3a) ----------
await db.usage.deleteMany({ where: { userId: user.id } }); // the daily cap would stop the eval
const conv = await db.conversation.create({ data: { userId: user.id, title: "eval strategy" } });
const collect = async (text: string) => {
  let out = "";
  const cards: Record<string, unknown>[] = [];
  let replies: string[] = [];
  await runDukeTurn(user.id, conv.id, text, { text: (d) => (out += d), card: (c) => cards.push(c), replies: (r) => (replies = r) });
  return { out, cards, replies };
};
const s1 = await collect("I want a new strategy. Goal: more catering orders for the holidays.");
check("strategy: asks one thing at a time (duration) with replies", s1.replies.some((r) => /week/i.test(r)) && s1.cards.length === 0, `${s1.out.slice(0, 200)} ${JSON.stringify(s1.replies)}`);
const s2 = await collect("8 weeks");
const mix = s2.cards.find((c) => c.type === "weekly_mix");
check("strategy: shows the weekly mix picker", Boolean(mix), JSON.stringify(s2.cards));
const s3 = await collect("2 static posts, 2 videos and 3 stories a week.");
const stratCard = s3.cards.find((c) => c.type === "strategy");
check("strategy: drafts a strategy card", Boolean(stratCard), s3.out.slice(0, 300));
if (stratCard) {
  const st = await db.strategy.findUniqueOrThrow({ where: { id: String(stratCard.strategyId) }, include: { pillars: true } });
  check("strategy: 8 weeks, 2/2/3, 1-4 pillars", st.durationWeeks === 8 && st.staticPerWeek === 2 && st.videosPerWeek === 2 && st.storiesPerWeek === 3 && st.pillars.length >= 1 && st.pillars.length <= 4, JSON.stringify({ d: st.durationWeeks, s: st.staticPerWeek, v: st.videosPerWeek, st: st.storiesPerWeek, p: st.pillars.length }));
  check("strategy: no invented numbers in objective or goals", !/\d/.test(`${st.objective} ${st.pillars.map((p) => p.goal).join(" ")}`.replace(/8 weeks?/g, "")), `${st.objective} | ${st.pillars.map((p) => p.goal).join(" | ")}`);
  const { saveStrategy } = await import("../../src/mvp/plan/service.js");
  await saveStrategy(user.id, st.id, "America/New_York");
  const w1 = await collect("Plan this week");
  const weekCard = w1.cards.find((c) => c.type === "week");
  check("week: drafts a week card", Boolean(weekCard), w1.out.slice(0, 300));
  if (weekCard) {
    const wk = await db.week.findUniqueOrThrow({ where: { id: String(weekCard.weekId) }, include: { posts: true } });
    const by = (t: string) => wk.posts.filter((p) => p.contentType === t).length;
    check("week: follows the strategy (2 static, 2 videos, 3 stories)", by("static") === 2 && by("video") === 2 && by("story") === 3, JSON.stringify({ static: by("static"), video: by("video"), story: by("story") }));
    check("week: says when posts go out", /\d{1,2}(:\d{2})?\s?(AM|PM)/i.test(w1.out), w1.out.slice(0, 300));
    const before = wk.posts.find((p) => p.format !== "reel" && p.contentType === "static");
    const w2 = await collect(`Make the "${before?.title}" post a Reel.`);
    const after = before ? await db.post.findUniqueOrThrow({ where: { id: before.id } }) : null;
    check("week: refine changes that post to a Reel", after?.format === "reel", `${w2.out.slice(0, 200)}`);
  }
}

// ---------- Report ----------
const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${!r.ok && r.detail ? `\n      ${r.detail}` : ""}`);
const cost = await db.aiUsage.aggregate({ _sum: { costUsd: true }, where: { createdAt: { gte: started } } });
console.log(`\n${results.length - failed.length}/${results.length} passed · cost of this run ≈ $${Number(cost._sum.costUsd ?? 0).toFixed(4)}`);
await db.$disconnect();
process.exit(failed.length ? 1 : 0);
