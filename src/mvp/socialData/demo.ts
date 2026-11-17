import { fetchInstagramProfile, SocialDataError } from "../../demo/socialData.client.js";
import type { IgFormat, IgProfileBundle, SocialDataSource } from "./types.js";
import { SocialDataUnavailable } from "./types.js";

// Uses the endpoint the Meet Duke demo already calls (POST /api/v1/instagram/profile/search).
// No change to Helio's API. It is slow (~17-24 s), so call it from a job and cache the result.

function toFormat(type: string | null | undefined): IgFormat {
  const t = (type ?? "").toLowerCase();
  if (t.includes("video") || t.includes("reel") || t.includes("clip")) return "reel";
  if (t.includes("sidecar") || t.includes("carousel")) return "carousel";
  return "image";
}

export const demoSource: SocialDataSource = {
  name: "demo",
  async lookupProfile(rawHandle) {
    const handle = rawHandle.replace(/^@/, "").trim().toLowerCase();
    try {
      const data = await fetchInstagramProfile(handle, 60_000);
      const p = data.profile;
      const bundle: IgProfileBundle = {
        profile: {
          id: p.id,
          handle: p.username,
          name: p.name ?? null,
          bio: p.biography ?? null,
          followers: p.followersCount ?? null,
          following: p.followingCount ?? null,
          totalPosts: p.totalPosts ?? null,
          photoUrl: p.profilePicUrlHD ?? null,
        },
        posts: data.posts.slice(0, 12).map((post) => ({
          id: post.id,
          url: post.url ?? null,
          format: toFormat(post.type),
          caption: post.caption ?? null,
          publishedAt: post.publishedAt ?? null,
          likes: post.likesCount ?? null,
          comments: post.commentsCount ?? null,
          views: null, // the demo endpoint does not return Reels views
          thumbnailUrl: post.displayUrl ?? null,
        })),
        fetchedAt: new Date().toISOString(),
        source: "demo",
      };
      return bundle;
    } catch (error) {
      if (error instanceof SocialDataError && error.status === 404) return null;
      throw new SocialDataUnavailable(error instanceof Error ? error.message : String(error));
    }
  },
};
