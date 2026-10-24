"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markGroupLinkShared, updateGroupAbout } from "@/modules/coalitions/home-actions";
import { leaveCoalition } from "@/modules/coalitions/actions";
import { COVER_CLASS, COVER_LABEL, COVER_THEMES, type CoverTheme } from "@/modules/coalitions/covers";

/** Group home, interactive bits: one-tap Invite, the About editor, Leave. */

/**
 * One tap: the phone's share sheet with the group link, which the page
 * fetched already (iOS only opens the sheet straight from a tap, with no
 * server round trip in between). Falls back to copying, then to the invite
 * card with the QR.
 */
export function InviteButton({ coalitionId, groupName, shareUrl, unavailable }: {
  coalitionId: string; groupName: string; shareUrl: string | null; unavailable: string | null;
}) {
  const [note, setNote] = useState<string | null>(null);
  async function invite() {
    setNote(null);
    if (!shareUrl) { setNote(unavailable ?? "The group link isn't on yet."); return; }
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: groupName, text: `Join ${groupName} on iKratom:`, url: shareUrl });
      } else {
        await navigator.clipboard.writeText(shareUrl);
        setNote("Link copied. Paste it anywhere.");
      }
      void markGroupLinkShared(coalitionId);
    } catch (e) {
      // Closing the share sheet is not an error worth showing.
      if ((e as Error)?.name !== "AbortError") document.getElementById("invite")?.scrollIntoView({ behavior: "smooth" });
    }
  }
  return (
    <div className="flex flex-1 flex-col sm:flex-none">
      <button type="button" onClick={invite}
        className="min-h-11 rounded-md bg-emerald-500 px-4 text-sm font-semibold text-zinc-950 hover:bg-emerald-400">
        ＋ Invite
      </button>
      {note && <span className="mt-1 text-[11px] text-zinc-400">{note}</span>}
    </div>
  );
}

export function AboutEditor({ coalitionId, description, coverTheme }: {
  coalitionId: string; description: string | null; coverTheme: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(description ?? "");
  const [cover, setCover] = useState<CoverTheme>((COVER_THEMES as readonly string[]).includes(coverTheme ?? "") ? (coverTheme as CoverTheme) : "emerald");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="min-h-10 rounded-md border border-zinc-700 px-3 text-sm text-zinc-200 hover:border-emerald-500">
        ✏️ Edit About and cover
      </button>
    );
  }
  return (
    <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
      <label className="block text-xs text-zinc-400">About this group
        <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} rows={5}
          placeholder="What the group is for, where you are, and what you're working on right now."
          className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-base text-zinc-100 focus:border-emerald-500 focus:outline-none sm:text-sm" />
      </label>
      <fieldset>
        <legend className="text-xs text-zinc-400">Cover</legend>
        <div className="mt-1 grid grid-cols-4 gap-2">
          {COVER_THEMES.map((t) => (
            <button key={t} type="button" onClick={() => setCover(t)} aria-pressed={cover === t} title={COVER_LABEL[t]}
              className={`h-12 rounded-md ${COVER_CLASS[t]} ${cover === t ? "ring-2 ring-emerald-400 ring-offset-2 ring-offset-zinc-950" : ""}`}>
              <span className="sr-only">{COVER_LABEL[t]}</span>
            </button>
          ))}
        </div>
      </fieldset>
      {error && <p className="text-xs text-red-300">{error}</p>}
      <div className="flex gap-2">
        <button type="button" disabled={pending}
          className="min-h-11 rounded-md bg-emerald-500 px-4 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-40"
          onClick={() => start(async () => {
            setError(null);
            const r = await updateGroupAbout(coalitionId, text, cover);
            if (!r.ok) { setError(r.error ?? "Couldn't save that."); return; }
            setOpen(false);
            router.refresh();
          })}>
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="min-h-11 px-3 text-sm text-zinc-400">Cancel</button>
      </div>
    </div>
  );
}

/** Members could not leave before: the button sat inside the organizers-only panel. */
export function LeaveGroup({ coalitionId }: { coalitionId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!confirming) {
    return <button type="button" onClick={() => setConfirming(true)} className="text-sm text-zinc-500 hover:text-red-300">Leave this group</button>;
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-sm">
      <span className="text-zinc-300">Leave? You&apos;ll need the group link to come back.</span>
      <button type="button" disabled={pending} className="rounded border border-red-700 px-2 py-1 text-red-300"
        onClick={() => start(async () => {
          const r = await leaveCoalition(coalitionId);
          if (!r.ok) { setError(r.error); return; }
          router.push("/coalitions");
        })}>
        {pending ? "Leaving…" : "Yes, leave"}
      </button>
      <button type="button" onClick={() => setConfirming(false)} className="text-zinc-500">Stay</button>
      {error && <span className="text-amber-300">{error}</span>}
    </span>
  );
}
