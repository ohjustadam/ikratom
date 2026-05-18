"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { assertNotReadOnly } from "@/lib/read-only-mode";

/**
 * Coalition server actions.
 *
 * All paths re-check auth + role server-side (RLS is the second
 * defense but we mirror the check in app code so we can surface
 * useful error messages instead of generic 42501 PostgREST errors).
 *
 * Slug rule: lowercase alphanumeric + hyphens, 4-64 chars, starting +
 * ending with alphanumeric. Enforced via SQL constraint AND here for
 * pre-submit validation.
 */

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
const INVITE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"; // skip 0/O/1/I/l for legibility

function generateCode(len = 12): string {
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  let out = "";
  for (let i = 0; i < len; i++) out += INVITE_CHARS[buf[i] % INVITE_CHARS.length];
  return out;
}

function normalizeSlug(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export type CreateCoalitionResult =
  | { ok: true; slug: string }
  | { ok: false; error: string };

export async function createCoalition(input: {
  name: string;
  description?: string | null;
  state?: string | null;
  is_public?: boolean;
}): Promise<CreateCoalitionResult> {
  const ro = await assertNotReadOnly();
  if (ro) return { ok: false, error: ro };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in required" };

  const name = input.name?.trim() ?? "";
  if (name.length < 2 || name.length > 80) {
    return { ok: false, error: "Name must be between 2 and 80 characters" };
  }
  const description = input.description?.trim() || null;
  if (description && description.length > 2000) {
    return { ok: false, error: "Description too long (max 2000 chars)" };
  }
  // State must be a valid 2-letter US abbr if provided
  const state = (input.state ?? "").trim().toUpperCase() || null;
  if (state && !/^[A-Z]{2}$/.test(state)) {
    return { ok: false, error: "State must be a 2-letter abbreviation" };
  }

  // Generate a slug from the name, append random suffix on collision.
  let slugBase = normalizeSlug(name);
  if (!SLUG_RE.test(slugBase)) slugBase = `team-${generateCode(6).toLowerCase()}`;
  let slug = slugBase;
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: existing } = await supabase
      .from("coalitions")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (!existing) break;
    slug = `${slugBase}-${generateCode(4).toLowerCase()}`;
  }

  const { data: created, error } = await supabase
    .from("coalitions")
    .insert({
      slug,
      name,
      description,
      state,
      owner_id: user.id,
      is_public: !!input.is_public,
    })
    .select("id, slug")
    .single();
  if (error || !created) {
    return { ok: false, error: error?.message ?? "Failed to create coalition" };
  }

  // Owner is also a member with role='owner'
  const { error: memberErr } = await supabase
    .from("coalition_members")
    .insert({ coalition_id: created.id, user_id: user.id, role: "owner" });
  if (memberErr) {
    // Roll back the coalition (best-effort) so we never have an
    // orphan with no owner row. If THIS fails the user can still
    // delete the orphan via admin.
    await supabase.from("coalitions").delete().eq("id", created.id);
    return { ok: false, error: `Failed to seed owner membership: ${memberErr.message}` };
  }

  // Coalition creation is user-tier, not admin-tier — skip audit log.
  revalidatePath("/coalitions");
  return { ok: true, slug: created.slug };
}

export type CreateInviteResult =
  | { ok: true; code: string; url: string }
  | { ok: false; error: string };

const APP_URL = process.env.APP_URL ?? "https://www.ikratom.org";

export async function createCoalitionInvite(input: {
  coalition_id: string;
  max_uses?: number;
  expires_in_days?: number;
}): Promise<CreateInviteResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in required" };

  // Sanity-check membership/admin role for nicer error than RLS
  const { data: membership } = await supabase
    .from("coalition_members")
    .select("role")
    .eq("coalition_id", input.coalition_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership || (membership as { role: string }).role === "member") {
    return { ok: false, error: "Only coalition admins can create invites" };
  }

  const maxUses = Math.max(1, Math.min(100, input.max_uses ?? 1));
  const expiresIn = input.expires_in_days ?? 14;
  const expiresAt = new Date(Date.now() + expiresIn * 86400 * 1000).toISOString();

  // Retry on the (vanishingly small) chance of a code collision
  let code = generateCode(12);
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: clash } = await supabase
      .from("coalition_invites")
      .select("id")
      .eq("code", code)
      .maybeSingle();
    if (!clash) break;
    code = generateCode(12);
  }

  const { error } = await supabase
    .from("coalition_invites")
    .insert({
      coalition_id: input.coalition_id,
      code,
      created_by: user.id,
      max_uses: maxUses,
      expires_at: expiresAt,
    });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/coalitions/[slug]`, "page");
  return { ok: true, code, url: `${APP_URL}/coalitions/join/${code}` };
}

export type JoinResult =
  | { ok: true; slug: string }
  | { ok: false; error: string };

export async function joinCoalitionViaCode(code: string): Promise<JoinResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in required to accept invite" };

  if (!/^[A-Za-z0-9_-]{8,32}$/.test(code)) {
    return { ok: false, error: "Invalid invite code format" };
  }

  const { data, error } = await supabase
    .rpc("join_coalition_via_code", { p_code: code });
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Join failed (no slug returned)" };

  revalidatePath(`/coalitions/${data}`);
  revalidatePath("/coalitions");
  return { ok: true, slug: data as string };
}

export async function leaveCoalition(coalition_id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in required" };

  // Prevent owner self-leave (UX clarity — the RLS policy also blocks it).
  const { data: membership } = await supabase
    .from("coalition_members")
    .select("role")
    .eq("coalition_id", coalition_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) return { ok: false, error: "Not a member" };
  if ((membership as { role: string }).role === "owner") {
    return { ok: false, error: "Owner cannot leave — delete the coalition or transfer ownership instead" };
  }

  const { error } = await supabase
    .from("coalition_members")
    .delete()
    .eq("coalition_id", coalition_id)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/coalitions");
  return { ok: true };
}
