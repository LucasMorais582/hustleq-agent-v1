import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Post media lives in Supabase Storage (decided 17/11; S3 only if the free tier doesn't fit).
// Private bucket: the app uploads straight to Storage with a signed upload URL (files never go
// through our API), and reads them with short-lived signed URLs.

export const BUCKET = process.env.MEDIA_BUCKET || "mvp-post-media";
// Free tier: 50 MB per file. A 30 s phone video at 1080p fits; 4K may not.
export const MAX_BYTES = 50 * 1024 * 1024;
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
export const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];

let client: SupabaseClient | null = null;
let bucketReady: Promise<void> | null = null;

function storage() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are needed for media");
  client ??= createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client.storage;
}

// Creates the private bucket the first time (idempotent).
export function ensureBucket() {
  bucketReady ??= (async () => {
    const s = storage();
    const { data } = await s.getBucket(BUCKET);
    if (data) return;
    const { error } = await s.createBucket(BUCKET, { public: false, fileSizeLimit: MAX_BYTES, allowedMimeTypes: [...IMAGE_TYPES, ...VIDEO_TYPES] });
    if (error && !/already exists/i.test(error.message)) throw error;
  })().catch((error) => {
    bucketReady = null;
    throw error;
  });
  return bucketReady;
}

const EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif",
  "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm",
};

// Path is decided by the server: <user>/<post>/<random>.<ext>. The app can't choose where it writes.
export async function signedUpload(userId: string, postId: string, mimeType: string) {
  await ensureBucket();
  const path = `${userId}/${postId}/${randomUUID()}.${EXT[mimeType] ?? "bin"}`;
  const { data, error } = await storage().from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw error ?? new Error("Could not create the upload URL");
  return { path, uploadUrl: data.signedUrl };
}

export async function fileInfo(path: string) {
  const { data, error } = await storage().from(BUCKET).info(path);
  if (error || !data) return null;
  return { size: Number(data.size ?? 0), contentType: data.contentType ?? null };
}

export async function signedReadUrls(paths: string[], ttlSeconds = 3600) {
  if (!paths.length) return new Map<string, string>();
  const { data, error } = await storage().from(BUCKET).createSignedUrls(paths, ttlSeconds);
  if (error || !data) return new Map<string, string>();
  return new Map(data.filter((d) => d.signedUrl && d.path).map((d) => [d.path!, d.signedUrl]));
}

export async function removeFiles(paths: string[]) {
  if (!paths.length) return;
  const { error } = await storage().from(BUCKET).remove(paths);
  if (error) console.error("[media] could not remove files", error);
}
