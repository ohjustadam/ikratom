"use client";

import { useState, useTransition } from "react";
import type { Legislator } from "@/lib/legislators";
import { ROLE_SHORT } from "@/lib/legislators";
import { logCampaignAction } from "../actions";

/**
 * One-click phone call panel.
 *
 * Each legislator with a phone number gets:
 *  - "Call now" (tel: link, opens dialer on mobile / FaceTime on Mac)
 *  - "I called" button to log the call (so impact stats count it)
 *
 * Talking points are derived from the campaign body — the user can read
 * them aloud while the call rings.
 */

// Default visible call entries before "Show all N" expand. Tuned for
// mobile readability — at 8 the section is still scannable; without a
// cap, large state-floor campaigns balloon to 100+ rows.
const DEFAULT_VISIBLE = 8;
// Reveal this many more per "Show more" click — paginates instead of dumping
// all 500+ rows into the DOM at once (which froze the page).
const PAGE_SIZE = 24;

export function CallActionPanel({
  campaignId,
  targets,
  body,
  isNonResident,
}: {
  campaignId: string;
  targets: Legislator[];
  body: string;
  isNonResident: boolean;
}) {
  const [logged, setLogged] = useState<Set<string>>(new Set());
  const [showPoints, setShowPoints] = useState(false);
  const [visibleCount, setVisibleCount] = useState(DEFAULT_VISIBLE);
  const [pending, startTransition] = useTransition();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [callError, setCallError] = useState<string | null>(null);

  const callable = targets.filter((t) => !!t.phone);
  if (callable.length === 0) return null;

  const visible = callable.slice(0, visibleCount);
  const hiddenCount = Math.max(0, callable.length - visibleCount);

  // Extract 3-5 punchy talking points from the body. Heuristic: split on
  // blank lines, take the substantive paragraphs, trim to one sentence each.
  const talkingPoints = extractTalkingPoints(body, 5);

  function logCall(legislatorId: string) {
    if (logged.has(legislatorId)) return;
    startTransition(async () => {
      // Best-effort — the tel: link already dialed. Never throw to the route
      // error boundary (the "@E352" page the call button was hitting).
      try {
        const r = await logCampaignAction({
          campaignId,
          legislatorIds: [legislatorId],
          method: "call",
          isNonResident,
        });
        if ("error" in r) {
          setCallError(r.error ?? "Couldn't log the call — please try again.");
        } else {
          setLogged((prev) => new Set(prev).add(legislatorId));
          setCallError(null);
        }
      } catch (e) {
        console.error("[campaign] logCampaignAction(call) failed", e);
        setCallError("Couldn't log the call — please try again.");
      }
    });
  }

  // tel: links do nothing in a desktop browser, so "Call now" also copies the
  // number (and logs the call) — desktop users can dial it from their phone.
  function copyNumber(phone: string | null, id: string) {
    if (!phone) return;
    navigator.clipboard
      ?.writeText(phone)
      .then(() => {
        setCopiedId(id);
        setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 3000);
      })
      .catch(() => {});
  }

  return (
    <section className="mt-8 rounded-lg border border-amber-700/40 bg-amber-950/10 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-amber-300">
            📞 Or call instead
          </p>
          <p className="mt-1 text-sm text-zinc-300">
            Phone calls weigh more than emails — staffers literally tally them
            for the legislator&apos;s morning briefing. Two minutes per call.
          </p>
        </div>
        <button
          onClick={() => setShowPoints((v) => !v)}
          className="text-xs text-emerald-400 hover:underline"
        >
          {showPoints ? "Hide talking points" : "Show talking points"}
        </button>
      </div>

      {showPoints && talkingPoints.length > 0 && (
        <div className="mt-4 rounded-md border border-zinc-800 bg-zinc-950 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Read aloud while the call rings
          </p>
          <ol className="mt-3 space-y-2 text-sm text-zinc-200">
            {talkingPoints.map((p, i) => (
              <li key={i} className="flex gap-2">
                <span className="font-mono text-emerald-400">{i + 1}.</span>
                <span>{p}</span>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-xs text-zinc-500">
            Open with: &quot;Hi, my name is [name] and I&apos;m a constituent in
            [city/zip]. I&apos;m calling about [bill number] — I&apos;d like
            [Senator/Representative] to vote NO.&quot;
          </p>
        </div>
      )}

      <ul className="mt-4 space-y-2">
        {visible.map((t) => {
          const wasLogged = logged.has(t.id);
          return (
            <li
              key={t.id}
              className={`rounded-md border p-3 ${
                wasLogged
                  ? "border-emerald-700/40 bg-emerald-950/20"
                  : "border-zinc-800 bg-zinc-950/60"
              }`}
            >
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-semibold text-zinc-100">{t.full_name}</span>
                    <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-xs text-zinc-400">
                      {ROLE_SHORT[t.role] ?? t.role}
                    </span>
                    {t.party && <span className="text-xs text-zinc-500">{t.party}</span>}
                    {t.district && <span className="text-xs text-zinc-500">D{t.district}</span>}
                  </div>
                  <a
                    href={`tel:${t.phone}`}
                    className="mt-1 inline-block font-mono text-base text-amber-300 hover:text-amber-200"
                  >
                    {t.phone}
                  </a>
                </div>
                <div className="flex gap-2">
                  <a
                    href={`tel:${t.phone}`}
                    onClick={() => { copyNumber(t.phone, t.id); logCall(t.id); }}
                    className="rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-amber-400"
                  >
                    Call now
                  </a>
                  <button
                    onClick={() => logCall(t.id)}
                    disabled={pending || wasLogged}
                    className={`rounded-md border px-3 py-2 text-sm transition disabled:opacity-50 ${
                      wasLogged
                        ? "border-emerald-700 text-emerald-300"
                        : "border-zinc-700 text-zinc-300 hover:border-emerald-500"
                    }`}
                  >
                    {wasLogged ? "✓ Logged" : "I called"}
                  </button>
                </div>
              </div>
              {copiedId === t.id && (
                <p className="mt-2 text-xs text-emerald-300">
                  📋 {t.phone} copied — dial it from your phone (a desktop browser can&apos;t place the call).
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {callError && <p className="mt-2 text-xs text-red-300">{callError}</p>}

      {(hiddenCount > 0 || visibleCount > DEFAULT_VISIBLE) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {hiddenCount > 0 && (
            <button
              onClick={() => setVisibleCount((c) => Math.min(callable.length, c + PAGE_SIZE))}
              className="flex-1 rounded-md border border-amber-700/40 px-3 py-2 text-xs font-semibold text-amber-300 hover:border-amber-500 hover:bg-amber-950/20"
            >
              Show {Math.min(PAGE_SIZE, hiddenCount)} more ({hiddenCount} remaining) ↓
            </button>
          )}
          {visibleCount > DEFAULT_VISIBLE && (
            <button
              onClick={() => setVisibleCount(DEFAULT_VISIBLE)}
              className="rounded-md border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-300 hover:border-amber-500"
            >
              Show less ↑
            </button>
          )}
        </div>
      )}

      <p className="mt-3 text-xs text-zinc-500">
        Tap a number to dial. After hanging up, hit &quot;I called&quot; so it
        counts toward platform impact stats.
        {hiddenCount > 0 && (
          <> Pace yourself — you don&apos;t need to call all {callable.length} in one sitting.</>
        )}
      </p>
    </section>
  );
}

/**
 * Pull talking-point bullets from a longer email body. We split on blank
 * lines, keep paragraphs that look like substantive sentences (not greeting,
 * sign-off, or boilerplate), trim each to one sentence, and cap at maxPoints.
 */
function extractTalkingPoints(body: string, maxPoints: number): string[] {
  if (!body) return [];
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const skipPatterns = [
    /^dear\b/i,
    /^my name is\b/i,
    /^thank you/i,
    /^sincerely/i,
    /^regards/i,
    /\{\{[a-z_]+\}\}/i, // template placeholders
  ];

  const points: string[] = [];
  for (const p of paragraphs) {
    if (skipPatterns.some((re) => re.test(p))) continue;
    // First sentence
    const m = p.match(/^([^.!?]+[.!?])/);
    const sentence = (m?.[1] ?? p).trim();
    if (sentence.length < 20 || sentence.length > 240) continue;
    points.push(sentence);
    if (points.length >= maxPoints) break;
  }
  return points;
}
