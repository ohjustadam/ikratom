"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAdminContext } from "./actions";
import { requireMfaForMutation } from "./mfa";
import { recordAdminAction } from "@/lib/audit";

/**
 * Emergency mode — flips a site-wide red banner on every page when an
 * urgent threat lands (federal scheduling rumor, FDA action, hostile
 * federal bill drop, etc.). Only the owner / admins can toggle.
 */

export type EmergencyConfig = {
  emergencyMode: boolean;
  title: string | null;
  body: string | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  severity: "info" | "urgent" | "critical";
  updatedAt: string | null;
};

export async function getEmergencyConfig(): Promise<EmergencyConfig> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("site_config")
    .select("emergency_mode, emergency_title, emergency_body, emergency_cta_label, emergency_cta_href, emergency_severity, updated_at")
    .eq("id", true)
    .maybeSingle();
  type Row = {
    emergency_mode: boolean;
    emergency_title: string | null;
    emergency_body: string | null;
    emergency_cta_label: string | null;
    emergency_cta_href: string | null;
    emergency_severity: "info" | "urgent" | "critical";
    updated_at: string | null;
  };
  const row = (data as Row | null) ?? {
    emergency_mode: false,
    emergency_title: null,
    emergency_body: null,
    emergency_cta_label: null,
    emergency_cta_href: null,
    emergency_severity: "urgent" as const,
    updated_at: null,
  };
  return {
    emergencyMode: row.emergency_mode,
    title: row.emergency_title,
    body: row.emergency_body,
    ctaLabel: row.emergency_cta_label,
    ctaHref: row.emergency_cta_href,
    severity: row.emergency_severity,
    updatedAt: row.updated_at,
  };
}

export async function updateEmergencyConfig(input: {
  enabled: boolean;
  title?: string;
  body?: string;
  ctaLabel?: string;
  ctaHref?: string;
  severity?: "info" | "urgent" | "critical";
}) {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admin only." };
  const mfaErr = requireMfaForMutation(ctx);
  if (mfaErr) return { error: mfaErr };

  const supabase = await createClient();
  const { error } = await supabase
    .from("site_config")
    .update({
      emergency_mode: input.enabled,
      emergency_title: input.title?.slice(0, 200) || null,
      emergency_body: input.body?.slice(0, 1000) || null,
      emergency_cta_label: input.ctaLabel?.slice(0, 80) || null,
      emergency_cta_href: input.ctaHref?.slice(0, 500) || null,
      emergency_severity: input.severity ?? "urgent",
      updated_at: new Date().toISOString(),
      updated_by: ctx.userId,
    })
    .eq("id", true);

  if (error) return { error: error.message };

  await recordAdminAction({
    action: input.enabled ? "emergency_mode_enabled" : "emergency_mode_disabled",
    targetType: "user",
    targetId: ctx.userId,
    details: { title: input.title ?? null, severity: input.severity ?? "urgent" },
  });

  revalidatePath("/", "layout");
  return { ok: true };
}
