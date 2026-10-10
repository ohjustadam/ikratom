import "server-only";
import { createHash } from "node:crypto";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { snapshotThroughStore, type SnapshotLoad, type SnapshotStore } from "./public-snapshot-core";

export type { SnapshotLoad } from "./public-snapshot-core";

/**
 * Public-data snapshots in Cloudflare R2 (2026-10-10).
 *
 * WHY: Supabase's free plan caps egress at 5 GB/month and restricts the whole
 * site at 100%. Public pages read Supabase on every cache miss, and Netlify's
 * data cache starts empty on every deploy, so crawlers sweeping thousands of
 * pages (3,800 county officials were added 2026-10-09) turn straight into
 * egress. R2 egress is free. One Supabase read per page per maxAge now serves
 * every later miss, across instances AND deploys, and if Supabase is ever
 * failing or restricted, pages serve their last good snapshot instead of
 * breaking.
 *
 * Contract: ONLY public data — callers load with the anonymous client, the
 * same rule as the unstable_cache snapshots. Bucket `ikratom-snapshots` is
 * private (no public URL), so it is not a free scraping endpoint.
 *
 * Switch: SNAPSHOTS_R2=on plus SNAPSHOT_R2_PREFIX (production "prod/",
 * deploy previews "preview/", so a preview build can never write into what
 * production reads). Unset = off = exactly the old behaviour (kill switch).
 *
 * Credentials: SNAPSHOT_R2_ACCESS_KEY_ID / SNAPSHOT_R2_SECRET_ACCESS_KEY when
 * set (a bucket-scoped R2 token, least privilege); otherwise derived from
 * CLOUDFLARE_DEPLOY_TOKEN the documented way: access key = the token's id,
 * secret = sha256(token).
 *
 * Bump a call site's version (".../v1/...") whenever its loader's data shape
 * changes, or old snapshots will be read with new code.
 */

const BUCKET = process.env.SNAPSHOT_R2_BUCKET || "ikratom-snapshots";
const GET_TIMEOUT_MS = 1500;
const PUT_TIMEOUT_MS = 2500;

function enabled(): boolean {
  return process.env.SNAPSHOTS_R2 === "on" && Boolean(process.env.SNAPSHOT_R2_PREFIX) && Boolean(process.env.CLOUDFLARE_ACCOUNT_ID);
}

let clientPromise: Promise<S3Client | null> | undefined;
function client(): Promise<S3Client | null> {
  clientPromise ??= (async () => {
    let accessKeyId = process.env.SNAPSHOT_R2_ACCESS_KEY_ID;
    let secretAccessKey = process.env.SNAPSHOT_R2_SECRET_ACCESS_KEY;
    if (!accessKeyId || !secretAccessKey) {
      const token = process.env.CLOUDFLARE_DEPLOY_TOKEN;
      if (!token) return null;
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
  return clientPromise;
}

const r2Store: SnapshotStore = {
  async get(key) {
    const s3 = await client();
    if (!s3) return null;
    try {
      const o = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }), { abortSignal: AbortSignal.timeout(GET_TIMEOUT_MS) });
      return (await o.Body?.transformToString()) ?? null;
    } catch {
      return null; // NoSuchKey, timeout or network: a miss
    }
  },
  async put(key, body) {
    const s3 = await client();
    if (!s3) return;
    await s3.send(
      new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: "application/json" }),
      { abortSignal: AbortSignal.timeout(PUT_TIMEOUT_MS) },
    );
  },
};

/**
 * Serve `kind/version/id` from R2 when fresh, else load once (Supabase) and
 * store it. `id` must be a stable public identifier (a uuid or state code).
 */
export function publicSnapshot<T>(
  kind: string,
  version: string,
  id: string,
  maxAgeSec: number,
  load: () => Promise<SnapshotLoad<T>>,
): Promise<T | null> {
  const safeId = id.replace(/[^A-Za-z0-9_-]/g, "_");
  const key = `${process.env.SNAPSHOT_R2_PREFIX ?? ""}${kind}/${version}/${safeId}.json`;
  return snapshotThroughStore(enabled() ? r2Store : null, key, maxAgeSec, load);
}
