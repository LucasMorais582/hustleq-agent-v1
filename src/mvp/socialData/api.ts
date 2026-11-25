import jwt from "jsonwebtoken";
import type { IgFormat, IgPost, IgProfile, IgProfileBundle, SocialDataSource } from "./types.js";
import { SocialDataUnavailable } from "./types.js";

// Client for Helio's Social Data API (SOCIAL_DATA_MODE=api). Contract: "Social Data API · Guia de
// implementação da MVP" + the Swagger at /docs. One short-lived HS256 token per call:
// user routes carry sub = our user id; /internal routes carry sub = hustleq-main, scope = service.

export type Caller = { userId: string } | "service";

export class SocialDataApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

function token(caller: Caller) {
  const secret = process.env.SOCIAL_DATA_JWT_SECRET;
  if (!secret) throw new SocialDataUnavailable("SOCIAL_DATA_JWT_SECRET is not set");
  const service = caller === "service";
  return jwt.sign(service ? { scope: "service" } : {}, secret, {
    algorithm: "HS256",
    subject: service ? "hustleq-main" : caller.userId,
    issuer: process.env.SOCIAL_DATA_JWT_ISSUER || "hustleq",
    audience: process.env.SOCIAL_DATA_JWT_AUDIENCE || "hustleq-social-data-api",
    expiresIn: 240,
  });
}

type CallOptions = { body?: unknown; query?: Record<string, string | number | null | undefined>; timeoutMs?: number };

export async function call<T>(method: string, path: string, caller: Caller, opts: CallOptions = {}): Promise<{ status: number; data: T }> {
  const base = process.env.SOCIAL_DATA_API_URL;
  if (!base) throw new SocialDataUnavailable("SOCIAL_DATA_API_URL is not set");
  const url = new URL(base.replace(/\/$/, "") + "/api/v1" + path);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v != null && v !== "") url.searchParams.set(k, String(v));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { authorization: `Bearer ${token(caller)}`, ...(opts.body !== undefined ? { "content-type": "application/json" } : {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : null,
      signal: controller.signal,
    });
  } catch (error) {
    const reason = error instanceof Error && error.name === "AbortError" ? "timed out" : error instanceof Error ? error.message : String(error);
    throw new SocialDataUnavailable(`${method} ${path} ${reason}`);
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 204) return { status: 204, data: undefined as T };
  const text = await res.text();
  const json = text ? (JSON.parse(text) as unknown) : undefined;
  if (res.ok) return { status: res.status, data: json as T };
  const err = (json as { error?: { code?: string; message?: string } } | undefined)?.error;
  // Provider down, timeouts and our own misconfiguration are "try again later" for the app.
  if (res.status >= 500 || res.status === 401) throw new SocialDataUnavailable(`${method} ${path} ${res.status} ${err?.code ?? ""}`);
  throw new SocialDataApiError(res.status, err?.code ?? "UNKNOWN", err?.message ?? `${method} ${path} returned ${res.status}`);
}

// ---------- Response shapes (guide sections 1 to 16) ----------

export type ApiType = "IMAGE" | "CAROUSEL" | "REEL";
export type ApiMetric = { likesCount: number | null; likesHidden: boolean; commentsCount: number | null; viewsCount: number | null; collectedAt: string };
export type ApiPost = {
  id: string;
  instagramPostId: string;
  url: string | null;
  type: ApiType;
  caption: string | null;
  hashtags: string[];
  displayUrl: string | null;
  images: string[];
  timestamp: string | null;
  ownerUsername: string | null;
  metrics: ApiMetric | null;
};
export type ApiProfileSnapshot = { followers: number | null; following: number | null; postsCount: number | null; collectedAt: string };
export type ApiProfile = {
  id: string;
  instagramId: string;
  username: string;
  name: string | null;
  url: string | null;
  bio: string | null;
  profilePhoto: string | null;
  category: string | null;
  isVerified: boolean | null;
  syncStatus: "pending" | "syncing" | "ready" | "failed";
  lastSyncedAt: string | null;
  metrics: ApiProfileSnapshot | null;
};
export type Ownership = "available" | "owned_by_me" | "owned_by_other" | "reserved" | "not_found";
type SearchResult =
  | { profileId: null; username: string; ownershipStatus: "not_found" }
  | { profileId: string | null; instagramId: string; username: string; name: string | null; bio: string | null; profilePhoto: string | null; isVerified: boolean | null; followers: number | null; following: number | null; postsCount: number | null; ownershipStatus: Exclude<Ownership, "not_found"> };
