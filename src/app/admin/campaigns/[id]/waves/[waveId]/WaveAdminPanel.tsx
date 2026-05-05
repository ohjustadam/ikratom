"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { retryWaveFailures } from "@/modules/waves/actions-admin";
import { cancelWave } from "@/modules/waves/actions";

type Wave = {
  id: string;
  campaign_id: string;
  fired_at: string | null;
  active: boolean;
};
type Signup = {
  id: string;
  user_id: string;
  joined_at: string;
  send_status: "pending" | "sent" | "failed" | "skipped" | "opted_out";
  send_error: string | null;
  sent_at: string | null;
};

const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  pending: { label: "Pending", cls: "bg-zinc-900 text-zinc-300" },
  sent: { label: "Sent", cls: "bg-emerald-950/40 text-emerald-300" },
  failed: { label: "Failed", cls: "bg-red-950/40 text-red-300" },
  skipped: { label: "Skipped", cls: "bg-amber-950/40 text-amber-300" },
  opted_out: { label: "Opted out", cls: "bg-zinc-900 text-zinc-500" },
};

export function WaveAdminPanel({
  wave,
  signups,
  profiles,
}: {
  wave: Wave;
  signups: Signup[];
  profiles: Record<string, { name: string; state: string | null }>;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const failedOrSkipped = signups.filter(
    (s) => s.send_status === "failed" || s.send_status === "skipped",
  );

  function retryAll() {
    if (!confirm(`Re-queue ${failedOrSkipped.length} failed/skipped signup${failedOrSkipped.length === 1 ? "" : "s"} for the next cron tick?`)) return;
    setError(null); setSuccess(null);
    startTransition(async () => {
      const r = await retryWaveFailures({ waveId: wave.id });
      if ("error" in r) setError(r.error ?? "Failed");
      else {
        setSuccess(`Reset ${r.count} signup${r.count === 1 ? "" : "s"}. Cron will retry within the hour.`);
        router.refresh();
      }
    });
  }

  function retryOne(signupId: string) {
    setError(null); setSuccess(null);
    startTransition(async () => {
      const r = await retryWaveFailures({ waveId: wave.id, signupIds: [signupId] });
      if ("error" in r) setError(r.error ?? "Failed");
      else {
        setSuccess(`Reset 1 signup.`);
        router.refresh();
      }
    });
  }

  function doCancel() {
    if (!confirm("Cancel this wave? Joined users will not receive emails. This can't be undone.")) return;
    setError(null); setSuccess(null);
    startTransition(async () => {
      const r = await cancelWave(wave.id);
      if ("error" in r) setError(r.error ?? "Failed");
      else {
        setSuccess("Wave cancelled.");
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
        {failedOrSkipped.length > 0 && (
          <button
            onClick={retryAll}
            disabled={pending}
            className="rounded-md border border-amber-700/50 bg-amber-950/20 px-3 py-1.5 text-sm text-amber-300 hover:border-amber-500 disabled:opacity-50"
          >
            Retry all {failedOrSkipped.length} failures
          </button>
        )}
        {wave.active && !wave.fired_at && (
          <button
            onClick={doCancel}
            disabled={pending}
            className="rounded-md border border-red-900/50 px-3 py-1.5 text-sm text-red-300 hover:border-red-700 disabled:opacity-50"
          >
            Cancel wave
          </button>
        )}
      </div>

      {error && (
        <p className="rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}
      {success && (
        <p className="rounded-md border border-emerald-900/40 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">
          {success}
        </p>
      )}

      {/* Signup list */}
      {signups.length === 0 ? (
        <p className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-8 text-center text-sm text-zinc-500">
          No advocates have joined this wave yet.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-950 text-xs uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="p-3 text-left">Advocate</th>
                <th className="p-3 text-left">Joined</th>
                <th className="p-3 text-left">Status</th>
                <th className="p-3 text-left">Detail</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900 bg-zinc-950/40">
              {signups.map((s) => {
                const profile = profiles[s.user_id];
                const tag = STATUS_STYLE[s.send_status] ?? STATUS_STYLE.pending;
                const canRetry = s.send_status === "failed" || s.send_status === "skipped";
                return (
                  <tr key={s.id}>
                    <td className="p-3">
                      <a
                        href={`/profile/${s.user_id}`}
                        className="text-zinc-200 hover:text-emerald-400"
                        target="_blank"
                        rel="noreferrer"
                      >
                        {profile?.name ?? "(unknown)"}
                      </a>
                      {profile?.state && (
                        <span className="ml-2 rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                          {profile.state}
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-xs text-zinc-500">
                      {new Date(s.joined_at).toLocaleString()}
                    </td>
                    <td className="p-3">
                      <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${tag.cls}`}>
                        {tag.label}
                      </span>
                    </td>
                    <td className="p-3 text-xs text-zinc-400">
                      {s.send_error ? (
                        <code className="text-red-400">{s.send_error}</code>
                      ) : s.sent_at ? (
                        <span>at {new Date(s.sent_at).toLocaleString()}</span>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </td>
                    <td className="p-3 text-right">
                      {canRetry && (
                        <button
                          onClick={() => retryOne(s.id)}
                          disabled={pending}
                          className="rounded border border-zinc-700 px-2 py-1 text-xs hover:border-amber-500 hover:text-amber-300 disabled:opacity-50"
                        >
                          Retry
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
