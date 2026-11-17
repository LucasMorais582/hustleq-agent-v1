import type { IgFormat, IgPost, IgProfileBundle, SocialDataSource } from "./types.js";

// Deterministic fake data in the real format, so every screen works before the API exists.
// Same handle -> same numbers, every time.

function seeded(handle: string) {
  let h = 2166136261;
  for (const c of handle) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

const FORMATS: IgFormat[] = ["reel", "carousel", "image", "reel", "carousel", "reel"];

export const fakeSource: SocialDataSource = {
  name: "fake",
  async lookupProfile(rawHandle) {
    const handle = rawHandle.replace(/^@/, "").trim().toLowerCase();
    if (!handle || handle.startsWith("notfound")) return null;

    const rand = seeded(handle);
    const followers = 800 + Math.floor(rand() * 9000);
    const now = Date.now();
    const posts: IgPost[] = Array.from({ length: 12 }, (_, i) => {
      const format = FORMATS[i % FORMATS.length] ?? "image";
      const likes = Math.floor(followers * (0.01 + rand() * 0.05));
      return {
        id: `fake_${handle}_${i + 1}`,
        url: `https://www.instagram.com/p/fake${i + 1}/`,
        format,
        caption: `[Fake post ${i + 1} from @${handle}]`,
        publishedAt: new Date(now - (i * 2 + 1) * 864e5).toISOString(),
        likes,
        comments: Math.floor(likes * (0.02 + rand() * 0.08)),
        views: format === "reel" ? Math.floor(followers * (0.3 + rand() * 2)) : null,
      };
    });

    const bundle: IgProfileBundle = {
      profile: {
        id: `fake_${handle}`,
        handle,
        name: handle.replace(/[._]/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()),
        bio: "[Fake bio: test data until the Social Data API is ready]",
        followers,
        following: 200 + Math.floor(rand() * 600),
        totalPosts: 40 + Math.floor(rand() * 400),
        photoUrl: null,
      },
      posts,
      fetchedAt: new Date().toISOString(),
      source: "fake",
    };
    return bundle;
  },
};
