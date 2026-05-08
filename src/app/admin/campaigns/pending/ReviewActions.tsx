"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approvePendingCampaign, rejectPendingCampaign } from "@/modules/admin/campaign-review-actions";
import { MfaInlineModal } from "@/components/MfaInlineModal";

/** Match the wording from requireMfaForMutation in src/modules/admin/mfa.ts. */
function isMfaError(msg: string | null) {
  return !!msg && /two-factor verification required/i.test(msg);
}

export function ReviewActions({ campaignId }: { campaignId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // When set, the MFA modal pops up; on success we re-run the saved
  // action so the user doesn't have to click Approve/Reject again.
  const [pendingAction, setPendingAction] = useState<null | "approve" | "reject">(null);
  const [pendingRejectReason, setPendingRejectReason] = useState<string | undefined>(undefined);

  function approve() {
    if (!confirm("Approve and publish this campaign? Matched users will be notified.")) return;
    setError(null);
    startTransition(async () => {
      const r = await approvePendingCampaign(campaignId);
      if ("error" in r) {
        setError(r.error ?? "Failed");
        if (isMfaError(r.error ?? null)) setPendingAction("approve");
      } else {
        router.refresh();
      }
    });
  }

  function reject(prefilledReason?: string) {
    const reason = prefilledReason !== undefined
      ? prefilledReason
      : (prompt("Reason for rejection (optional, audit-log only):") ?? null);
    if (reason === null) return; // user hit cancel on prompt
    const r = reason || undefined;
    setError(null);
    setPendingRejectReason(r);
    startTransition(async () => {
      const result = await rejectPendingCampaign({ campaignId, reason: r });
      if ("error" in result) {
        setError(result.error ?? "Failed");
        if (isMfaError(result.error ?? null)) setPendingAction("reject");
      } else {
        router.refresh();
      }
    });
  }

  // Called by the modal after a successful TOTP verify. The bypass
  // cookie is now set, so the next call to approve/reject sails past
  // requireMfaForMutation.
  function onMfaSuccess() {
    const action = pendingAction;
    setPendingAction(null);
    setError(null);
    if (action === "approve") {
      // Re-call without the confirm dialog (user already confirmed once)
      startTransition(async () => {
        const r = await approvePendingCampaign(campaignId);
        if ("error" in r) setError(r.error ?? "Failed");
        else router.refresh();
      });
    } else if (action === "reject") {
      reject(pendingRejectReason ?? "");
    }
  }

  const showMfa = pendingAction !== null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={approve}
          disabled={pending}
          className="rounded-md bg-emerald-500 px-4 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          {pending ? "…" : "Approve + publish"}
        </button>
        <button
          onClick={() => reject()}
          disabled={pending}
          className="rounded-md border border-red-900/50 px-3 py-1.5 text-xs text-red-300 hover:border-red-700 disabled:opacity-50"
        >
          Reject
        </button>
        {error && (
          <>
            {isMfaError(error) ? (
              <button
                onClick={() => setPendingAction(pendingAction ?? "approve")}
                className="inline-flex items-center gap-1.5 rounded-md border border-amber-700/50 bg-amber-950/30 px-3 py-1.5 text-xs font-semibold text-amber-300 hover:border-amber-500"
              >
                🔐 Verify 2FA to continue →
              </button>
            ) : (
              <span className="text-xs text-red-300">{error}</span>
            )}
          </>
        )}
      </div>

      {showMfa && (
        <MfaInlineModal
          title="Verify 2FA to publish"
          subtitle="Sensitive admin actions need a fresh code each hour. Enter the 6-digit code from your authenticator app."
          onClose={() => setPendingAction(null)}
          onSuccess={onMfaSuccess}
        />
      )}
    </>
  );
}
