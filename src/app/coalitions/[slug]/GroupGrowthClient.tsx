"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  decideJoinRequest,
  getGroupLink,
  requestToJoin,
  setGroupAction,
  setGroupVisibility,
} from "@/modules/coalitions/growth-actions";

/** Group growth, interactive half (migration 0274). */

const btn = "rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-40";
const ghost = "rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:border-emerald-500";

/** The one reusable group link + QR. Members can share it once an organizer turns it on. */
export function GroupLinkCard({ coalitionId }: { coalitionId: string }) {
  const [link, setLink] = useState<{ url: string; qrSvg: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  return (
    <section className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
      <h2 className="text-sm font-bold text-zinc-200">🔗 Invite people</h2>
      <p className="mt-1 text-xs text-zinc-400">
        One link for everyone. New people sign up first, then land in the group, and you get referral credit.
      </p>
      {!link ? (
        <button type="button" disabled={pending} className={`${btn} mt-3`}
          onClick={() => start(async () => {
            setError(null);
            const r = await getGroupLink(coalitionId);
            if (r.ok) setLink({ url: r.url, qrSvg: r.qrSvg }); else setError(r.error);
          })}>
          {pending ? "Getting link…" : "Show the group link + QR code"}
        </button>
      ) : (
        <div className="mt-3 flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1">
            <p className="break-all rounded bg-zinc-900 px-2 py-1.5 font-mono text-xs text-emerald-300">{link.url}</p>
            <button type="button" className={`${ghost} mt-2`}
              onClick={async () => { try { await navigator.clipboard.writeText(link.url); setCopied(true); setTimeout(() => setCopied(false), 3000); } catch { /* ignore */ } }}>
              {copied ? "✓ Copied" : "Copy link"}
            </button>
            <p className="mt-2 text-[11px] text-zinc-500">Print the QR for meetings, shops and events. Anyone who scans it can join.</p>
          </div>
          {/* SVG generated server-side by the qrcode library from our own URL. */}
          <div className="h-[160px] w-[160px] rounded bg-white p-1 [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: link.qrSvg }} />
        </div>
      )}
      {error && <p className="mt-2 text-xs text-amber-300">{error}</p>}
    </section>
  );
}

export function VisibilityToggle({ coalitionId, isPublic }: { coalitionId: string; isPublic: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 text-sm">
      <p className="text-zinc-200">
        This group is <strong>{isPublic ? "public" : "private"}</strong>.{" "}
        {isPublic
          ? "Anyone can see its page and ask to join; you approve each request."
          : "Only people with your link can find it."}
      </p>
      <button type="button" disabled={pending} className={`${ghost} mt-2`}
        onClick={() => start(async () => {
          const r = await setGroupVisibility(coalitionId, !isPublic);
          if (!r.ok) setError(r.error ?? "Couldn't change it."); else router.refresh();
        })}>
        {isPublic ? "Make it private" : "Make it public (recruit from the group directory)"}
      </button>
      {error && <p className="mt-1 text-xs text-amber-300">{error}</p>}
    </div>
  );
}

export function RequestToJoin({ coalitionId }: { coalitionId: string }) {
  const [msg, setMsg] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (done) return <p className="mt-4 rounded border border-emerald-800/50 bg-emerald-950/20 p-3 text-sm text-emerald-300">{done}</p>;
  return (
    <div className="mt-4 rounded-lg border border-emerald-700/40 bg-emerald-950/10 p-4">
      <p className="text-sm font-semibold text-zinc-100">Want in?</p>
      <textarea value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={500} rows={2}
        placeholder="Optional: a line about why you'd like to join"
        aria-label="Message to the organizers"
        className="mt-2 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none" />
      <button type="button" disabled={pending} className={`${btn} mt-2`}
        onClick={() => start(async () => {
          setError(null);
          const r = await requestToJoin(coalitionId, msg);
          if (r.ok) setDone("Request sent. The organizers will let you in."); else setError(r.error ?? "Couldn't send it.");
        })}>
        {pending ? "Sending…" : "Ask to join"}
      </button>
      {error && <p className="mt-1 text-xs text-amber-300">{error}</p>}
    </div>
  );
}

export function DecideRequest({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const decide = (approve: boolean) => start(async () => {
    const r = await decideJoinRequest(requestId, approve);
    if (!r.ok) setError(r.error ?? "Couldn't save that."); else router.refresh();
  });
  return (
    <span className="mt-2 flex items-center gap-2">
      <button type="button" disabled={pending} onClick={() => decide(true)} className="rounded bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-zinc-950 hover:bg-emerald-500">Approve</button>
      <button type="button" disabled={pending} onClick={() => decide(false)} className={ghost}>Decline</button>
      {error && <span className="text-[11px] text-amber-300">{error}</span>}
    </span>
  );
}

export function GroupActionPicker({ coalitionId, current, options }: { coalitionId: string; current: string | null; options: { slug: string; title: string }[] }) {
  const router = useRouter();
  const [slug, setSlug] = useState(current ?? "");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer text-xs text-zinc-400 hover:text-emerald-300">
        {current ? "Change the group action" : "Pick the group action"}
      </summary>
      <div className="mt-2 space-y-2">
        <select value={slug} onChange={(e) => setSlug(e.target.value)} aria-label="Campaign"
          className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-2 py-2 text-sm text-zinc-100">
          <option value="">(none)</option>
          {options.map((o) => <option key={o.slug} value={o.slug}>{o.title}</option>)}
        </select>
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200}
          placeholder="Optional note, e.g. Let's all send this before Friday's hearing" aria-label="Note to the group"
          className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100" />
        <button type="button" disabled={pending} className={btn}
          onClick={() => start(async () => {
            setError(null);
            const r = await setGroupAction(coalitionId, slug || null, note);
            if (!r.ok) setError(r.error ?? "Couldn't save that."); else router.refresh();
          })}>
          {pending ? "Saving…" : "Save and tell the group"}
        </button>
        {error && <p className="text-xs text-amber-300">{error}</p>}
      </div>
    </details>
  );
}