export type DiscoverPost = {
  instagramPostId: string;
  url: string | null;
  type: ApiType;
  caption: string | null;
  hashtags: string[];
  displayUrl: string | null;
  timestamp: string;
  ownerUsername: string | null;
  ownerFullName: string | null;
  likesCount: number | null;
  likesHidden: boolean;
  commentsCount: number | null;
  viewsCount: number | null;
};
export type Discover = { fromCache: boolean; fetchedAt: string; niche: string; city: string; query: string | null; posts: DiscoverPost[] };
export type Competitor = {
  id: string; // relation id (used to end it)
  competitorProfileId: string;
  createdAt: string;
  endedAt: string | null;
  competitorProfile: { id: string; instagramId: string; username: string; name: string | null; bio: string | null; profilePhoto: string | null; url: string | null };
};
export type ApifyCosts = { month: string; totalUsd: number | null; byUser: { userId: string; costUsd: number | null; runs: number }[]; byTrigger: { trigger: string; costUsd: number | null; runs: number }[]; unattributedUsd: number | null };

// ---------- Mapping to the app's shapes ----------

const FORMAT: Record<ApiType, IgFormat> = { IMAGE: "image", CAROUSEL: "carousel", REEL: "reel" };
export const toFormat = (t: ApiType) => FORMAT[t];

export function toIgPost(p: ApiPost): IgPost {
  return {
    id: p.id,
    url: p.url,
    format: FORMAT[p.type],
    caption: p.caption,
    publishedAt: p.timestamp,
    likes: p.metrics?.likesCount ?? null,
    comments: p.metrics?.commentsCount ?? null,
    views: p.metrics?.viewsCount ?? null,
    thumbnailUrl: p.displayUrl ?? p.images[0] ?? null,
  };
}

export function toIgProfile(p: ApiProfile): IgProfile {
  return {
    id: p.id,
    handle: p.username,
    name: p.name,
    bio: p.bio,
    followers: p.metrics?.followers ?? null,
    following: p.metrics?.following ?? null,
    totalPosts: p.metrics?.postsCount ?? null,
    photoUrl: p.profilePhoto,
  };
}

// ---------- Endpoints ----------

const enc = encodeURIComponent;

