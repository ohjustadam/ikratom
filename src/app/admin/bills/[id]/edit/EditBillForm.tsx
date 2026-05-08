"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateBill } from "@/modules/admin/bill-actions";
import { MfaInlineModal } from "@/components/MfaInlineModal";

type EditableBill = {
  id: string;
  status: string;
  kratom_relevance: string;
  relevance_confidence: number;
  active: boolean;
  title: string;
  summary: string;
  last_action: string;
  last_action_at: string;
  source_url: string;
};

function isMfaError(msg: string | null) {
  return !!msg && /two-factor verification required/i.test(msg);
}

export function EditBillForm({ bill }: { bill: EditableBill }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [showMfa, setShowMfa] = useState(false);
  const [pendingPatch, setPendingPatch] = useState<Partial<EditableBill> | null>(null);

  function fire(patch: Partial<EditableBill>) {
    setError(null);
    startTransition(async () => {
      const r = await updateBill({ id: bill.id, ...patch });
      if ("error" in r) {
        setError(r.error ?? "Failed");
        if (isMfaError(r.error ?? null)) {
          setPendingPatch(patch);
          setShowMfa(true);
        }
        return;
      }
      setSavedAt(new Date().toLocaleTimeString());
      router.refresh();
    });
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fire({
      status: String(fd.get("status") ?? bill.status),
      kratom_relevance: String(fd.get("kratom_relevance") ?? bill.kratom_relevance),
      relevance_confidence: Number(fd.get("relevance_confidence") ?? bill.relevance_confidence) || 0,
      active: fd.get("active") === "on",
      title: String(fd.get("title") ?? bill.title),
      summary: String(fd.get("summary") ?? bill.summary),
      last_action: String(fd.get("last_action") ?? bill.last_action),
      last_action_at: String(fd.get("last_action_at") ?? bill.last_action_at),
      source_url: String(fd.get("source_url") ?? bill.source_url),
    });
  }

  function onMfaSuccess() {
    setShowMfa(false);
    if (pendingPatch) {
      const patch = pendingPatch;
      setPendingPatch(null);
      fire(patch);
    }
  }

  return (
    <>
      <form onSubmit={onSubmit} className="space-y-5">
        {/* Active toggle — most-used quick action */}
        <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-4">
          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              name="active"
              defaultChecked={bill.active}
              className="h-5 w-5 rounded border-zinc-700 bg-zinc-900"
            />
            <span>
              <span className="block text-sm font-semibold text-zinc-100">Active</span>
              <span className="block text-xs text-zinc-500">
                Uncheck to hide from public bill lists. Use for stale, dead, or off-topic bills.
              </span>
            </span>
          </label>
        </div>

        {/* Status + relevance row */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Status" hint="Workflow stage. Set to 'dead' for failed bills.">
            <select
              name="status"
              defaultValue={bill.status}
              className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-emerald-500"
            >
              <option value="introduced">Introduced</option>
              <option value="committee">In committee</option>
              <option value="passed_chamber">Passed chamber</option>
              <option value="enacted">Enacted</option>
              <option value="dead">Dead</option>
            </select>
          </Field>
          <Field label="Kratom relevance" hint="Pro = protects natural leaf. Anti = restricts.">
            <select
              name="kratom_relevance"
              defaultValue={bill.kratom_relevance}
              className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-emerald-500"
            >
              <option value="pro">Pro-kratom</option>
              <option value="anti">Anti-kratom</option>
              <option value="neutral">Neutral</option>
              <option value="unknown">Unknown</option>
            </select>
          </Field>
        </div>

        <Field label="Relevance confidence (0.0 – 1.0)" hint="How sure are we? AI confidence usually lives here.">
          <input
            type="number"
            name="relevance_confidence"
            step="0.05"
            min="0"
            max="1"
            defaultValue={bill.relevance_confidence}
            className="w-32 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-emerald-500"
          />
        </Field>

        <Field label="Title" hint="The bill's official title.">
          <input
            name="title"
            defaultValue={bill.title}
            className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-emerald-500"
          />
        </Field>

        <Field label="Summary (official, plain text)" hint="The legislature's own summary if available. summary_long (AI-generated briefing) is separate.">
          <textarea
            name="summary"
            defaultValue={bill.summary}
            rows={4}
            className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm font-mono focus:border-emerald-500"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Last action (text)" hint="e.g. 'Referred to Judiciary'">
            <input
              name="last_action"
              defaultValue={bill.last_action}
              className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-emerald-500"
            />
          </Field>
          <Field label="Last action date (YYYY-MM-DD)" hint="ISO format. Leave blank to clear.">
            <input
              name="last_action_at"
              defaultValue={bill.last_action_at?.slice(0, 10) ?? ""}
              placeholder="2026-05-08"
              className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-emerald-500"
            />
          </Field>
        </div>

        <Field label="Source URL" hint="State legislature's bill page (LegiScan / OpenStates / city portal).">
          <input
            name="source_url"
            defaultValue={bill.source_url}
            placeholder="https://..."
            className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-emerald-500"
          />
        </Field>

        {error && !isMfaError(error) && (
          <div className="rounded-md border border-red-900/50 bg-red-950/30 p-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-emerald-500 px-5 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save changes"}
          </button>
          {savedAt && (
            <span className="text-xs text-emerald-400">✓ saved at {savedAt}</span>
          )}
          {error && isMfaError(error) && (
            <button
              type="button"
              onClick={() => setShowMfa(true)}
              className="rounded-md border border-amber-700/50 bg-amber-950/30 px-3 py-2 text-xs font-semibold text-amber-300 hover:border-amber-500"
            >
              🔐 Verify 2FA to continue →
            </button>
          )}
        </div>
      </form>

      {showMfa && (
        <MfaInlineModal
          title="Verify 2FA to save"
          subtitle="Editing bills is a sensitive admin action. Enter the 6-digit code from your authenticator app."
          onClose={() => setShowMfa(false)}
          onSuccess={onMfaSuccess}
        />
      )}
    </>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold uppercase tracking-wider text-zinc-400">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-zinc-500">{hint}</span>}
    </label>
  );
}
