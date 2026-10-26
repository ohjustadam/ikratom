import "server-only";
import { createHash } from "node:crypto";
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Member photo storage (B4b, 2026-10-24): a PRIVATE Cloudflare R2 bucket.
 * Never Supabase Storage — Supabase egress is the platform's tightest ceiling,
 * and R2 egress is free. Nothing in the bucket is publicly addressable: every
 * read goes through /api/media/<id>, which asks the database whether THIS
 * viewer may see the photo and only then hands out a 10-minute signed URL.
 *
 * Credentials: MEDIA_R2_ACCESS_KEY_ID / MEDIA_R2_SECRET_ACCESS_KEY when set (a
 * bucket-scoped token, least privilege); otherwise derived from
 * CLOUDFLARE_DEPLOY_TOKEN exactly like lib/public-snapshots.ts does
 * (access key = token id, secret = sha256(token)).
 */

export const MEDIA_BUCKET = process.env.MEDIA_R2_BUCKET || "ikratom-member-media";
export const SIGNED_URL_TTL_SEC = 600;

export function isMediaStoreConfigured(): boolean {
  return Boolean(
    process.env.CLOUDFLARE_ACCOUNT_ID &&
      ((process.env.MEDIA_R2_ACCESS_KEY_ID && process.env.MEDIA_R2_SECRET_ACCESS_KEY) || process.env.CLOUDFLARE_DEPLOY_TOKEN),
  );
}

let clientPromise: Promise<S3Client | null> | undefined;
function client(): Promise<S3Client | null> {
  clientPromise ??= (async () => {
    let accessKeyId = process.env.MEDIA_R2_ACCESS_KEY_ID;
    let secretAccessKey = process.env.MEDIA_R2_SECRET_ACCESS_KEY;
    if (!accessKeyId || !secretAccessKey) {
      const token = process.env.CLOUDFLARE_DEPLOY_TOKEN;
      if (!token || !process.env.CLOUDFLARE_ACCOUNT_ID) return null;
      try {
        const r = await fetch("https://api.cloudflare.com/client/v4/user/tokens/verify", {
          headers: { authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(3000),
        });
        const j = (await r.json()) as { result?: { id?: string; status?: string } };
        if (!j.result?.id || j.result.status !== "active") return null;
        accessKeyId = j.result.id;
        secretAccessKey = createHash("sha256").update(token).digest("hex");
      } catch {
        return null;
      }
    }
    return new S3Client({
      region: "auto",
      endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
  })();
  // A transient verify failure must not disable storage for the instance's life.
  clientPromise.then((c) => { if (!c) clientPromise = undefined; });
  return clientPromise;
}

async function must(): Promise<S3Client> {
  const s3 = await client();
  if (!s3) throw new Error("Photo storage is not configured.");
  return s3;
}

export async function putMemberPhoto(key: string, body: Uint8Array, contentType: string): Promise<void> {
  const s3 = await must();
  await s3.send(
    new PutObjectCommand({
      Bucket: MEDIA_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: "private, max-age=31536000, immutable",
    }),
    { abortSignal: AbortSignal.timeout(15_000) },
  );
}

/** Best-effort: a leftover object is unreachable (no row → the route 404s). */
export async function deleteMemberPhoto(key: string): Promise<void> {
  try {
    const s3 = await must();
    await s3.send(new DeleteObjectCommand({ Bucket: MEDIA_BUCKET, Key: key }), { abortSignal: AbortSignal.timeout(10_000) });
  } catch (e) {
    console.error("[media-store] delete failed:", key, e instanceof Error ? e.message : e);
  }
}

export async function signedMemberPhotoUrl(key: string, contentType: string): Promise<string> {
  const s3 = await must();
  return getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: MEDIA_BUCKET, Key: key, ResponseContentType: contentType }),
    { expiresIn: SIGNED_URL_TTL_SEC },
  );
}
