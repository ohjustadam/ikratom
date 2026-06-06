"use client";

import { useState, useTransition } from "react";
import { draftAlertResponse } from "@/modules/alerts/rebuttal-actions";

/**
 * Inline "draft my response" UI on /alerts/[id].
 *
 * Mission: equalize against astroturf form-letter campaigns. AI drafts
 * a personalized public-comment / opposition letter using the user's
 * profile (name, state, advocate type, kratom story). User reviews,
 * tweaks, then copies to clipboard / opens email client / submits to
 * agency portal.
 *
 * Each draft is individually written — different prompt outputs → no
 * two letters look the same. That's the whole point: 500 polished
 * individual comments beats 500 form letters during a BoP rule window.
 */
export function DraftResponsePanel({
  alertId,
  alertTitle,
  sourceUrl,
}: {
  alertId: string;
  alertTitle: string;
  sourceUrl: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<{ subject: string; body: string; provider: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editedSubject, setEditedSubject] = useState("");
  const [editedBody, setEditedBody] = useState("");
  const [tone, setTone] = useState<"personal" | "formal" | "urgent">("personal");

  function generate() {
    setError(null);
    setDraft(null);
    startTransition(async () => {
      try {
        const r = await draftAlertResponse({ alertId, tone });
        if (!r.ok) {
          setError(r.error);
          return;
        }
        setDraft({ subject: r.subject, body: r.body, provider: r.provider });
        setEditedSubject(r.subject);
        setEditedBody(r.body);
      } catch {
        setError("Something went wrong drafting your letter. Please try again.");
      }
    });
  }

  function copyToClipboard() {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    const text = `Subject: ${editedSubject}\n\n${editedBody}`;
    navigator.clipboard.writeText(text).catch(() => {});
  }

  // mailto: with edited subject + body pre-filled. User picks recipient.
  const mailtoHref = draft
    ? `mailto:?subject=${encodeURIComponent(editedSubject)}&body=${encodeURIComponent(editedBody)}`
    : "";

  return (
    <section className="rounded-lg border border-emerald-700/50 bg-emerald-950/15 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-bold text-emerald-200">
          ✍ Draft your response
        </h2>
        <span className="text-[11px] text-zinc-500">
          AI-drafts a personalized letter you edit + send. ~10 seconds.
        </span>
      </div>

      {!draft && !pending && (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-zinc-300">
            One click. The AI uses your profile (name, state, your kratom story
            if you&apos;ve set one) to draft an individually-written letter
            opposing this. You review, tweak, copy — or send via your email.
          </p>
          <p className="text-[11px] text-zinc-500">
            Each draft is unique. Astroturf groups submit form letters; we
            submit 500 individually-written ones. That&apos;s the lever.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={tone}
              onChange={(e) => setTone(e.target.value as typeof tone)}
              className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200"
            >
              <option value="personal">Personal tone</option>
              <option value="formal">Formal / policy tone</option>
              <option value="urgent">Urgent / action tone</option>
            </select>
            <button
              type="button"
              onClick={generate}
              disabled={pending}
              className="rounded bg-emerald-500 px-4 py-1.5 text-sm font-bold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
            >
              ✍ Draft my response
            </button>
          </div>
        </div>
      )}

      {pending && (
        <p className="mt-3 text-sm text-zinc-300">
          ⏳ Drafting your letter via AI router… (Groq → Ollama → Gemini fallback)
        </p>
      )}

      {error && (
        <p className="mt-3 rounded border border-red-700/40 bg-red-950/40 px-3 py-2 text-xs text-red-300">
          ✗ {error}
        </p>
      )}

      {draft && (
        <div className="mt-4 space-y-3">
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Subject
            </label>
            <input
              value={editedSubject}
              onChange={(e) => setEditedSubject(e.target.value)}
              className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
              maxLength={200}
            />
          </div>
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Letter body (edit anything before sending)
            </label>
            <textarea
              value={editedBody}
              onChange={(e) => setEditedBody(e.target.value)}
              rows={18}
              className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm leading-relaxed text-zinc-100 focus:border-emerald-500 focus:outline-none"
              maxLength={4000}
            />
            <p className="mt-1 text-[10px] text-zinc-500">
              {editedBody.length} chars · drafted by {draft.provider}
            </p>
          </div>

          {/* Send / copy / re-roll actions */}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={copyToClipboard}
              className="rounded bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-400"
            >
              📋 Copy
            </button>
            <a
              href={mailtoHref}
              className="rounded border border-emerald-700/50 bg-emerald-950/20 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:border-emerald-500"
            >
              ✉ Open in email
            </a>
            {sourceUrl && (
              <a
                href={sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 hover:border-emerald-500"
              >
                View the source ↗
              </a>
            )}
            <button
              type="button"
              onClick={generate}
              disabled={pending}
              className="rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-500 disabled:opacity-50"
            >
              ↻ Re-roll
            </button>
          </div>

          <p className="text-[11px] text-zinc-500">
            💡 Personalize the letter before submitting — agencies count
            duplicate text as one comment. Yours is already unique; tweaks
            make it even harder to discount. Headline: {alertTitle.slice(0, 60)}…
          </p>
        </div>
      )}
    </section>
  );
}
