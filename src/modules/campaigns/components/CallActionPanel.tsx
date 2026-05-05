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
  const [pending, startTransition] = useTransition();

  const callable = targets.filter((t) => !!t.phone);
  if (callable.length === 0) return null;

  // Extract 3-5 punchy talking points from the body. Heuristic: split on
  // blank lines, take the substantive paragraphs, trim to one sentence each.
  const talkingPoints = extractTalkingPoints(body, 5);

  function logCall(legislatorId: string) {
    if (logged.has(legislatorId)) return;
    startTransition(async () => {
      const r = await logCampaignAction({
        campaignId,
        legislatorIds: [legislatorId],
        method: "call",
        isNonResident,
      });
      if (!("error" in r)) {
        setLogged((prev) => new Set(prev).add(legislatorId));
      }
    });
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
        {callable.map((t) => {
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
                    onClick={() => logCall(t.id)}
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
            </li>
          );
        })}
      </ul>

      <p className="mt-3 text-xs text-zinc-500">
        Tap a number to dial. After hanging up, hit &quot;I called&quot; so it
        counts toward platform impact stats.
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