export const sda = {
  // 1. Check a handle before inviting (not saved there). Costs one Apify profile lookup.
  async search(handle: string, userId: string) {
    const { data } = await call<SearchResult>("GET", "/instagram/profiles/search", { userId }, { query: { username: handle }, timeoutMs: 60_000 });
    if (data.ownershipStatus === "not_found") return null;
    const profile: IgProfile = {
      id: data.instagramId,
      handle: data.username,
      name: data.name,
      bio: data.bio,
      followers: data.followers,
      following: data.following,
      totalPosts: data.postsCount,
      photoUrl: data.profilePhoto,
    };
    return { profile, ownership: data.ownershipStatus, profileId: data.profileId ?? null };
  },
  // 2. Reserve the profile for an invite; starts the Initial Profile Sync over there.
  async reserve(handle: string, inviteId: string, reservedUntil: Date) {
    const { data } = await call<{ profileId: string; username: string; status: "syncing" | "ready" }>("POST", "/internal/instagram/profiles", "service", {
      body: { username: handle, inviteId, reservedUntil: reservedUntil.toISOString() },
      timeoutMs: 60_000,
    });
    return data;
  },
  // 3. Invite accepted: the user owns the profile (same owner again is fine).
  async assignOwner(profileId: string, userId: string) {
    await call("POST", `/internal/instagram/profiles/${enc(profileId)}/owner`, "service", { body: { userId } });
  },
  // 4. Invite expired or revoked: free the reservation, keep the data.
  // Ends the user's ownership: the API ends their watched list and cancels pending syncs there.
  // A profile without owner answers 204 too; another owner answers 409 OWNER_MISMATCH.
  async removeOwner(profileId: string, userId: string) {
    await call("DELETE", `/internal/instagram/profiles/${enc(profileId)}/owner`, "service", { query: { userId } });
  },
  async releaseReservation(profileId: string) {
    await call("DELETE", `/internal/instagram/profiles/${enc(profileId)}/reservation`, "service");
  },
  // 11. Plan inactive: keep collecting until this date (null = always).
  async setMonitoring(profileId: string, until: Date | null) {
    await call("PATCH", `/internal/instagram/profiles/${enc(profileId)}/monitoring`, "service", { body: { monitoringUntil: until ? until.toISOString() : null } });
  },
  // 5.
  async profile(profileId: string, userId: string) {
    return (await call<ApiProfile>("GET", `/instagram/profiles/${enc(profileId)}`, { userId })).data;
  },
  // 6. Newest first.
  async posts(profileId: string, userId: string, q: { from?: string; to?: string; type?: ApiType; page?: number; limit?: number } = {}) {
    return (await call<{ profileId: string; posts: ApiPost[]; pagination: { page: number; limit: number; total: number; totalPages: number } }>("GET", `/instagram/profiles/${enc(profileId)}/posts`, { userId }, { query: q })).data;
  },
  // 7. Oldest first.
  async snapshots(profileId: string, userId: string, q: { from?: string; to?: string } = {}) {
    return (await call<{ profileId: string; snapshots: ApiProfileSnapshot[] }>("GET", `/instagram/profiles/${enc(profileId)}/snapshots`, { userId }, { query: q })).data.snapshots;
  },
  // 8. Older than 24 h: refresh starts there and the last known data comes back (refreshing true).
  async post(postId: string, userId: string) {
    const { status, data } = await call<ApiPost | { status: "refreshing"; post: ApiPost }>("GET", `/instagram/posts/${enc(postId)}`, { userId });
    return status === 202 ? { post: (data as { post: ApiPost }).post, refreshing: true } : { post: data as ApiPost, refreshing: false };
  },
  // 9. Oldest first.
  async postMetrics(postId: string, userId: string, q: { from?: string; to?: string } = {}) {
    return (await call<{ postId: string; metrics: (ApiMetric & { source: string | null })[] }>("GET", `/instagram/posts/${enc(postId)}/metrics`, { userId }, { query: q })).data.metrics;
  },
  // 10. "Refresh now". Our 2/day limit is checked before calling.
  async refreshPost(postId: string, userId: string) {
    await call("POST", `/instagram/posts/${enc(postId)}/refresh`, { userId });
  },
  // 13 to 15. Responses come wrapped in { response }.
  async competitors(profileId: string, userId: string) {
    const { data } = await call<{ response: { relations: Competitor[] } }>("GET", `/instagram/profiles/${enc(profileId)}/competitors`, { userId }, { query: { status: "active" } });
    return data.response.relations;
  },
  async addCompetitor(profileId: string, userId: string, handle: string) {
    const { data } = await call<{ response: Competitor }>("POST", `/instagram/profiles/${enc(profileId)}/competitors`, { userId }, { body: { username: handle }, timeoutMs: 60_000 });
    return data.response;
  },
  async endCompetitor(profileId: string, userId: string, relationId: string) {
    await call("DELETE", `/instagram/profiles/${enc(profileId)}/competitors/${enc(relationId)}`, { userId });
  },
  // 16. Cached (24 h there) -> 200 with posts. A miss queues the search over there and answers
  // 202 {status: "searching"}; ask again until the posts arrive. A failure in the last minute is an error.
  async discover(q: { niche: string; city: string; query?: string | null }, caller: Caller): Promise<Discover | { status: "searching" }> {
    return (await call<Discover | { status: "searching" }>("GET", "/instagram/discover", caller, { query: { niche: q.niche, city: q.city, query: q.query ?? undefined }, timeoutMs: 60_000 })).data;
  },
  // 12.
  async costs(month: string) {
    return (await call<ApifyCosts>("GET", "/internal/costs", "service", { query: { month } })).data;
  },
};

// Own profile + latest 12 posts, the shape the app already uses (onboarding, Home, Duke).
export async function ownBundle(profileId: string, userId: string): Promise<{ bundle: IgProfileBundle; syncStatus: ApiProfile["syncStatus"]; lastSyncedAt: string | null }> {
  const [profile, posts] = await Promise.all([sda.profile(profileId, userId), sda.posts(profileId, userId, { limit: 12 })]);
  return {
    bundle: { profile: toIgProfile(profile), posts: posts.posts.map(toIgPost), fetchedAt: profile.lastSyncedAt ?? new Date().toISOString(), source: "api" },
    syncStatus: profile.syncStatus,
    lastSyncedAt: profile.lastSyncedAt,
  };
}

// Admin check before an invite: profile only (posts arrive after the reservation's first sync).
export function apiSource(asUserId: string): SocialDataSource {
  return {
    name: "api",
    async lookupProfile(handle) {
      const found = await sda.search(handle.replace(/^@/, "").trim().toLowerCase(), asUserId);
      return found ? { profile: found.profile, posts: [], fetchedAt: new Date().toISOString(), source: "api" } : null;
    },
  };
}
