"use client";

import { useState } from "react";
import type { Legislator } from "@/lib/legislators";
import { ROLE_SHORT } from "@/lib/legislators";
import { EmailOfficialButton } from "@/modules/compose/EmailOfficialButton";

// Domains we know parking-page squat — Gemini sometimes hallucinates
// council-member URLs that resolve to these. Treat as no-website.
const PARKED_DOMAINS = [
  "hugedomains.com",
  "sedoparking.com",
  "dan.com",
  "godaddy.com/forsale",
  "parkingcrew.net",
  "afternic.com",
  "uniregistry.com",
];

function isUsableUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (!u.protocol.startsWith("http")) return false;
    const host = u.hostname.toLowerCase();
    if (PARKED_DOMAINS.some((p) => host.endsWith(p) || host.includes(p))) return false;
    return true;
  } catch {
    return false;
  }
}

// Default visible per-official cards before "Show more N" toggle.
// Tuned for one mobile screen.
const DEFAULT_VISIBLE_OFFICIALS = 6;

/**
 * LocalActionPlaybook — the answer to "campaign page is empty because
 * small-town officials don't publish per-member email/phone."
 *
 * Renders for city/county-scoped campaigns where most/all targets only
 * have a website (typical of small jurisdictions). Surfaces every
 * actionable thing we DO have:
 *
 *   1. Copy-paste message (the email body) so users can drop it into
 *      whatever contact form / personal-email / Facebook message they
 *      use to reach the official.
 *   2. City hall contact block — generic phone, generic email, mailing
 *      address, contact form URL — pulled from bills.local_meta.city_general
 *      (seeded by seed-bill-officials.mjs).
 *   3. Meeting / hearing info — when, where, Zoom link, public-comment
 *      deadline — from bills.local_meta extracted_at fields.
 *   4. Per-official cards with "Open contact form →" buttons that link
 *      to the official's website (only field we reliably have).
 *   5. Talking points (computed client-side from the body).
 *
 * Renders only when the campaign is local-scoped AND most/all targets
 * lack email+phone. State/federal campaigns with normal contact info
 * keep using the standard CampaignAction flow.
 */
export type CityGeneral = {
  name?: string | null;
  general_phone?: string | null;
  general_email?: string | null;
  contact_form_url?: string | null;
  mailing_address?: string | null;
  council_meeting_url?: string | null;
  official_website?: string | null;
};

export type LocalMeta = {
  city_general?: CityGeneral | null;
  summary_one_line?: string | null;
  // Fields populated by extract-local-meta.mjs (subset)
  meeting_at?: string | null;
  meeting_address?: string | null;
  meeting_zoom_url?: string | null;
  meeting_phone?: string | null;
  public_comment_email?: string | null;
  public_comment_deadline?: string | null;
  official_status?: string | null;
};

