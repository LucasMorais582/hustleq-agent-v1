import { db } from "../db.js";
import { AppError } from "../http/errors.js";
import { isApiMode } from "../socialData/index.js";
import { sda, SocialDataApiError } from "../socialData/api.js";
import { SocialDataUnavailable } from "../socialData/types.js";
import { planStateOf } from "../billing/service.js";

// Who owns which profile in the Social Data API (guide endpoints 2, 3, 4 and 11).
// Invite created -> reserve (first sync starts there). Accepted -> owner. Expired/revoked -> release.
// Nothing happens in fake/demo mode.

// Called before the invite row exists, so a profile someone else holds stops the invite.
export async function reserveForInvite(inviteId: string, handle: string, expiresAt: Date) {
  if (!isApiMode()) return null;
  try {
    const r = await sda.reserve(handle, inviteId, expiresAt);
    return r.profileId;
  } catch (error) {
    if (error instanceof SocialDataApiError) {
      if (error.code === "PROFILE_ALREADY_OWNED") throw new AppError(409, "instagram_taken", "This Instagram already belongs to an account.");
      if (error.code === "PROFILE_RESERVED") throw new AppError(409, "instagram_taken", "This Instagram already has an open invite.");
      if (error.code === "PROFILE_NOT_FOUND") throw new AppError(404, "instagram_not_found", `We couldn't find @${handle} on Instagram.`);
    }
    if (error instanceof SocialDataUnavailable) throw new AppError(503, "instagram_unavailable", "We couldn't reach Instagram data right now. Try again in a minute.");
    throw error;
  }
}

// Expired, revoked or replaced invite. Failures are logged: the reservation also ends on its own date.
export async function releaseInvite(invite: { id: string; socialProfileId: string | null }) {
  if (!isApiMode() || !invite.socialProfileId) return;
  try {
    await sda.releaseReservation(invite.socialProfileId);
  } catch (error) {
    if (!(error instanceof SocialDataApiError && error.status === 404)) console.error("[social] release failed", invite.id, error);
  }
}

// Makes sure the user owns their profile in the API and returns its id there. Accounts created
// before api mode (no reservation yet) get one now, keyed by their invite.
export async function linkUser(userId: string): Promise<string | null> {
  if (!isApiMode()) return null;
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { socialProfileId: true, instagramHandle: true } });
  if (user.socialProfileId) return user.socialProfileId;
  if (!user.instagramHandle) return null;

  const invite = await db.invite.findFirst({ where: { acceptedUserId: userId }, orderBy: { acceptedAt: "desc" }, select: { id: true, socialProfileId: true, instagramHandle: true } });
  let profileId = invite?.instagramHandle === user.instagramHandle ? invite.socialProfileId : null;
  if (!profileId) {
    // Reservation key: the invite when there is one, else the user (handle changed by the team).
    const key = invite && invite.instagramHandle === user.instagramHandle ? invite.id : `user:${userId}:${user.instagramHandle}`;
    profileId = (await sda.reserve(user.instagramHandle, key, new Date(Date.now() + 864e5))).profileId;
  }
  await sda.assignOwner(profileId, userId);
  await db.user.update({ where: { id: userId }, data: { socialProfileId: profileId } });
  return profileId;
}

// Handle changed by the team ("Not my account"): the next read links the new profile.
// The API has no way yet to drop the old owner (asked to Helio), so the old profile keeps syncing.
export async function unlinkUser(userId: string) {
  if (!isApiMode()) return;
  await db.user.update({ where: { id: userId }, data: { socialProfileId: null, socialMonitoringUntil: null } });
}

const MONITOR_AFTER_INACTIVE_DAYS = 30;

// Daily: plan inactive -> the API keeps collecting for 30 more days, then stops. Active again -> always.
export async function syncMonitoring(now = new Date()) {
  if (!isApiMode()) return { changed: 0 };
  const users = await db.user.findMany({ where: { socialProfileId: { not: null } }, include: { subscription: true } });
  let changed = 0;
  for (const u of users) {
    const plan = planStateOf(u, u.subscription, now);
    let until: Date | null = null;
    if (plan.state !== "active") {
      // Counted from when access ended (or from sign-up for a plan that never started).
      const s = u.subscription;
      const stopped = s?.endedAt ?? s?.graceUntil ?? s?.currentPeriodEnd ?? u.createdAt;
      until = new Date(Math.min(stopped.getTime(), now.getTime()) + MONITOR_AFTER_INACTIVE_DAYS * 864e5);
    }
    if ((until?.getTime() ?? null) === (u.socialMonitoringUntil?.getTime() ?? null)) continue;
    try {
      await sda.setMonitoring(u.socialProfileId!, until);
      await db.user.update({ where: { id: u.id }, data: { socialMonitoringUntil: until } });
      changed += 1;
    } catch (error) {
      console.error("[social] monitoring failed", u.id, error);
    }
  }
  return { changed };
}
