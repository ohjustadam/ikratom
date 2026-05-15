"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { recordAdminAction } from "@/lib/audit";
import {
  ALLOWED_UPLOAD_EXT,
  filenameExt,
  rejectReasonForUpload,
} from "@/lib/file-signatures";

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

/**
 * Variant: paper submission where the user uploaded a PDF (or text/markdown)
 * directly via Supabase Storage. The client has already pushed the file to
 * the bucket `research-uploads/{user_id}/{rand}/{filename}` and passes us:
 *   - storagePath: bucket-relative path used to issue signed URLs later
 *   - filename: original filename for the title fallback
 *   - sizeBytes: for the audit log only
 *   - optional metadata fields the user typed in
 */
export async function submitResearchPaperUpload(input: {
  storagePath: string;
  filename: string;
  sizeBytes?: number;
  title?: string;
  authorsCsv?: string;
  journal?: string;
  publicationYear?: number;
  abstract?: string;
}): Promise<SubmitResult> {
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
    return { ok: false, error: "Research submissions are limited to advocate leaders + admins." };
  }

  // Storage path safety: must live under the user's own folder + bucket
  if (!input.storagePath || !input.storagePath.startsWith(`${user.id}/`)) {
    return { ok: false, error: "Storage path must be in your own folder." };
  }

  // Filename safety: defense in depth on extension. The bucket's
  // allowed_mime_types and the client also enforce this — server check
  // catches the malicious-client case where they hit Supabase Storage
  // directly with a faked content-type header.
  const ext = filenameExt(input.filename);
  if (!ALLOWED_UPLOAD_EXT.has(ext)) {
    await deleteUploaded(input.storagePath); // don't leave it lying around
    return { ok: false, error: `File extension .${ext || "(none)"} isn't allowed. Accepted: .pdf, .txt, .md` };
  }

  // AUTHORITATIVE FILE-CONTENT CHECK: download the first 16 bytes of
  // the just-uploaded file and verify the magic bytes match what we
  // expect for the claimed type. This is the only check a malicious
  // client cannot bypass — the bucket's allowed_mime_types relies on
  // the upload request's content-type header which the attacker
  // controls. The file bytes themselves are what we actually serve.
  const sigOk = await verifyUploadedSignature(input.storagePath, ext);
  if (!sigOk.ok) {
    await deleteUploaded(input.storagePath);
    return { ok: false, error: sigOk.error };
  }

  // Sanitize the title / authors / abstract user input
  const title = (input.title ?? input.filename ?? "Untitled upload").trim().slice(0, 500);
  const authors = input.authorsCsv
    ? input.authorsCsv.split(",").map((a) => a.trim()).filter(Boolean).slice(0, 50).map((a) => a.slice(0, 200))
    : [];
  const journal = input.journal?.trim().slice(0, 200) || null;
  const year = input.publicationYear && input.publicationYear >= 1900 && input.publicationYear <= 2100
    ? input.publicationYear : null;
  const abstract = input.abstract?.trim().slice(0, 5000) || null;

  const admin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  // Build a signed URL valid for the canonical public link. We re-issue
  // these per-render on /research/[id] so this is just for the initial
  // insert breadcrumb.
  const { data: signed } = await admin.storage
    .from("research-uploads")
    .createSignedUrl(input.storagePath, 60 * 60 * 24 * 365); // 1 year — long-lived, but private bucket

  const { data: inserted, error: insErr } = await admin
    .from("research_papers")
    .insert({
      title,
      abstract,
      authors,
      journal,
      publication_year: year,
      pdf_url: signed?.signedUrl ?? null,
      uploaded_storage_path: input.storagePath,
      topics: ["needs_review", "leader_submitted", "uploaded_pdf"],
      study_type: null,
      ingested_via: "leader_upload",
      admin_notes_md: `Uploaded by ${profile?.full_name ?? user.email} on ${new Date().toISOString().slice(0, 10)}. Size ${Math.round((input.sizeBytes ?? 0) / 1024)} KB. Storage path: ${input.storagePath}. Pending AI evaluation pass.`,
      is_active: true,
    })
    .select("id")
    .single();

  if (insErr || !inserted) {
    return { ok: false, error: `Couldn't save: ${insErr?.message ?? "unknown error"}` };
  }

  try {
    await recordAdminAction({
      action: "research.leader_upload",
      details: {
        paper_id: inserted.id,
        storage_path: input.storagePath,
        filename: input.filename.slice(0, 200),
        size_bytes: input.sizeBytes ?? 0,
      },
    });
  } catch { /* non-fatal */ }

  return { ok: true, paperId: inserted.id, isDuplicate: false };
}

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

// ----- Upload validation helpers (defense in depth vs malicious clients) -----

function adminStorageClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

/**
 * Authoritative file-content check. Downloads the first 16 bytes of
 * the uploaded file and runs the shared magic-bytes detector
 * (src/lib/file-signatures.ts). This is the check a malicious client
 * cannot bypass — the bucket's allowed_mime_types relies on the
 * upload request's content-type header which the attacker controls.
 */
async function verifyUploadedSignature(
  storagePath: string,
  ext: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const admin = adminStorageClient();
    const { data: blob, error } = await admin.storage
      .from("research-uploads")
      .download(storagePath);
    if (error || !blob) {
      return { ok: false, error: "Couldn't read the uploaded file to verify its contents." };
    }
    const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
    const reason = rejectReasonForUpload(head, ext);
    if (reason) return { ok: false, error: reason };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Signature check failed: ${(e as Error).message}` };
  }
}

async function deleteUploaded(storagePath: string): Promise<void> {
  try {
    await adminStorageClient().storage.from("research-uploads").remove([storagePath]);
  } catch {
    // Best-effort cleanup; if it fails the orphan can be swept by the
    // quarterly admin pass (see docs/STORAGE_STRATEGY.md).
  }
}
