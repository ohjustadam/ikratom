"use client";

import { useEffect, useState } from "react";
import { getOrCreateKeypair } from "@/lib/crypto/e2e";
import { setPublicKey } from "@/modules/dm/actions";

type Conv = {
  id: string;
  last_message_at: string;
  others: { id: string; full_name: string | null; email: string | null; state: string | null }[];
  is_group: boolean;
  name: string | null;
  unread: number;
};

export function MessagesInbox({
  conversations,
  hasPublicKeyOnServer,
}: {
  conversations: Conv[];
  hasPublicKeyOnServer: boolean;
}) {
  const [keyStatus, setKeyStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  // On mount: ensure keypair exists locally + uploaded to server
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const kp = await getOrCreateKeypair();
        if (cancelled) return;
        // If server doesn't have our pubkey OR it's different, upload
        if (!hasPublicKeyOnServer) {
          const r = await setPublicKey(kp.publicKey);
          if (cancelled) return;
          if ("error" in r && r.error) {
            setError(r.error);
            setKeyStatus("error");
            return;
          }
        }
        setKeyStatus("ready");
      } catch (e) {
        setError((e as Error).message);
        setKeyStatus("error");
      }
    })();
    return () => { cancelled = true; };
  }, [hasPublicKeyOnServer]);

  return (
    <div>
      {keyStatus === "loading" && (
        <p className="mb-4 rounded-md border border-zinc-800 bg-zinc-950/40 p-3 text-xs text-zinc-500">
          Initializing your encryption keys…
        </p>
      )}
      {keyStatus === "error" && (
        <p className="mb-4 rounded-md border border-red-900/40 bg-red-950/40 p-3 text-sm text-red-300">
          Couldn&apos;t initialize encryption: {error}
        </p>
      )}

      {conversations.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="space-y-2">
          {conversations.map((c) => {
            const display = c.is_group
              ? c.name ?? "Unnamed group"
              : (c.others[0]?.full_name || c.others[0]?.email || "Unknown member");
            const subtitle = c.is_group
              ? `${c.others.length + 1} members`
              : c.others[0]?.state ?? "";
            return (
              <li key={c.id}>
                <a
                  href={`/messages/${c.id}`}
                  className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 hover:border-emerald-700/50"
                >
                  <Avatar name={display} group={c.is_group} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-semibold">{display}</span>
                      {c.is_group ? (
                        <span className="rounded bg-purple-950/40 px-1.5 py-0.5 text-[10px] text-purple-300">
                          Group
                        </span>
                      ) : subtitle ? (
                        <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-400">
                          {subtitle}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-xs text-zinc-500">
                      {c.is_group && subtitle && <>{subtitle} · </>}
                      {timeAgo(c.last_message_at)}
                    </p>
                  </div>
                  {c.unread > 0 && (
                    <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-xs font-bold text-zinc-950">
                      {c.unread}
                    </span>
                  )}
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Avatar({ name, group }: { name: string; group?: boolean }) {
  if (group) {
    return (
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-purple-950/40 text-purple-300">
        👥
      </div>
    );
  }
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-900 font-semibold text-zinc-400">
      {initials || "?"}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-12 text-center">
      <p className="text-sm text-zinc-400">No conversations yet.</p>
      <a
        href="/messages/new"
        className="mt-3 inline-block rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400"
      >
        Start a conversation →
      </a>
    </div>
  );
}

function timeAgo(iso: string): string {
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  const days = Math.floor(sec / 86400);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
