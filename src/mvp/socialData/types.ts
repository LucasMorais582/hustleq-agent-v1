// What the app needs from Instagram, independent of where it comes from.
// Shapes follow "Social Data API — Documentação dos Endpoints"; the real client maps to them.

export type IgFormat = "reel" | "carousel" | "image";

export type IgProfile = {
  id: string; // id in the Social Data API
  handle: string;
  name: string | null;
  bio: string | null;
  followers: number | null;
  following: number | null;
  totalPosts: number | null;
  photoUrl: string | null;
};

export type IgPost = {
  id: string;
  url: string | null;
  format: IgFormat;
  caption: string | null;
  publishedAt: string | null; // ISO
  likes: number | null;
  comments: number | null;
  views: number | null; // reels only
  thumbnailUrl: string | null; // Instagram CDN link, expires after a few days
};

export type IgProfileBundle = { profile: IgProfile; posts: IgPost[]; fetchedAt: string; source: "fake" | "demo" | "api" };

export interface SocialDataSource {
  readonly name: IgProfileBundle["source"];
  // Profile plus its most recent posts (up to 12). Null when the handle doesn't exist.
  lookupProfile(handle: string): Promise<IgProfileBundle | null>;
}

export class SocialDataUnavailable extends Error {}
