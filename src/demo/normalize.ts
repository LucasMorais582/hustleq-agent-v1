/*
  social-data-api returns a different shape per route (Sidecar/Video vs reel/photo,
  flat likes vs metrics{}). Everything the demo stores goes through here first.
  CDN image/video URLs are dropped on purpose: they expire and the model doesn't need them.
*/

export type MediaFormat = "photo" | "carousel" | "reel";

export type NormalizedPost = {
  id: string;
  url: string | null;
  author: string | null;
  format: MediaFormat;
  caption: string;
  hashtags: string[];
  publishedAt: string | null;
  likes: number | null;
  comments: number | null;
  plays: number | null;
};

export function toFormat(type?: string | null): MediaFormat {
  const t = (type || "").toLowerCase();

  if (t === "sidecar" || t === "carousel" || t === "carousel_container") return "carousel";
  if (t === "video" || t === "reel" || t === "clips") return "reel";
  return "photo";
}

function count(v: unknown) {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}

// Skips tokens like "#4" that come from street addresses.
function cleanHashtags(tags?: string[] | null) {
  return (tags || [])
    .map((t) => t.replace(/^#/, "").toLowerCase().trim())
    .filter((t) => /[a-zà-ÿ]/i.test(t));
}

export function normalizeProfilePost(p: any): NormalizedPost {
  return {
    id: String(p.id),
    url: p.url ?? null,
    author: null,
    format: toFormat(p.type),
    caption: (p.caption || "").trim(),
    hashtags: cleanHashtags((p.caption || "").match(/#[\p{L}\p{N}_]+/gu)),
    publishedAt: p.publishedAt ?? null,
    likes: count(p.likesCount),
    comments: count(p.commentsCount),
    plays: null,
  };
}

export function normalizeTrendPost(p: any): NormalizedPost {
  return {
    id: String(p.id),
    url: p.url ?? null,
    author: p.author?.username ?? null,
    format: toFormat(p.media?.type),
    caption: (p.caption || "").trim(),
    hashtags: cleanHashtags(p.hashtags),
    publishedAt: p.publishedAt ?? null,
    likes: count(p.metrics?.likesCount),
    comments: count(p.metrics?.commentsCount),
    plays: count(p.metrics?.playsCount),
  };
}

export function interactions(p: NormalizedPost) {
  return (p.likes ?? 0) + (p.comments ?? 0);
}
