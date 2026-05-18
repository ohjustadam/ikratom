"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCoalitionInvite, leaveCoalition } from "@/modules/coalitions/actions";

export function CoalitionAdminPanel({
  coalitionId,
  viewerRole,
}: {
  coalitionId: string;
  viewerRole: "owner" | "admin" | "member";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [maxUses, setMaxUses] = useState(1);
  const [expiresIn, setExpiresIn] = useState(14);
  const [copied, setCopied] = useState(false);

  function generate() {
    setError(null);
    setInviteUrl(null);
    setCopied(false);
    startTransition(async () => {
      const res = await createCoalitionInvite({
        coalition_id: coalitionId,
        max_uses: maxUses,
        expires_in_days: expiresIn,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setInviteUrl(res.url);
    });
  }

  function copy() {
    if (!inviteUrl) return;
    navigator.clipboard?.writeText(inviteUrl).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 1500); },
      () => { setError("Copy failed — select the link manually"); },
    );
  }

  function leave() {
    if (viewerRole === "owner") return; // disabled in UI
    if (!confirm("Leave this coalition? You'll need a new invite to rejoin.")) return;
    setError(null);
    startTransition(async () => {
      const res = await leaveCoalition(coalitionId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push("/coalitions");
    });
  }

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-zinc-300">
        Admin actions
      </h2>

      <div className="rounded border border-zinc-800 bg-zinc-900/40 p-3">
        <p className="text-[11px] font-semibold text-zinc-200">Generate an invite link</p>
        <p className="mt-1 text-[10px] text-zinc-500">
          Single-use by default; bump max uses for a public-organizer link. Links expire on the
          schedule you set below; you can also revoke from the invite list (v2).
        </p>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <label className="block text-[10px] text-zinc-400">
            <span className="block uppercase tracking-wider">Max uses</span>
            <input
              type="number"
              min={1}
              max={100}
              value={maxUses}
              onChange={(e) => setMaxUses(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
              className="mt-0.5 w-20 rounded border border-zinc-800 bg-zinc-950/60 px-2 py-1 text-zinc-100 focus:border-emerald-500 focus:outline-none"
            />
          </label>
          <label className="block text-[10px] text-zinc-400">
            <span className="block uppercase tracking-wider">Expires (days)</span>
            <input
              type="number"
              min={1}
              max={365}
              value={expiresIn}
              onChange={(e) => setExpiresIn(Math.max(1, Math.min(365, Number(e.target.value) || 14)))}
              className="mt-0.5 w-20 rounded border border-zinc-800 bg-zinc-950/60 px-2 py-1 text-zinc-100 focus:border-emerald-500 focus:outline-none"
            />
          </label>
          <button
            type="button"
            disabled={pending}
            onClick={generate}
            className="rounded-md bg-emerald-500 px-3 py-1.5 text-[11px] font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
          >
            {pending ? "Generating…" : "Generate"}
          </button>
        </div>

        {inviteUrl && (
          <div className="mt-3 rounded border border-emerald-700/40 bg-emerald-950/15 p-2">
            <div className="flex flex-wrap items-center gap-2">
              <code className="flex-1 break-all text-[10px] text-emerald-100">{inviteUrl}</code>
              <button
                type="button"
                onClick={copy}
                className="rounded bg-emerald-700 px-2 py-1 text-[10px] font-semibold text-zinc-100 hover:bg-emerald-600"
              >
                {copied ? "✓ Copied" : "Copy"}
              </button>
            </div>
            <p className="mt-1 text-[9px] text-zinc-500">
              Share this link in your group chat or via email. New members hit the URL → sign in
              → automatically join.
            </p>
          </div>
        )}
      </div>

      {viewerRole !== "owner" && (
        <div className="mt-3">
          <button
            type="button"
            disabled={pending}
            onClick={leave}
            className="rounded-md border border-red-700/40 bg-red-950/20 px-3 py-1.5 text-[11px] text-red-200 hover:bg-red-950/40 disabled:opacity-50"
          >
            Leave coalition
          </button>
        </div>
      )}

      {error && (
        <p className="mt-3 rounded border border-red-700/40 bg-red-950/15 px-3 py-2 text-[11px] text-red-200">
          {error}
        </p>
      )}
    </section>
  );
}
