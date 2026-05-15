"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitResearchPaper } from "@/modules/research/submit-actions";

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

export function SubmitResearchForm({ submitterName }: { submitterName: string }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
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

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setQuipIdx(Math.floor(Math.random() * KRATOM_QUIPS.length));
    startTransition(async () => {
      const result = await submitResearchPaper(url.trim());
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

  return (
    <div>
      <form onSubmit={onSubmit} className="space-y-4">
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
            required
            disabled={pending}
            className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none disabled:opacity-60"
          />
          <p className="mt-1 text-[10px] text-zinc-500">
            DOI URLs work too (doi.org/...). Submitting as <span className="text-zinc-300">{submitterName}</span>.
          </p>
        </div>

        <button
          type="submit"
          disabled={pending || !url.trim()}
          className="inline-flex items-center gap-2 rounded-md bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          {pending ? "Processing…" : "Add to library →"}
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
