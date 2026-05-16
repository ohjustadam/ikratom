"use client";

import { useState, useTransition } from "react";
import type { Legislator } from "@/lib/legislators";
import { ROLE_SHORT } from "@/lib/legislators";
import { logCampaignAction, sendCampaignViaGmail } from "../actions";
import { personalizeCampaignBody } from "../actions-personalize";
import { CallActionPanel } from "./CallActionPanel";
import { AttachmentRecorder } from "./AttachmentRecorder";
import { RetryDistrictsButton } from "@/components/RetryDistrictsButton";

type SendMethod = "mailto" | "gmail" | "outlook" | "copy" | "platform_gmail";

export function CampaignAction({
  campaignId,
  targets,
  targetRoles,
  userState,
  campaignState,
  userCity,
  userCounty,
  campaignLocality,
  allowNonResidents,
  bodyTemplate,
  gmailConnected,
  gmailEmail,
  alreadySentLegislatorIds,
  lastSentAt,
  initialSubject,
  initialBody,
  hasStreet,
  hasDistricts,
}: {
  campaignId: string;
  targets: Legislator[];
  targetRoles: string[];
  userState: string | null;
  campaignState: string | null;
  userCity?: string | null;
  userCounty?: string | null;
  campaignLocality?: string | null;
  allowNonResidents?: boolean;
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
}) {
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);
  const [editing, setEditing] = useState(false);
  const [sentVia, setSentVia] = useState<SendMethod | null>(null);
  const [copied, setCopied] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ sent: number; failed: number; total: number } | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [personalizing, setPersonalizing] = useState(false);
  const [personalizeError, setPersonalizeError] = useState<string | null>(null);
  const [personalizeChanges, setPersonalizeChanges] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Geography gates — bypassed entirely when campaign allows non-residents.
  const userCityLocality = userCity && userState ? `${userCity}, ${userState}` : null;
  const userCountyLocality = userCounty && userState ? `${userCounty}, ${userState}` : null;

  const stateMismatch = !!campaignState && !!userState && userState !== campaignState;
  const localityMismatch =
    !!campaignLocality &&
    campaignLocality !== userCityLocality &&
    campaignLocality !== userCountyLocality;

  const wrongState = stateMismatch && !allowNonResidents;
  const wrongLocality = localityMismatch && !allowNonResidents;
  // Show non-resident notice when the user is out-of-scope but the campaign accepts them
  const isNonResident = (stateMismatch || localityMismatch) && !!allowNonResidents;
  const noProfile = targets.length === 0 && !wrongState && !wrongLocality;

  // Build the right URL / payload for each method
  const allWithEmail = targets.filter((t) => !!t.email);
  const alreadySentSet = new Set(alreadySentLegislatorIds);
  const targetsWithEmail = allWithEmail.filter((t) => !alreadySentSet.has(t.id));
  const skippedAlreadySent = allWithEmail.length - targetsWithEmail.length;
  const allAlreadySent = allWithEmail.length > 0 && targetsWithEmail.length === 0;
  const to = targetsWithEmail[0]?.email ?? "";
  const bccList = targetsWithEmail.slice(1).map((t) => t.email!).join(",");

  function logAction(method: SendMethod) {
    startTransition(async () => {
      await logCampaignAction({
        campaignId,
        legislatorIds: targets.map((t) => t.id),
        method: method === "copy" ? "mailto" : "mailto", // schema only allows mailto/platform_email/call
        subject,
        body,
        isNonResident,
      });
      setSentVia(method);
    });
  }

  function buildMailto() {
    const params = new URLSearchParams();
    params.set("subject", subject);
    if (bccList) params.set("bcc", bccList);
    params.set("body", body);
    return `mailto:${to}?${params.toString()}`;
  }

  function buildGmailUrl() {
    // Gmail web compose URL — opens in user's logged-in Gmail tab
    const params = new URLSearchParams();
    params.set("view", "cm");
    params.set("fs", "1");
    params.set("to", to);
    if (bccList) params.set("bcc", bccList);
    params.set("su", subject);
    params.set("body", body);
    return `https://mail.google.com/mail/?${params.toString()}`;
  }

  function buildOutlookUrl() {
    // Outlook web compose URL
    const params = new URLSearchParams();
    params.set("to", to);
    if (bccList) params.set("bcc", bccList);
    params.set("subject", subject);
    params.set("body", body);
    return `https://outlook.office.com/mail/deeplink/compose?${params.toString()}`;
  }

  async function platformGmailSend() {
    if (!gmailConnected) return;
    setBatchError(null);
    startTransition(async () => {
      const result = await sendCampaignViaGmail({
        campaignId,
        subject,
        bodyTemplate,
        targetIds: targetsWithEmail.map((t) => t.id),
        isNonResident,
      });
      if ("error" in result) {
        setBatchError(result.error);
      } else {
        setBatchProgress({ sent: result.sent, failed: result.failed, total: targetsWithEmail.length });
        setSentVia("platform_gmail");
      }
    });
  }

  async function copyAll() {
    const allEmails = targetsWithEmail.map((t) => t.email).join(", ");
    const text =
      `To: ${allEmails}\n\nSubject: ${subject}\n\n${body}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      logAction("copy");
      setTimeout(() => setCopied(false), 4000);
    } catch {
      setCopied(false);
    }
  }

  if (wrongState) {
    return (
      <Card>
        <h2 className="text-lg font-semibold text-amber-300">
          This campaign is for {campaignState} residents
        </h2>
        <p className="mt-2 text-sm text-zinc-400">
          You&apos;re registered in {userState}. Find a campaign for your state.
        </p>
        <a
          href="/campaigns"
          className="mt-4 inline-block rounded-md border border-zinc-700 px-4 py-2 text-sm hover:border-emerald-500"
        >
          Browse campaigns →
        </a>
      </Card>
    );
  }

  if (wrongLocality) {
    return (
      <Card>
        <h2 className="text-lg font-semibold text-amber-300">
          This campaign is local to {campaignLocality}
        </h2>
        <p className="mt-2 text-sm text-zinc-400">
          You&apos;re registered in {userCityLocality ?? userState ?? "another area"}.
          Local campaigns target specific city or county officials — they only fire for
          residents of that locality.
        </p>
        <a
          href="/campaigns"
          className="mt-4 inline-block rounded-md border border-zinc-700 px-4 py-2 text-sm hover:border-emerald-500"
        >
          Browse campaigns →
        </a>
      </Card>
    );
  }

  if (noProfile) {
    // Distinguish "no address typed yet" from "address typed but Census
    // didn't have it." Old copy lied to users who'd actually entered
    // their full address (2/8 users hit by the Census-geocoder gap as
    // of 2026-05-16, mostly rural / unincorporated).
    if (hasStreet && !hasDistricts) {
      return (
        <Card>
          <h2 className="text-lg font-semibold text-amber-300">
            We couldn&apos;t auto-detect your district
          </h2>
          <p className="mt-2 text-sm text-zinc-400">
            Your address is on file, but the US Census Bureau&apos;s address
            index doesn&apos;t cover every street — rural and newer addresses
            sometimes get missed. Click below to retry, or find your reps
            manually.
          </p>
          <div className="mt-4">
            <RetryDistrictsButton userState={userState} />
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
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
                Find {userState} legislators manually →
              </a>
            )}
          </div>
        </Card>
      );
    }
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
  if (allWithEmail.length === 0) {
    return (
      <Card>
        <h2 className="text-lg font-semibold text-amber-300">
          No public emails on file for your reps yet
        </h2>
        <p className="mt-2 text-sm text-zinc-400">
          Public sources don&apos;t have email addresses for these legislators. Use the
          phone numbers and websites on the legislators page in the meantime.
        </p>
        <a
          href={`/legislators?state=${userState ?? campaignState}`}
          className="mt-4 inline-block rounded-md border border-zinc-700 px-4 py-2 text-sm hover:border-emerald-500"
        >
          See contact info →
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
      <RecipientChips targets={targetsWithEmail} />

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
            </p>
          </div>
          {/* Personal video / audio attachment */}
          <AttachmentRecorder
            onAttached={(att) => {
              const link = `\n\n${att.kind === "video" ? "📹" : "🎙"} My personal message: ${att.url}\n`;
              const transcript = att.transcript ? `\n(transcript: ${att.transcript})\n` : "";
              setBody((b) => b + link + transcript);
            }}
          />
        </div>
      )}

      {/* Already-sent banner (top of action area) */}
      {skippedAlreadySent > 0 && !batchProgress && (
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
      {allAlreadySent && !batchProgress && (
        <div className="mt-6 rounded-xl border-2 border-zinc-700 bg-zinc-950/40 p-6 text-center">
          <p className="text-2xl">✓</p>
          <h2 className="mt-2 text-lg font-bold text-zinc-200">
            You&apos;ve sent this campaign to all your legislators
          </h2>
          <p className="mt-2 text-sm text-zinc-400">
            To prevent spam, we don&apos;t allow re-sending the same campaign to the same officials within 7 days.
            {lastSentAt && <> Last sent {timeAgo(lastSentAt)}.</>}
          </p>
          <a
            href="/campaigns"
            className="mt-4 inline-block rounded-md border border-zinc-700 px-4 py-2 text-sm hover:border-emerald-500"
          >
            Find another campaign →
          </a>
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
            ⚡ One-click send (optional)
          </p>
          <p className="mt-1 text-sm text-zinc-300">
            Connect Gmail once and the {targetsWithEmail.length} email{targetsWithEmail.length === 1 ? "" : "s"} below send in a single click — each from <strong>your</strong> address, each in your Sent folder.
          </p>
          <a
            href="/api/oauth/google/start"
            className="mt-3 inline-flex items-center gap-2 rounded-md bg-white px-4 py-2 text-sm font-semibold text-zinc-900 hover:bg-zinc-100"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Connect Gmail →
          </a>
          <div className="mt-3 rounded-md border border-zinc-800 bg-zinc-950/60 p-2.5 text-[11px] text-zinc-400">
            <p className="font-semibold text-zinc-300">What we ask for + what we don&apos;t</p>
            <ul className="mt-1 space-y-0.5">
              <li>✓ <strong className="text-emerald-300">gmail.send</strong> scope only — the narrowest possible Gmail permission</li>
              <li>✗ We <strong>never</strong> read your inbox, contacts, drafts, calendar, or any other Google service</li>
              <li>✗ We <strong>don&apos;t</strong> store email contents — sends go through Gmail&apos;s API directly to legislators</li>
              <li>✓ Disconnect anytime at <a href="/account" className="text-emerald-400 hover:underline">/account</a>; revoke at <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline">myaccount.google.com/permissions</a></li>
            </ul>
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            Prefer to skip? Use the manual options below — same emails, just one at a time.
          </p>
        </div>
      )}

      {/* Platform-Gmail one-click batch (when connected) */}
      {!allAlreadySent && gmailConnected && sentVia !== "platform_gmail" && (
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

          {/* Pre-send disclaimer — explains what happens after click */}
          <div className="mt-3 rounded-md border border-zinc-800 bg-zinc-950/60 p-3 text-xs text-zinc-400">
            <p>
              <strong className="text-zinc-200">What happens when you click:</strong>{" "}
              We send the emails in the background — you won&apos;t see a popup or
              compose window. Watch this card for the success count, then check your{" "}
              <a
                href="https://mail.google.com/mail/u/0/#sent"
                target="_blank"
                rel="noreferrer"
                className="text-emerald-400 hover:underline"
              >
                Gmail Sent folder
              </a>{" "}
              to see the actual messages.
            </p>
          </div>

          <button
            onClick={platformGmailSend}
            className="group mt-3 flex w-full items-center justify-center gap-3 rounded-lg bg-emerald-500 px-6 py-3.5 text-base font-bold text-zinc-950 transition hover:bg-emerald-400"
          >
            <BoltIcon /> Send {targetsWithEmail.length} personalized emails →
          </button>
          {batchError && (
            <p className="mt-2 rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-sm text-red-300">
              {batchError}
            </p>
          )}
        </div>
      )}

      {sentVia === "platform_gmail" && batchProgress && (
        <div className="mt-6 rounded-xl border-2 border-emerald-500 bg-gradient-to-br from-emerald-950/40 to-zinc-950/40 p-6">
          <div className="flex items-start gap-3">
            <div className="text-3xl">✓</div>
            <div className="flex-1">
              <p className="text-xl font-bold text-emerald-300">
                Sent {batchProgress.sent} of {batchProgress.total}
              </p>
              <p className="mt-1 text-sm text-zinc-300">
                Each email went out from <span className="font-mono text-emerald-300">{gmailEmail}</span>.
                They&apos;re now in your Gmail Sent folder.
              </p>
              {batchProgress.failed > 0 && (
                <p className="mt-2 text-sm text-amber-300">
                  {batchProgress.failed} failed — try the manual options below to retry those.
                </p>
              )}
              <a
                href="https://mail.google.com/mail/u/0/#sent"
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex items-center gap-2 rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400"
              >
                Open Gmail Sent folder ↗
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Send options — three reliable paths */}
      <div className="mt-6">
        <p className="mb-2 text-xs uppercase tracking-wider text-zinc-500">
          {gmailConnected ? "Or send manually" : "Pick how to send"}
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          <SendOption
            href={buildGmailUrl()}
            target="_blank"
            label="Open in Gmail"
            sub="Web compose tab"
            primary={!gmailConnected}
            onClick={() => logAction("gmail")}
            done={sentVia === "gmail"}
          />
          <SendOption
            href={buildOutlookUrl()}
            target="_blank"
            label="Open in Outlook"
            sub="Web compose tab"
            onClick={() => logAction("outlook")}
            done={sentVia === "outlook"}
          />
          <SendOption
            href={buildMailto()}
            label="Default email app"
            sub="Apple Mail / Thunderbird"
            onClick={() => logAction("mailto")}
            done={sentVia === "mailto"}
          />
        </div>

        <button
          onClick={copyAll}
          className="mt-3 w-full rounded-md border border-zinc-800 bg-zinc-950/60 px-4 py-2.5 text-sm text-zinc-300 hover:border-emerald-500 hover:text-emerald-300"
        >
          {copied ? "✓ Copied — paste anywhere" : "Or copy the whole message"}
        </button>

        {sentVia && (
          <p className="mt-4 rounded-md border border-emerald-900/40 bg-emerald-950/30 px-3 py-2 text-center text-sm text-emerald-300">
            ✓ Compose window opened. Hit Send in there to add your voice to the record.
          </p>
        )}
      </div>

      <p className="mt-3 text-center text-xs text-zinc-500">
        The email comes from <em>your</em> address — what legislators actually read.
      </p>

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
}: {
  href: string;
  target?: string;
  label: string;
  sub: string;
  primary?: boolean;
  onClick: () => void;
  done?: boolean;
}) {
  const base =
    "group flex flex-col items-center gap-0.5 rounded-md px-3 py-3 text-center transition";
  const cls = done
    ? "bg-emerald-700 text-zinc-950"
    : primary
    ? "bg-emerald-500 text-zinc-950 hover:bg-emerald-400"
    : "border border-zinc-700 text-zinc-200 hover:border-emerald-500 hover:bg-zinc-950";

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

function BoltIcon() {
  return (
    <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
      <path d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" />
    </svg>
  );
}

/**
 * Recipient list with a "Show all N" toggle so 100+ recipient chips
 * don't blow out the page on state-floor campaigns. Default cap of 12
 * tuned for one mobile screen.
 */
function RecipientChips({ targets }: { targets: Legislator[] }) {
  const CAP = 12;
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? targets : targets.slice(0, CAP);
  const hidden = Math.max(0, targets.length - CAP);
  return (
    <>
      <ul className="mt-3 flex flex-wrap gap-2">
        {visible.map((t) => (
          <li
            key={t.id}
            className="rounded-full border border-emerald-700/40 bg-emerald-950/20 px-3 py-1 text-xs"
          >
            <span className="text-emerald-300">{ROLE_SHORT[t.role] ?? t.role}</span>{" "}
            <span className="text-zinc-200">{t.full_name}</span>
            {t.district && <span className="text-zinc-500"> · D{t.district}</span>}
          </li>
        ))}
        {hidden > 0 && !expanded && (
          <li>
            <button
              onClick={() => setExpanded(true)}
              className="rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs text-zinc-400 hover:border-emerald-500 hover:text-emerald-300"
            >
              + {hidden} more →
            </button>
          </li>
        )}
        {expanded && targets.length > CAP && (
          <li>
            <button
              onClick={() => setExpanded(false)}
              className="rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs text-zinc-400 hover:border-emerald-500 hover:text-emerald-300"
            >
              Show fewer ↑
            </button>
          </li>
        )}
      </ul>
    </>
  );
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
