import { createServer, type Server } from "node:http";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ownBundle, sda, SocialDataApiError } from "../../src/mvp/socialData/api.js";
import { SocialDataUnavailable } from "../../src/mvp/socialData/types.js";

// The api-mode client against a stand-in server that answers like Helio's routes (same paths,
// envelopes and codes as his Zod schemas on 24/11). Checks tokens, 202s and error mapping.

const SECRET = "x".repeat(40);
let server: Server;
const seen: { method: string; path: string; claims: jwt.JwtPayload; body: string }[] = [];

const post = (id: string, type: "REEL" | "IMAGE", likes: number | null) => ({
  id, instagramPostId: `ig_${id}`, url: `https://www.instagram.com/p/${id}/`, type, caption: "hi", hashtags: [], displayUrl: `https://cdn/${id}.jpg`, images: [],
  timestamp: "2026-11-20T23:00:00.000Z", ownerUsername: "bargoyana",
  metrics: { likesCount: likes, likesHidden: likes == null, commentsCount: 3, viewsCount: type === "REEL" ? 900 : null, collectedAt: "2026-11-24T09:00:00.000Z" },
});

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const url = new URL(req.url!, "http://x");
      const claims = jwt.verify((req.headers.authorization ?? "").slice(7), SECRET, { audience: "hustleq-social-data-api", issuer: "hustleq" }) as jwt.JwtPayload;
      seen.push({ method: req.method!, path: url.pathname + url.search, claims, body });
      const send = (status: number, data?: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(data === undefined ? "" : JSON.stringify(data));
      };
      const p = url.pathname.replace("/api/v1", "");
      if (p === "/instagram/profiles/search") {
        return url.searchParams.get("username") === "nobody"
          ? send(200, { username: "nobody", ownershipStatus: "not_found" })
          : send(200, { instagramId: "46489416578", username: "bargoyana", name: "Bar Goyana", bio: "b", profilePhoto: null, isVerified: false, followers: 7905, following: 1871, postsCount: 345, ownershipStatus: "available" });
      }
      if (p === "/internal/instagram/profiles") {
        return JSON.parse(body).username === "taken"
          ? send(409, { error: { code: "PROFILE_ALREADY_OWNED", message: "x", time: new Date().toISOString() } })
          : send(201, { profileId: "cprof1", username: "bargoyana", status: "syncing" });
      }
      if (p === "/internal/instagram/profiles/cprof1/owner") return send(200, { profileId: "cprof1", ownerUserId: JSON.parse(body).userId });
      if (p === "/internal/instagram/profiles/cprof1/reservation") return send(204);
      if (p === "/instagram/profiles/cprof1") {
        return send(200, { id: "cprof1", instagramId: "46489416578", username: "bargoyana", name: "Bar Goyana", url: null, bio: "b", profilePhoto: null, category: null, isVerified: false, syncStatus: "ready", lastSyncedAt: "2026-11-24T09:00:00.000Z", metrics: { followers: 7905, following: 1871, postsCount: 345, collectedAt: "2026-11-24T09:00:00.000Z" } });
      }
      if (p === "/instagram/profiles/cprof1/posts") return send(200, { profileId: "cprof1", posts: [post("p1", "REEL", 120), post("p2", "IMAGE", null)], pagination: { page: 1, limit: 12, total: 2, totalPages: 1 } });
      if (p === "/instagram/posts/p1") return send(202, { status: "refreshing", post: post("p1", "REEL", 120) });
      if (p === "/instagram/posts/p2") return send(200, post("p2", "IMAGE", 40));
      if (p === "/instagram/posts/p1/refresh") return send(429, { error: { code: "MANUAL_REFRESH_LIMIT_REACHED", message: "x", time: new Date().toISOString() } });
      if (p === "/instagram/profiles/cprof1/competitors") return send(200, { response: { relations: [], page: 1, limit: 50 } });
      if (p === "/internal/costs") return send(200, { month: "2026-11", totalUsd: 0.12, byUser: [{ userId: "u1", costUsd: 0.1, runs: 4 }], byTrigger: [], unattributedUsd: 0.02 });
      if (p === "/instagram/discover") return send(503, { error: { code: "PROVIDER_UNAVAILABLE", message: "x", time: new Date().toISOString() } });
      send(404, { error: { code: "NOT_FOUND", message: "x", time: new Date().toISOString() } });
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  const { port } = server.address() as { port: number };
  process.env.SOCIAL_DATA_API_URL = `http://127.0.0.1:${port}`;
  process.env.SOCIAL_DATA_JWT_SECRET = SECRET;
});
afterAll(() => server.close());

describe("Social Data API client (api mode)", () => {
  it("signs user calls with the user id and internal calls as the service", async () => {
    const found = await sda.search("bargoyana", "u1");
    expect(found).toMatchObject({ ownership: "available", profile: { id: "46489416578", handle: "bargoyana", followers: 7905, totalPosts: 345 } });
    expect(await sda.search("nobody", "u1")).toBeNull();
    expect(seen.at(-1)!.claims).toMatchObject({ sub: "u1" });
    expect(seen.at(-1)!.claims.scope).toBeUndefined();

    const r = await sda.reserve("bargoyana", "inv1", new Date("2026-12-01T05:00:00Z"));
    expect(r.profileId).toBe("cprof1");
    expect(seen.at(-1)!.claims).toMatchObject({ sub: "hustleq-main", scope: "service" });
    expect(JSON.parse(seen.at(-1)!.body)).toEqual({ username: "bargoyana", inviteId: "inv1", reservedUntil: "2026-12-01T05:00:00.000Z" });
    await sda.assignOwner("cprof1", "u1");
    await sda.releaseReservation("cprof1");
    const exp = seen.at(-1)!.claims;
    expect(exp.exp! - exp.iat!).toBeLessThanOrEqual(300);
  });

  it("maps business errors to codes and outages to SocialDataUnavailable", async () => {
    await expect(sda.reserve("taken", "inv2", new Date())).rejects.toMatchObject({ code: "PROFILE_ALREADY_OWNED", status: 409 });
    await expect(sda.refreshPost("p1", "u1")).rejects.toBeInstanceOf(SocialDataApiError);
    await expect(sda.discover({ niche: "bar", city: "Newark" }, "service")).rejects.toBeInstanceOf(SocialDataUnavailable);
  });

  it("reads the own profile and 12 posts in the app's shape, hidden likes as null", async () => {
    const { bundle, syncStatus } = await ownBundle("cprof1", "u1");
    expect(syncStatus).toBe("ready");
    expect(bundle).toMatchObject({ source: "api", profile: { id: "cprof1", handle: "bargoyana", followers: 7905 } });
    expect(bundle.posts).toEqual([
      expect.objectContaining({ id: "p1", format: "reel", likes: 120, views: 900, thumbnailUrl: "https://cdn/p1.jpg" }),
      expect.objectContaining({ id: "p2", format: "image", likes: null, views: null }),
    ]);
    expect(seen.find((s) => s.path.startsWith("/api/v1/instagram/profiles/cprof1/posts"))!.path).toContain("limit=12");
  });

  it("tells a fresh post from one being refreshed", async () => {
    expect(await sda.post("p1", "u1")).toMatchObject({ refreshing: true, post: { id: "p1" } });
    expect(await sda.post("p2", "u1")).toMatchObject({ refreshing: false, post: { id: "p2" } });
    expect(await sda.competitors("cprof1", "u1")).toEqual([]);
    expect(await sda.costs("2026-11")).toMatchObject({ totalUsd: 0.12 });
  });
});
