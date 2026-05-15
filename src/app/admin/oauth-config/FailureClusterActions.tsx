"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { escalateAuthFailureToDevs, dismissAuthFailureCluster } from "@/modules/admin/auth-events-actions";

/**
 * Action row that appears next to every UNRESOLVED auth-failure cluster
 * on /admin/oauth-config.
 *
 * Two buttons:
 *   - "Send to devs" — files a GitHub issue against the repo. If the
 *     cluster already has dev_issue_url, the button is replaced with a
 *     direct link to the existing issue.
 *   - "Dismiss" — admin acknowledges + resolves the cluster manually.
 *     Future failures in the same cluster will re-escalate.
 */
export function FailureClusterActions({
  cluster,
}: {
  cluster: {
    kind: string;
    provider: string | null;
    error_code: string | null;
    dev_issue_url: string | null;
  };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [filedUrl, setFiledUrl] = useState<string | null>(cluster.dev_issue_url);
  const [error, setError] = useState<string | null>(null);

  function onSendToDevs() {
    setError(null);
    startTransition(async () => {
      const res = await escalateAuthFailureToDevs({
        kind: cluster.kind,
        provider: cluster.provider,
        errorCode: cluster.error_code,
      });
      if (res.ok) {
        setFiledUrl(res.issueUrl);
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  function onDismiss() {
    if (!confirm("Mark this cluster as resolved? Future failures will re-escalate.")) return;
    setError(null);
    startTransition(async () => {
      const res = await dismissAuthFailureCluster({
        kind: cluster.kind,
        provider: cluster.provider,
        errorCode: cluster.error_code,
      });
      if (res.ok) router.refresh();
      else setError(res.error);
    });
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
      {filedUrl ? (
        <a
          href={filedUrl}
          target="_blank"
          rel="noreferrer"
          className="rounded bg-emerald-700 px-2.5 py-1 font-semibold text-white hover:bg-emerald-600"
        >
          🔗 issue filed — view on GitHub ↗
        </a>
      ) : (
        <button
          type="button"
          onClick={onSendToDevs}
          disabled={pending}
          className="rounded bg-red-700 px-2.5 py-1 font-semibold text-white hover:bg-red-600 disabled:opacity-60"
        >
          {pending ? "filing…" : "📮 Send to devs"}
        </button>
      )}
      <button
        type="button"
        onClick={onDismiss}
        disabled={pending}
        className="rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-zinc-300 hover:border-emerald-500 disabled:opacity-60"
      >
        ✓ Dismiss
      </button>
      {error && (
        <span className="rounded border border-red-900/40 bg-red-950/40 px-2 py-0.5 text-red-300">
          {error}
        </span>
      )}
    </div>
  );
}
