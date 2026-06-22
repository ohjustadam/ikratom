"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { recordAdminAction } from "@/lib/audit";
import { getCreatorContext } from "./actions";
import { requireMfaForMutation, requireMfaEnrolled } from "./mfa";
import { checkRateLimit } from "@/lib/rate-limit";
import { screenCampaignTemplate } from "@/modules/campaigns/screen-content";

const ROLE_OPTIONS = ["us_senate", "us_house", "state_senate", "state_house"] as const;

export type CampaignFormResult =
  | { ok: true; slug: string }
  | { error: string };

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function readForm(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim().slice(0, 200);
  const blurb = String(formData.get("blurb") ?? "").trim().slice(0, 500) || null;
  const bodyMd = String(formData.get("body_md") ?? "").trim().slice(0, 20000) || null;
  const stateRaw = String(formData.get("state") ?? "").trim().toUpperCase();
  const state = stateRaw === "" || stateRaw === "FEDERAL" ? null : stateRaw;
  const subjectTemplate = String(formData.get("subject_template") ?? "").trim().slice(0, 200);
  const bodyTemplate = String(formData.get("body_template") ?? "").trim().slice(0, 20000);
  const active = formData.get("active") === "on";
  const is_standing = formData.get("is_standing") === "on";
  const slugRaw = String(formData.get("slug") ?? "").trim().toLowerCase();

  const targetRoles = ROLE_OPTIONS.filter((r) => formData.get(`role_${r}`) === "on");

  const targetLocalityRaw = String(formData.get("target_locality") ?? "").trim().slice(0, 120);
  const targetLocality = targetLocalityRaw || null;

  const allowNonResidents = formData.get("allow_non_residents") === "on";

  // Explicit recipient list — comma-separated UUIDs from the wizard.
  const idsRaw = String(formData.get("target_legislator_ids") ?? "").trim();
  const target_legislator_ids = idsRaw
    ? idsRaw.split(",").map((s) => s.trim()).filter((s) => /^[0-9a-f-]{36}$/i.test(s))
    : null;

  return {
    title,
    blurb,
    body_md: bodyMd,
    state,
    subject_template: subjectTemplate,
    body_template: bodyTemplate,
    active,
    is_standing,
    slug: slugRaw || slugify(title),
    target_roles: targetRoles,
    target_locality: targetLocality,
    target_legislator_ids,
    allow_non_residents: allowNonResidents,
  };
}

function validate(d: ReturnType<typeof readForm>): string | null {
  if (!d.title) return "Title is required.";
  if (!d.subject_template) return "Subject template is required.";
  if (!d.body_template) return "Body template is required.";
  // Either explicit legislator IDs OR target roles must be set
  if ((!d.target_legislator_ids || d.target_legislator_ids.length === 0) && d.target_roles.length === 0) {
    return "Pick at least one target role or specific officials.";
  }
  if (d.state && !/^[A-Z]{2}$/.test(d.state)) return "State must be a 2-letter code.";
  if (d.slug && !/^[a-z0-9-]+$/.test(d.slug)) return "Slug must be lowercase letters/numbers/hyphens only.";
  return null;
}

/**
 * Stance gate (anti-weaponization PR3). Returns campaign-column overrides
 * that route a flagged template to the review queue, or {} to publish as
 * submitted. Only PURE advocate leaders are gated — admins/owner are the
 * trusted tier and skip the screen (their edits are still recorded in the
 * template version history from mig 0204).
 */
async function screenForReview(
  ctx: { isLeader: boolean; isAdmin: boolean; isOwner: boolean },
  data: { title: string; subject_template: string; body_template: string },
): Promise<{ active?: boolean; review_state?: string; review_reason?: string }> {
  if (!ctx.isLeader || ctx.isAdmin || ctx.isOwner) return {};
  const screen = await screenCampaignTemplate({
    title: data.title,
    subject: data.subject_template,
    body: data.body_template,
  });
  if (screen.pass) return {};
  return {
    active: false,
    review_state: "pending_review",
    review_reason: (
      `AI stance screen: ${screen.verdict.stance} (${screen.verdict.confidence.toFixed(2)})` +
      `${screen.errored ? " [screener unavailable]" : ""} — ${screen.verdict.reason}`
    ).slice(0, 500),
  };
}

