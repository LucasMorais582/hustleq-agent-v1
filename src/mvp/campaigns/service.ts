import { db } from "../db.js";
import { cachedInstagram } from "../instagram/own.js";
import { addDays, dayInTz, daysBetween } from "../lib/time.js";
import { activeStrategy, contentTypeOf, FORMAT_LABEL, getStrategy, postSlot, queueDetails, type Format } from "../plan/service.js";
import { DAYS, mondayOf, scheduledAt } from "../plan/timing.js";

// Campaigns (7.1-7.4) and commercial dates (7.5, 7.6).

export class CampaignInputError extends Error {}

// One color per campaign, in this order (SYS-Event-Colors).
export const CAMPAIGN_COLORS = ["#9B6BC4", "#F08A4B", "#B4436E", "#5B2A82", "#F5B98A", "#C9A97E"];
export const SUGGEST_DAYS_BEFORE = 28;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const fmt = (day: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { ...o, timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
const short = (day: string) => fmt(day, { month: "short", day: "numeric" });
const range = (a: string, b: string) => `${short(a)} to ${a.slice(5, 7) === b.slice(5, 7) ? Number(b.slice(8)) : short(b)}`;

// "about two and a half weeks away", "in 5 days", "tomorrow"
export function howFar(days: number) {
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 7) return `in ${days} days`;
  const weeks = days / 7;
  const half = Math.round(weeks * 2) / 2;
  const words = ["", "one", "two", "three", "four", "five"];
  const whole = Math.floor(half);
  const text = half % 1 ? `${whole ? `${words[whole]} and a half` : "half a"} weeks` : `${words[whole] ?? whole} ${whole === 1 ? "week" : "weeks"}`;
  return `about ${text.replace("one and a half weeks", "a week and a half")} away`;
}

// ---------- Commercial dates ----------

export type DateRow = {
  id: string; // CommercialDate id, or "own:<UserCommercialDate id>"
  kind: "us" | "own";
  name: string;
  date: string;
  tip: string | null;
  suggestOn: string | null;
  campaign: { id: string; name: string; status: string } | null;
  skipped: boolean;
  repeats: boolean;
};

// Next occurrence of each date in the coming year, US and the owner's own.
export async function upcomingDates(userId: string, tz: string, horizonDays = 366): Promise<DateRow[]> {
  const today = dayInTz(new Date(), tz);
  const until = addDays(today, horizonDays);
  const [us, own, prefs, campaigns] = await Promise.all([
    db.commercialDate.findMany({ where: { country: "US", date: { gte: new Date(`${today}T00:00:00Z`), lte: new Date(`${until}T00:00:00Z`) } }, orderBy: { date: "asc" } }),
    db.userCommercialDate.findMany({ where: { userId, commercialDateId: null } }),
    db.userCommercialDate.findMany({ where: { userId, commercialDateId: { not: null } } }),
    db.campaign.findMany({ where: { userId, dateId: { not: null } }, select: { id: true, name: true, status: true, dateId: true, endsOn: true } }),
  ]);
  const rows: DateRow[] = [];
  for (const d of us) {
    const date = iso(d.date);
    const pref = prefs.find((p) => p.commercialDateId === d.id);
    const camp = campaigns.find((c) => c.dateId === d.id && c.status === "saved") ?? campaigns.find((c) => c.dateId === d.id);
    rows.push({ id: d.id, kind: "us", name: d.name, date, tip: d.tip, suggestOn: addDays(date, -SUGGEST_DAYS_BEFORE), campaign: camp ? { id: camp.id, name: camp.name, status: camp.status } : null, skipped: Boolean(pref?.notThisYear && pref.skippedYear === Number(date.slice(0, 4))), repeats: true });
  }
  for (const o of own) {
    if (!o.date || !o.name) continue;
    let date = iso(o.date);
    if (o.repeats) while (date < today) date = `${Number(date.slice(0, 4)) + 1}${date.slice(4)}`;
    if (date < today || date > until) continue;
    const id = `own:${o.id}`;
    const camp = campaigns.find((c) => c.dateId === id && iso(c.endsOn) >= addDays(date, -60));
    rows.push({ id, kind: "own", name: o.name, date, tip: null, suggestOn: o.suggestCampaign ? addDays(date, -SUGGEST_DAYS_BEFORE) : null, campaign: camp ? { id: camp.id, name: camp.name, status: camp.status } : null, skipped: Boolean(o.notThisYear && o.skippedYear === Number(date.slice(0, 4))), repeats: o.repeats });
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

export function dateState(r: DateRow, today: string) {
  if (r.campaign) return `Campaign: ${r.campaign.name} · ${r.campaign.status === "saved" ? "Planned" : "Draft"}`;
  if (r.skipped) return "Not this year";
  if (r.suggestOn && r.suggestOn > today) return `Duke will suggest a campaign on ${short(r.suggestOn)}`;
  return r.tip ?? "Plan a campaign for it";
}

export async function datesPage(userId: string, tz: string) {
  const today = dayInTz(new Date(), tz);
  const rows = await upcomingDates(userId, tz);
  return {
    items: rows.map((r) => ({ ...r, dateLabel: short(r.date), state: dateState(r, today), canPlan: !r.campaign })),
    note: "US dates, dates for your niche and your own dates. Duke suggests a campaign 3 to 4 weeks before each one.",
  };
}

export async function addOwnDate(userId: string, input: { name: string; date: string; repeats: boolean; suggestCampaign: boolean }) {
  return db.userCommercialDate.create({ data: { userId, name: input.name.trim().slice(0, 60), date: new Date(`${input.date}T00:00:00Z`), repeats: input.repeats, suggestCampaign: input.suggestCampaign } });
}

export async function removeOwnDate(userId: string, id: string) {
  const r = await db.userCommercialDate.deleteMany({ where: { id, userId, commercialDateId: null } });
  return r.count > 0;
}

// "Not this year": no suggestion for this date until next year.
export async function skipDate(userId: string, tz: string, dateId: string) {
  const row = (await upcomingDates(userId, tz)).find((r) => r.id === dateId);
  if (!row) return null;
  const year = Number(row.date.slice(0, 4));
  if (row.kind === "own") {
    await db.userCommercialDate.updateMany({ where: { id: dateId.slice(4), userId }, data: { notThisYear: true, skippedYear: year } });
  } else {
    const pref = await db.userCommercialDate.findFirst({ where: { userId, commercialDateId: dateId } });
    if (pref) await db.userCommercialDate.update({ where: { id: pref.id }, data: { notThisYear: true, skippedYear: year } });
    else await db.userCommercialDate.create({ data: { userId, commercialDateId: dateId, notThisYear: true, skippedYear: year } });
  }
  return { skipped: true, name: row.name };
}

// 7.1 · The date Duke should bring up now: within 4 weeks, no campaign, not skipped.
export async function campaignSuggestion(userId: string, tz: string) {
  const today = dayInTz(new Date(), tz);
  const row = (await upcomingDates(userId, tz, SUGGEST_DAYS_BEFORE + 1)).find((r) => r.suggestOn && r.suggestOn <= today && !r.campaign && !r.skipped && r.date > addDays(today, 2));
  if (!row) return null;
  const days = daysBetween(today, row.date);
  return {
    dateId: row.id,
    name: row.name,
    date: row.date,
    headline: `${row.name} is ${days === 1 ? "tomorrow" : `in ${days} days`}. Want a campaign?`,
    opening: `${row.name} is on ${short(row.date)}, ${howFar(days)}. Want to plan a campaign for it?`,
  };
}

// ---------- Campaigns ----------

export type CampaignPostInput = { date: string; time: string; format: Format; pillar?: string | undefined; title: string; hook?: string | undefined };

async function nextColor(userId: string) {
  const n = await db.campaign.count({ where: { userId } });
  return CAMPAIGN_COLORS[n % CAMPAIGN_COLORS.length]!;
}

export async function createDraftCampaign(userId: string, tz: string, conversationId: string | null, input: { name: string; dateId?: string | undefined; strategyId?: string | undefined; objective?: string | undefined; posts: CampaignPostInput[] }) {
  if (input.posts.length < 1 || input.posts.length > 30) throw new CampaignInputError("A campaign has 1 to 30 posts.");
  const today = dayInTz(new Date(), tz);
  const dates = input.posts.map((p) => p.date).sort();
  if (dates[0]! < today) throw new CampaignInputError("Campaign posts must be today or later.");
  const strategy = input.strategyId ? await getStrategy(userId, input.strategyId) : null;
  const pillarId = (name?: string) => (name && strategy ? strategy.pillars.find((p) => p.name.toLowerCase() === name.toLowerCase())?.id ?? null : null);
  const campaign = await db.campaign.create({
    data: {
      userId,
      name: input.name.trim().slice(0, 80),
      objective: input.objective?.trim().slice(0, 300) ?? null,
      startsOn: new Date(`${dates[0]}T00:00:00Z`),
      endsOn: new Date(`${dates.at(-1)}T00:00:00Z`),
      color: await nextColor(userId),
      status: "draft",
      dateId: input.dateId ?? null,
      strategyId: strategy?.id ?? null,
      conversationId,
      posts: {
        create: input.posts.map((p, i) => {
          const weekStart = mondayOf(new Date(`${p.date}T12:00:00Z`), "UTC");
          const day = DAYS[(new Date(`${p.date}T12:00:00Z`).getUTCDay() + 6) % 7]!;
          return {
            userId,
            status: "draft" as const,
            pillarId: pillarId(p.pillar),
            format: p.format,
            contentType: contentTypeOf(p.format),
            title: p.title.slice(0, 120),
            hook: p.hook?.slice(0, 300) ?? null,
            scheduledAt: scheduledAt(weekStart, day, p.time, tz),
            position: i,
          };
        }),
      },
    },
    include: { posts: true },
  });
  if (conversationId) await db.conversation.update({ where: { id: conversationId }, data: { objectType: "campaign", objectId: campaign.id } });
  void queueDetails(campaign.posts.map((p) => p.id)).catch((e) => console.error("[campaigns] queue details", e));
  return campaign;
}

export async function getCampaign(userId: string, id: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const c = await db.campaign.findFirst({ where: { id, userId }, include: { posts: { include: { pillar: true, publication: true }, orderBy: [{ scheduledAt: "asc" }, { position: "asc" }] } } });
  if (!c) return null;
  return presentCampaign(c, user.timezone, user.instagramHandle);
}

type CampaignRow = NonNullable<Awaited<ReturnType<typeof db.campaign.findFirst>>> & { posts: (NonNullable<Awaited<ReturnType<typeof db.post.findFirst>>> & { pillar: { name: string } | null; publication: { instagramPostId: string } | null })[] };

export async function presentCampaign(c: CampaignRow, tz: string, handle: string | null) {
  const today = dayInTz(new Date(), tz);
  const start = iso(c.startsOn);
  const end = iso(c.endsOn);
  const live = c.posts.filter((p) => p.status !== "cancelled");
  const count = (s: string) => live.filter((p) => p.status === s).length;
  const strategy = c.strategyId ? await db.strategy.findUnique({ where: { id: c.strategyId }, select: { id: true, title: true } }) : null;
  // Results of the published posts, from the profile's last posts.
  const bundle = handle ? await cachedInstagram(handle) : null;
  const igIds = new Set(c.posts.map((p) => p.publication?.instagramPostId).filter(Boolean));
  const published = (bundle?.posts ?? []).filter((p) => igIds.has(p.id));
  const results = published.length
    ? { likes: published.reduce((s, p) => s + (p.likes ?? 0), 0), comments: published.reduce((s, p) => s + (p.comments ?? 0), 0), views: published.reduce((s, p) => s + (p.views ?? 0), 0) }
    : null;
  const parts = [count("scheduled") && `${count("scheduled")} scheduled`, count("draft") && `${count("draft")} ${count("draft") === 1 ? "draft" : "drafts"}`].filter(Boolean);
  return {
    id: c.id,
    name: c.name,
    color: c.color,
    status: c.status === "draft" ? "draft" : today < start ? "upcoming" : today > end ? "ended" : "active",
    saved: c.status === "saved",
    startsOn: start,
    endsOn: end,
    datesLabel: range(start, end),
    objective: c.objective,
    strategy: strategy ? { id: strategy.id, name: strategy.title } : null,
    conversationId: c.conversationId,
    progress: { posted: count("posted"), total: live.length, label: `${count("posted")} of ${live.length} posted`, detail: parts.join(" · ") || null },
    posts: c.posts.map((p) => {
      const slot = postSlot(p.scheduledAt, tz);
      return { id: p.id, date: slot.date, dayLabel: slot.date ? fmt(slot.date, { weekday: "short", day: "numeric" }) : "", slotLabel: slot.label, title: p.title, format: p.format, formatLabel: FORMAT_LABEL[(p.format ?? "feed") as Format] ?? p.format, pillar: p.pillar?.name ?? null, status: p.status, detailsStatus: p.detailsStatus };
    }),
    weeks: weekSplit(start, end, c.posts.map((p) => postSlot(p.scheduledAt, tz).date).filter((d): d is string => Boolean(d))),
    results,
    resultsNote: results ? null : "Starts adding up after the first post goes live.",
  };
}

// "Week 1 builds interest, week 2 pushes orders": how many posts fall in each week.
function weekSplit(start: string, end: string, dates: string[]) {
  const out: { label: string; posts: number }[] = [];
  let i = 1;
  for (let w = mondayOf(new Date(`${start}T12:00:00Z`), "UTC"); w <= end; w = addDays(w, 7), i += 1) {
    const to = addDays(w, 6);
    out.push({ label: `Week ${i} · ${range(w < start ? start : w, to > end ? end : to)}`, posts: dates.filter((d) => d >= w && d <= to).length });
  }
  return out;
}

export async function listCampaigns(userId: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const rows = await db.campaign.findMany({ where: { userId, status: "saved" }, include: { posts: { include: { pillar: true, publication: true } } }, orderBy: { startsOn: "desc" } });
  const items = await Promise.all(rows.map((c) => presentCampaign(c, user.timezone, null)));
  const order = { active: 0, upcoming: 1, ended: 2, draft: 3 } as const;
  return items.sort((a, b) => order[a.status as keyof typeof order] - order[b.status as keyof typeof order]).map((c) => ({
    id: c.id, name: c.name, color: c.color, status: c.status, datesLabel: c.datesLabel,
    summary: `${c.datesLabel} · ${c.progress.total} ${c.progress.total === 1 ? "post" : "posts"} · ${c.progress.posted === c.progress.total && c.progress.total ? "all posted" : `${c.progress.posted} posted`}`,
  }));
}

// Save campaign: its posts become Scheduled (reminders on), and Duke says so in the chat.
export async function saveCampaign(userId: string, id: string) {
  const c = await db.campaign.findFirst({ where: { id, userId }, include: { posts: true } });
  if (!c) return null;
  await db.$transaction([
    db.post.updateMany({ where: { campaignId: id, status: "draft" }, data: { status: "scheduled", reminderSentAt: null } }),
    db.campaign.update({ where: { id }, data: { status: "saved" } }),
  ]);
  const n = c.posts.filter((p) => p.status !== "cancelled").length;
  if (c.conversationId && c.status !== "saved") {
    const text = `Saved. ${c.name} is on your calendar with its own color. I’ll email you on each post day.`;
    await db.message.create({
      data: {
        conversationId: c.conversationId,
        role: "assistant",
        content: [{ type: "text", text: `(App note, not shown to the owner: the owner tapped Save campaign. Campaign "${c.name}" (id ${c.id}) is saved, ${n} posts scheduled.)\n${text}` }],
        display: { text, card: { type: "notice", text: `Campaign saved · ${n} ${n === 1 ? "post" : "posts"}`, link: `/campaigns/${c.id}`, linkLabel: "Open campaign" }, replies: { options: ["Shot list for the campaign", "Export campaign", "Later"] } },
      },
    });
    await db.conversation.update({ where: { id: c.conversationId }, data: { updatedAt: new Date() } });
  }
  return getCampaign(userId, id);
}

// Planning context for Duke: the strategy and what's already on those days.
export async function campaignContext(userId: string, tz: string, from: string, to: string) {
  const [strategy, posts] = await Promise.all([
    activeStrategy(userId, tz),
    db.post.findMany({ where: { userId, status: { in: ["scheduled", "draft"] }, scheduledAt: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T23:59:59Z`) } }, select: { scheduledAt: true, title: true, format: true, status: true } }),
  ]);
  return {
    strategy,
    alreadyPlanned: posts.map((p) => ({ date: p.scheduledAt ? dayInTz(p.scheduledAt, tz) : null, title: p.title, format: p.format, status: p.status })),
  };
}
