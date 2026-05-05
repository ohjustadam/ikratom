"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { unblockUser } from "@/modules/dm/block-actions";

type Blocked = {
  id: string;
  full_name: string | null;
  email: string | null;
  blocked_at: string | null;
};

export function BlockedUsersList({ blocked }: { blocked: Blocked[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  function unblock(id: string, name: string) {
    if (!confirm(`Unblock ${name}? They'll be able to send you messages again.`)) return;
    startTransition(async () => {
      await unblockUser(id);
      router.refresh();
    });
  }

  if (blocked.length === 0) {
    return (
      <p className="text-sm text-zinc-500">
        No blocked users. Block someone from a conversation if they&apos;re sending unwanted messages.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-zinc-800">
      {blocked.map((b) => {
        const name = b.full_name ?? b.email ?? "Unknown";
        return (
          <li key={b.id} className="flex items-center justify-between py-3">
            <div>
              <p className="text-sm font-medium">{name}</p>
              {b.blocked_at && (
                <p className="text-xs text-zinc-500">
                  Blocked {new Date(b.blocked_at).toLocaleDateString()}
                </p>
              )}
            </div>
            <button
              onClick={() => unblock(b.id, name)}
              className="rounded-md border border-zinc-700 px-3 py-1 text-xs hover:border-emerald-500 hover:text-emerald-300"
            >
              Unblock
            </button>
          </li>
        );
      })}
    </ul>
  );
}
