"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * User-defined saved searches with alert delivery.
 *
 * v1 query shape (kept narrow on purpose; expand in v2):
 *   - state: "OK" or null (any)
 *   - relevance: "anti" | "pro" | "neutral" | null
 *   - keyword: string (ILIKE on bills.title + bills.summary)
 *   - scope: "state" | "federal" | null (any)
 *
 * Cap: 10 saved searches per user, enforced by a Postgres trigger.
 */

export type SavedSearchQuery = {
  state?: string | null;
  relevance?: "anti" | "pro" | "neutral" | null;
  keyword?: string | null;
  scope?: "state" | "federal" | null;
};

export type SavedSearch = {
  id: string;
  user_id: string;
  name: string;
  query: SavedSearchQuery;
  alert_method: "push" | "email" | "both" | "in_app";
  active: boolean;
  last_match_check_at: string | null;
  total_matches: number;
  created_at: string;
};

const VALID_RELEVANCE = new Set(["anti", "pro", "neutral"]);
const VALID_SCOPE = new Set(["state", "federal"]);
const VALID_METHODS = new Set(["push", "email", "both", "in_app"]);

function sanitizeQuery(input: unknown): SavedSearchQuery {
  if (!input || typeof input !== "object") return {};
  const q = input as Record<string, unknown>;
  const out: SavedSearchQuery = {};
  if (typeof q.state === "string" && /^[A-Z]{2}$/.test(q.state.toUpperCase())) {
    out.state = q.state.toUpperCase();
  }
  if (typeof q.relevance === "string" && VALID_RELEVANCE.has(q.relevance)) {
    out.relevance = q.relevance as "anti" | "pro" | "neutral";
  }
  if (typeof q.keyword === "string" && q.keyword.trim().length > 0) {
    out.keyword = q.keyword.trim().slice(0, 120);
  }
  if (typeof q.scope === "string" && VALID_SCOPE.has(q.scope)) {
    out.scope = q.scope as "state" | "federal";
  }
  return out;
}

export async function listMySavedSearches(): Promise<SavedSearch[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data } = await supabase
    .from("user_saved_searches")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  return ((data ?? []) as SavedSearch[]);
}

export async function createSavedSearch(input: {
  name: string;
  query: SavedSearchQuery;
  alertMethod?: "push" | "email" | "both" | "in_app";
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in." };

  const name = (input.name ?? "").trim();
  if (name.length < 1 || name.length > 80) return { error: "Name must be 1–80 characters." };
  const method = input.alertMethod && VALID_METHODS.has(input.alertMethod) ? input.alertMethod : "in_app";
  const query = sanitizeQuery(input.query);

  const { data, error } = await supabase
    .from("user_saved_searches")
    .insert({ user_id: user.id, name, query, alert_method: method, active: true })
    .select("*")
    .single();
  if (error) return { error: error.message };
  revalidatePath("/account/saved-searches");
  return { ok: true, search: data as SavedSearch };
}

export async function updateSavedSearch(input: {
  id: string;
  name?: string;
  query?: SavedSearchQuery;
  alertMethod?: "push" | "email" | "both" | "in_app";
  active?: boolean;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in." };
  if (!/^[0-9a-f-]{36}$/i.test(input.id)) return { error: "Invalid id." };

  const update: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const v = input.name.trim();
    if (v.length < 1 || v.length > 80) return { error: "Name must be 1–80 chars." };
    update.name = v;
  }
  if (input.query !== undefined) update.query = sanitizeQuery(input.query);
  if (input.alertMethod !== undefined && VALID_METHODS.has(input.alertMethod)) {
    update.alert_method = input.alertMethod;
  }
  if (input.active !== undefined) update.active = input.active;

  const { error } = await supabase
    .from("user_saved_searches")
    .update(update)
    .eq("id", input.id)
    .eq("user_id", user.id);
  if (error) return { error: error.message };
  revalidatePath("/account/saved-searches");
  return { ok: true };
}

export async function deleteSavedSearch(id: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in." };
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: "Invalid id." };

  const { error } = await supabase
    .from("user_saved_searches")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return { error: error.message };
  revalidatePath("/account/saved-searches");
  return { ok: true };
}
