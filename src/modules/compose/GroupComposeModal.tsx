"use client";

import { useEffect, useRef, useState } from "react";
import { draftOfficialEmail, getComposePrefill, logOfficialContact } from "./actions";
import { buildDefaultLetter } from "./default-letter";
import {
  buildGmailComposeUrl,
  buildMailtoUrl,
  buildOutlookComposeUrl,
  mailtoWithinLimit,
} from "./send-links";
import { EmailOfficialButton } from "./EmailOfficialButton";
import type { ComposeGroup } from "./types";

/**
 * Group email composer — one AI-assisted letter addressed to a whole group of
 * officials (all Representatives / all Senators / the executive trio) for a
 * bill. Reuses the exact same drafting backend as the single-official
 * ComposeModal (getComposePrefill / draftOfficialEmail), so the "✨ Draft with
 * AI + your story" experience is identical everywhere.
 *
 * Delivery: the batchable inboxes go into one compose — first in `to`, the rest
 * BCC'd (privacy + no reply-all storm). Gmail/Outlook web are the primary
 * buttons (they handle long recipient lists); the default-app mailto is offered
 * only when the URL stays under the ~2000-char client limit, else we steer to
 * copy. Officials with only a webform are listed separately, each contacted via
 * the shared single-official contact-form flow.
 */
