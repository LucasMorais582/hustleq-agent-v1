/*
  Client for hustleq-social-data-api (Apify behind it).
  Every call is slow (profile ~17s, trends 2-4 min), so callers set their own timeout.
  Auth: a short-lived HS256 JWT signed with the secret the API shares (JWT_SECRET there).
*/

import { createHmac } from "node:crypto";

export class SocialDataError extends Error {
  constructor(
    message: string,
    public status: number | null
  ) {
    super(message);
  }
}

type ProfileResponse = {
  response: {
    profile: {
      id: string;
      username: string;
      name?: string | null;
      biography?: string | null;
      followersCount?: number | null;
      followingCount?: number | null;
      totalPosts?: number | null;
      profilePicUrlHD?: string | null;
    };
    posts: {
      id: string;
      type?: string | null;
      caption?: string | null;
      url?: string | null;
      likesCount?: number | null;
      commentsCount?: number | null;
      publishedAt?: string | null;
    }[];
  };
};

type TrendsResponse = {
  response: {
    keywords: string[];
    collectedAt: string;
    daysBack: number;
    posts: {
      id: string;
      keyword?: string | null;
      url?: string | null;
      caption?: string | null;
      hashtags?: string[] | null;
      publishedAt?: string | null;
      author?: { username?: string | null } | null;
      media?: { type?: string | null; durationSeconds?: number | null } | null;
      metrics?: {
        likesCount?: number | null;
        commentsCount?: number | null;
        playsCount?: number | null;
      } | null;
      location?: string | null;
    }[];
  };
};

const b64url = (input: string | Buffer) => Buffer.from(input).toString("base64url");

function signToken(secret: string) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({
    sub: "marketing-agent",
    iss: process.env.SOCIAL_DATA_JWT_ISSUER || "hustleq",
    aud: process.env.SOCIAL_DATA_JWT_AUDIENCE || "hustleq-social-data-api",
    iat: now,
    exp: now + 600,
  }));
  const signature = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

async function post<T>(path: string, body: unknown, timeoutMs: number): Promise<T> {
  const base = process.env.SOCIAL_DATA_API_URL;

  if (!base) {
    throw new SocialDataError("SOCIAL_DATA_API_URL is not set", null);
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const secret = process.env.SOCIAL_DATA_JWT_SECRET;
  if (secret) headers.Authorization = `Bearer ${signToken(secret)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(base.replace(/\/$/, "") + path, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new SocialDataError(`social-data-api ${path} returned ${res.status}`, res.status);
    }

    return (await res.json()) as T;

  } catch (error: any) {
    if (error instanceof SocialDataError) throw error;
    if (error?.name === "AbortError") {
      throw new SocialDataError(`social-data-api ${path} timed out after ${timeoutMs}ms`, null);
    }
    throw new SocialDataError(`social-data-api ${path} failed: ${error?.message}`, null);

  } finally {
    clearTimeout(timer);
  }
}

export async function fetchInstagramProfile(username: string, timeoutMs = 40000) {
  const data = await post<ProfileResponse>(
    "/api/v1/instagram/profile/search",
    { username },
    timeoutMs
  );

  return data.response;
}

// All keywords go in one Apify run; searchLimit is per keyword.
export async function fetchInstagramTrends(
  keywords: string[],
  { daysBack = 14, searchLimit = 15, timeoutMs = 300000 } = {}
) {
  const data = await post<TrendsResponse>(
    "/api/v1/instagram/trends/search",
    { keywords, daysBack, searchLimit },
    timeoutMs
  );

  return data.response;
}
