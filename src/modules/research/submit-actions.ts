"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { recordAdminAction } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { safeFetch } from "@/lib/url-safety";
import {
  ALLOWED_UPLOAD_EXT,
  filenameExt,
  rejectReasonForUpload,
} from "@/lib/file-signatures";
import {
  extractResearchMetaFromHtml,
  stripTrackingParams,
} from "@/lib/research-metadata";
import { enrichAbstractFromUrl } from "@/lib/research-enrich-ai";
import { lookupByDoi, extractDoi } from "@/lib/research-doi-lookup";

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

  // Rate limit: bound submissions even for a (compromised) leader account.
  if (!(await checkRateLimit(`research_submit:${user.id}`, 20, 3600))) {
    return { ok: false, error: "Too many submissions this hour — slow down." };
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

  // Don't persist a signed URL. research_papers is anon-readable (public
  // research shelf), and a long-lived signed URL is a bearer token that can't
  // be revoked when a paper is retracted (is_active=false) — defeating the
  // private-bucket model migration 0145 relies on. The /research/[id] page
  // re-issues a fresh 1-hour signed URL per render from uploaded_storage_path,
  // so nothing is lost.
  const { data: inserted, error: insErr } = await admin
    .from("research_papers")
    .insert({
      title,
      abstract,
      authors,
      journal,
      publication_year: year,
      pdf_url: null,
      uploaded_storage_path: input.storagePath,
      topics: ["needs_review", "leader_submitted", "uploaded_pdf"],
      study_type: null,
      ingested_via: "leader_upload",
      submitted_by: user.id,
      admin_notes_md: `Leader upload on ${new Date().toISOString().slice(0, 10)}. Size ${Math.round((input.sizeBytes ?? 0) / 1024)} KB. Pending AI evaluation pass.`,
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

  // Rate limit: bound submissions even for a (compromised) leader account.
  if (!(await checkRateLimit(`research_submit:${user.id}`, 20, 3600))) {
    return { ok: false, error: "Too many submissions this hour — slow down." };
  }

  // Strip tracking params (fbclid, utm_*, etc.) BEFORE the rest of
  // the flow so dedupe + storage are consistent regardless of which
  // share-channel the user came through.
  const url = stripTrackingParams(rawUrl.trim().slice(0, 1000));
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

  // Fetch the page once. We parse all the standard academic meta tags
  // (citation_*) which RSC, ACS, Springer, Wiley, Nature, PubMed, etc.
  // all expose. Then, if the abstract came back truncated (og:description
  // typically caps at ~300 chars), kick off an AI enrichment pass so
  // the kratom-brain RAG has full content to ground on.
  let title: string = url;
  let abstract: string | null = null;
  let authors: string[] = [];
  let journal: string | null = null;
  let doi: string | null = null;
  let publicationYear: number | null = null;
  let publicationDate: string | null = null;
  let pdfUrl: string | null = null;
  let abstractLikelyTruncated = false;
  let html: string | null = null;
  try {
    // SSRF-safe (validates URL + each redirect hop). Best-effort: on a blocked
    // or failed fetch we leave title=URL/abstract=null for the admin to edit.
    const f = await safeFetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: { "User-Agent": "iKratom Research Bot (research@ikratom.org)" },
    });
    const r = f.ok ? f.response : null;
    if (r && r.ok) {
      html = await r.text();
      const meta = extractResearchMetaFromHtml(html);
      title = meta.title ?? url;
      abstract = meta.abstract;
      authors = meta.authors;
      journal = meta.journal ?? meta.journalAbbrev ?? null;
      doi = meta.doi;
      publicationYear = meta.publicationYear;
      publicationDate = meta.publicationDate;
      pdfUrl = meta.pdfUrl;
      abstractLikelyTruncated = meta.abstractLikelyTruncated;
    }
  } catch {
    // Best-effort — failure leaves title=URL + abstract=null, admin can edit
  }

  // Enrichment chain when the page-scrape abstract is missing or
  // truncated. Order:
  //   1. DOI-based lookup (CrossRef → OpenAlex → PubMed) — accurate,
  //      structured, no AI cost. Best source when available.
  //   2. AI-extracted abstract from the page HTML — fallback when no
  //      DOI is available OR DOI sources have no abstract either.
  //
  // Also harvests structured metadata (authors, journal, pmid, year)
  // from DOI lookup even when the abstract specifically comes from
  // another source.
  let enrichmentNote = "";
  let pmid: string | null = null;
  if (!abstract || abstractLikelyTruncated) {
    // Try to discover a DOI: prefer the one extracted from page meta,
    // fall back to scanning the submitted URL itself.
    const candidateDoi = doi ?? extractDoi(url) ?? extractDoi(html);
    if (candidateDoi) {
      try {
        const dl = await lookupByDoi(candidateDoi);
        if (dl.abstract && dl.abstract.length > (abstract?.length ?? 0)) {
          abstract = dl.abstract;
          enrichmentNote = ` Abstract from ${dl.abstract_source} via DOI ${candidateDoi}.`;
        }
        // Backfill structured fields from DOI lookup when page-scrape missed them
        if (!authors.length && dl.authors.length) authors = dl.authors;
        if (!journal && dl.journal) journal = dl.journal;
        if (!publicationYear && dl.publicationYear) publicationYear = dl.publicationYear;
        if (!publicationDate && dl.publicationDate) publicationDate = dl.publicationDate;
        if (!doi && candidateDoi) doi = candidateDoi;
        if (dl.pmid) pmid = dl.pmid;
        // If DOI lookup found nothing useful, append context so the admin
        // notes show what we tried.
        if (!dl.abstract) {
          enrichmentNote += ` Tried DOI sources [${dl.sources_tried.join(", ") || "none reachable"}] — no abstract on file.`;
        }
      } catch { /* fall through to AI */ }
    }

    // Still no abstract? Last resort: AI page-scrape.
    if ((!abstract || (abstractLikelyTruncated && abstract.length < 600)) && html) {
      const enriched = await enrichAbstractFromUrl({ url, title });
      if (enriched.ok && enriched.chars > (abstract?.length ?? 0)) {
        abstract = enriched.abstract;
        enrichmentNote += ` AI-extracted abstract via ${enriched.provider} (${enriched.chars} chars).`;
      }
    }
  }

  // Final caps. Title 500, abstract 8000, author list to 50 entries.
  title = title.slice(0, 500);
  abstract = abstract ? abstract.slice(0, 8000) : null;
  authors = authors.slice(0, 50);

  // Defensively check: if a paper with the same DOI or PMID already
  // exists, return that row instead of inserting a duplicate. Saves
  // the admin a manual dedup later.
  if (doi || pmid) {
    const dedupeQ = admin.from("research_papers").select("id").limit(1);
    const filterCol = doi ? "doi" : "pubmed_id";
    const filterVal = doi ?? pmid!;
    const { data: existing } = await dedupeQ.eq(filterCol, filterVal);
    if (existing && existing.length > 0) {
      return { ok: true, paperId: (existing[0] as { id: string }).id, isDuplicate: true };
    }
  }

  const { data: inserted, error: insErr } = await admin
    .from("research_papers")
    .insert({
      title,
      abstract,
      authors,
      journal,
      doi,
      pubmed_id: pmid,
      publication_year: publicationYear,
      publication_date: publicationDate,
      full_text_url: url,
      pdf_url: pdfUrl,
      topics: ["needs_review", "leader_submitted"],
      study_type: null,
      ingested_via: "leader_submit",
      submitted_by: user.id,
      admin_notes_md: `Submitted via /research/submit on ${new Date().toISOString().slice(0, 10)}.${enrichmentNote} Pending editorial pass.`,
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