export function GroupComposeModal({
  open,
  onClose,
  group,
  billId,
  stance,
  source,
}: {
  open: boolean;
  onClose: () => void;
  group: ComposeGroup;
  billId: string;
  stance?: "oppose" | "support" | "improve" | "neutral" | null;
  source: string;
}) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [hasStory, setHasStory] = useState(false);
  const [tone, setTone] = useState<"personal" | "formal" | "urgent">("personal");
  const [drafting, setDrafting] = useState(false);
  const [draftNote, setDraftNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sentVia, setSentVia] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const loggedRef = useRef(false);

  // A synthetic "official" standing in for the whole group so the shared
  // drafting backend produces a group-addressed letter ("Dear Members of the
  // Michigan House of Representatives,") with no code fork.
  const groupOfficial = {
    officialId: null,
    officialName: group.greeting,
    role: null,
    title: null,
    state: group.emailable[0]?.state ?? group.formOnly[0]?.state ?? null,
  };

  const emails = group.emailable.map((o) => o.email!).filter(Boolean);
  const to = emails[0] ?? "";
  const bcc = emails.slice(1).join(",");

  useEffect(() => {
    if (!open || loaded) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await getComposePrefill({
          official: groupOfficial,
          billId,
          kind: "bill",
          stance: stance ?? null,
        });
        if (cancelled) return;
        setSubject(r.subject);
        setBody(r.body);
        setSignedIn(r.signedIn);
        setHasStory(r.hasStory);
      } catch {
        if (cancelled) return;
        const fb = buildDefaultLetter({
          official: { full_name: group.greeting, role: null, title: null, state: groupOfficial.state },
          sender: {},
          context: { kind: "bill", stance: stance ?? null },
        });
        setSubject(fb.subject);
        setBody(fb.body);
        setSignedIn(false);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loaded]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  function aiDraft() {
    setError(null); setDraftNote(null); setDrafting(true);
    (async () => {
      try {
        const r = await draftOfficialEmail({
          official: groupOfficial, billId, kind: "bill", stance: stance ?? null, tone,
        });
        if (!r.ok) setError(r.error);
        else {
          setSubject(r.subject); setBody(r.body);
          setDraftNote(
            r.provider === "template"
              ? "AI was busy — here's a fresh template instead. Edit away."
              : `✨ Drafted in your voice (${r.provider}). Review + tweak before sending.`,
          );
        }
      } catch {
        setError("Drafting failed — check your connection and try again.");
      } finally { setDrafting(false); }
    })();
  }

  function logSend(via: string) {
    setSentVia(via);
    if (loggedRef.current) return;
    loggedRef.current = true;
    // One summary row per group send (legislator_id null → no per-member point
    // farming; a group click counts as a single action). Best-effort.
    logOfficialContact({ officialId: null, source, subject, body }).catch(() => {});
  }

  async function copyAll() {
    try {
      const header = emails.length ? `To: ${emails.join(", ")}\n` : "";
      await navigator.clipboard.writeText(`${header}Subject: ${subject}\n\n${body}`);
      setCopied(true);
      logSend("copy");
      setTimeout(() => setCopied(false), 4000);
    } catch { setCopied(false); }
  }

  const mailtoUrl = buildMailtoUrl(to, subject, body, bcc);
  const mailtoOk = mailtoWithinLimit(mailtoUrl);
  const total = group.emailable.length + group.formOnly.length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label={`Email ${group.label}`}
    >
      <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-xl border border-zinc-800 bg-zinc-950 p-5 sm:max-w-lg sm:rounded-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-zinc-100">{group.label}</h2>
            <p className="mt-0.5 text-[11px] text-zinc-400">
              {group.emailable.length > 0 ? (
                <>Emailing <span className="text-emerald-300">{group.emailable.length}</span> of {total}
                {group.formOnly.length > 0 && <> — {group.formOnly.length} take web forms only (below)</>}.</>
              ) : (
                <>These {total} office{total === 1 ? "" : "s"} only take web messages — send individually below.</>
              )}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded px-2 py-1 text-zinc-400 hover:text-zinc-200">✕</button>
        </div>

        {!loaded ? (
          <p className="mt-6 text-sm text-zinc-400">Preparing your letter…</p>
        ) : (
          <>
            {/* AI draft row — identical to the single-official composer */}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <select
                value={tone}
                onChange={(e) => setTone(e.target.value as typeof tone)}
                className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200"
                aria-label="Tone"
              >
                <option value="personal">Personal tone</option>
                <option value="formal">Formal / policy tone</option>
                <option value="urgent">Urgent / action tone</option>
              </select>
              <button
                type="button"
                onClick={aiDraft}
                disabled={drafting || !signedIn}
                title={signedIn ? "Drafts this in your voice using your kratom story (from /account/character)" : "Sign in to use AI drafting"}
                className="rounded-md border border-emerald-700/40 bg-emerald-950/20 px-2.5 py-1.5 text-xs text-emerald-300 hover:border-emerald-500 disabled:opacity-50"
              >
                {drafting ? "✨ Drafting…" : "✨ Draft with AI"}
              </button>
              {!signedIn && (
                <a href="/login" className="text-[11px] text-emerald-400 hover:underline">Sign in to auto-fill your name + use AI →</a>
              )}
              {signedIn && !hasStory && (
                <a href="/account/character" className="text-[11px] text-zinc-400 hover:text-emerald-300 hover:underline">Add your kratom story to personalize AI drafts →</a>
              )}
            </div>
            {draftNote && <p className="mt-2 rounded-md border border-emerald-700/40 bg-emerald-950/10 p-2 text-xs text-emerald-300">{draftNote}</p>}
            {error && <p className="mt-2 rounded-md border border-amber-700/40 bg-amber-950/10 p-2 text-xs text-amber-300">{error}</p>}

            {group.emailable.length > 0 && (
              <>
                <div className="mt-3 space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-zinc-400">Subject</label>
                    <input
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      maxLength={200}
                      className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-400">Message</label>
                    <textarea
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      rows={10}
                      maxLength={4000}
                      className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
                    />
                    <p className="mt-1 text-xs text-zinc-500">
                      A sentence about why this matters to you doubles your impact. Your street address is never included.
                    </p>
                  </div>
                </div>

                {/* Delivery — Gmail/Outlook primary (handle long recipient lists) */}
                <div className="mt-4">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <SendLink href={buildGmailComposeUrl(to, subject, body, bcc)} label="Open in Gmail" sub="Web compose" onClick={() => logSend("gmail")} done={sentVia === "gmail"} />
                    <SendLink href={buildOutlookComposeUrl(to, subject, body, bcc)} label="Open in Outlook" sub="Web compose" onClick={() => logSend("outlook")} done={sentVia === "outlook"} />
                  </div>
                  {mailtoOk ? (
                    <a
                      href={mailtoUrl}
                      onClick={() => logSend("mailto")}
                      className={`mt-2 block w-full rounded-md border px-4 py-2 text-center text-sm ${sentVia === "mailto" ? "border-emerald-600 bg-emerald-700 text-zinc-950" : "border-zinc-700 text-zinc-200 hover:border-emerald-500"}`}
                    >
                      {sentVia === "mailto" ? "✓ " : ""}Open in default email app
                    </a>
                  ) : (
                    <p className="mt-2 rounded-md border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-center text-[11px] text-zinc-500">
                      Too many recipients for the default mail app — use Gmail/Outlook above, or copy below.
                    </p>
                  )}
                  <button
                    onClick={copyAll}
                    className="mt-2 w-full rounded-md border border-zinc-800 bg-zinc-950/60 px-4 py-2 text-sm text-zinc-300 hover:border-emerald-500 hover:text-emerald-300"
                  >
                    {copied ? "✓ Copied — all addresses + message" : "Or copy all addresses + the message"}
                  </button>
                </div>
                {sentVia && sentVia !== "copy" && (
                  <p className="mt-3 rounded-md border border-emerald-900/40 bg-emerald-950/30 px-3 py-2 text-center text-sm text-emerald-300">
                    ✓ Compose window opened. Hit Send there to deliver it — from <em>your</em> address.
                  </p>
                )}
                <p className="mt-2 text-center text-[11px] text-zinc-500">
                  First recipient is in To, the rest BCC&apos;d — no reply-all storm, and the email comes from your address.
                </p>
              </>
            )}

            {/* Web-form / no-inbox officials — contacted one at a time */}
            {group.formOnly.length > 0 && (
              <div className="mt-5 rounded-lg border border-amber-800/40 bg-amber-950/10 p-3">
                <p className="text-[11px] font-bold uppercase tracking-widest text-amber-300">
                  {group.formOnly.length} take web contact only
                </p>
                <p className="mt-1 text-xs text-zinc-400">
                  No public inbox — draft above, copy, then open each office&apos;s form.
                </p>
                <ul className="mt-2 space-y-1.5">
                  {group.formOnly.map((o) => (
                    <li key={o.id ?? o.name} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-zinc-800 bg-zinc-950/60 px-3 py-1.5">
                      <span className="text-xs text-zinc-200">{o.title ?? o.name}</span>
                      <EmailOfficialButton
                        official={o}
                        context={{ kind: "bill", billId, stance: stance ?? null }}
                        source={`${source}_form`}
                        variant="inline"
                      />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SendLink({ href, label, sub, onClick, done }: { href: string; label: string; sub: string; onClick: () => void; done?: boolean }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onClick}
      className={`group flex flex-col items-center gap-0.5 rounded-md px-3 py-3 text-center transition ${done ? "bg-emerald-700 text-zinc-950" : "border border-zinc-700 text-zinc-200 hover:border-emerald-500 hover:bg-zinc-950"}`}
    >
      <span className="text-sm font-semibold">{done ? "✓ " : ""}{label}</span>
      <span className={`text-[11px] ${done ? "text-zinc-900/70" : "text-zinc-500"}`}>{sub}</span>
    </a>
  );
}
