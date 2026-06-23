"use client";

import { useState, useTransition } from "react";
import { deleteMyAccount, exportMyData } from "../data-actions";

export function DangerZone() {
  const [pending, startTransition] = useTransition();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [password, setPassword] = useState("");
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function exportData() {
    setExportMsg(null);
    startTransition(async () => {
      const result = await exportMyData();
      if ("error" in result) {
        setExportMsg(`✗ ${result.error}`);
        return;
      }
      // Trigger a download
      const blob = new Blob([result.json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ikratom-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setExportMsg("✓ Downloaded");
    });
  }

  function deleteAccount() {
    setDeleteError(null);
    startTransition(async () => {
      const result = await deleteMyAccount({ confirmation, password });
      if (result && "error" in result && result.error) {
        setDeleteError(result.error);
      }
      // On success, server action redirects — no need to handle here
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-zinc-100">Export your data</h3>
        <p className="mt-1 text-xs text-zinc-500">
          Download a JSON file with everything we have on you — profile, threads, campaign
          actions, message metadata, integration settings. Direct messages stay encrypted
          (you&apos;d need your device key to decrypt).
        </p>
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={exportData}
            disabled={pending}
            className="rounded-md border border-zinc-700 px-4 py-2 text-sm hover:border-emerald-500 disabled:opacity-50"
          >
            {pending && !showDeleteConfirm ? "Preparing…" : "Download my data"}
          </button>
          {exportMsg && (
            <span className={`text-xs ${exportMsg.startsWith("✓") ? "text-emerald-300" : "text-red-300"}`}>
              {exportMsg}
            </span>
          )}
        </div>
      </div>

      <div className="border-t border-red-900/40 pt-6">
        <h3 className="text-sm font-semibold text-red-300">Delete your account</h3>
        <p className="mt-1 text-xs text-zinc-500">
          Permanent and immediate. Your profile, threads, posts, campaign action history, DM
          metadata, and all integrations are wiped. Encrypted DM ciphertext you sent stays in
          other people&apos;s conversations (we can&apos;t decrypt it to remove). Cannot be undone.
        </p>

        {!showDeleteConfirm ? (
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            className="mt-3 rounded-md border border-red-700/50 px-4 py-2 text-sm text-red-300 hover:bg-red-950/40"
          >
            Delete my account
          </button>
        ) : (
          <div className="mt-3 space-y-3 rounded-md border border-red-900/40 bg-red-950/10 p-4">
            <p className="text-sm text-zinc-200">
              Type{" "}
              <code className="rounded bg-zinc-900 px-1.5 py-0.5 text-red-300">DELETE MY ACCOUNT</code>{" "}
              to confirm.
            </p>
            <input
              type="text"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              placeholder="DELETE MY ACCOUNT"
              className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm font-mono focus:border-red-500 focus:outline-none"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your password"
              autoComplete="current-password"
              className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-red-500 focus:outline-none"
            />
            <p className="text-[11px] text-zinc-500">Re-enter your password to confirm this can&apos;t be undone.</p>
            {deleteError && (
              <p className="rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-sm text-red-300">
                {deleteError}
              </p>
            )}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={deleteAccount}
                disabled={pending || confirmation !== "DELETE MY ACCOUNT" || password.length === 0}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
              >
                {pending ? "Deleting…" : "Permanently delete"}
              </button>
              <button
                type="button"
                onClick={() => { setShowDeleteConfirm(false); setConfirmation(""); setPassword(""); setDeleteError(null); }}
                className="text-sm text-zinc-400 hover:text-emerald-400"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
