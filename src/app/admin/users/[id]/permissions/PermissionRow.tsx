"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setUserPermissionOverride } from "@/modules/admin/permissions-actions";
import type { Permission } from "@/modules/admin/permissions";

export function PermissionRow({
  userId,
  permission,
  hasOverride,
  overrideGranted,
  overrideReason,
  roleDefault,
  effective,
  canEdit,
}: {
  userId: string;
  permission: Permission;
  hasOverride: boolean;
  overrideGranted: boolean | null;
  overrideReason: string | null;
  roleDefault: boolean;
  effective: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function setOverride(granted: boolean | null) {
    if (!canEdit) return;
    let reason = "";
    if (granted !== null) {
      const promptText = granted
        ? `GRANT "${permission.label}" to this user?\n\nThis overrides their role default. Audit log reason:`
        : `REVOKE "${permission.label}" from this user?\n\nThis overrides their role default. Audit log reason:`;
      reason = prompt(promptText) ?? "";
      if (!reason.trim()) return;
    } else {
      if (!confirm(`Clear override for "${permission.label}"?\n\nReverts to the user's role default.`)) return;
    }
    setError(null);
    startTransition(async () => {
      const r = await setUserPermissionOverride({
        userId,
        permission: permission.key,
        granted,
        reason: granted !== null ? reason : undefined,
      });
      if ("error" in r && r.error) setError(r.error);
      else router.refresh();
    });
  }

  // Source label: what determined the current effective state?
  let sourceLabel: string;
  let sourceCls: string;
  if (hasOverride && overrideGranted === true) {
    sourceLabel = "Override → granted";
    sourceCls = "bg-emerald-950/40 text-emerald-300";
  } else if (hasOverride && overrideGranted === false) {
    sourceLabel = "Override → revoked";
    sourceCls = "bg-red-950/40 text-red-300";
  } else if (roleDefault) {
    sourceLabel = "Role default → granted";
    sourceCls = "bg-zinc-900 text-zinc-400";
  } else {
    sourceLabel = "Role default → denied";
    sourceCls = "bg-zinc-900 text-zinc-500";
  }

  return (
    <li
      className={`rounded-md border p-3 ${
        permission.dangerous ? "border-red-900/40 bg-red-950/5" : "border-zinc-800 bg-zinc-950/60"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                effective ? "bg-emerald-400" : "bg-zinc-700"
              }`}
            />
            <p className="font-medium text-zinc-100">{permission.label}</p>
            {permission.dangerous && (
              <span className="rounded bg-red-950/60 px-1.5 py-0.5 text-[9px] font-bold uppercase text-red-300">
                Sensitive
              </span>
            )}
            <span className={`ml-auto rounded px-1.5 py-0.5 text-[10px] ${sourceCls}`}>
              {sourceLabel}
            </span>
          </div>
          <p className="mt-1 text-xs text-zinc-500">{permission.description}</p>
          {permission.defaultFor.length > 0 && (
            <p className="mt-1 text-[10px] text-zinc-600">
              Default for: {permission.defaultFor.join(", ")}
            </p>
          )}
          {hasOverride && overrideReason && (
            <p className="mt-1 text-[10px] italic text-zinc-500">
              Reason: {overrideReason}
            </p>
          )}
        </div>
      </div>

      {canEdit && (
        <div className="mt-3 flex flex-wrap gap-1">
          <button
            onClick={() => setOverride(true)}
            disabled={pending || (hasOverride && overrideGranted === true)}
            className={`rounded-md border px-2.5 py-1 text-xs disabled:opacity-30 ${
              hasOverride && overrideGranted === true
                ? "border-emerald-500 bg-emerald-950/40 text-emerald-300"
                : "border-zinc-700 text-zinc-300 hover:border-emerald-500 hover:text-emerald-300"
            }`}
          >
            ✓ Grant
          </button>
          <button
            onClick={() => setOverride(false)}
            disabled={pending || (hasOverride && overrideGranted === false)}
            className={`rounded-md border px-2.5 py-1 text-xs disabled:opacity-30 ${
              hasOverride && overrideGranted === false
                ? "border-red-500 bg-red-950/40 text-red-300"
                : "border-zinc-700 text-zinc-300 hover:border-red-500 hover:text-red-300"
            }`}
          >
            ✗ Revoke
          </button>
          {hasOverride && (
            <button
              onClick={() => setOverride(null)}
              disabled={pending}
              className="rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-400 hover:border-zinc-500 disabled:opacity-30"
            >
              Clear override
            </button>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
    </li>
  );
}
