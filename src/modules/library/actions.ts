"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCreatorContext } from "@/modules/admin/actions";
import { sanitizeLibraryEmbedHtml } from "@/lib/embed-safety";

const VALID_TYPES = ["video", "audio", "book", "article", "document"] as const;

const cap = (s: string, n: number) => s.slice(0, n).trim();

function readForm(formData: FormData) {
  const typeRaw = String(formData.get("type") ?? "article");
  const type = (VALID_TYPES as readonly string[]).includes(typeRaw) ? typeRaw : "article";

  const tagsRaw = String(formData.get("tags") ?? "").trim();
  const tags = tagsRaw
    ? tagsRaw.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 20)
    : [];

  // Embed HTML is rendered via dangerouslySetInnerHTML on the public
  // /library/[id] page. We trust elevated roles to populate this BUT a
  // compromised advocate-leader could otherwise inject <script> or a
  // hostile iframe. Sanitizer accepts ONLY YouTube/Vimeo iframes and
  // rebuilds them with a strict attribute allowlist + sandbox.
  const embedRaw = String(formData.get("embed_html") ?? "").trim();
  const embed_html = embedRaw ? sanitizeLibraryEmbedHtml(embedRaw) : null;

  return {
    type,
    title: cap(String(formData.get("title") ?? ""), 200),
    description: cap(String(formData.get("description") ?? ""), 2000) || null,
    url: cap(String(formData.get("url") ?? ""), 500) || null,
    embed_html,
    _embedRejected: embedRaw.length > 0 && embed_html === null,
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
  if (data._embedRejected) {
    return { error: "Embed HTML must be a single YouTube or Vimeo iframe. Custom HTML, scripts, and other iframe sources are not allowed." };
  }
  // Strip the sentinel field before insert.
  const { _embedRejected: _r, ...row } = data;
  void _r;

  const supabase = await createClient();
  const { data: created, error } = await supabase
    .from("library_items")
    .insert({ ...row, added_by: ctx.userId })
    .select("id")
    .single();
  if (error) return { error: error.message };
  redirect(`/library/${created.id}`);
}

export async function updateLibraryItem(id: string, formData: FormData) {
  const ctx = await getCreatorContext();
  if (!ctx.ok) return { error: "Sign in as an admin or advocate leader." };
  if (!id) return { error: "Missing id." };

  const data = readForm(formData);
  if (!data.title) return { error: "Title is required." };
  if (data._embedRejected) {
    return { error: "Embed HTML must be a single YouTube or Vimeo iframe. Custom HTML, scripts, and other iframe sources are not allowed." };
  }
  const { _embedRejected: _r, ...row } = data;
  void _r;

  const supabase = await createClient();
  const { error } = await supabase
    .from("library_items")
    .update({ ...row, updated_at: new Date().toISOString() })
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
