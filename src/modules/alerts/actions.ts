"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { getAdminContext } from "@/modules/admin/actions";
import { recordAdminAction } from "@/lib/audit";

/**
 * /alerts/submit — advocate intel form.
 *
 * Anyone signed in can submit an "intel tip" — a piece of policy news
 * we (or our scrapers) might not have caught yet. City council vote,
 * AG quote, BoP agenda item, etc. The submission lands in
 * policy_alerts with kind='intel_tip' + moderation_status='pending';
 * an admin reviews it on /admin/intel-queue and either approves
 * (publishes to /pulse + auto-spawns a campaign via the trigger) or
 * rejects with a note.
 *
 * RLS already exists for self-insert (migration 0062). This action
 * adds: input validation, rate-limit (5/h per user, 20/d per IP),
 * locality normalization, optional bill_id linkage.
 */

const VALID_KINDS = [
  "bill_event", "bop_hearing", "fda_action", "dea_action",
  "ag_enforcement", "news_break",
] as const;
type IntelKind = typeof VALID_KINDS[number];

const VALID_SEVERITY = ["watch", "alert", "critical"] as const;
type Severity = typeof VALID_SEVERITY[number];

export async function submitIntelTip(input: {
  kind: IntelKind;
  severity: Severity;
  title: string;
  body: string;
  locality: string;        // 2-letter state, "FED", or "ALL"
  source_url?: string | null;
  occurs_at?: string | null;  // ISO datetime if event has a deadline/meeting
  is_anonymous?: boolean;
  action_required?: boolean;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in to submit intel." };

  // Rate-limit: 5 tips per user per hour, 20 per IP per day.
  const ipOk = await checkRateLimit(`intel-tip:ip:${await getClientIp()}`, 20, 86_400);
  if (!ipOk) return { error: "Too many submissions from this network. Try again tomorrow." };
  const userOk = await checkRateLimit(`intel-tip:user:${user.id}`, 5, 3_600);
  if (!userOk) return { error: "You've submitted 5 tips in the last hour. Take a breath, more later." };

  // ---- Validate ----
  const title = input.title.trim().slice(0, 200);
  const body = (input.body ?? "").trim().slice(0, 4_000);
  if (!title || title.length < 10) return { error: "Title must be at least 10 characters." };
  if (body.length > 0 && body.length < 30) return { error: "If you include a body, give us at least 30 characters of context." };

  if (!(VALID_KINDS as readonly string[]).includes(input.kind)) {
    return { error: "Invalid alert kind." };
  }
  if (!(VALID_SEVERITY as readonly string[]).includes(input.severity)) {
    return { error: "Invalid severity." };
  }

  // Locality: FED, ALL, or 2-letter state code
  const localityRaw = (input.locality ?? "").trim().toUpperCase();
  let locality: string;
  if (localityRaw === "FED" || localityRaw === "ALL") {
    locality = localityRaw;
  } else if (/^[A-Z]{2}$/.test(localityRaw)) {
    locality = localityRaw;
  } else {
    return { error: "Pick a state (or FED / ALL for federal/national)." };
  }

  // Source URL: optional, must be http(s) if provided
  let source_url: string | null = null;
  if (input.source_url && input.source_url.trim()) {
    const u = input.source_url.trim().slice(0, 1_000);
    if (!/^https?:\/\//i.test(u)) return { error: "Source URL must start with http:// or https://" };
    source_url = u;
  }

  // occurs_at: optional ISO date
  let occurs_at: string | null = null;
  if (input.occurs_at) {
    const d = new Date(input.occurs_at);
    if (Number.isNaN(d.getTime())) return { error: "Invalid event date/time." };
    occurs_at = d.toISOString();
  }

  // ---- Insert ----
  // The RLS policy `policy_alerts_self_submit` (migration 0062) requires:
  //   kind = 'intel_tip', moderation_status = 'pending', submitted_by_user_id = auth.uid()
  // We store the user-claimed kind in the body header so admins see it
  // when triaging. The "real" kind gets reassigned at approval time.
  const bodyWithMeta = [
    `[claimed kind: ${input.kind}]`,
    `[claimed severity: ${input.severity}]`,
    body || "(no additional context)",
  ].join("\n\n");

  // Trusted reporters get auto-approved (RLS policy_alerts_trusted_self_submit
  // covers the insert; the Phase 4 trigger then auto-spawns a campaign).
  // Field reporters + rookies still queue for moderation.
  const { data: profile } = await supabase
    .from("profiles")
    .select("intel_tier")
    .eq("id", user.id)
    .single();
  const tier = (profile as { intel_tier: string } | null)?.intel_tier ?? "rookie";
  const isTrusted = tier === "trusted_reporter";

  const { error, data: row } = await supabase
    .from("policy_alerts")
    .insert({
      kind: "intel_tip",
      severity: input.severity,
      title,
      body: bodyWithMeta,
      locality,
      source_url,
      occurs_at,
      action_required: !!input.action_required,
      moderation_status: isTrusted ? "approved" : "pending",
      submitted_by_user_id: user.id,
      is_anonymous: !!input.is_anonymous,
    })
    .select("id")
    .single();
  if (error) {
    console.error("[submitIntelTip] insert failed:", error.message);
    return { error: "Could not save your tip. Try again or DM an admin." };
  }

  revalidatePath("/admin/intel-queue");
  if (isTrusted) revalidatePath("/pulse");
  return { ok: true, id: row.id, autoApproved: isTrusted };
}

// ============================================================
// User-facing — list my own tips
// ============================================================

export async function listMyIntelTips() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase
    .from("policy_alerts")
    .select("id, kind, severity, title, body, locality, source_url, occurs_at, action_required, moderation_status, moderation_note, moderated_at, campaign_id, created_at")
    .eq("submitted_by_user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(100);

  return data ?? [];
}

// ============================================================
// Admin moderation
// ============================================================

export async function listPendingIntelTips() {
  const ctx = await getAdminContext();
  if (!ctx.ok) return [];
  const supabase = await createClient();
  const { data: tips } = await supabase
    .from("policy_alerts")
    .select("id, kind, severity, title, body, locality, source_url, occurs_at, action_required, submitted_by_user_id, is_anonymous, created_at")
    .eq("moderation_status", "pending")
    .order("created_at", { ascending: false })
    .limit(100);
  if (!tips || tips.length === 0) return [];

  // Decorate with submitter trust tier so the queue UI can show badges.
  const submitterIds = Array.from(new Set(
    tips.map((t) => (t as { submitted_by_user_id: string | null }).submitted_by_user_id).filter(Boolean) as string[],
  ));
  if (submitterIds.length === 0) return tips;

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, intel_tier, intel_approved_count, intel_rejected_count")
    .in("id", submitterIds);

  const byId = new Map(
    (profiles ?? []).map((p) => [(p as { id: string }).id, p as { id: string; intel_tier: string; intel_approved_count: number; intel_rejected_count: number }]),
  );

  return tips.map((t) => {
    const sid = (t as { submitted_by_user_id: string | null }).submitted_by_user_id;
    const prof = sid ? byId.get(sid) : null;
    return {
      ...t,
      _submitter_tier: prof?.intel_tier ?? "rookie",
      _submitter_approved: prof?.intel_approved_count ?? 0,
      _submitter_rejected: prof?.intel_rejected_count ?? 0,
    };
  });
}

/**
 * Approve a pending intel tip. Admin can:
 *   - reassign the kind from intel_tip → real kind (so trigger picks
 *     the right campaign template)
 *   - flip severity / action_required
 *   - optionally clean up title/body
 *
 * On approval, the auto-campaign trigger (migration 0068) will fire
 * if action_required = true and campaign_id IS NULL.
 */
export async function approveIntelTip(input: {
  alertId: string;
  reassignKind?: IntelKind;
  severity?: Severity;
  actionRequired?: boolean;
  editedTitle?: string;
  editedBody?: string;
  note?: string;
  /**
   * Publish to /pulse but suppress the push-critical-alerts fan-out (set by the
   * bulk/auto resolver so clearing the intel backlog doesn't spam). Marks the
   * alert already-pushed so push-critical-alerts.mjs (auto_pushed_at IS NULL)
   * skips it. A deliberate single approve leaves this unset so it still pushes.
   */
  suppressPush?: boolean;
}) {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admin only." };
  const supabase = await createClient();

  const update: Record<string, unknown> = {
    moderation_status: "approved",
    moderated_by: ctx.userId,
    moderated_at: new Date().toISOString(),
    moderation_note: input.note?.slice(0, 500) ?? null,
  };
  if (input.suppressPush) update.auto_pushed_at = new Date().toISOString();

  if (input.reassignKind && (VALID_KINDS as readonly string[]).includes(input.reassignKind)) {
    update.kind = input.reassignKind;
  }
  if (input.severity && (VALID_SEVERITY as readonly string[]).includes(input.severity)) {
    update.severity = input.severity;
  }
  if (typeof input.actionRequired === "boolean") {
    update.action_required = input.actionRequired;
  }
  if (input.editedTitle) {
    const t = input.editedTitle.trim().slice(0, 200);
    if (t.length >= 10) update.title = t;
  }
  if (input.editedBody) {
    update.body = input.editedBody.trim().slice(0, 4_000);
  }

  // Idempotency + race guard (mirrors the campaign review path): only flip a
  // row still pending. affected=0 means another admin/auto-pass already handled
  // it — return a clear error instead of silently re-publishing an already-
  // decided alert (a blind re-approve of a REJECTED alert would republish it to
  // /pulse and can auto-spawn a campaign via the moderation_status trigger).
  const { data: affected, error } = await supabase
    .from("policy_alerts")
    .update(update)
    .eq("id", input.alertId)
    .eq("moderation_status", "pending")
    .select("id");
  if (error) return { error: error.message };
  if (!affected?.length) return { error: "This alert isn't pending review — it was already approved or rejected." };

  await recordAdminAction({
    action: "intel_tip_approved",
    targetType: "policy_alert",
    targetId: input.alertId,
    details: {
      reassign_kind: input.reassignKind ?? null,
      action_required: input.actionRequired ?? null,
      note: input.note ?? null,
    },
  });

  revalidatePath("/admin/intel-queue");
  revalidatePath("/pulse");
  return { ok: true };
}

export async function rejectIntelTip(input: { alertId: string; note: string }) {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admin only." };
  const supabase = await createClient();

  // Same pending-only guard as approve: don't re-reject / churn an alert that
  // another admin or the auto-resolver already decided.
  const { data: affected, error } = await supabase
    .from("policy_alerts")
    .update({
      moderation_status: "rejected",
      moderation_note: input.note.slice(0, 500),
      moderated_by: ctx.userId,
      moderated_at: new Date().toISOString(),
    })
    .eq("id", input.alertId)
    .eq("moderation_status", "pending")
    .select("id");
  if (error) return { error: error.message };
  if (!affected?.length) return { error: "This alert isn't pending review — it was already approved or rejected." };

  await recordAdminAction({
    action: "intel_tip_rejected",
    targetType: "policy_alert",
    targetId: input.alertId,
    details: { note: input.note },
  });

  revalidatePath("/admin/intel-queue");
  return { ok: true };
}
