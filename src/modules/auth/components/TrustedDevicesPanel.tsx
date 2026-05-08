"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  revokeTrustedDevice,
  revokeAllTrustedDevices,
} from "../actions-trusted-devices";

type Device = {
  id: string;
  device_id: string;
  ua_summary: string | null;
  ip_seen: string | null;
  last_used_at: string;
  expires_at: string;
  created_at: string;
  is_current: boolean;
};

/**
 * /account/security panel listing trusted devices. Each row shows the
 * UA summary + last-used + expires + revoke button. The current device
 * is labeled and revoking it also clears the cookie.
 */
export function TrustedDevicesPanel({ initial }: { initial: Device[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onRevoke(d: Device) {
    if (
      !confirm(
        d.is_current
          ? "Revoke trust for THIS device? You'll need to enter your TOTP code on your next sign-in here."
          : `Revoke trust for ${d.ua_summary ?? "device"}?`,
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await revokeTrustedDevice(d.id);
      if ("error" in r) setError(r.error ?? "Failed");
      else router.refresh();
    });
  }

  function onRevokeAll() {
    if (!confirm(`Revoke trust for ALL ${initial.length} devices? Every sign-in will require the TOTP code again.`)) return;
    setError(null);
    startTransition(async () => {
      const r = await revokeAllTrustedDevices();
      if ("error" in r) setError(r.error ?? "Failed");
      else router.refresh();
    });
  }

  if (initial.length === 0) {
    return (
      <p className="text-xs text-zinc-500">
        No trusted devices. Check &ldquo;Remember this device&rdquo; during your next MFA sign-in
        to skip the code on routine logins from that browser.
      </p>
    );
  }

  return (
    <>
      <ul className="space-y-2">
        {initial.map((d) => (
          <li
            key={d.id}
            className={`rounded-md border p-3 text-sm ${
              d.is_current
                ? "border-emerald-700/50 bg-emerald-950/10"
                : "border-zinc-800 bg-zinc-950/40"
            }`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-zinc-100">
                {d.ua_summary ?? "Unknown device"}
              </span>
              {d.is_current && (
                <span className="rounded bg-emerald-950/40 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                  this device
                </span>
              )}
              <button
                onClick={() => onRevoke(d)}
                disabled={pending}
                className="ml-auto rounded-md border border-red-900/50 px-2 py-0.5 text-[11px] text-red-300 hover:border-red-700 disabled:opacity-50"
              >
                Revoke
              </button>
            </div>
            <p className="mt-1 font-mono text-[11px] text-zinc-500">
              IP {d.ip_seen ?? "—"} · last used {new Date(d.last_used_at).toLocaleString()} · expires {new Date(d.expires_at).toLocaleDateString()}
            </p>
          </li>
        ))}
      </ul>
      {initial.length > 1 && (
        <button
          onClick={onRevokeAll}
          disabled={pending}
          className="mt-3 rounded-md border border-red-900/50 px-3 py-1.5 text-xs text-red-300 hover:border-red-700 disabled:opacity-50"
        >
          Revoke all trusted devices
        </button>
      )}
      {error && (
        <p className="mt-2 rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-xs text-red-300">{error}</p>
      )}
    </>
  );
}
