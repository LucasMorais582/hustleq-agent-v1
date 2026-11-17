import { db } from "../db.js";
import { activeStrategy } from "../plan/service.js";
import { campaignSuggestion, upcomingDates } from "../campaigns/service.js";
import { dayInTz, daysBetween } from "../lib/time.js";
import { howFar } from "../campaigns/service.js";
import { noteForDuke } from "../notes/service.js";

// How Duke opens a conversation started from somewhere in the app.

const short = (day: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));

// 7.1 · from a commercial date ("Plan" in 7.5, or the Home suggestion)
export async function campaignOpening(userId: string, tz: string, dateId: string) {
  const row = (await upcomingDates(userId, tz)).find((r) => r.id === dateId) ?? null;
  const suggestion = await campaignSuggestion(userId, tz);
  if (!row) return null;
  const days = daysBetween(dayInTz(new Date(), tz), row.date);
  const text = suggestion?.dateId === row.id ? suggestion.opening : `${row.name} is on ${short(row.date)}, ${howFar(days)}. Want to plan a campaign for it?`;
  return {
    text,
    card: undefined,
    replies: { options: ["Plan a campaign", "Not this year"] },
    title: `${row.name} ${row.date.slice(0, 4)}`,
    note: `campaign for the commercial date "${row.name}" on ${row.date} (dateId ${row.id}). "Not this year" means skip_commercial_date. Otherwise ask the period and posts per week, then which strategy guides it, then draft_campaign with this dateId.`,
  };
}

// 8.5 · Turn a note into a post
export async function noteOpening(userId: string, tz: string, noteId: string) {
  const note = await noteForDuke(userId, noteId);
  if (!note) return null;
  const strategies = await db.strategy.findMany({ where: { userId, status: "saved" }, select: { title: true }, orderBy: { startsOn: "desc" }, take: 3 });
  const active = await activeStrategy(userId, tz);
  const options = [...new Set([active?.name, ...strategies.map((s) => s.title)].filter((x): x is string => Boolean(x)))].slice(0, 3);
  return {
    text: "Let’s turn this note into a post. Which strategy?",
    card: { type: "note", noteId: note.noteId },
    replies: { options: [...options, "No strategy"] },
    title: `Post from: ${note.title}`.slice(0, 120),
    note: `turn the note "${note.title}" (noteId ${note.noteId}) into a post. Note text: ${note.text}${note.references.length ? ` References: ${note.references.join("; ")}` : ""}. Ask the strategy (done), then whether it's part of a campaign (list saved campaigns as replies plus "No campaign"), then the day, then draft_post with this noteId.`,
  };
}
