"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitResearchPaper, submitResearchPaperUpload } from "@/modules/research/submit-actions";
import { createClient } from "@/lib/supabase/client";
import {
  ALLOWED_UPLOAD_EXT,
  ALLOWED_UPLOAD_MIME,
  filenameExt,
  rejectReasonForUpload,
} from "@/lib/file-signatures";

/**
 * Submit form with staged kratom-leaf progress.
 *
 * Phase 1 (current): the server action does the real work in one shot
 * (fetch metadata → insert row), then we redirect. While waiting, we
 * STAGE the progress UI through 4 fake phases so the user has feedback
 * + a kratom joke rotation.
 *
 * Phase 2 (when AI pipeline is wired): replace `useStagedProgress` with
 * an SSE subscription to /api/research/submit/progress?id=<paper_id>.
 */

const KRATOM_QUIPS = [
  "watering the plant…",
  "extracting the alkaloids…",
  "reading the autopsy reports…",
  "cross-referencing 447 sibling papers…",
  "asking the pharmacologists nicely…",
  "checking if 7-OH is mentioned (it usually is)…",
  "filtering the gas-station-heroin noise…",
  "drying the leaves under a UV-A 365 nm lamp…",
  "noting the methodology bias indicators…",
  "computing the evidence-strength score…",
  "skipping the pre-paywall ads…",
  "looking for the conflict-of-interest disclosure…",
  "verifying the journal isn't predatory…",
  "indexing the receptor binding constants…",
  "translating the SE Asian phytochemistry terms…",
];

const PHASES = [
  { label: "Fetching the page", duration: 1200 },
  { label: "Extracting metadata", duration: 1600 },
  { label: "Checking the library for duplicates", duration: 800 },
  { label: "Saving to the sanctuary", duration: 800 },
];

type Mode = "url" | "upload";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB — matches bucket cap from migration 0145
const MIN_UPLOAD_BYTES = 64; // empty / near-empty files are almost always corrupt or a probe
// Common dangerous extensions we explicitly call out in the deny path
// so users get a clear error message instead of a generic "not allowed".
// The authoritative test is rejectReasonForUpload(head, ext) which uses
// the file's actual magic bytes — the extension list is a fast UX layer.
const COMMON_BLOCKED_HINTS: Record<string, string> = {
  exe: "Windows executable", msi: "Windows installer", bat: "Batch script",
  sh: "Shell script", dmg: "macOS disk image", apk: "Android package",
  zip: "ZIP archive", rar: "RAR archive", "7z": "7-zip archive",
  tar: "tar archive", gz: "gzip archive", iso: "disk image",
  mp4: "video", mov: "video", avi: "video", mkv: "video", webm: "video",
  mp3: "audio", wav: "audio", ogg: "audio", m4a: "audio", flac: "audio",
  jpg: "image", jpeg: "image", png: "image", gif: "image", webp: "image",
  doc: "Word document (use PDF export)", docx: "Word document (use PDF export)",
  xls: "Excel spreadsheet (use PDF export)", xlsx: "Excel spreadsheet (use PDF export)",
  ppt: "PowerPoint (use PDF export)", pptx: "PowerPoint (use PDF export)",
  html: "HTML (could contain scripts)", htm: "HTML (could contain scripts)",
  svg: "SVG (could contain scripts)", xml: "XML",
  js: "JavaScript", py: "Python script", rb: "Ruby script",
};

