"use client";

import { useState, useTransition } from "react";
import { setUserRoles } from "@/modules/admin/user-actions";

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
  const [isAdmin, setIsAdmin] = useState(user.is_admin);
  const [isLeader, setIsLeader] = useState(user.is_advocate_leader);
  const [isOwner, setIsOwner] = useState(user.is_owner);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const isSelf = user.id === callerUserId;

  function save() {
    setMsg(null);
    startTransition(async () => {
      const result = await setUserRoles({
        userId: user.id,
        isAdmin,
        isLeader,
        isOwner: callerIsOwner ? isOwner : undefined,
      });
      if (result.error) {
        setMsg(`✗ ${result.error}`);
        // revert
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
      <td className="p-3 text-right">
        {msg && <span className="mr-2 text-xs text-zinc-400">{msg}</span>}
        <button
          onClick={save}
          disabled={!dirty || pending}
          className="rounded-md border border-zinc-700 px-2.5 py-1 text-xs hover:border-emerald-500 disabled:opacity-30"
        >
          {pending ? "…" : "Save"}
        </button>
      </td>
    </tr>
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