export function LocalActionPlaybook({
  campaignTitle,
  bodyTemplate,
  targets,
  localMeta,
  locality,
}: {
  campaignTitle: string;
  bodyTemplate: string;
  targets: Legislator[];
  localMeta: LocalMeta | null;
  locality: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const [showAllOfficials, setShowAllOfficials] = useState(false);

  const cg = localMeta?.city_general ?? null;
  const meetingAt = localMeta?.meeting_at;
  const meetingZoom = localMeta?.meeting_zoom_url;
  const meetingPhone = localMeta?.meeting_phone;
  const meetingAddress = localMeta?.meeting_address;
  const publicCommentEmail = localMeta?.public_comment_email;
  const publicCommentDeadline = localMeta?.public_comment_deadline;
  const enacted = localMeta?.official_status === "enacted";

  // Substitute obvious template placeholders that don't apply to
  // contact-form pasting. Leaves intentional placeholders intact so
  // the user fills them in (full_name, city, state).
  const pasteableBody = bodyTemplate
    .replace(/\{\{recipient_title\}\}\s*/g, "")
    .replace(/\{\{recipient_last_name\}\}/g, "Mayor / Council Member");

  const talkingPoints = extractTalkingPoints(pasteableBody, 5);

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(pasteableBody);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // older browsers — fall through
    }
  }

  return (
    <section className="mb-6 rounded-lg border border-emerald-700/40 bg-emerald-950/10 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-widest text-emerald-300">
          📍 Local action playbook
        </p>
        {locality && (
          <span className="text-xs text-zinc-500">
            for {locality}
          </span>
        )}
      </div>

      {enacted ? (
        <p className="mt-2 text-sm text-amber-200">
          This ordinance is <strong>already in effect</strong>. The action below is to
          <em> push for repeal or amendment</em> — and to make sure the next ordinance
          like this in your area gets stopped before it passes.
        </p>
      ) : (
        <p className="mt-2 text-sm text-zinc-300">
          Small-town officials usually don&apos;t publish per-member emails — but they
          all read what comes through their contact form, voicemail, and city hall
          inbox. Here&apos;s how to make sure your message lands.
        </p>
      )}

      {/* Step 1 — Copy the message */}
      <div className="mt-5 rounded-md border border-zinc-800 bg-zinc-950/60 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
            1. Copy your message
          </p>
          <button
            onClick={copyMessage}
            className="rounded-md bg-emerald-500 px-3 py-1 text-xs font-semibold text-zinc-950 hover:bg-emerald-400"
          >
            {copied ? "✓ Copied" : "Copy message"}
          </button>
        </div>
        <pre className="mt-2 max-h-60 overflow-y-auto whitespace-pre-wrap rounded border border-zinc-900 bg-zinc-950 p-3 font-sans text-xs leading-relaxed text-zinc-300">
{pasteableBody}
        </pre>
        <p className="mt-2 text-[11px] text-zinc-500">
          Replace <span className="font-mono text-zinc-300">{"{{full_name}}"}</span>,{" "}
          <span className="font-mono text-zinc-300">{"{{city}}"}</span>, and{" "}
          <span className="font-mono text-zinc-300">{"{{state}}"}</span> with your own
          info before sending.
        </p>
      </div>

      {/* Step 2 — Where to send it */}
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {cg && (cg.general_phone || cg.general_email || cg.contact_form_url || cg.mailing_address) && (
          <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
              2a. {cg.name ?? "City hall"}
            </p>
            <ul className="mt-2 space-y-2 text-sm">
              {cg.general_phone && (
                <li>
                  <span className="text-zinc-500">📞 Phone</span>{" "}
                  <a href={`tel:${cg.general_phone}`} className="font-mono text-amber-300 hover:underline">
                    {cg.general_phone}
                  </a>
                </li>
              )}
              {cg.general_email && (
                <li>
                  <span className="text-zinc-500">✉ Email</span>{" "}
                  <a href={`mailto:${cg.general_email}?subject=${encodeURIComponent("Re: " + campaignTitle)}`} className="text-emerald-300 hover:underline">
                    {cg.general_email}
                  </a>
                </li>
              )}
              {cg.contact_form_url && (
                <li>
                  <a
                    href={cg.contact_form_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-400"
                  >
                    Open contact form →
                  </a>
                </li>
              )}
              {cg.mailing_address && (
                <li>
                  <span className="text-zinc-500">✉ Mail</span>{" "}
                  <span className="text-zinc-300">{cg.mailing_address}</span>
                </li>
              )}
              {cg.official_website && !cg.contact_form_url && (
                <li>
                  <a
                    href={cg.official_website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-emerald-400 hover:underline text-xs"
                  >
                    🌐 {cg.official_website}
                  </a>
                </li>
              )}
            </ul>
          </div>
        )}

        {/* Meeting / hearing info if we have it */}
        {(meetingAt || meetingZoom || meetingAddress || publicCommentDeadline) && (
          <div className="rounded-md border border-amber-700/40 bg-amber-950/10 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-amber-300">
              2b. Show up at the meeting
            </p>
            <ul className="mt-2 space-y-2 text-sm">
              {meetingAt && (
                <li>
                  <span className="text-zinc-500">📅 When</span>{" "}
                  <span className="text-zinc-200">{new Date(meetingAt).toLocaleString()}</span>
                </li>
              )}
              {meetingAddress && (
                <li>
                  <span className="text-zinc-500">📍 Where</span>{" "}
                  <span className="text-zinc-200">{meetingAddress}</span>
                </li>
              )}
              {meetingZoom && (
                <li>
                  <a
                    href={meetingZoom}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-amber-400"
                  >
                    Join Zoom →
                  </a>
                </li>
              )}
              {meetingPhone && (
                <li>
                  <span className="text-zinc-500">📞 Dial-in</span>{" "}
                  <a href={`tel:${meetingPhone}`} className="font-mono text-amber-300 hover:underline">
                    {meetingPhone}
                  </a>
                </li>
              )}
              {publicCommentEmail && (
                <li>
                  <span className="text-zinc-500">✉ Public comment</span>{" "}
                  <a
                    href={`mailto:${publicCommentEmail}?subject=${encodeURIComponent("Public comment: " + campaignTitle)}`}
                    className="text-emerald-300 hover:underline"
                  >
                    {publicCommentEmail}
                  </a>
                </li>
              )}
              {publicCommentDeadline && (
                <li className="text-xs text-amber-200">
                  ⏰ Comments due by {new Date(publicCommentDeadline).toLocaleString()}
                </li>
              )}
            </ul>
          </div>
        )}
      </div>

      {/* Step 3 — Per-official cards. Card is NOT a wrapping anchor —
          parked-domain risk + makes inner buttons unreachable on mobile.
          Each contact action is its own clickable element with a known
          target. URLs are validated to skip parking pages. */}
      {targets.length > 0 && (
        <div className="mt-4 rounded-md border border-zinc-800 bg-zinc-950/60 p-4">
          <details open className="group">
            <summary className="flex cursor-pointer items-center justify-between text-xs font-semibold uppercase tracking-wider text-zinc-300">
              <span>3. Reach individual officials directly ({targets.length})</span>
              <span className="text-[10px] font-normal normal-case text-zinc-500 group-open:hidden">click to expand</span>
              <span className="text-[10px] font-normal normal-case text-zinc-500 hidden group-open:inline">click to collapse</span>
            </summary>
            <p className="mt-2 text-[11px] text-zinc-500">
              Email or call where it&apos;s published. Otherwise, &quot;Open contact form&quot;
              opens the official&apos;s page where you can paste the message you copied above.
            </p>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {(showAllOfficials ? targets : targets.slice(0, DEFAULT_VISIBLE_OFFICIALS)).map((t) => {
                const websiteOk = isUsableUrl(t.website);
                const hasAnyContact = !!t.email || !!t.phone || websiteOk;
                return (
                  <li
                    key={t.id}
                    className={`rounded-md border p-3 text-sm ${
                      hasAnyContact
                        ? "border-zinc-800 bg-zinc-950"
                        : "border-zinc-900 bg-zinc-950/40 opacity-70"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] uppercase text-zinc-400">
                        {ROLE_SHORT[t.role] ?? t.role}
                      </span>
                      <span className="font-semibold text-zinc-100">{t.full_name}</span>
                    </div>
                    {t.district && (
                      <p className="mt-1 text-[11px] text-zinc-500">District/Ward: {t.district}</p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                      {(t.email || websiteOk) && (
                        <EmailOfficialButton
                          official={{
                            id: t.id,
                            name: t.full_name,
                            role: t.role,
                            title: t.title ?? null,
                            state: t.state,
                            email: t.email,
                            // Only hand the composer a website we've vetted (isUsableUrl
                            // filters parked/squatter domains); the bare-link fallback
                            // below still covers the unusable-website case.
                            website: websiteOk ? t.website ?? null : null,
                          }}
                          context={{ kind: "local" }}
                          source="local_playbook"
                          variant="chip"
                        />
                      )}
                      {t.phone && (
                        <a
                          href={`tel:${t.phone}`}
                          className="rounded bg-amber-950/40 px-2 py-1 font-mono text-amber-300 hover:bg-amber-950"
                        >
                          📞 {t.phone}
                        </a>
                      )}
                      {!t.email && !t.phone && t.website && !websiteOk && (
                        <span
                          className="rounded bg-zinc-900 px-2 py-1 text-zinc-500"
                          title={`URL was flagged as a parked/squatted domain: ${t.website}`}
                        >
                          ⚠ Website unreliable
                        </span>
                      )}
                      {!hasAnyContact && (
                        <span className="rounded bg-zinc-900 px-2 py-1 text-zinc-500">
                          No contact info published
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            {targets.length > DEFAULT_VISIBLE_OFFICIALS && (
              <button
                onClick={() => setShowAllOfficials((v) => !v)}
                className="mt-3 w-full rounded-md border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:border-emerald-500"
              >
                {showAllOfficials
                  ? `Show fewer ↑`
                  : `Show all ${targets.length} (${targets.length - DEFAULT_VISIBLE_OFFICIALS} more) ↓`}
              </button>
            )}
          </details>
        </div>
      )}

      {/* Step 4 — Talking points */}
      {talkingPoints.length > 0 && (
        <details className="mt-4 rounded-md border border-zinc-800 bg-zinc-950/60 p-4">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-zinc-300">
            4. Talking points (open if calling)
          </summary>
          <ol className="mt-3 space-y-2 text-sm text-zinc-200">
            {talkingPoints.map((p, i) => (
              <li key={i} className="flex gap-2">
                <span className="font-mono text-emerald-400">{i + 1}.</span>
                <span>{p}</span>
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}

function extractTalkingPoints(body: string, max: number): string[] {
  if (!body) return [];
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const skip = [
    /^dear\b/i,
    /^my name is\b/i,
    /^thank you/i,
    /^sincerely/i,
    /^regards/i,
    /\{\{[a-z_]+\}\}/i,
  ];
  const points: string[] = [];
  for (const p of paragraphs) {
    if (skip.some((re) => re.test(p))) continue;
    const m = p.match(/^([^.!?]+[.!?])/);
    const sentence = (m?.[1] ?? p).trim();
    if (sentence.length < 20 || sentence.length > 240) continue;
    points.push(sentence);
    if (points.length >= max) break;
  }
  return points;
}
