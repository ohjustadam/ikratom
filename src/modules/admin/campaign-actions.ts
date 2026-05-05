"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCreatorContext } from "./actions";

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

export async function createCampaign(formData: FormData): Promise<CampaignFormResult> {
  const ctx = await getCreatorContext();
  if (!ctx.ok) return { error: "Sign in as an admin or advocate leader to manage campaigns." };

  const data = readForm(formData);
  const err = validate(data);
  if (err) return { error: err };

  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("campaigns")
    .insert(data)
    .select("slug")
    .single();

  if (error) return { error: error.message };
  redirect(`/campaigns/${row.slug}`);
}

export async function updateCampaign(
  id: string,
  formData: FormData
): Promise<CampaignFormResult> {
  const ctx = await getCreatorContext();
  if (!ctx.ok) return { error: "Sign in as an admin or advocate leader to manage campaigns." };
  if (!id) return { error: "Missing id." };

  const data = readForm(formData);
  const err = validate(data);
  if (err) return { error: err };

  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("campaigns")
    .update(data)
    .eq("id", id)
    .select("slug")
    .single();

  if (error) return { error: error.message };
  redirect(`/campaigns/${row.slug}`);
}

export async function setCampaignActive(id: string, active: boolean) {
  const ctx = await getCreatorContext();
  if (!ctx.ok) return { error: "Sign in as an admin or advocate leader to manage campaigns." };
  const supabase = await createClient();
  const { error } = await supabase.from("campaigns").update({ active }).eq("id", id);
  if (error) return { error: error.message };
  return { ok: true };
}
