"use client";

import { useState, useTransition } from "react";
import {
  setUserRoles,
  sendPasswordResetForUser,
  sendMagicLinkForUser,
  setAccountLocked,
  generateTempPassword,
} from "@/modules/admin/user-actions";
import { useSignIn } from "@/components/auth/SignInContext";
import { wasMfaRequired } from "@/lib/mfa-error";

type UserRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  state: string | null;
  city: string | null;
  county: string | null;
  is_admin: boolean;
  is_owner: boolean;
  is_advocate_leader: boolean;
  account_locked_at: string | null;
};

export function UserRolesRow({
  user,
  callerIsOwner,
  callerUserId,
}: {
  user: UserRow;
  callerIsOwner: boolean;
  callerUserId: string;
}) {
  const { requireMfa } = useSignIn();
  const [isAdmin, setIsAdmin] = useState(user.is_admin);
  const [isLeader, setIsLeader] = useState(user.is_advocate_leader);
  const [isOwner, setIsOwner] = useState(user.is_owner);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [tempModal, setTempModal] = useState<{ password: string; email: string } | null>(null);

  const isSelf = user.id === callerUserId;

  async function doSave(): Promise<{ ok: boolean; error?: string }> {
    const result = await setUserRoles({
      userId: user.id,
      isAdmin,
      isLeader,
      isOwner: callerIsOwner ? isOwner : undefined,
    });
    return result.error ? { ok: false, error: result.error } : { ok: true };
  }

  function save() {
    setMsg(null);
    startTransition(async () => {
      let result = await doSave();
      // MFA step-up: open the in-page modal instead of redirecting.
      // After successful verification, retry the same mutation. The
      // server will see the 1-hour mfa_bypass cookie and treat the
      // session as aal2.
      if (!result.ok && wasMfaRequired(result.error)) {
        const ok = await requireMfa();
        if (!ok) {
          setMsg("✗ Two-factor verification cancelled");
          setIsAdmin(user.is_admin);
          setIsLeader(user.is_advocate_leader);
          setIsOwner(user.is_owner);
          setTimeout(() => setMsg(null), 3000);
          return;
        }
        result = await doSave();
      }
      if (!result.ok) {
        setMsg(`✗ ${result.error}`);
        setIsAdmin(user.is_admin);
        setIsLeader(user.is_advocate_leader);
        setIsOwner(user.is_owner);
      } else {
        setMsg("✓ Saved");
        setTimeout(() => setMsg(null), 2000);
      }
    });
  }

  const dirty =
    isAdmin !== user.is_admin ||
    isLeader !== user.is_advocate_leader ||
    isOwner !== user.is_owner;

  function triggerReset() {
    if (!confirm(`Send a password-reset email to ${user.email}?\n\nThey'll get a link valid for 1 hour to set a new password.`)) return;
    setMsg(null);
    startTransition(async () => {
      const r = await sendPasswordResetForUser({ userId: user.id });
      setMsg(r.error ? `✗ ${r.error.slice(0, 80)}` : "✓ Reset email sent");
      setTimeout(() => setMsg(null), 4000);
    });
  }

  function triggerTempPassword() {
    if (
      !confirm(
        `Issue a temporary password for ${user.email}?\n\n` +
          `You'll see the temp password ONCE on the next screen — copy it and read it to the user.\n\n` +
          `The user will be forced to set their own password the moment they sign in with it. ` +
          `The user is also emailed a heads-up. Audit-logged.`
      )
    )
      return;
    setMsg(null);
    startTransition(async () => {
      const r = await generateTempPassword({ userId: user.id });
      if ("error" in r) {
        setMsg(`✗ ${r.error.slice(0, 100)}`);
        setTimeout(() => setMsg(null), 6000);
      } else {
        setTempModal({ password: r.tempPassword, email: r.email });
      }
    });
  }

  function triggerMagicLink() {
    if (!confirm(`Send a magic sign-in link to ${user.email}?\n\nFor users who can't remember their password but have inbox access. Less destructive than a full password reset.`)) return;
    setMsg(null);
    startTransition(async () => {
      const r = await sendMagicLinkForUser({ userId: user.id });
      setMsg(r.error ? `✗ ${r.error.slice(0, 80)}` : "✓ Magic link sent");
      setTimeout(() => setMsg(null), 4000);
    });
  }

  function toggleLock() {
    const isCurrentlyLocked = !!user.account_locked_at;
    if (isCurrentlyLocked) {
      if (!confirm(`Unlock ${user.email}'s account?\n\nThey'll regain full access.`)) return;
      startTransition(async () => {
        const r = await setAccountLocked({ userId: user.id, locked: false });
        setMsg(r.error ? `✗ ${r.error.slice(0, 80)}` : "✓ Unlocked");
        setTimeout(() => setMsg(null), 4000);
      });
    } else {
      const reason = prompt(`Lock ${user.email}'s account?\n\nThey'll be bounced to /locked on next request. Reason (audit trail):`);
      if (!reason) return;
      startTransition(async () => {
        const r = await setAccountLocked({ userId: user.id, locked: true, reason });
        setMsg(r.error ? `✗ ${r.error.slice(0, 80)}` : "✓ Locked");
        setTimeout(() => setMsg(null), 4000);
      });
    }
  }

  return (
    <tr>
      <td className="p-3">
        <div className="font-medium">{user.full_name || <span className="text-zinc-500">—</span>}</div>
        <div className="text-xs text-zinc-500">{user.email}</div>
      </td>
      <td className="p-3 text-xs text-zinc-400">
        {[user.city, user.state].filter(Boolean).join(", ") || <span className="text-zinc-600">—</span>}
      </td>
      <td className="p-3">
        <div className="flex justify-center gap-2 text-xs">
          {callerIsOwner && (
            <Toggle label="Owner" checked={isOwner} onChange={setIsOwner} disabled={isSelf} />
          )}
          <Toggle label="Admin" checked={isAdmin} onChange={setIsAdmin} disabled={isSelf && !isOwner} />
          <Toggle label="Leader" checked={isLeader} onChange={setIsLeader} />
        </div>
      </td>
      <td className="p-3">
        <div className="flex flex-wrap items-center justify-end gap-1">
          {msg && <span className="mr-2 text-xs text-zinc-400">{msg}</span>}
          {dirty && (
            <button
              onClick={save}
              disabled={pending}
              className="rounded-md border border-emerald-700/40 bg-emerald-950/20 px-2.5 py-1 text-xs text-emerald-300 hover:border-emerald-500 disabled:opacity-30"
            >
              {pending ? "…" : "Save roles"}
            </button>
          )}
          <details className="relative">
            <summary className="cursor-pointer list-none rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-zinc-500 [&::-webkit-details-marker]:hidden">
              Support ▾
            </summary>
            <div className="absolute right-0 top-full z-10 mt-1 w-56 rounded-md border border-zinc-700 bg-zinc-950 p-2 shadow-2xl">
              <button
                onClick={triggerMagicLink}
                disabled={pending}
                className="block w-full rounded px-2 py-1.5 text-left text-xs text-zinc-200 hover:bg-zinc-900"
              >
                📧 Send magic sign-in link
              </button>
              <button
                onClick={triggerReset}
                disabled={pending}
                className="block w-full rounded px-2 py-1.5 text-left text-xs text-zinc-200 hover:bg-zinc-900"
              >
                🔑 Send password reset
              </button>
              {!isSelf && (
                <button
                  onClick={triggerTempPassword}
                  disabled={pending}
                  className="block w-full rounded px-2 py-1.5 text-left text-xs text-zinc-200 hover:bg-zinc-900"
                >
                  🎟 Generate temp password
                </button>
              )}
              {callerIsOwner && !isSelf && (
                <button
                  onClick={toggleLock}
                  disabled={pending}
                  className={`block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-zinc-900 ${
                    user.account_locked_at ? "text-emerald-300" : "text-red-300"
                  }`}
                >
                  {user.account_locked_at ? "🔓 Unlock account" : "🔒 Lock account (owner)"}
                </button>
              )}
              <a
                href={`/admin/users/${user.id}/permissions`}
                className="block w-full rounded px-2 py-1.5 text-left text-xs text-zinc-200 hover:bg-zinc-900"
              >
                🎚 Permissions matrix
              </a>
              <a
                href={`/profile/${user.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full rounded px-2 py-1.5 text-left text-xs text-zinc-400 hover:bg-zinc-900"
              >
                👤 View public profile ↗
              </a>
            </div>
          </details>
        </div>
        {user.account_locked_at && (
          <p className="mt-1 text-right text-[10px] font-bold text-red-400">🔒 LOCKED</p>
        )}
        {tempModal && (
          <TempPasswordModal
            password={tempModal.password}
            email={tempModal.email}
            onClose={() => setTempModal(null)}
          />
        )}
      </td>
    </tr>
  );
}

function TempPasswordModal({
  password,
  email,
  onClose,
}: {
  password: string;
  email: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Some browsers without clipboard API in non-https context;
      // fall back to selecting the text.
      const el = document.getElementById("temp-pw-display");
      if (el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
  }
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-emerald-700/40 bg-zinc-950 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold text-emerald-300">Temporary password issued</h3>
        <p className="mt-1 text-xs text-zinc-400">
          For <span className="font-mono text-zinc-200">{email}</span>. Read this to
          the user — they&apos;ll be forced to set their own password the moment they
          sign in with it.
        </p>
        <div
          id="temp-pw-display"
          className="mt-4 select-all rounded-md border border-zinc-800 bg-zinc-900 px-3 py-3 text-center font-mono text-base font-bold tracking-wider text-emerald-200 break-all"
        >
          {password}
        </div>
        <div className="mt-3 flex gap-2">
          <button
            onClick={copy}
            className="flex-1 rounded-md bg-emerald-500 px-3 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400"
          >
            {copied ? "✓ Copied" : "Copy to clipboard"}
          </button>
          <button
            onClick={onClose}
            className="rounded-md border border-zinc-700 px-3 py-2 text-sm hover:border-zinc-500"
          >
            Done
          </button>
        </div>
        <p className="mt-4 text-[11px] text-amber-300/80">
          ⚠ This is shown ONCE. If the user loses it, generate a new one.
        </p>
        <p className="mt-2 text-[11px] text-zinc-500">
          The user has also been emailed a heads-up that an admin set a temp
          password — a safety net against unauthorized takeover.
        </p>
      </div>
    </div>
  );
}

function Toggle({
  label, checked, onChange, disabled,
}: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`flex items-center gap-1 ${disabled ? "opacity-40" : "cursor-pointer"}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="h-3.5 w-3.5 rounded border-zinc-700 bg-zinc-950"
      />
      <span>{label}</span>
    </label>
  );
}
