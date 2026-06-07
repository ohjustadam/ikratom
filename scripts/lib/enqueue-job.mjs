// scripts/lib/enqueue-job.mjs
// Enqueue a job for the local-worker bridge (migration 0185). Call from cron
// scripts / server code holding a SERVICE-ROLE Supabase client.
//
//   await enqueueJob(sb, "tts_render", { segments, bucket, path }, { dedupeKey: `news:${id}` });
export async function enqueueJob(sb, kind, payload = {}, { priority = 100, maxAttempts = 3, dedupeKey = null } = {}) {
  // Optional dedupe: don't queue the same work twice while a copy is pending.
  if (dedupeKey) {
    const { data: existing } = await sb
      .from("local_jobs")
      .select("id")
      .eq("kind", kind)
      .in("status", ["queued", "running"])
      .eq("payload->>dedupe_key", dedupeKey)
      .limit(1);
    if (existing && existing.length) return { id: existing[0].id, deduped: true };
  }
  const row = {
    kind,
    payload: dedupeKey ? { ...payload, dedupe_key: dedupeKey } : payload,
    priority,
    max_attempts: maxAttempts,
  };
  const { data, error } = await sb.from("local_jobs").insert(row).select("id").single();
  if (error) return { error: error.message };
  return { id: data.id };
}
