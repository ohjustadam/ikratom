"use client";

import { useEffect, useState, useTransition } from "react";
import type { Legislator } from "@/lib/legislators";
import { ROLE_SHORT } from "@/lib/legislators";
import { logCampaignAction } from "../actions";
import { groupVars, recipientVars, renderTemplate, unfilledPlaceholders } from "../templates";
import { personalizeCampaignBody } from "../actions-personalize";
import { CallActionPanel } from "./CallActionPanel";
import { AttachmentRecorder } from "./AttachmentRecorder";
import { RecipientChips, type TargetIntelSignal } from "./RecipientChips";
import { appendClipLine, withLetterFooter } from "../letter-extras";
import { RetryDistrictsButton } from "@/components/RetryDistrictsButton";
import { EmailOfficialButton } from "@/modules/compose/EmailOfficialButton";
import { SendBatchPanel } from "./SendBatchPanel";
import { UseAdmissionWarning } from "./UseAdmissionWarning";
import { findUseAdmissions } from "@/lib/use-admission";
import { checkLetter } from "../send-batch-actions";
import { EmailSafetyNote } from "@/components/EmailSafetyNote";
import { makeRecordNonce, recordAddress, withRecordBcc } from "@/lib/send-record";
import { SendRecordNotice } from "./SendRecordNotice";
import Link from "@/components/Link";
import {
  groupByRole,
  defaultCollapsed,
  togglePicked,
  setGroupPicked,
  buildTargetsParam,
} from "../picker-logic";

type SendMethod = "mailto" | "gmail" | "outlook" | "copy" | "platform_gmail";

export type { TargetIntelSignal } from "./RecipientChips";

