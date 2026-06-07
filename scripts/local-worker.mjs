#!/usr/bin/env node
/**
 * local-worker.mjs — the owner's local "heavy tier" worker.
 *
 * Runs on the home PC (i7 / 64GB / GTX 1080 Ti / Ollama). PULLS jobs from the
 * Supabase local_jobs queue (migration 0185), does the heavy work the free-tier
 * cloud can't (Kokoro TTS renders today; Whisper transcription + Ollama agent
 * work as those handlers land), and PUSHES results back. Connection is
 * OUTBOUND-ONLY — the PC reaches Supabase; nothing reaches the PC. If the PC is
 * off, jobs simply wait in the queue.
 *
 * Run on the PC (leave it running):
 *   node --env-file=.env.local scripts/local-worker.mjs
 * Process the backlog once and exit (cron / testing):
 *   node --env-file=.env.local scripts/local-worker.mjs --once
 */
import { createClient } from "@supabase/supabase-js";
import { renderSegmentsToMp3 } from "./lib/kokoro-tts.mjs";

const ONCE = process.argv.includes("--once");
const POLL_MS = 5000;
const STALE_MIN = 15; // a 'running' job older than this = crashed worker → requeue

// Kinds THIS worker handles. Add 'transcribe' / 'agent_query' as those handlers
// land (they need faster-whisper / Ollama respectively).
const KINDS = ["tts_render"];

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

async function ensureBucket(name) {
  try {
    const { data: buckets } = await sb.storage.listBuckets();
    if (!(buckets ?? []).some((b) => b.name === name)) {
      await sb.storage.createBucket(name, { public: true, fileSizeLimit: 1024 * 1024 * 10 });
    }
  } catch { /* best-effort */ }
}

const handlers = {
  // Render an array of {text, voice} segments to one MP3 via Kokoro and upload.
  async tts_render(payload) {
    const { segments, bucket = "content-audio", path, bitrate = 64 } = payload;
    if (!Array.isArray(segments) || !path) throw new Error("tts_render needs { segments, path }");
    const mp3 = await renderSegmentsToMp3(segments, { bitrate });
    if (mp3.length === 0) throw new Error("rendered 0 bytes");
    await ensureBucket(bucket);
    const { error } = await sb.storage.from(bucket).upload(path, mp3, {
      contentType: "audio/mpeg", upsert: true, cacheControl: "3600",
    });
    if (error) throw new Error("upload failed: " + error.message);
    const { data } = sb.storage.from(bucket).getPublicUrl(path);
    return { bucket, path, bytes: mp3.length, url: data.publicUrl };
  },
};

async function reapStale() {
  const cutoff = new Date(Date.now() - STALE_MIN * 60_000).toISOString();
  const { data } = await sb.from("local_jobs")
    .update({ status: "queued" })
    .eq("status", "running")
    .lt("locked_at", cutoff)
    .select("id");
  if (data?.length) console.log(`  reaped ${data.length} stale running job(s) → requeued`);
}

async function processOne() {
  const { data: job, error } = await sb.rpc("claim_local_job", { p_kinds: KINDS });
  if (error) { console.error("claim failed:", error.message); return false; }
  if (!job) return false;

  const short = job.id.slice(0, 8);
  console.log(`▶ ${short} ${job.kind} (attempt ${job.attempts}/${job.max_attempts})`);

  if (job.attempts > job.max_attempts) {
    await finish(job.id, { status: "error", error: "max attempts exceeded" });
    console.log(`  ✗ ${short} max attempts`);
    return true;
  }
  const handler = handlers[job.kind];
  if (!handler) {
    await finish(job.id, { status: "error", error: `no handler for kind '${job.kind}'` });
    console.log(`  ✗ ${short} no handler`);
    return true;
  }
  try {
    const result = await handler(job.payload ?? {});
    await finish(job.id, { status: "done", result, error: null });
    console.log(`  ✓ ${short} done`);
  } catch (e) {
    const msg = String(e?.message ?? e).slice(0, 500);
    const retry = job.attempts < job.max_attempts;
    await finish(job.id, retry ? { status: "queued" } : { status: "error", error: msg });
    console.log(`  ${retry ? "↺ requeue" : "✗ error"} ${short}: ${msg.slice(0, 90)}`);
  }
  return true;
}

async function finish(id, patch) {
  const row = { ...patch };
  if (patch.status === "done" || patch.status === "error") row.finished_at = new Date().toISOString();
  try { await sb.from("local_jobs").update(row).eq("id", id); } catch (e) { console.error("finish write failed:", e?.message); }
}

console.log(`local-worker — kinds=[${KINDS.join(", ")}] mode=${ONCE ? "once" : "loop"}`);
await reapStale();

if (ONCE) {
  let n = 0;
  while (await processOne()) n++;
  console.log(`Done — processed ${n} job(s).`);
  process.exit(0);
} else {
  // Continuous: process until idle, then poll. Re-reap periodically.
  let sinceReap = Date.now();
  for (;;) {
    const did = await processOne();
    if (!did) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      if (Date.now() - sinceReap > 5 * 60_000) { await reapStale(); sinceReap = Date.now(); }
    }
  }
}
