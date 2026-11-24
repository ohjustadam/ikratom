"use client";

import { useState, useTransition } from "react";
import { requiredOpen } from "@/modules/auth/promotion-checklist";
import { inviteLeader, revokeLeaderInvite } from "@/modules/admin/leader-invite-actions";
import type { ChecklistItem } from "@/modules/auth/promotion-checklist";
import { useSignIn } from "@/components/auth/SignInContext";
import { wasMfaRequired } from "@/lib/mfa-error";

/**
 * The full-width row under a member on /admin/users that explains a refused
 * leader promotion, or shows an open invite. A refusal used to be one small
 * line that vanished; this stays until the owner closes it.
 */
export function LeaderInvitePanel({
  userId,
  who,
  refusal,
  openInvite,
  onClose,
}: {
  userId: string;
  who: string;
  /** Set right after a refused promotion. */
  refusal: { items: ChecklistItem[]; canInvite: boolean } | null;
  /** Set when an invite is already waiting on the member. */
  openInvite: { line: string } | null;
  onClose?: () => void;
}) {
  const { requireMfa } = useSignIn();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [invited, setInvited] = useState(false);

  async function withMfa<T>(fn: () => Promise<T | { error: string }>): Promise<T | { error: string }> {
    let r = await fn();
    if (r && typeof r === "object" && "error" in r && wasMfaRequired(r.error)) {
      if (!(await requireMfa())) return { error: "Two-factor verification cancelled." };
      r = await fn();
    }
    return r;
  }

  function invite() {
    setMsg(null);
    start(async () => {
      const r = await withMfa(() => inviteLeader({ userId }));
      if ("error" in r) setMsg(`✗ ${r.error}`);
      else { setInvited(true); setMsg(`✓ ${r.line}`); }
    });
  }

  function revoke() {
    if (!confirm(`Withdraw the leader invite for ${who}?`)) return;
    setMsg(null);
    start(async () => {
      const r = await withMfa(() => revokeLeaderInvite({ userId }));
      setMsg("error" in r ? `✗ ${r.error}` : "✓ Invite withdrawn.");
    });
  }

  if (refusal) {
    const open = requiredOpen(refusal.items);
    return (
      <div className="rounded-lg border-2 border-amber-600/70 bg-amber-950/30 p-4 text-sm text-amber-100" role="alert">
        <p className="text-base font-bold text-amber-200">⚠ Not saved. {who} is not a leader yet.</p>
        <p className="mt-1 text-amber-100/90">
          The Leader role turns on only for verified accounts, so the campaign tools never go to a throwaway
          account. {who} still needs to:
        </p>
        <ul className="mt-2 list-disc space-y-0.5 pl-5">
          {open.map((i) => <li key={i.key}>{i.short}</li>)}
        </ul>
        {refusal.canInvite && !invited && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              onClick={invite}
              disabled={pending}
              className="rounded-md bg-amber-400 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-amber-300 disabled:opacity-50"
            >
              {pending ? "Inviting…" : `🎖 Invite ${who} to lead`}
            </button>
            <span className="text-xs text-amber-100/80">
              They get a notice with exactly what to finish. The role turns on by itself when they&apos;re done.
            </span>
          </div>
        )}
        {msg && <p className="mt-2 text-sm font-semibold">{msg}</p>}
        {onClose && (
          <button onClick={onClose} className="mt-3 text-xs text-amber-300 underline hover:text-amber-100">
            Close
          </button>
        )}
      </div>
    );
  }

  if (!openInvite) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-sky-700/50 bg-sky-950/20 px-3 py-2 text-xs text-sky-100">
      <span className="font-semibold">🎖 Invited to lead</span>
      <span className="text-sky-200/80">{openInvite.line}</span>
      <button onClick={revoke} disabled={pending} className="ml-auto text-sky-300 underline hover:text-sky-100 disabled:opacity-50">
        Withdraw
      </button>
      {msg && <span className="w-full">{msg}</span>}
    </div>
  );
}
