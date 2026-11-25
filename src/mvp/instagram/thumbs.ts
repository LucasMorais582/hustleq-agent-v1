import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Instagram image links expire after about 5 days. We keep our own copy of each post cover (and
// profile photo) in a public Supabase bucket the first time we see it: ig/<profileId>/<postId>.jpg.
// Lists hand out our copy when it exists, else the Instagram link while a copy is made.

const BUCKET = process.env.IG_THUMB_BUCKET || "mvp-ig-thumbs";
const MAX_BYTES = 5 * 1024 * 1024;
const IG_HOST = /(^|\.)(cdninstagram\.com|fbcdn\.net)$/i;

let client: SupabaseClient | null = null;
let ready: Promise<void> | null = null;

function enabled() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function bucket() {
  client ??= createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  ready ??= (async () => {
    const { data } = await client!.storage.getBucket(BUCKET);
    if (data) return;
    const { error } = await client!.storage.createBucket(BUCKET, { public: true, fileSizeLimit: MAX_BYTES, allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"] });
    if (error && !/already exists/i.test(error.message)) throw error;
  })().catch((error) => {
    ready = null;
    throw error;
  });
  return ready.then(() => client!.storage.from(BUCKET));
}

const pathOf = (profileId: string, key: string) => `ig/${profileId}/${key.replace(/[^\w-]/g, "")}.jpg`;
const publicUrl = (path: string) => `${process.env.SUPABASE_URL!.replace(/\/$/, "")}/storage/v1/object/public/${BUCKET}/${path}`;

// Which keys of this profile already have a copy (one list call per profile, cached a few minutes).
const listed = new Map<string, { at: number; keys: Set<string> }>();
async function copiedKeys(profileId: string) {
  const hit = listed.get(profileId);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.keys;
  const b = await bucket();
  const { data } = await b.list(`ig/${profileId}`, { limit: 1000 });
  const keys = new Set((data ?? []).map((f) => f.name.replace(/\.jpg$/, "")));
  listed.set(profileId, { at: Date.now(), keys });
  return keys;
}

const inFlight = new Set<string>();
async function copy(profileId: string, key: string, src: string) {
  const path = pathOf(profileId, key);
  if (inFlight.has(path)) return;
  inFlight.add(path);
  try {
    const host = new URL(src).hostname;
    if (!IG_HOST.test(host)) return;
    const res = await fetch(src, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return; // expired already: nothing to keep
    const type = res.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
    const body = Buffer.from(await res.arrayBuffer());
    if (body.length > MAX_BYTES) return;
    const b = await bucket();
    const { error } = await b.upload(path, body, { contentType: type, upsert: true, cacheControl: "31536000" });
    if (!error) listed.get(profileId)?.keys.add(key);
  } catch (error) {
    console.error("[thumbs] copy failed", key, error instanceof Error ? error.message : error);
  } finally {
    inFlight.delete(path);
  }
}

// Returns a lasting URL for each item, starting copies for the ones we don't have yet.
export async function lastingImages<T extends { key: string; src: string | null }>(profileId: string, items: T[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (!enabled()) {
    for (const i of items) out.set(i.key, i.src);
    return out;
  }
  let have: Set<string>;
  try {
    have = await copiedKeys(profileId);
  } catch (error) {
    console.error("[thumbs] list failed", error);
    for (const i of items) out.set(i.key, i.src);
    return out;
  }
  for (const i of items) {
    if (have.has(i.key)) out.set(i.key, publicUrl(pathOf(profileId, i.key)));
    else {
      out.set(i.key, i.src);
      if (i.src) void copy(profileId, i.key, i.src);
    }
  }
  return out;
}

// Daily job: make sure the latest posts are copied while their links still work.
export async function keepImages(profileId: string, items: { key: string; src: string | null }[]) {
  if (!enabled()) return;
  const have = await copiedKeys(profileId);
  for (const i of items) if (i.src && !have.has(i.key)) await copy(profileId, i.key, i.src);
}
