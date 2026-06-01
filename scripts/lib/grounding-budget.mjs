/**
 * .mjs mirror of src/lib/ai/grounding-budget.ts + grounding-errors.ts.
 *
 * Used by .mjs scripts that can't resolve @/lib path aliases:
 *   - scripts/lib/officials-slate.mjs (seedLocalitySlate)
 *   - scripts/auto-fulfill-pending-local-reps.mjs
 *   - scripts/seed-bill-officials.mjs
 *   - scripts/extract-news-officials.mjs (already had inline retry,
 *     this just centralizes it)
 *
 * Keep in sync with the TS originals when changing.
 */

const TASK_KIND = "gemini_grounded";
const DEFAULT_CAP = 400;

export class GroundingQuotaError extends Error {
  constructor(usedToday, cap) {
    super(`Gemini grounded-query daily cap reached (${usedToday}/${cap}). Try again tomorrow (UTC).`);
    this.name = "GroundingQuotaError";
    this.kind = "quota_exhausted";
    this.usedToday = usedToday;
    this.cap = cap;
  }
}

export function classifyGroundingError(rawMessage) {
  const m = (rawMessage ?? "").toLowerCase();
  if (!m) return "other";
  if (/429|quota|rate.?limit|exceeded.*quota|resource_exhausted/i.test(m)) return "quota_exhausted";
  if (/401|403|api.?key|unauthorized|forbidden/i.test(m)) return "auth";
  if (/500|502|503|504|timeout|timed.?out|fetch failed|econn|network|abort/i.test(m)) return "transient";
  if (/no <result>|could not parse|json|parse/i.test(m)) return "parse";
  return "other";
}

export function isRetryableGroundingError(rawMessage) {
  const kind = classifyGroundingError(rawMessage);
  return kind === "quota_exhausted" || kind === "transient";
}

export async function getGroundingBudget(sb) {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const [{ count }, { data: cfg }] = await Promise.all([
    sb.from("ai_jobs").select("id", { count: "exact", head: true })
      .eq("task_kind", TASK_KIND)
      .gte("created_at", startOfDay.toISOString()),
    sb.from("site_config").select("gemini_grounded_daily_cap").eq("id", true).maybeSingle(),
  ]);
  const usedToday = count ?? 0;
  const cap = cfg?.gemini_grounded_daily_cap ?? DEFAULT_CAP;
  return { usedToday, cap, remaining: Math.max(0, cap - usedToday), exhausted: usedToday >= cap };
}

export async function assertGroundingBudget(sb) {
  const status = await getGroundingBudget(sb);
  if (status.exhausted) throw new GroundingQuotaError(status.usedToday, status.cap);
  return status;
}

export async function recordGroundingCall(sb, opts) {
  try {
    await sb.from("ai_jobs").insert({
      task_kind: TASK_KIND,
      provider_used: "gemini",
      model_used: "gemini-2.5-flash-grounded",
      status: opts.status,
      prompt_preview: opts.promptPreview?.slice(0, 800) ?? null,
      elapsed_ms: opts.elapsedMs ?? null,
      error: opts.error?.slice(0, 800) ?? null,
      caller: opts.caller,
      metadata: opts.metadata ?? null,
      completed_at: new Date().toISOString(),
    });
  } catch {
    // logging never throws
  }
}
