"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { recordAdminAction } from "@/lib/audit";

/**
 * Server action: leader-advocate / admin submits a research-paper URL.
 *
 * Phase 1 (this PR — "no AI yet"):
 *   1. Validate URL + auth
 *   2. Fetch the page, extract OG title / author / description as best-
 *      effort metadata (paywalled papers may return little)
 *   3. Dedupe by full_text_url against research_papers
 *   4. INSERT a row with ingested_via='leader_submit',
 *      topics=['needs_review'], abstract=description-if-any
 *   5. Return the new paper's id so the client can redirect to
 *      /research/[id]
 *
 * Phase 2 (later PR — once chatbot budget is approved):
 *   - Replace the inline fetch with a job-queued task
 *   - AI evaluation pass populates ai_* fields
 *   - Stream progress via SSE to the client (currently we just simulate
 *     progress on the client side for UX continuity)
 *
 * Access:
 *   - Admins (is_admin OR is_owner) — always allowed
 *   - Advocate leaders (is_advocate_leader) — allowed
 *   - All other authenticated users: rejected with a "request leader
 *     access" message
 *   - Unauthenticated: redirect to /login
 */

export type SubmitResult =
  | { ok: true; paperId: string; isDuplicate: boolean }
  | { ok: false; error: string };

const URL_RE = /^https?:\/\/[^\s]+$/i;

export async function submitResearchPaper(rawUrl: string): Promise<SubmitResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin, is_owner, is_advocate_leader, full_name")
    .eq("id", user.id)
    .maybeSingle();
  const isPrivileged = !!(profile?.is_admin || profile?.is_owner || profile?.is_advocate_leader);
  if (!isPrivileged) {
    return {
      ok: false,
      error: "Research-paper submissions are limited to advocate leaders + admins right now. Visit /account/leader to apply.",
    };
  }

  const url = rawUrl.trim().slice(0, 1000);
  if (!URL_RE.test(url)) return { ok: false, error: "Paste a valid http(s) URL." };

  // Dedupe BEFORE fetching — fast path when this URL is already on the
  // shelf. Also matches DOI when the URL is a doi.org link.
  const admin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const { data: existing } = await admin
    .from("research_papers")
    .select("id, title")
    .or(`full_text_url.eq.${url},pdf_url.eq.${url}`)
    .maybeSingle();
  if (existing) return { ok: true, paperId: existing.id, isDuplicate: true };

  // Best-effort metadata fetch. Server-side, so we control timeouts +
  // can hit paywalled domains that browsers can't reach.
  let title: string = url;
  let description: string | null = null;
  let author: string | null = null;
  try {
    const r = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: { "User-Agent": "iKratom Research Bot (research@ikratom.org)" },
    });
    if (r.ok) {
      const html = await r.text();
      title = extractMeta(html, /<meta[^>]+(?:property|name)=["']og:title["'][^>]+content=["']([^"']{3,300})["']/i)
        ?? extractMeta(html, /<title>([^<]{3,300})<\/title>/i)
        ?? title;
      description = extractMeta(html, /<meta[^>]+(?:property|name)=["']og:description["'][^>]+content=["']([^"']{10,2000})["']/i)
        ?? extractMeta(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']{10,2000})["']/i);
      // citation_author meta is widely used by academic publishers
      author = extractMeta(html, /<meta[^>]+name=["']citation_author["'][^>]+content=["']([^"']{2,200})["']/i)
        ?? extractMeta(html, /<meta[^>]+name=["']author["'][^>]+content=["']([^"']{2,200})["']/i);
    }
  } catch {
    // Best-effort — failure leaves title=URL + abstract=null, admin can edit
  }

  // Decode any HTML entities in the captured fields
  title = decodeEntities(title).slice(0, 500);
  description = description ? decodeEntities(description).slice(0, 4000) : null;
  author = author ? decodeEntities(author).slice(0, 200) : null;

  const { data: inserted, error: insErr } = await admin
    .from("research_papers")
    .insert({
      title,
      abstract: description,
      authors: author ? [author] : [],
      full_text_url: url,
      topics: ["needs_review", "leader_submitted"],
      study_type: null,
      ingested_via: "leader_submit",
      admin_notes_md: `Submitted via /research/submit by ${profile?.full_name ?? user.email} on ${new Date().toISOString().slice(0, 10)}. Pending AI evaluation pass.`,
      is_active: true,
    })
    .select("id")
    .single();

  if (insErr || !inserted) {
    return { ok: false, error: `Couldn't save: ${insErr?.message ?? "unknown error"}` };
  }

  // Audit log so this submission is traceable
  try {
    await recordAdminAction({
      action: "research.leader_submit",
      details: { paper_id: inserted.id, url, title: title.slice(0, 100) },
    });
  } catch { /* non-fatal */ }

  return { ok: true, paperId: inserted.id, isDuplicate: false };
}

function extractMeta(html: string, re: RegExp): string | null {
  const m = html.match(re);
  return m ? m[1].trim() : null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}