export function CampaignAction({
  campaignId,
  billId,
  targets,
  targetIntel,
  targetRoles,
  userState,
  campaignState,
  userCity,
  userCounty,
  campaignLocality,
  gmailConnected,
  gmailEmail,
  alreadySentLegislatorIds,
  lastSentAt,
  initialSubject,
  initialBody,
  hasStreet,
  hasDistricts,
  pickableStateReps,
  campaignSlug,
  emailNeedsReconnect,
  safeModeState,
}: {
  campaignId: string;
  /** The campaign's bill (if any) — grounds the fallback composer's draft. */
  billId?: string | null;
  targets: Legislator[];
  targetIntel?: Record<string, TargetIntelSignal>;
  targetRoles: string[];
  userState: string | null;
  campaignState: string | null;
  userCity?: string | null;
  userCounty?: string | null;
  campaignLocality?: string | null;
  bodyTemplate: string;
  gmailConnected: boolean;
  gmailEmail: string | null;
  alreadySentLegislatorIds: string[];
  lastSentAt: string | null;
  initialSubject: string;
  initialBody: string;
  /** True if the user has a saved street address. Drives the gating
   *  copy: "missing address" vs "address present but districts unknown". */
  hasStreet: boolean;
  /** True if the user has at least one of US house / state senate /
   *  state house district fields populated. */
  hasDistricts: boolean;
  /** When districts can't be auto-detected (Census gap), this is the
   *  list of state-level legislators in the user's state matching the
   *  campaign's target_roles. User picks manually → ?manual_targets=... */
  pickableStateReps: Legislator[];
  /** Campaign slug for building the ?manual_targets URL. */
  campaignSlug: string;
  /** True when a prior email connection exists but its OAuth token was revoked
   *  (invalid_grant) — prompt a reconnect rather than a first-time connect. */
  emailNeedsReconnect?: boolean;
  /** The member's state name while banned-state safe mode is on (0275). */
  safeModeState?: string | null;
}) {
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);
  // Safe mode opens the editor when the letter already says "I use kratom",
  // so the warning (which lives in the editor) can't be missed.
  const [editing, setEditing] = useState(
    () => !!safeModeState && findUseAdmissions(`${initialSubject}\n${initialBody}`).length > 0,
  );
  const [sentVia, setSentVia] = useState<SendMethod | null>(null);
  const [copied, setCopied] = useState(false);
  // B9: the external compose paths BCC a send-record copy unless the member opts out.
  const [keepCopy, setKeepCopy] = useState(true);
  const [personalizing, setPersonalizing] = useState(false);
  const [personalizeError, setPersonalizeError] = useState<string | null>(null);
  const [personalizeChanges, setPersonalizeChanges] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [screenRes, setScreenRes] = useState<{ key: string; ok: boolean; message: string } | null>(null);

  // Screen the member's own edits while they type (owner rules 2026-10-22,
  // screen-content.ts). An unedited letter is the campaign's own text, which
  // was screened when the campaign was authored. The queue re-checks on Send.
  // The status is DERIVED from which text was last checked, so the effect only
  // sets state from its async callback.
  const edited = subject !== initialSubject || body !== initialBody;
  const screenKey = `${subject}\u0000${body}`;
  useEffect(() => {
    if (!edited) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const r = await checkLetter(subject, body);
        if (!cancelled) setScreenRes({ key: screenKey, ok: r.ok, message: r.message });
      } catch {
        // Never trap a member on a network blip; the queue re-checks on Send.
        if (!cancelled) setScreenRes({ key: screenKey, ok: true, message: "" });
      }
    }, 1200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [subject, body, edited, screenKey]);
  const screen: { status: "idle" | "checking" | "ok" | "blocked"; message: string } = !edited
    ? { status: "idle", message: "" }
    : screenRes?.key === screenKey
      ? { status: screenRes.ok ? "ok" : "blocked", message: screenRes.message }
      : { status: "checking", message: "" };
  const letterBlocked = screen.status === "blocked";
  const externalLocked = edited && screen.status !== "ok";

  // Geography context. Every campaign is actionable by every user regardless
  // of where they live (owner policy 2026-06-22) — we no longer block out-of-
  // area advocates. We DO still tell them they're not a constituent
  // (legislators weight constituent mail most), and for role-based state
  // campaigns route them through a picker of the campaign-state's officials
  // (pickableStateReps) rather than auto-blasting a whole legislature.
  const userCityLocality = userCity && userState ? `${userCity}, ${userState}` : null;
  const userCountyLocality = userCounty && userState ? `${userCounty}, ${userState}` : null;

  const stateMismatch = !!campaignState && !!userState && userState !== campaignState;
  const localityMismatch =
    !!campaignLocality &&
    campaignLocality !== userCityLocality &&
    campaignLocality !== userCountyLocality;

  // Out-of-area advocate — show the honest "not a constituent" notice.
  const isNonResident = stateMismatch || localityMismatch;
  const noProfile = targets.length === 0;

  // Build the right URL / payload for each method.
  // Exclude contact-form-only "emails" (stored as http(s) URLs) — they're not
  // mailable and would land as garbage in the compose "To". Mirrors the
  // server-side filter in actions.ts so client + server agree on who's emailable.
  const allWithEmail = targets.filter((t) => !!t.email && !t.email.startsWith("http"));
  // Targets reachable ONLY via a web form (email is an http URL) or via their
  // official site (no email but a website) — surfaced separately so a mixed
  // campaign doesn't silently drop them (finding: LA Gov/AG + a real-inbox
  // senator on one campaign). Bulk-emailable targets are excluded here.
  const formOnlyTargets = targets.filter(
    (t) => (!!t.email && t.email.startsWith("http")) || (!t.email && !!t.website),
  );
  const alreadySentSet = new Set(alreadySentLegislatorIds);
  const targetsWithEmail = allWithEmail.filter((t) => !alreadySentSet.has(t.id));
  const skippedAlreadySent = allWithEmail.length - targetsWithEmail.length;
  const allAlreadySent = allWithEmail.length > 0 && targetsWithEmail.length === 0;
  const to = targetsWithEmail[0]?.email ?? "";
  // The box keeps per-official fields ({{recipient_title}}, {{legislator_name}}…)
  // so one-click can address each person by name. A single compose window
  // going to many people can't, so those paths get a group greeting
  // ("Dear Senators and Representatives").
  const groupFill = groupVars(targetsWithEmail);
  const outSubject = renderTemplate(subject, groupFill);
  // The footer is added here, at render time, for every compose path below.
  const outBody = withLetterFooter(renderTemplate(body, groupFill));
  const sampleGreeting = targetsWithEmail[0]
    ? renderTemplate("Dear {{recipient_title}} {{recipient_last_name}}", recipientVars(targetsWithEmail[0]))
    : null;
  const unknownFields = unfilledPlaceholders(renderTemplate(`${subject}\n${body}`, recipientVars(targetsWithEmail[0] ?? null)));
  const bccList = targetsWithEmail.slice(1).map((t) => t.email!).join(",");

  function logAction(method: SendMethod, recordNonce: string | null = null) {
    startTransition(async () => {
      // Logging the send is best-effort — the email/copy already happened
      // client-side. A server hiccup here must NOT throw to the route error
      // boundary (the "@E352" broken-page the funnel was hitting).
      try {
        await logCampaignAction({
          campaignId,
          legislatorIds: targets.map((t) => t.id),
          // External / self-managed sends (gmail-web, outlook-web, mailto,
          // copy) all log as the unverified "mailto" channel; only the in-app
          // one-click path logs "platform_email" — our verified, on-the-record
          // send. (Schema allows mailto/platform_email/call.)
          method: "mailto",
          subject: outSubject,
          body: outBody,
          isNonResident,
          recordNonce: recordNonce ?? undefined,
        });
      } catch (e) {
        console.error("[campaign] logCampaignAction failed", e);
      }
      setSentVia(method);
    });
  }

  // Windows hands a mailto: URI to the mail client through ShellExecute, which
  // truncates around 2048 characters, and Outlook desktop is stricter still.
  // A whole-chamber selection blows straight past that: 198 MA legislators is a
  // 5.2 KB BCC list and a ~7.9 KB URI, 386% of the limit. The failure is SILENT
  // — the client opens with a truncated recipient list, or nothing happens —
  // which is the same trap as the old 20-target cap: the UI looks like it
  // worked while the action quietly did less. Warn instead, and point at the
  // connected-account path, which posts the message through the provider API
  // and has no URL length limit at all.
  const MAILTO_SAFE_LIMIT = 1900;
  const mailtoLength = buildMailto(keepCopy ? "a".repeat(16) : null).length;
  const mailtoTooLong = mailtoLength > MAILTO_SAFE_LIMIT;

  function buildMailto(recordNonce: string | null = null) {
    // encodeURIComponent (%20), NOT URLSearchParams ('+') — RFC 6068 mailto
    // bodies treat '+' as a literal plus sign in several mail clients.
    const bcc = withRecordBcc(bccList, recordNonce);
    const parts = [`subject=${encodeURIComponent(outSubject)}`];
    if (bcc) parts.push(`bcc=${encodeURIComponent(bcc)}`);
    parts.push(`body=${encodeURIComponent(outBody)}`);
    return `mailto:${to}?${parts.join("&")}`;
  }

  function buildGmailUrl(recordNonce: string | null = null) {
    // Gmail web compose URL — opens in user's logged-in Gmail tab
    const bcc = withRecordBcc(bccList, recordNonce);
    const params = new URLSearchParams();
    params.set("view", "cm");
    params.set("fs", "1");
    params.set("to", to);
    if (bcc) params.set("bcc", bcc);
    params.set("su", outSubject);
    params.set("body", outBody);
    return `https://mail.google.com/mail/?${params.toString()}`;
  }

  function buildOutlookUrl(recordNonce: string | null = null) {
    // Outlook web compose URL
    const bcc = withRecordBcc(bccList, recordNonce);
    const params = new URLSearchParams();
    params.set("to", to);
    if (bcc) params.set("bcc", bcc);
    params.set("subject", outSubject);
    params.set("body", outBody);
    return `https://outlook.office.com/mail/deeplink/compose?${params.toString()}`;
  }

  // The nonce is minted at click time, not render time: the href is rewritten
  // before the browser follows it, so the server render and hydration agree and
  // each compose window gets its own record address.
  function openWithRecord(
    e: React.MouseEvent<HTMLAnchorElement>,
    method: SendMethod,
    build: (recordNonce: string | null) => string,
  ) {
    const recordNonce = keepCopy ? makeRecordNonce() : null;
    e.currentTarget.href = build(recordNonce);
    logAction(method, recordNonce);
  }

  async function copyAll() {
    const allEmails = targetsWithEmail.map((t) => t.email).join(", ");
    const recordNonce = keepCopy ? makeRecordNonce() : null;
    const bccLine = recordNonce ? `Bcc: ${recordAddress(recordNonce)}\n` : "";
    const text =
      `To: ${allEmails}\n${bccLine}\nSubject: ${outSubject}\n\n${outBody}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      logAction("copy", recordNonce);
      setTimeout(() => setCopied(false), 4000);
    } catch {
      setCopied(false);
    }
  }

  if (noProfile) {
    const showPicker = pickableStateReps.length > 0;
    // The state whose officials the picker offers (campaign's own, falling
    // back to the user's) — used for copy + the "browse legislators" link.
    const pickerScope = campaignState ?? userState;

    // Out-of-area advocate on a state/local campaign: not a constituent, so we
    // can't auto-pick "their" reps. Offer the campaign-state's officials and
    // let them choose who to contact — no auto-blast of a whole legislature,
    // no torching the advocate's own email reputation. (This branch comes
    // first: an out-of-state user has their OWN districts, so the Census-gap
    // branch below would never fire for them.)
    if (showPicker && isNonResident) {
      return (
        <Card>
          <h2 className="text-lg font-semibold text-emerald-300">
            Add your voice to the {pickerScope ?? "this"} fight
          </h2>
          <p className="mt-2 text-sm text-zinc-400">
            You&apos;re not registered in {campaignLocality ?? campaignState}, but this
            campaign welcomes voices from anywhere. Pick which official
            {pickableStateReps.length === 1 ? "" : "s"} you want to contact below —
            legislators weight constituent mail most, so lead with{" "}
            <em>why this matters to you</em>, even from out of state.
          </p>
          <StateRepPicker
            reps={pickableStateReps}
            campaignSlug={campaignSlug}
            targetRoles={targetRoles}
          />
        </Card>
      );
    }

    // Resident with an address on file but Census couldn't map the district.
    // Old copy lied to users who'd actually entered their full address (2/8
    // users hit by the Census-geocoder gap as of 2026-05-16, mostly rural /
    // unincorporated).
    if (hasStreet && !hasDistricts) {
      return (
        <Card>
          <h2 className="text-lg font-semibold text-amber-300">
            We couldn&apos;t auto-detect your district
          </h2>
          <p className="mt-2 text-sm text-zinc-400">
            Your address is on file, but the US Census Bureau&apos;s address
            index doesn&apos;t cover every street — rural and newer addresses
            sometimes get missed. Retry the lookup, or pick your reps
            from the list below.
          </p>
          <div className="mt-4">
            <RetryDistrictsButton userState={userState} />
          </div>

          {pickableStateReps.length > 0 && (
            <StateRepPicker
              reps={pickableStateReps}
              campaignSlug={campaignSlug}
              targetRoles={targetRoles}
            />
          )}

          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <a
              href="/account"
              className="rounded-md border border-zinc-700 px-3 py-1.5 hover:border-emerald-500 hover:text-emerald-300"
            >
              Update address
            </a>
            {userState && (
              <a
                href={`/legislators?state=${userState}`}
                className="rounded-md border border-zinc-700 px-3 py-1.5 hover:border-emerald-500 hover:text-emerald-300"
              >
                Browse all {userState} legislators →
              </a>
            )}
          </div>
        </Card>
      );
    }
    // No address set yet, but a state campaign offers a picker — let the user
    // choose who to contact now, and nudge them to add their address so future
    // sends are one-click. (Federal campaigns have no picker → fall through.)
    if (showPicker) {
      return (
        <Card>
          <h2 className="text-lg font-semibold text-amber-300">
            Pick which {pickerScope ?? ""} reps to contact
          </h2>
          <p className="mt-2 text-sm text-zinc-400">
            Add your full address in{" "}
            <a href="/account" className="text-emerald-400 hover:underline">your account</a>{" "}
            and we&apos;ll auto-match your specific reps for true one-click sends. For
            now, choose who to email below.
          </p>
          <StateRepPicker
            reps={pickableStateReps}
            campaignSlug={campaignSlug}
            targetRoles={targetRoles}
          />
        </Card>
      );
    }
    // Address IS on file but we still found no targets and have no picker to
    // offer — i.e. the user is outside this campaign's area and we don't have
    // its officials listed. Don't tell them to "fix" an address that's fine.
    if (hasStreet) {
      return (
        <Card>
          <h2 className="text-lg font-semibold text-amber-300">
            You&apos;re outside this campaign&apos;s area
          </h2>
          <p className="mt-2 text-sm text-zinc-400">
            This campaign targets {pickerScope ?? campaignLocality ?? "specific"} officials,
            and we don&apos;t have a contactable list for them yet. You can still help — find
            and contact officials directly.
          </p>
          <a
            href={`/legislators${campaignState ? `?state=${campaignState}` : ""}`}
            className="mt-4 inline-block rounded-md border border-zinc-700 px-4 py-2 text-sm hover:border-emerald-500"
          >
            Browse legislators →
          </a>
        </Card>
      );
    }

    // Genuinely missing an address — needed to find the user's own reps
    // (federal / their-own-state campaigns).
    return (
      <Card>
        <h2 className="text-lg font-semibold text-amber-300">
          We need your address to find your reps
        </h2>
        <p className="mt-2 text-sm text-zinc-400">
          Add your full street address so we can match you to your specific{" "}
          {targetRoles.map((r) => ROLE_SHORT[r] ?? r).join(", ")}.
        </p>
        <a
          href="/account"
          className="mt-4 inline-block rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400"
        >
          Add my address →
        </a>
      </Card>
    );
  }

  // Only show "no public emails" when no rep EVER had a sendable email.
  // If `allWithEmail.length > 0` but `targetsWithEmail.length === 0`, that
  // means everyone's in the cooldown window — handled by allAlreadySent below.
  // NOT a dead end anymore: officials without an inbox (state executives,
  // most governors/AGs) get the shared composer's contact-form/website flow —
  // draft here, copy, paste into their form. (The LA Gov/AG campaign gap.)
  if (allWithEmail.length === 0) {
    const contactable = targets.filter((t) => t.email || t.website);
    return (
      <Card>
        <h2 className="text-lg font-semibold text-amber-300">
          {contactable.length > 0
            ? "These offices don't publish an email — use their contact form"
            : "No public emails on file for your reps yet"}
        </h2>
        <p className="mt-2 text-sm text-zinc-400">
          {contactable.length > 0 ? (
            <>Draft your message right here (AI can help), copy it, and paste it into
            the office&apos;s official contact form — same voice, same record, one extra click.</>
          ) : (
            <>Public sources don&apos;t have contact channels for these officials yet. Use the
            phone numbers on the legislators page in the meantime.</>
          )}
        </p>
        {contactable.length > 0 && (
          <ul className="mt-4 space-y-2">
            {contactable.map((t) => (
              <li
                key={t.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-zinc-800 bg-zinc-950/60 px-3 py-2"
              >
                <span className="text-sm">
                  <span className="text-emerald-300">{t.title ?? ROLE_SHORT[t.role] ?? t.role}</span>{" "}
                  <span className="text-zinc-200">{t.full_name}</span>
                </span>
                <EmailOfficialButton
                  official={{
                    id: t.id,
                    name: t.full_name,
                    role: t.role,
                    title: t.title,
                    state: t.state,
                    email: t.email,
                    website: t.website,
                  }}
                  context={billId ? { kind: "bill", billId } : undefined}
                  source="campaign_no_email"
                />
              </li>
            ))}
          </ul>
        )}
        <a
          href={`/legislators?state=${userState ?? campaignState}`}
          className="mt-4 inline-block rounded-md border border-zinc-700 px-4 py-2 text-sm hover:border-emerald-500"
        >
          See all contact info →
        </a>
      </Card>
    );
  }

  return (
    <Card accent>
      {isNonResident && (
        <div className="mb-4 rounded-md border border-purple-900/40 bg-purple-950/20 p-3 text-xs text-purple-200">
          <strong className="text-purple-300">Heads up — you&apos;re not a constituent of {campaignLocality ?? campaignState}.</strong>{" "}
          This campaign accepts out-of-area voices. Your message will go through, but
          legislators weight emails from constituents most. Lead with your story:{" "}
          <em>why this issue matters to you</em>, even if you live elsewhere.
        </div>
      )}

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">
          Send to {isNonResident ? "" : "your "}{targetsWithEmail.length}{" "}
          {targetsWithEmail.length === 1 ? "legislator" : "legislators"}
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={async () => {
              setPersonalizeError(null);
              setPersonalizeChanges(null);
              setPersonalizing(true);
              try {
                const r = await personalizeCampaignBody({
                  campaignBody: body,
                  campaignTitle: subject,
                });
                if ("error" in r && r.error) {
                  setPersonalizeError(r.error);
                } else if ("ok" in r && r.ok && r.personalized_body) {
                  setBody(r.personalized_body);
                  setPersonalizeChanges(r.what_changed ?? null);
                  setEditing(true);
                }
              } catch {
                // A rejected server-action POST (connection drop / 504) never
                // returns an {error} shape — without this catch the spinner just
                // stops and the user gets zero feedback.
                setPersonalizeError("Personalization failed — check your connection and try again.");
              } finally {
                setPersonalizing(false);
              }
            }}
            disabled={personalizing}
            className="rounded-md border border-emerald-700/40 bg-emerald-950/20 px-2 py-0.5 text-xs text-emerald-300 hover:border-emerald-500 disabled:opacity-50"
            title="Rewrites this template in your authentic voice using your kratom story (from /account/character)"
          >
            {personalizing ? "✨ Personalizing…" : "✨ Personalize with my story"}
          </button>
          <button
            onClick={() => setEditing((v) => !v)}
            className="text-xs text-emerald-400 hover:underline"
          >
            {editing ? "Hide editor" : "Edit message"}
          </button>
        </div>
      </div>
      {personalizeError && (
        <p className="mt-2 rounded-md border border-amber-700/40 bg-amber-950/10 p-2 text-xs text-amber-300">
          {personalizeError}
        </p>
      )}
      {personalizeChanges && (
        <p className="mt-2 rounded-md border border-emerald-700/40 bg-emerald-950/10 p-2 text-xs text-emerald-300">
          ✨ {personalizeChanges} <span className="text-zinc-500">Review the edit + send when ready.</span>
        </p>
      )}

      {/* Recipient chips — capped to keep the page from ballooning on
          large state-floor campaigns. */}
      <RecipientChips targets={targetsWithEmail} intel={targetIntel ?? {}} />

      {/* Editor (collapsible) */}
      {editing && (
        <div className="mt-5 space-y-3">
          <div>
            <label className="block text-xs font-medium text-zinc-400">Subject</label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400">Body</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
            />
            <p className="mt-1 text-xs text-zinc-500">
              Personal touches get read. A sentence about why this matters to you doubles your impact.
              Every letter ends with one quiet line, &ldquo;Sent via iKratom.org&rdquo;, so officials know where it came from.
            </p>
            {sampleGreeting && (
              <p className="mt-1 text-xs text-zinc-500">
                Parts in <span className="font-mono">{"{{double braces}}"}</span> are filled in for each official,
                so &ldquo;Dear {"{{recipient_title}} {{recipient_last_name}}"}&rdquo; becomes &ldquo;{sampleGreeting}&rdquo;.
              </p>
            )}
            {letterBlocked && (
              <p className="mt-1 rounded border border-red-900/50 bg-red-950/30 px-2 py-1.5 text-xs text-red-200">
                {screen.message}{" "}
                <a href="/support" className="underline">Think this is a mistake? Tell us.</a>
              </p>
            )}
            {safeModeState && (
              <UseAdmissionWarning
                stateName={safeModeState}
                subject={subject}
                body={body}
                onFix={(s, b) => { setSubject(s); setBody(b); }}
              />
            )}
            {screen.status === "checking" && <p className="mt-1 text-[11px] text-zinc-500">Checking your letter…</p>}
            {unknownFields.length > 0 && (
              <p className="mt-1 rounded border border-amber-800/50 bg-amber-950/20 px-2 py-1 text-xs text-amber-200">
                We can&apos;t fill in {unknownFields.map((f) => `{{${f}}}`).join(", ")}. Replace it with your own words before sending.
              </p>
            )}
          </div>
          {/* Personal video / audio attachment */}
          <AttachmentRecorder
            onAttached={(att) => setBody((b) => appendClipLine(b, att))}
          />
        </div>
      )}

      {/* Already-sent banner (top of action area) */}
      {skippedAlreadySent > 0 && (
        <div className="mt-5 rounded-md border border-zinc-800 bg-zinc-950 p-3 text-xs">
          <span className="text-zinc-400">
            ✓ You&apos;ve already sent this campaign to{" "}
            <strong className="text-zinc-200">{skippedAlreadySent}</strong> of{" "}
            {allWithEmail.length} legislator{allWithEmail.length === 1 ? "" : "s"}
            {lastSentAt && <> — last sent {timeAgo(lastSentAt)}</>}.
            {targetsWithEmail.length > 0 && <> The remaining {targetsWithEmail.length} are still pending.</>}
          </span>
        </div>
      )}

      {/* All already sent — block re-send */}
      {allAlreadySent && (
        <div className="mt-6 rounded-xl border-2 border-zinc-700 bg-zinc-950/40 p-6 text-center">
          <p className="text-2xl">✓</p>
          <h2 className="mt-2 text-lg font-bold text-zinc-200">
            You&apos;ve sent this campaign to all your legislators
          </h2>
          <p className="mt-2 text-sm text-zinc-400">
            To prevent spam, we don&apos;t allow re-sending the same campaign to the same officials within 7 days.
            {lastSentAt && <> Last sent {timeAgo(lastSentAt)}.</>}
          </p>
          <Link
            href="/campaigns"
            className="mt-4 inline-block rounded-md border border-zinc-700 px-4 py-2 text-sm hover:border-emerald-500"
          >
            Find another campaign →
          </Link>
        </div>
      )}

      {/* Inline Connect-Gmail CTA — only shows when user is NOT yet
          connected. Discovery gap fix 2026-05-16: previously users had
          to find the connect button buried in /account, which is why
          we had 1 connected user (the owner) out of 8 with addresses.
          Privacy copy below makes the scope unambiguous. */}
      {!allAlreadySent && !gmailConnected && sentVia === null && (
        <div className="mt-6 rounded-lg border-2 border-dashed border-emerald-700/50 bg-emerald-950/10 p-4">
          <p className="text-xs font-bold uppercase tracking-widest text-emerald-300">
            {emailNeedsReconnect ? "⚠ Reconnect your email" : "⚡ One-click send (recommended)"}
          </p>
          <p className="mt-1 text-sm text-zinc-300">
            {emailNeedsReconnect ? (
              <>Your email connection expired (Google revoked the token), so one-click send is paused. Reconnect below to resume — or use the &ldquo;Send from your own email&rdquo; options below, which need no connection.</>
            ) : (
              <>Connect your email once and the {targetsWithEmail.length} email{targetsWithEmail.length === 1 ? "" : "s"} below send in a single click — each from <strong>your</strong> address, each in your Sent folder.</>
            )}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <a
              href="/api/oauth/google/start"
              className="inline-flex items-center gap-2 rounded-md bg-white px-4 py-2 text-sm font-semibold text-zinc-900 hover:bg-zinc-100"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Connect Gmail →
            </a>
            <a
              href="/api/oauth/outlook/start"
              className="inline-flex items-center gap-2 rounded-md bg-[#0078D4] px-4 py-2 text-sm font-semibold text-white hover:bg-[#106EBE]"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="white">
                <path d="M21.86 6.16h-9.83v3.84l4.92 3.07 4.91-3.07V6.16zM12.03 9.99v8.66h9.83V13L17 16.07 12.03 9.99zM10.04 4.93H2.14v14.14h7.9V4.93zm-1.61 9.6H3.65V8.54h4.78v5.99z"/>
              </svg>
              Connect Outlook →
            </a>
          </div>
          <div className="mt-3 rounded-md border border-zinc-800 bg-zinc-950/60 p-2.5 text-[11px] text-zinc-400">
            <p className="font-semibold text-zinc-300">What we ask for + what we don&apos;t</p>
            <ul className="mt-1 space-y-0.5">
              <li>✓ <strong className="text-emerald-300">gmail.send</strong> / <strong className="text-emerald-300">Mail.Send</strong> scope only — the narrowest possible mail permission on either provider</li>
              <li>✗ We <strong>never</strong> read your inbox, contacts, drafts, calendar, or any other service</li>
              <li>✓ We keep a copy of each letter you send through iKratom, so your history is accurate and nobody gets the same letter twice. We never read anything else in your mailbox</li>
              <li>✓ Disconnect anytime at <a href="/account" className="text-emerald-400 hover:underline">/account</a>; revoke at <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline">Google permissions</a> or <a href="https://account.microsoft.com/privacy/app-access" target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline">Microsoft permissions</a></li>
              <li>✓ Yahoo, AOL or iCloud? <a href="/account#integrations" className="text-emerald-400 hover:underline">Connect them with an app password</a> in your account settings. (Proton isn&apos;t possible: free Proton accounts allow no outside apps.)</li>
            </ul>
          </div>
          <EmailSafetyNote collapsed className="mt-3" />
          <p className="mt-2 text-xs text-zinc-500">
            No Gmail or Outlook? Use &ldquo;Send from your own email&rdquo; below — same emails, sent by you, one client at a time.
          </p>
        </div>
      )}

      {/* Platform-Gmail one-click batch (when connected) */}
      {!allAlreadySent && gmailConnected && (
        <div className="mt-6 rounded-lg border-2 border-emerald-500 bg-emerald-950/30 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-emerald-300">
                ⚡ One-click send
              </p>
              <p className="text-sm text-zinc-300">
                Send {targetsWithEmail.length} personalized emails from{" "}
                <span className="font-mono text-emerald-300">{gmailEmail}</span> in one click.
              </p>
            </div>
          </div>

          <SendBatchPanel
            campaignSlug={campaignSlug}
            selectedIds={targetsWithEmail.map((t) => t.id)}
            subject={subject}
            body={body}
            primary
            blockedReason={letterBlocked ? screen.message : null}
            className="mt-3"
          />
          <p className="mt-2 text-xs text-zinc-500">
            Check your email&apos;s Sent folder to see every letter as it goes out.
          </p>
          <EmailSafetyNote collapsed className="mt-3" />
        </div>
      )}

      {/* Advanced fallback — external / self-managed send. These open the
          user's OWN email client or web compose, so iKratom can neither screen
          nor verify what actually goes out: this is the unscreened path,
          deliberately demoted below the one-click in-app send (the blessed,
          on-the-record path). Kept reachable for users who haven't connected
          one-click send, or can't yet (Proton / Yahoo / iCloud). Expanded by
          default only when there's no one-click option. Gated on ≥1 sendable
          recipient — without it the buttons opened an empty-"To" compose. */}
      {targetsWithEmail.length > 0 && (
      <details className="mt-6 rounded-lg border border-zinc-800 bg-zinc-950/40">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-zinc-300 hover:text-emerald-300">
          {gmailConnected ? "Other ways to send" : "Or open it in your own email app instead"}
        </summary>
        <div className="border-t border-zinc-800 px-4 py-3">
          <p className="mb-3 text-xs text-zinc-500">
            These open your own email app or web compose and you press Send there. iKratom
            can&apos;t screen changes made after it opens. Connecting your email above is
            faster and screens every letter.
          </p>
          <SendRecordNotice keepCopy={keepCopy} onChange={setKeepCopy} />
          <div className="grid gap-2 sm:grid-cols-3">
            <SendOption
              href={buildGmailUrl()}
              target="_blank"
              label="Open in Gmail"
              disabled={externalLocked}
              sub="Web compose tab"
              onClick={(e) => openWithRecord(e, "gmail", buildGmailUrl)}
              done={sentVia === "gmail"}
            />
            <SendOption
              href={buildOutlookUrl()}
              target="_blank"
              label="Open in Outlook"
              disabled={externalLocked}
              sub="Web compose tab"
              onClick={(e) => openWithRecord(e, "outlook", buildOutlookUrl)}
              done={sentVia === "outlook"}
            />
            <SendOption
              href={buildMailto()}
              label="Default email app"
              disabled={externalLocked}
              sub="Apple Mail / Thunderbird"
              onClick={(e) => openWithRecord(e, "mailto", buildMailto)}
              done={sentVia === "mailto"}
            />
          </div>

          {externalLocked && (
            <p className="mb-2 text-[11px] text-amber-300">
              {letterBlocked ? "These are off until the letter above is changed." : "One moment: checking your edited letter…"}
            </p>
          )}
          {mailtoTooLong && (
            <p className="mt-3 rounded-md border border-amber-800/50 bg-amber-950/20 px-3 py-2 text-xs text-amber-200">
              <strong>{targetsWithEmail.length} recipients is too many for a desktop mail app.</strong>{" "}
              This message is {mailtoLength.toLocaleString()} characters and Windows cuts mailto links off
              around 2,000 — your mail client may open with recipients missing, or not open at all.
              Use <em>Gmail</em> or <em>Outlook</em> above (they take the full list), send with a connected
              account, or copy the message and paste it yourself.
            </p>
          )}

          <button
            onClick={copyAll}
            className="mt-3 w-full rounded-md border border-zinc-800 bg-zinc-950/60 px-4 py-2.5 text-sm text-zinc-300 hover:border-emerald-500 hover:text-emerald-300"
          >
            {copied ? "✓ Copied — paste anywhere" : "Or copy the whole message"}
          </button>

          {sentVia && sentVia !== "platform_gmail" && (
            <p className="mt-4 rounded-md border border-emerald-900/40 bg-emerald-950/30 px-3 py-2 text-center text-sm text-emerald-300">
              ✓ Compose window opened. Hit Send in there to add your voice to the record.
            </p>
          )}
        </div>
      </details>
      )}

      {targetsWithEmail.length > 0 && (
      <p className="mt-3 text-center text-xs text-zinc-500">
        The email comes from <em>your</em> address — what legislators actually read.
      </p>
      )}

      {/* Web-form / no-inbox targets. The bulk send above only covers real
          inboxes (allWithEmail filters out http contact-form "emails"), so
          without this, officials who only take web contact — e.g. most
          governors/AGs, and some legislators — were silently dropped from a
          mixed campaign. Each gets the shared composer's contact-form flow. */}
      {formOnlyTargets.length > 0 && (
        <div className="mt-5 rounded-lg border border-amber-800/40 bg-amber-950/10 p-4">
          <p className="text-xs font-bold uppercase tracking-widest text-amber-300">
            {formOnlyTargets.length} of these take web contact only
          </p>
          <p className="mt-1 text-sm text-zinc-300">
            These offices don&apos;t publish an email inbox. Draft your message (AI can
            help), copy it, and paste it into each one&apos;s official form — one extra click.
          </p>
          <ul className="mt-3 space-y-2">
            {formOnlyTargets.map((t) => (
              <li
                key={t.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-zinc-800 bg-zinc-950/60 px-3 py-2"
              >
                <span className="text-sm">
                  <span className="text-emerald-300">{t.title ?? ROLE_SHORT[t.role] ?? t.role}</span>{" "}
                  <span className="text-zinc-200">{t.full_name}</span>
                  {t.district && <span className="text-zinc-500"> · D{t.district}</span>}
                </span>
                <EmailOfficialButton
                  official={{
                    id: t.id,
                    name: t.full_name,
                    role: t.role,
                    title: t.title,
                    state: t.state,
                    email: t.email,
                    website: t.website,
                  }}
                  context={billId ? { kind: "bill", billId } : undefined}
                  source="campaign_webform"
                />
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* One-click phone call section — only renders if any target has a phone */}
      <CallActionPanel
        campaignId={campaignId}
        targets={targets}
        body={body}
        isNonResident={isNonResident}
      />
    </Card>
  );
}

function SendOption({
  href,
  target,
  label,
  sub,
  primary,
  onClick,
  done,
  disabled,
}: {
  href: string;
  target?: string;
  label: string;
  sub: string;
  primary?: boolean;
  onClick: (e: React.MouseEvent<HTMLAnchorElement>) => void;
  done?: boolean;
  /** Edited letter not yet screened, or blocked: no compose window. */
  disabled?: boolean;
}) {
  const base =
    "group flex flex-col items-center gap-0.5 rounded-md px-3 py-3 text-center transition";
  const cls = done
    ? "bg-emerald-700 text-zinc-950"
    : primary
    ? "bg-emerald-500 text-zinc-950 hover:bg-emerald-400"
    : "border border-zinc-700 text-zinc-200 hover:border-emerald-500 hover:bg-zinc-950";

  if (disabled) {
    return (
      <span aria-disabled="true" className={`${base} cursor-not-allowed border border-zinc-800 text-zinc-600`}>
        <span className="text-sm font-semibold">{label}</span>
        <span className="text-[11px] text-zinc-600">{sub}</span>
      </span>
    );
  }
  return (
    <a
      href={href}
      target={target}
      rel={target === "_blank" ? "noopener noreferrer" : undefined}
      onClick={onClick}
      className={`${base} ${cls}`}
    >
      <span className="text-sm font-semibold">
        {done ? "✓ " : ""}
        {label}
      </span>
      <span className={`text-[11px] ${done ? "text-zinc-900/70" : primary ? "text-zinc-900/70" : "text-zinc-500"}`}>
        {sub}
      </span>
    </a>
  );
}

function Card({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
  const cls = accent
    ? "border-emerald-700/50 bg-gradient-to-br from-emerald-950/30 to-zinc-950/40 ring-1 ring-emerald-700/20"
    : "border-zinc-800 bg-zinc-950/40";
  return <div className={`rounded-xl border p-6 ${cls}`}>{children}</div>;
}

function timeAgo(iso: string): string {
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)} minute${sec < 120 ? "" : "s"} ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} hour${sec < 7200 ? "" : "s"} ago`;
  const days = Math.floor(sec / 86400);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * Manual state-rep picker — shown inside the "no districts auto-detected"
 * card when the user has a saved address but Census couldn't map it.
 * Lets the user check the boxes for whichever legislators they want to
 * contact, then redirects to /campaigns/[slug]?manual_targets=id1,id2,...
 * The slug page re-renders with those targets and the full send UI
 * appears below.
 */
function StateRepPicker({
  reps,
  campaignSlug,
  targetRoles,
}: {
  reps: Legislator[];
  campaignSlug: string;
  targetRoles: string[];
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // Collapsed by default for any group big enough to bury the rest of the UI.
  // MA has 158 State Reps; rendering that open pushes every other chamber and
  // the send button out of the scroll viewport. Small groups (a delegation, a
  // council) stay open since collapsing 3 rows helps nobody.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => defaultCollapsed(reps));

  function toggle(id: string) {
    setPicked((prev) => togglePicked(prev, id));
  }

  function toggleCollapsed(role: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });
  }

  /** Select or clear every rep in one role group, leaving other groups alone. */
  function setGroup(group: Legislator[], on: boolean) {
    setPicked((prev) => setGroupPicked(prev, group, on));
  }

  // Group by role for readable scanning
  const grouped = groupByRole(reps);

  const targetsParam = buildTargetsParam(picked, reps.length);
  // "all" sentinel instead of enumerating every id: 198 UUIDs is a ~7.4 KB
  // query string, past what several servers and proxies accept, and the slug
  // page caps explicit ids anyway. The page resolves "all" server-side to the
  // same set the picker was built from, so the two can never drift.
  const sendHref = targetsParam
    ? `/campaigns/${campaignSlug}?manual_targets=${targetsParam}`
    : null;

  return (
    <div className="mt-5 rounded-md border-2 border-dashed border-emerald-700/50 bg-emerald-950/10 p-4">
      <p className="text-xs font-bold uppercase tracking-widest text-emerald-300">
        Pick your reps manually
      </p>
      <p className="mt-1 text-sm text-zinc-300">
        {reps.length} {targetRoles.map((r) => ROLE_SHORT[r] ?? r).join(" / ")} in your state. Tick the ones you want to email — usually just the legislators for your district, or select a whole chamber to contact everyone.
      </p>

      {/* Bulk controls. Selecting a whole chamber is a legitimate advocacy
          move for a statewide action, so it should take one click rather than
          158 of them. */}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <button
          type="button"
          onClick={() => setPicked(new Set(reps.map((r) => r.id)))}
          className="rounded border border-emerald-700/50 px-2 py-1 font-medium text-emerald-300 hover:border-emerald-500 hover:text-emerald-200"
        >
          Select all {reps.length}
        </button>
        <button
          type="button"
          onClick={() => setPicked(new Set())}
          className="rounded border border-zinc-700 px-2 py-1 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
        >
          Select none
        </button>
        <span className="text-zinc-500">
          {picked.size} selected
        </span>
      </div>

      <div className="mt-3 max-h-72 overflow-y-auto rounded border border-zinc-800 bg-zinc-950 p-2">
        {[...grouped.entries()].map(([role, group]) => {
          const isCollapsed = collapsed.has(role);
          const pickedInGroup = group.filter((r) => picked.has(r.id)).length;
          const allInGroup = pickedInGroup === group.length;
          return (
          <div key={role} className="mb-2">
            <div className="flex items-center justify-between gap-2 px-2 py-1">
              <button
                type="button"
                onClick={() => toggleCollapsed(role)}
                aria-expanded={!isCollapsed}
                className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-emerald-300/80 hover:text-emerald-200"
              >
                <span aria-hidden className="inline-block w-2">{isCollapsed ? "▸" : "▾"}</span>
                {ROLE_SHORT[role] ?? role} ({group.length})
                {pickedInGroup > 0 && (
                  <span className="text-emerald-400">· {pickedInGroup} picked</span>
                )}
              </button>
              <button
                type="button"
                onClick={() => setGroup(group, !allInGroup)}
                className="shrink-0 text-[10px] text-zinc-400 underline decoration-dotted hover:text-emerald-300"
              >
                {allInGroup ? "clear" : `all ${group.length}`}
              </button>
            </div>
            <ul hidden={isCollapsed}>
              {group.map((r) => (
                <li key={r.id}>
                  <label className="flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-zinc-900">
                    <input
                      type="checkbox"
                      checked={picked.has(r.id)}
                      onChange={() => toggle(r.id)}
                      className="h-3.5 w-3.5"
                    />
                    <span className="font-mono text-zinc-500">
                      {r.district ? `D${r.district}` : "  "}
                    </span>
                    <span className="text-zinc-200">{r.full_name}</span>
                    {r.party && <span className="text-zinc-500">· {r.party}</span>}
                    {!r.email && <span className="text-amber-400/80">· no email</span>}
                  </label>
                </li>
              ))}
            </ul>
          </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs">
        {sendHref ? (
          <a
            href={sendHref}
            className="rounded-md bg-emerald-500 px-4 py-1.5 font-semibold text-zinc-950 hover:bg-emerald-400"
          >
            Use these {picked.size} →
          </a>
        ) : (
          <span className="text-zinc-500">Pick at least one to continue.</span>
        )}
        {picked.size > 0 && (
          <button
            type="button"
            onClick={() => setPicked(new Set())}
            className="text-zinc-400 hover:text-emerald-400"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