export function SubmitResearchForm({ submitterName, userId }: { submitterName: string; userId: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("url");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [authorsCsv, setAuthorsCsv] = useState("");
  const [journal, setJournal] = useState("");
  const [year, setYear] = useState("");
  const [abstract, setAbstract] = useState("");
  const [pending, startTransition] = useTransition();
  const [phaseIdx, setPhaseIdx] = useState(-1); // -1 = not started
  const [quipIdx, setQuipIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Rotate the kratom quip every 1.8s while a submit is pending
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => {
      setQuipIdx((i) => (i + 1) % KRATOM_QUIPS.length);
    }, 1800);
    return () => clearInterval(t);
  }, [pending]);

  // Stage through PHASES while pending so the user has visible motion
  useEffect(() => {
    if (!pending) return;
    setPhaseIdx(0);
    let cancelled = false;
    (async () => {
      for (let i = 0; i < PHASES.length; i++) {
        if (cancelled) return;
        setPhaseIdx(i);
        await new Promise((r) => setTimeout(r, PHASES[i].duration));
      }
    })();
    return () => { cancelled = true; };
  }, [pending]);

  async function uploadFileToStorage(f: File): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
    // 1. Size bounds (both directions — 0-byte files are almost always probes)
    if (f.size > MAX_UPLOAD_BYTES) {
      return { ok: false, error: `File is ${(f.size / 1024 / 1024).toFixed(1)} MB; limit is 10 MB.` };
    }
    if (f.size < MIN_UPLOAD_BYTES) {
      return { ok: false, error: `File is too small (${f.size} bytes). Probably empty or corrupt.` };
    }
    // 2. Extension allowlist — friendly error message for common blocked types
    const ext = filenameExt(f.name);
    const blockedHint = COMMON_BLOCKED_HINTS[ext];
    if (blockedHint) {
      return { ok: false, error: `${blockedHint} (.${ext}) isn't allowed here. Accepted: .pdf, .txt, .md` };
    }
    if (!ALLOWED_UPLOAD_EXT.has(ext)) {
      return { ok: false, error: `File extension .${ext || "(none)"} isn't allowed. Accepted: .pdf, .txt, .md` };
    }
    // 3. MIME allowlist — second line of defense; browser-provided so
    //    can be lied about, but cheap to check and catches honest mismatches
    if (!ALLOWED_UPLOAD_MIME.has(f.type)) {
      return { ok: false, error: `MIME type ${f.type || "(unknown)"} not allowed. Accepted: PDF, plain text, markdown.` };
    }
    // 4. Magic-bytes peek — read the first 16 bytes client-side and
    //    sanity-check the signature matches the extension. The SERVER
    //    runs this same check authoritatively after upload — a malicious
    //    client can skip this, but the server check is bypass-proof.
    const head = new Uint8Array(await f.slice(0, 16).arrayBuffer());
    const reason = rejectReasonForUpload(head, ext);
    if (reason) {
      return { ok: false, error: reason };
    }
    // Path: {user_id}/{paper_uuid_placeholder}/{safe_filename}
    const rand = crypto.randomUUID();
    const safeName = f.name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 200);
    const path = `${userId}/${rand}/${safeName}`;
    const sb = createClient();
    const { error: upErr } = await sb.storage.from("research-uploads").upload(path, f, {
      contentType: f.type,
      upsert: false,
    });
    if (upErr) return { ok: false, error: `Upload failed: ${upErr.message}` };
    return { ok: true, path };
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setQuipIdx(Math.floor(Math.random() * KRATOM_QUIPS.length));
    startTransition(async () => {
      let result;
      if (mode === "url") {
        result = await submitResearchPaper(url.trim());
      } else {
        if (!file) {
          setError("Pick a file first.");
          setPhaseIdx(-1);
          return;
        }
        const up = await uploadFileToStorage(file);
        if (!up.ok) {
          setError(up.error);
          setPhaseIdx(-1);
          return;
        }
        result = await submitResearchPaperUpload({
          storagePath: up.path,
          filename: file.name,
          sizeBytes: file.size,
          title: title.trim() || undefined,
          authorsCsv: authorsCsv.trim() || undefined,
          journal: journal.trim() || undefined,
          publicationYear: year.trim() ? parseInt(year, 10) : undefined,
          abstract: abstract.trim() || undefined,
        });
      }
      if (!result.ok) {
        setError(result.error);
        setPhaseIdx(-1);
        return;
      }
      // Brief hold so the "Saving to the sanctuary" stage is visible
      await new Promise((r) => setTimeout(r, 400));
      router.push(`/research/${result.paperId}${result.isDuplicate ? "?from=submit&duplicate=1" : "?from=submit"}`);
    });
  }

  const canSubmit = mode === "url" ? !!url.trim() : !!file;

  return (
    <div>
      {/* Mode toggle — paste URL OR upload file */}
      <div className="mb-4 flex rounded-md border border-zinc-800 bg-zinc-950 p-0.5 text-sm">
        <button
          type="button"
          onClick={() => setMode("url")}
          disabled={pending}
          className={`flex-1 rounded px-3 py-1.5 transition ${
            mode === "url" ? "bg-emerald-950/40 text-emerald-300 font-semibold" : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          🔗 URL
        </button>
        <button
          type="button"
          onClick={() => setMode("upload")}
          disabled={pending}
          className={`flex-1 rounded px-3 py-1.5 transition ${
            mode === "upload" ? "bg-emerald-950/40 text-emerald-300 font-semibold" : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          📄 Upload file
        </button>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        {mode === "url" ? (
          <div>
            <label className="block text-xs font-medium text-zinc-400" htmlFor="url">
              Research paper URL
            </label>
            <input
              id="url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://pubs.acs.org/doi/10.1021/acs.jmedchem.6c00991"
              required={mode === "url"}
              disabled={pending}
              className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none disabled:opacity-60"
            />
            <p className="mt-1 text-[10px] text-zinc-500">
              DOI URLs work too (doi.org/...). Submitting as <span className="text-zinc-300">{submitterName}</span>.
            </p>
          </div>
        ) : (
          <>
            <div>
              <label className="block text-xs font-medium text-zinc-400" htmlFor="file">
                Research paper file
              </label>
              <input
                id="file"
                type="file"
                accept=".pdf,.txt,.md,.markdown,application/pdf,text/plain,text/markdown"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                disabled={pending}
                className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 file:mr-3 file:rounded-md file:border-0 file:bg-emerald-950/30 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-emerald-300 disabled:opacity-60"
              />
              <p className="mt-1 text-[10px] text-zinc-500">
                <strong className="text-zinc-300">Allowed:</strong> .pdf, .txt, .md · up to 10 MB · stored privately, served via signed URLs.
              </p>
              <p className="mt-0.5 text-[10px] text-zinc-600">
                <strong className="text-zinc-500">Blocked:</strong> video, audio, executables, archives, images, Office docs, scripts, HTML. Use the URL mode to link those if they live elsewhere.
              </p>
              {file && (
                <p className="mt-1 text-[10px] text-zinc-300">
                  Selected: <span className="font-mono">{file.name}</span> ({(file.size / 1024).toFixed(0)} KB · {file.type || "(no MIME)"})
                </p>
              )}
            </div>
            <details className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
              <summary className="cursor-pointer text-xs text-zinc-400 hover:text-zinc-200">
                Optional metadata (title, authors, journal…) — click to expand
              </summary>
              <div className="mt-3 space-y-3">
                <input
                  type="text"
                  placeholder="Title (defaults to filename if blank)"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={pending}
                  maxLength={500}
                  className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none disabled:opacity-60"
                />
                <input
                  type="text"
                  placeholder="Authors (comma-separated)"
                  value={authorsCsv}
                  onChange={(e) => setAuthorsCsv(e.target.value)}
                  disabled={pending}
                  className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none disabled:opacity-60"
                />
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="text"
                    placeholder="Journal"
                    value={journal}
                    onChange={(e) => setJournal(e.target.value)}
                    disabled={pending}
                    maxLength={200}
                    className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none disabled:opacity-60"
                  />
                  <input
                    type="number"
                    placeholder="Year (e.g. 2026)"
                    value={year}
                    onChange={(e) => setYear(e.target.value)}
                    disabled={pending}
                    min={1900}
                    max={2100}
                    className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none disabled:opacity-60"
                  />
                </div>
                <textarea
                  placeholder="Abstract or summary"
                  value={abstract}
                  onChange={(e) => setAbstract(e.target.value)}
                  disabled={pending}
                  rows={4}
                  maxLength={5000}
                  className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none disabled:opacity-60"
                />
                <p className="text-[10px] text-zinc-500">
                  Skip any field — admins will fill gaps during the editorial review pass. Submitting as <span className="text-zinc-300">{submitterName}</span>.
                </p>
              </div>
            </details>
          </>
        )}

        <button
          type="submit"
          disabled={pending || !canSubmit}
          className="inline-flex items-center gap-2 rounded-md bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          {pending ? "Processing…" : mode === "url" ? "Add to library →" : "Upload + add →"}
        </button>

        {error && (
          <p className="rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}
      </form>

      {/* Progress panel — only renders while pending */}
      {pending && (
        <div className="mt-6 rounded-lg border-2 border-emerald-700/40 bg-emerald-950/15 p-6">
          <div className="flex items-center justify-center">
            <KratomLeafSpinner />
          </div>
          <p className="mt-4 text-center text-sm font-semibold text-emerald-200">
            {KRATOM_QUIPS[quipIdx]}
          </p>
          <ul className="mt-5 space-y-2">
            {PHASES.map((phase, i) => {
              const state = i < phaseIdx ? "done" : i === phaseIdx ? "active" : "pending";
              const dot = state === "done" ? "✓" : state === "active" ? "●" : "○";
              const cls = state === "done" ? "text-emerald-300" : state === "active" ? "text-emerald-200 font-semibold" : "text-zinc-500";
              return (
                <li key={i} className={`flex items-center gap-3 text-[12px] ${cls}`}>
                  <span className={state === "active" ? "animate-pulse" : ""}>{dot}</span>
                  <span>{phase.label}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Kratom-leaf SVG that slowly rotates while the submission runs.
 * Stylized — three-lobed Mitragyna-speciosa leaf silhouette with veins.
 */
function KratomLeafSpinner() {
  return (
    <svg
      width="80"
      height="80"
      viewBox="0 0 100 100"
      className="animate-spin"
      style={{ animationDuration: "3s" }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="leaf" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#10b981" />
          <stop offset="1" stopColor="#059669" />
        </linearGradient>
      </defs>
      {/* Stem */}
      <line x1="50" y1="50" x2="50" y2="92" stroke="#065f46" strokeWidth="2" strokeLinecap="round" />
      {/* Three lobes radiating from center, characteristic Mitragyna leaf shape */}
      <g transform="translate(50 50)">
        {[0, 120, 240].map((angle) => (
          <g key={angle} transform={`rotate(${angle})`}>
            <path
              d="M 0 0 Q -14 -22 0 -42 Q 14 -22 0 0 Z"
              fill="url(#leaf)"
              opacity="0.92"
            />
            {/* Vein */}
            <line x1="0" y1="0" x2="0" y2="-38" stroke="#065f46" strokeWidth="1.2" opacity="0.7" />
          </g>
        ))}
      </g>
    </svg>
  );
}
