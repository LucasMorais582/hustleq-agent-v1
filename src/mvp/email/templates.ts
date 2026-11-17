// The app's emails (board: 1.1 and Email · ...). Same look on any device.
// Plain inline-styled HTML, the way email clients need it.

const C = { deep: "#2A0A3D", cream: "#F4EEE3", card: "#FFFDF9", border: "#E2D6C4", lilac: "#EDE1F6", muted: "#4A3A57", violet: "#5B2A82" };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

type Block = { eyebrow: string; title: string; body: string[]; button?: { label: string; url: string }; notes?: string[] };

function layout(b: Block) {
  const body = b.body.map((p) => `<p style="margin:0 0 12px;font-size:15px;line-height:22px;color:${C.deep}">${p}</p>`).join("");
  const notes = (b.notes ?? []).map((p) => `<p style="margin:12px 0 0;font-size:13px;line-height:18px;color:${C.muted}">${p}</p>`).join("");
  const button = b.button
    ? `<a href="${esc(b.button.url)}" style="display:inline-block;margin-top:8px;background:${C.deep};color:${C.card};text-decoration:none;font-weight:600;font-size:15px;padding:14px 22px;border-radius:12px">${esc(b.button.label)}</a>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:${C.cream};font-family:'Instrument Sans',Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.cream};padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
<tr><td style="background:${C.deep};color:${C.card};padding:22px 24px;border-radius:20px 20px 0 0;font-size:20px;font-weight:600">HustleQ</td></tr>
<tr><td style="background:${C.card};border:1px solid ${C.border};border-top:0;border-radius:0 0 20px 20px;padding:24px">
<p style="margin:0 0 6px;font-family:'IBM Plex Mono',Menlo,monospace;font-size:12px;color:${C.muted}">${b.eyebrow}</p>
<h1 style="margin:0 0 14px;font-size:24px;line-height:30px;color:${C.deep}">${b.title}</h1>
${body}${button}${notes}
</td></tr></table></td></tr></table></body></html>`;
}

function text(b: Block) {
  return [b.title, "", ...b.body, ...(b.button ? ["", `${b.button.label}: ${b.button.url}`] : []), ...(b.notes ? ["", ...b.notes] : [])]
    .join("\n").replace(/<[^>]+>/g, "");
}

export type Email = { template: string; subject: string; html: string; text: string };
const build = (template: string, subject: string, b: Block): Email => ({ template, subject, html: layout(b), text: text(b) });

type InviteVars = { businessName: string; handle: string; url: string; heldUntil: string };
const who = (v: { businessName: string; handle: string }) => `Invite for ${esc(v.businessName)} · @${esc(v.handle)}`;

export const inviteEmail = (v: InviteVars) =>
  build("invite", "Your HustleQ seat is ready", {
    eyebrow: who(v),
    title: "Your seat is ready.",
    body: [
      "We checked your Instagram and saved a seat for you. Create your password and I’ll show you what I learned from your last posts.",
      `<b>Held until ${esc(v.heldUntil)}.</b> After that, the seat goes to the next business on the list.`,
    ],
    button: { label: "Accept invite", url: v.url },
    notes: ["Duke First Access: your first month is free.", "One reminder a day until you accept or the invite expires."],
  });

export const inviteReminderEmail = (v: InviteVars & { daysLeft: number }) =>
  build("invite_reminder", `Your seat is still waiting · ${v.daysLeft} ${v.daysLeft === 1 ? "day" : "days"} left`, {
    eyebrow: who(v),
    title: "Your seat is still saved",
    body: ["Duke already looked at your Instagram. Create your password and see what he found in your last posts."],
    button: { label: "Accept invite", url: v.url },
    notes: [`Held until ${esc(v.heldUntil)}.`],
  });

export const inviteLastDayEmail = (v: InviteVars) =>
  build("invite_last_day", "Last day to claim your HustleQ seat", {
    eyebrow: `Invite for ${esc(v.businessName)}`,
    title: "Your invite expires tonight",
    body: ["After today, your seat goes to the next business on the waitlist."],
    button: { label: "Claim my seat", url: v.url },
    notes: ["Not interested? Ignore this email."],
  });

export const inviteExpiredEmail = (v: { businessName: string; waitlistUrl: string }) =>
  build("invite_expired", "Your invite expired", {
    eyebrow: esc(v.businessName),
    title: "Your seat went to the next business",
    body: ["We held it for 7 days. You can join the waitlist again and we’ll write when a new seat opens."],
    button: { label: "Join the waitlist again", url: v.waitlistUrl },
  });

export const passwordResetEmail = (v: { email: string; url: string }) =>
  build("password_reset", "Reset your HustleQ password", {
    eyebrow: "Account",
    title: "Set a new password",
    body: [`Someone asked to reset the password for ${esc(v.email)}. If it was you, use the button below. The link works once.`],
    button: { label: "Set new password", url: v.url },
    notes: ["Didn’t ask for this? Ignore this email; your password stays the same."],
  });

export const accountChangeTeamEmail = (v: { businessName: string; email: string; current: string | null; requested: string }) =>
  build("account_change_team", `Not my account: ${v.businessName} asked for @${v.requested}`, {
    eyebrow: "Team · onboarding",
    title: "An owner says the Instagram is wrong",
    body: [
      `${esc(v.businessName)} (${esc(v.email)}) was invited with @${esc(v.current ?? "—")} and says the right account is <b>@${esc(v.requested)}</b>.`,
      "Check it and fix it in Admin · Invites. We promised an answer within 24 hours on business days.",
    ],
  });

export const accountUpdatedEmail = (v: { handle: string; url: string }) =>
  build("account_updated", "Your Instagram is updated", {
    eyebrow: "Account",
    title: "We fixed your Instagram",
    body: [`Your HustleQ account is now linked to @${esc(v.handle)}. Log in and Duke will pick up from there.`],
    button: { label: "Open HustleQ", url: v.url },
  });

// 6.3 · morning of the post
export const postReminderEmail = (v: { timeLabel: string; formatLabel: string; title: string; mediaSummary: string; caption: string | null; hashtags: string[]; imageUrls: string[]; url: string; settingsUrl: string }) => {
  const imgs = v.imageUrls.slice(0, 4).map((u) => `<img src="${esc(u)}" alt="" width="112" height="112" style="width:112px;height:112px;object-fit:cover;border-radius:10px;margin:0 6px 6px 0;display:inline-block">`).join("");
  const caption = [v.caption, v.hashtags.join(" ")].filter(Boolean).join("\n\n");
  return build("post_reminder", `Today at ${v.timeLabel}: ${v.title}`, {
    eyebrow: `Today · ${esc(v.timeLabel)} · ${esc(v.formatLabel)}`,
    title: esc(v.title),
    body: [
      `${esc(v.mediaSummary)} Copy the caption, post at ${esc(v.timeLabel)}, and I’ll find it on your profile tomorrow.`,
      ...(imgs ? [imgs] : []),
      ...(caption ? [`<span style="display:block;background:${C.lilac};border-radius:12px;padding:14px;white-space:pre-wrap;font-size:14px;line-height:20px">${esc(caption)}</span>`] : []),
    ],
    button: { label: "Open post in HustleQ", url: v.url },
    notes: [`<a href="${esc(v.settingsUrl)}" style="color:${C.muted}">Turn off reminders in Account settings.</a>`],
  });
};
