"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { draftOfficialEmail, getComposePrefill, logOfficialContact } from "./actions";
import { buildDefaultLetter } from "./default-letter";
import {
  buildGmailComposeUrl,
  buildMailtoUrl,
  buildOutlookComposeUrl,
  httpUrlOrNull,
  isContactFormUrl,
} from "./send-links";
import type { ComposeOfficial, ComposeContext } from "./types";

/**
 * The uniform email composer behind every "✉ Email" CTA. One feature set,
 * platform-wide: instant prefilled letter, ✨ AI draft (free-tier router),
 * in-app editing, mailto / Gmail / Outlook / copy delivery, contact-form
 * fallback when the office has no public inbox, and best-effort send logging.
 */
export function ComposeModal({
  open,
  onClose,
  official,
  context,
  source,
}: {
  open: boolean;
  onClose: () => void;
  official: ComposeOfficial;
  context?: ComposeContext;
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
  const [, startTransition] = useTransition();

  // Channel resolution: real inbox → normal compose; email column holding an
  // http URL → contact-form flow; no email but a website → website flow
  // (copy message + open their site and find the contact page).
  const isForm = isContactFormUrl(official.email);
  // Website channel must be a real http(s) link — never let a javascript:/data:
  // URL from a synced/admin-editable row become a clickable href.
  const safeWebsite = httpUrlOrNull(official.website);
  const websiteOnly = !official.email && !!safeWebsite;
  const formUrl = isForm ? official.email : websiteOnly ? safeWebsite : null;
  const to = !isForm && official.email ? official.email : "";

  // Prefill on open — one server round-trip merges the viewer's profile
  // into the deterministic default letter (generic letter when signed out).
  // A rejected server action (client-side network failure) can't be caught
  // by the action's own try/catch, so guard here: on failure fall back to a
  // client-built generic letter rather than hanging on "Preparing…" forever.
  useEffect(() => {
    if (!open || loaded) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await getComposePrefill({
          official: officialInput(official),
          billId: context?.billId ?? null,
          kind: context?.kind,
          stance: context?.stance ?? null,
          ask: context?.ask ?? null,
        });
        if (cancelled) return;
        setSubject(r.subject);
        setBody(r.body);
        setSignedIn(r.signedIn);
        setHasStory(r.hasStory);
      } catch {
        if (cancelled) return;
        const fb = buildDefaultLetter({
          official: {
            full_name: official.name,
            role: official.role ?? null,
            title: official.title ?? null,
            state: official.state ?? null,
          },
          sender: {},
          // Preserve the client-held posture + ask (bill number/title can't be
          // reconstructed here, but stance/ask are cheap to keep).
          context: context?.kind
            ? { kind: context.kind, stance: context.stance ?? null, ask: context.ask ?? null }
            : null,
        });
        setSubject(fb.subject);
        setBody(fb.body);
        setSignedIn(false);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [open, loaded, official, context]);

  // Esc to close
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  function aiDraft() {
    setError(null);
    setDraftNote(null);
    setDrafting(true);
    (async () => {
      try {
        const r = await draftOfficialEmail({
          official: officialInput(official),
          billId: context?.billId ?? null,
          kind: context?.kind,
          stance: context?.stance ?? null,
          ask: context?.ask ?? null,
          tone,
        });
        if (!r.ok) {
          setError(r.error);
        } else {
          setSubject(r.subject);
          setBody(r.body);
          setDraftNote(
            r.provider === "template"
              ? "AI was busy — here's a fresh template instead. Edit away."
              : `✨ Drafted in your voice (${r.provider}). Review + tweak before sending.`,
          );
        }
      } catch {
        setError("Drafting failed — check your connection and try again.");
      } finally {
        setDrafting(false);
      }
    })();
  }

  function logSend(via: string) {
    setSentVia(via);
    // One letter = one logged action, no matter how many delivery buttons the
    // user tries (Gmail → mailto → copy). Without this guard each click would
    // insert another campaign_actions row, inflating counts/badges and the
    // public scoreboard. Reset per modal-open (component remounts on open).
    if (loggedRef.current) return;
    loggedRef.current = true;
    startTransition(() => {
      // Best-effort — the compose window already opened client-side.
      logOfficialContact({
        officialId: official.id ?? null,
        source,
        subject,
        body,
      }).catch(() => {});
    });
  }

  async function copyMessage() {
    try {
      const text = `${to ? `To: ${to}\n` : ""}Subject: ${subject}\n\n${body}`;
      await navigator.clipboard.writeText(text);
      setCopied(true);
      logSend("copy");
      setTimeout(() => setCopied(false), 4000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label={`Email ${official.name}`}
    >
      <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-xl border border-zinc-800 bg-zinc-950 p-5 sm:max-w-lg sm:rounded-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-zinc-100">
              {formUrl ? "Contact" : "Email"} {official.name}
            </h2>
            {to && <p className="mt-0.5 font-mono text-[11px] text-emerald-300">{to}</p>}
            {isForm && (
              <p className="mt-0.5 text-[11px] text-amber-300">
                This office only takes messages through its web contact form.
              </p>
            )}
            {websiteOnly && (
              <p className="mt-0.5 text-[11px] text-amber-300">
                This office publishes no public inbox — send your message through their official site.
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded px-2 py-1 text-zinc-400 hover:text-zinc-200"
          >
            ✕
          </button>
        </div>

        {!loaded ? (
          <p className="mt-6 text-sm text-zinc-400">Preparing your letter…</p>
        ) : (
          <>
            {/* AI draft row — identical on every surface */}
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
                title={
                  signedIn
                    ? "Drafts this email in your voice using your kratom story (from /account/character)"
                    : "Sign in to use AI drafting"
                }
                className="rounded-md border border-emerald-700/40 bg-emerald-950/20 px-2.5 py-1.5 text-xs text-emerald-300 hover:border-emerald-500 disabled:opacity-50"
              >
                {drafting ? "✨ Drafting…" : "✨ Draft with AI"}
              </button>
              {!signedIn && (
                <a href="/login" className="text-[11px] text-emerald-400 hover:underline">
                  Sign in to auto-fill your name + use AI →
                </a>
              )}
              {signedIn && !hasStory && (
                <a href="/account/character" className="text-[11px] text-zinc-400 hover:text-emerald-300 hover:underline">
                  Add your kratom story to make AI drafts sound like you →
                </a>
              )}
            </div>
            {draftNote && (
              <p className="mt-2 rounded-md border border-emerald-700/40 bg-emerald-950/10 p-2 text-xs text-emerald-300">{draftNote}</p>
            )}
            {error && (
              <p className="mt-2 rounded-md border border-amber-700/40 bg-amber-950/10 p-2 text-xs text-amber-300">{error}</p>
            )}

            {/* Editor — always visible; the letter is meant to be made yours */}
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

            {/* Delivery — contact-form/website flow or the standard trio + copy */}
            {formUrl ? (
              <div className="mt-4 space-y-2">
                <button
                  onClick={copyMessage}
                  className="w-full rounded-md bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-emerald-400"
                >
                  {copied ? "✓ Copied — now paste it there" : "1 · Copy your message"}
                </button>
                <a
                  href={formUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => logSend("contact_form")}
                  className="block w-full rounded-md border border-emerald-700/50 bg-emerald-950/20 px-4 py-2.5 text-center text-sm font-semibold text-emerald-300 hover:border-emerald-500"
                >
                  {isForm ? "2 · Open the contact form ↗" : "2 · Open their site — find the contact page ↗"}
                </a>
              </div>
            ) : (
              <div className="mt-4">
                <div className="grid gap-2 sm:grid-cols-3">
                  <SendLink
                    href={buildGmailComposeUrl(to, subject, body)}
                    newTab
                    label="Open in Gmail"
                    sub="Web compose"
                    onClick={() => logSend("gmail")}
                    done={sentVia === "gmail"}
                  />
                  <SendLink
                    href={buildOutlookComposeUrl(to, subject, body)}
                    newTab
                    label="Open in Outlook"
                    sub="Web compose"
                    onClick={() => logSend("outlook")}
                    done={sentVia === "outlook"}
                  />
                  <SendLink
                    href={buildMailtoUrl(to, subject, body)}
                    label="Default email app"
                    sub="Gmail app / Mail"
                    onClick={() => logSend("mailto")}
                    done={sentVia === "mailto"}
                  />
                </div>
                <button
                  onClick={copyMessage}
                  className="mt-2 w-full rounded-md border border-zinc-800 bg-zinc-950/60 px-4 py-2 text-sm text-zinc-300 hover:border-emerald-500 hover:text-emerald-300"
                >
                  {copied ? "✓ Copied — paste anywhere" : "Or copy the whole message"}
                </button>
              </div>
            )}

            {sentVia && sentVia !== "copy" && !formUrl && (
              <p className="mt-3 rounded-md border border-emerald-900/40 bg-emerald-950/30 px-3 py-2 text-center text-sm text-emerald-300">
                ✓ Compose window opened. Hit Send in there to add your voice to the record.
              </p>
            )}
            <p className="mt-3 text-center text-[11px] text-zinc-500">
              The email comes from <em>your</em> address — what officials actually read.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function officialInput(o: ComposeOfficial) {
  return {
    officialId: o.id ?? null,
    officialName: o.name,
    role: o.role ?? null,
    title: o.title ?? null,
    state: o.state ?? null,
  };
}

function SendLink({
  href,
  newTab,
  label,
  sub,
  onClick,
  done,
}: {
  href: string;
  newTab?: boolean;
  label: string;
  sub: string;
  onClick: () => void;
  done?: boolean;
}) {
  return (
    <a
      href={href}
      target={newTab ? "_blank" : undefined}
      rel={newTab ? "noopener noreferrer" : undefined}
      onClick={onClick}
      className={`group flex flex-col items-center gap-0.5 rounded-md px-3 py-3 text-center transition ${
        done
          ? "bg-emerald-700 text-zinc-950"
          : "border border-zinc-700 text-zinc-200 hover:border-emerald-500 hover:bg-zinc-950"
      }`}
    >
      <span className="text-sm font-semibold">{done ? "✓ " : ""}{label}</span>
      <span className={`text-[11px] ${done ? "text-zinc-900/70" : "text-zinc-500"}`}>{sub}</span>
    </a>
  );
}