export async function createCampaign(formData: FormData): Promise<CampaignFormResult> {
  const ctx = await getCreatorContext();
  if (!ctx.ok) return { error: "Sign in as an admin or advocate leader to manage campaigns." };
  // MFA mandatory for leader authoring (PR4); admins/owner keep the soft gate.
  const mfaErr = ctx.isLeader && !ctx.isAdmin && !ctx.isOwner
    ? requireMfaEnrolled(ctx)
    : requireMfaForMutation(ctx);
  if (mfaErr) return { error: mfaErr };
  // Defense-in-depth: bound campaign creation even for a (compromised) leader.
  if (!(await checkRateLimit(`campaign:create:${ctx.userId}`, 30, 3600))) {
    return { error: "Too many campaigns created this hour — slow down." };
  }

  const data = readForm(formData);
  const err = validate(data);
  if (err) return { error: err };

  // Stance screen (PR3): never publish a leader-authored campaign whose
  // message undermines kratom — a flagged template lands in the review queue
  // (active=false) instead of going live.
  const review = await screenForReview(ctx, data);

  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("campaigns")
    .insert({ ...data, ...review, created_by: ctx.userId })
    .select("id, slug")
    .single();

  if (error) return { error: error.message };

  // Append-only template provenance (mig 0204): record the initial template
  // so a later swap-then-revert is reconstructable — the audit log alone
  // never captured the template text. Best-effort; don't block creation.
  await supabase.from("campaign_template_versions").insert({
    campaign_id: row.id,
    subject_template: data.subject_template,
    body_template: data.body_template,
    edited_by: ctx.userId,
  });

  await recordAdminAction({
    action: "campaign_created",
    targetType: "campaign",
    targetId: row.id,
    details: { slug: row.slug, title: data.title, state: data.state, active: data.active },
  });

  redirect(`/campaigns/${row.slug}`);
}

export async function updateCampaign(
  id: string,
  formData: FormData
): Promise<CampaignFormResult> {
  const ctx = await getCreatorContext();
  if (!ctx.ok) return { error: "Sign in as an admin or advocate leader to manage campaigns." };
  // MFA mandatory for leader authoring (PR4); admins/owner keep the soft gate.
  const mfaErr = ctx.isLeader && !ctx.isAdmin && !ctx.isOwner
    ? requireMfaEnrolled(ctx)
    : requireMfaForMutation(ctx);
  if (mfaErr) return { error: mfaErr };
  if (!id) return { error: "Missing id." };

  const data = readForm(formData);
  const err = validate(data);
  if (err) return { error: err };

  // Stance screen (PR3): a leader editing into off-mission / anti-kratom text
  // is bounced to the review queue rather than published live.
  const review = await screenForReview(ctx, data);

  const supabase = await createClient();

  // Snapshot the prior template so we can tell whether this edit actually
  // changed the message (and record the new state in append-only history).
  const { data: prev } = await supabase
    .from("campaigns")
    .select("subject_template, body_template")
    .eq("id", id)
    .maybeSingle();

  const { data: row, error } = await supabase
    .from("campaigns")
    .update({ ...data, ...review })
    .eq("id", id)
    .select("slug")
    .single();

  if (error) return { error: error.message };

  const templateChanged =
    !prev ||
    prev.subject_template !== data.subject_template ||
    prev.body_template !== data.body_template;
  if (templateChanged) {
    await supabase.from("campaign_template_versions").insert({
      campaign_id: id,
      subject_template: data.subject_template,
      body_template: data.body_template,
      edited_by: ctx.userId,
    });
  }

  await recordAdminAction({
    action: "campaign_updated",
    targetType: "campaign",
    targetId: id,
    details: {
      slug: row.slug,
      title: data.title,
      state: data.state,
      active: data.active,
      template_changed: templateChanged,
    },
  });

  redirect(`/campaigns/${row.slug}`);
}

export async function setCampaignActive(id: string, active: boolean) {
  const ctx = await getCreatorContext();
  if (!ctx.ok) return { error: "Sign in as an admin or advocate leader to manage campaigns." };
  const mfaErr = requireMfaForMutation(ctx);
  if (mfaErr) return { error: mfaErr };
  const supabase = await createClient();
  const { error } = await supabase.from("campaigns").update({ active }).eq("id", id);
  if (error) return { error: error.message };

  await recordAdminAction({
    action: active ? "campaign_activated" : "campaign_archived",
    targetType: "campaign",
    targetId: id,
  });

  return { ok: true };
}
