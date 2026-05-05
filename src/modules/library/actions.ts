"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCreatorContext } from "@/modules/admin/actions";

const VALID_TYPES = ["video", "audio", "book", "article", "document"] as const;

const cap = (s: string, n: number) => s.slice(0, n).trim();

function readForm(formData: FormData) {
  const typeRaw = String(formData.get("type") ?? "article");
  const type = (VALID_TYPES as readonly string[]).includes(typeRaw) ? typeRaw : "article";

  const tagsRaw = String(formData.get("tags") ?? "").trim();
  const tags = tagsRaw
    ? tagsRaw.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 20)
    : [];

  return {
    type,
    title: cap(String(formData.get("title") ?? ""), 200),
    description: cap(String(formData.get("description") ?? ""), 2000) || null,
    url: cap(String(formData.get("url") ?? ""), 500) || null,
    embed_html: cap(String(formData.get("embed_html") ?? ""), 2000) || null,
    cover_image_url: cap(String(formData.get("cover_image_url") ?? ""), 500) || null,
    full_text: cap(String(formData.get("full_text") ?? ""), 500_000) || null,
    summary: cap(String(formData.get("summary") ?? ""), 5000) || null,
    transcript: cap(String(formData.get("transcript") ?? ""), 500_000) || null,
    author: cap(String(formData.get("author") ?? ""), 200) || null,
    source_org: cap(String(formData.get("source_org") ?? ""), 200) || null,
    duration_seconds: parseInt(String(formData.get("duration_seconds") ?? "")) || null,
    published_at: cap(String(formData.get("published_at") ?? ""), 20) || null,
    tags,
    kratom_relevance: ["high", "medium", "low"].includes(String(formData.get("kratom_relevance") ?? ""))
      ? String(formData.get("kratom_relevance"))
      : "high",
    featured: formData.get("featured") === "on",
    active: formData.get("active") !== "off",  // default true
  };
}

export async function createLibraryItem(formData: FormData) {
  const ctx = await getCreatorContext();
  if (!ctx.ok) return { error: "Sign in as an admin or advocate leader." };

  const data = readForm(formData);
  if (!data.title) return { error: "Title is required." };

  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("library_items")
    .insert({ ...data, added_by: ctx.userId })
    .select("id")
    .single();
  if (error) return { error: error.message };
  redirect(`/library/${row.id}`);
}

export async function updateLibraryItem(id: string, formData: FormData) {
  const ctx = await getCreatorContext();
  if (!ctx.ok) return { error: "Sign in as an admin or advocate leader." };
  if (!id) return { error: "Missing id." };

  const data = readForm(formData);
  if (!data.title) return { error: "Title is required." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("library_items")
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(`/library/${id}`);
  redirect(`/library/${id}`);
}

export async function deleteLibraryItem(id: string) {
  const ctx = await getCreatorContext();
  if (!ctx.ok) return { error: "Sign in as an admin or advocate leader." };
  const supabase = await createClient();
  const { error } = await supabase.from("library_items").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/library");
  redirect("/library");
}
