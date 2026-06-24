/**
 * Cloudflare R2 helpers. R2 is S3-compatible, so we use @aws-sdk/client-s3
 * with the R2 endpoint. Used for user-uploaded advocacy video clips (the
 * "video_url" field on profiles, originally YouTube/Vimeo only).
 *
 * Required envs to enable uploads (server-side):
 *   R2_ACCOUNT_ID         — your Cloudflare account id
 *   R2_ACCESS_KEY_ID      — R2 API token (S3-compat)
 *   R2_SECRET_ACCESS_KEY  — R2 API secret
 *   R2_BUCKET             — bucket name, e.g. "ikratom-media"
 *   R2_PUBLIC_BASE_URL    — public read base, e.g. "https://media.ikratom.org"
 *                           or "https://pub-XXXXXX.r2.dev"
 *
 * If any of the above is missing, isR2Configured() returns false and the
 * UI gracefully falls back to URL-only video input. No hard dependency.
 */

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

let _client: S3Client | null = null;

export function isR2Configured(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET &&
      process.env.R2_PUBLIC_BASE_URL
  );
}

function getClient(): S3Client {
  if (_client) return _client;
  const accountId = process.env.R2_ACCOUNT_ID!;
  _client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
  return _client;
}

export type PresignedUploadResult = {
  /** URL the client PUTs the file to with the same Content-Type header */
  uploadUrl: string;
  /** Final public URL once the upload completes */
  publicUrl: string;
  /** Object key inside the bucket (for diagnostics + future deletion) */
  key: string;
  /** Seconds until the presigned URL expires */
  expiresIn: number;
};

/**
 * Generate a presigned PUT URL for a one-shot upload. The caller passes
 * the contentType the browser will send — R2 stores it and serves it back
 * with the same value, so the file is playable inline without a proxy.
 *
 * key MUST be path-shaped (no leading slash) and should embed the actor's
 * id so abuse is traceable. e.g. "videos/{user_id}/{uuid}.mp4"
 */
export async function getPresignedUploadUrl(input: {
  key: string;
  contentType: string;
  expiresInSeconds?: number;
}): Promise<PresignedUploadResult> {
  if (!isR2Configured()) {
    throw new Error("R2 is not configured — set R2_* env vars.");
  }
  const expiresIn = Math.min(Math.max(input.expiresInSeconds ?? 600, 60), 3600);
  const client = getClient();
  const cmd = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET!,
    Key: input.key,
    ContentType: input.contentType,
  });
  const uploadUrl = await getSignedUrl(client, cmd, { expiresIn });
  const base = process.env.R2_PUBLIC_BASE_URL!.replace(/\/+$/, "");
  const publicUrl = `${base}/${input.key}`;
  return { uploadUrl, publicUrl, key: input.key, expiresIn };
}

/**
 * Server-side direct upload (no presign round-trip). Used by maintenance
 * scripts that already hold the bytes — e.g. caching official portraits from
 * public sources into our own bucket so we don't hotlink third-party CDNs.
 *
 * key MUST be path-shaped (no leading slash). Returns the final public URL.
 */
export async function putObjectToR2(input: {
  key: string;
  body: Uint8Array | Buffer;
  contentType: string;
}): Promise<{ key: string; publicUrl: string }> {
  if (!isR2Configured()) {
    throw new Error("R2 is not configured — set R2_* env vars.");
  }
  const client = getClient();
  await client.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET!,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
    })
  );
  const base = process.env.R2_PUBLIC_BASE_URL!.replace(/\/+$/, "");
  return { key: input.key, publicUrl: `${base}/${input.key}` };
}
