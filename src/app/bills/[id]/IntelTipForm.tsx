"use client";

import { useState, useTransition } from "react";
import { submitBillIntelTip, type SubmitTipInput } from "@/modules/bills/intel-tip-actions";

/**
 * Submit-intel form on bill detail pages.
 *
 * Owner directive: "an 'add additional intel' button for people who
 * have local intel to share. we need to out shine the agencies in
 * our own right."
 *
 * Posts to the existing policy_alerts queue with moderation_status=
 * 'pending'. Admins triage at /admin/intel-queue.
 */
export function IntelTipForm({
  billId,
  billTitle,
  billState,
  billLocality,
}: {
  billId: string;
  billTitle: string;
  billState: string;
  billLocality: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [intel, setIntel] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [isAnon, setIsAnon] = useState(false);
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);

  function submit() {
    setFeedback(null);
    const input: SubmitTipInput = {
      billId, billTitle, billState, billLocality,
      intel,
      sourceUrl: sourceUrl.trim() || undefined,
      isAnonymous: isAnon,
    };
    startTransition(async () => {
      const r = await submitBillIntelTip(input);
      if ("error" in r && r.error) {
        setFeedback(r.error);
      } else {
        setFeedback("✓ Submitted. An admin will review and surface it to other advocates.");
        setIntel("");
        setSourceUrl("");
        setTimeout(() => { setOpen(false); setFeedback(null); }, 2500);
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-violet-700/50 bg-violet-950/20 px-3 py-1.5 text-xs font-medium text-violet-300 transition hover:border-violet-500 hover:bg-violet-950/40"
      >
        ➕ Add local intel
      </button>
    );
  }

  const remaining = 4000 - intel.length;
  const tooShort = intel.trim().length < 20;

  return (
    <div className="rounded-md border border-violet-700/40 bg-violet-950/15 p-4 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-semibold text-violet-300">Submit local intel</p>
        <button
          type="button"
          onClick={() => { setOpen(false); setFeedback(null); }}
          className="text-xs text-zinc-500 hover:text-zinc-300"
        >
          Cancel
        </button>
      </div>
      <p className="mt-1 text-[11px] text-zinc-400">
        Something we missed about this bill — a sponsor meeting you witnessed, a community-leader contact, an industry connection, a sponsor&apos;s upcoming public appearance, anything that would help advocates. Admins review before it goes live.
      </p>
      <label className="mt-3 block">
        <span className="text-[11px] text-zinc-400">Intel <span className="text-zinc-600">(20-4000 chars · {Math.max(0, remaining)} left)</span></span>
        <textarea
          value={intel}
          onChange={(e) => setIntel(e.target.value.slice(0, 4000))}
          rows={4}
          placeholder="e.g. 'Spoke with Legislator Mazzarella's chief of staff at the May 12 hearing. They confirmed the resolution is going to be re-tabled at the next General Meeting if more than 30 public commenters show up.'"
          className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950/60 px-2 py-1.5 text-[13px] text-zinc-100"
        />
      </label>
      <label className="mt-2 block">
        <span className="text-[11px] text-zinc-400">Source URL <span className="text-zinc-600">(optional — link to article, post, doc)</span></span>
        <input
          type="url"
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          placeholder="https://..."
          className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950/60 px-2 py-1 text-zinc-100"
        />
      </label>
      <label className="mt-3 flex items-center gap-2 text-[11px] text-zinc-400">
        <input
          type="checkbox"
          checked={isAnon}
          onChange={(e) => setIsAnon(e.target.checked)}
          className="h-3.5 w-3.5"
        />
        Submit anonymously (don&apos;t attach my user account)
      </label>
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={pending || tooShort}
          className="rounded-md bg-violet-600 px-3 py-1 text-sm font-medium text-violet-50 hover:bg-violet-500 disabled:opacity-50"
        >
          {pending ? "Submitting…" : "Submit intel"}
        </button>
        {feedback && (
          <span className={feedback.startsWith("✓") ? "text-emerald-400 text-[11px]" : "text-red-400 text-[11px]"}>
            {feedback}
          </span>
        )}
      </div>
      <p className="mt-2 text-[10px] text-zinc-600">
        Submissions go to the intel queue (/admin/intel-queue). Review usually within 24h.
      </p>
    </div>
  );
}
