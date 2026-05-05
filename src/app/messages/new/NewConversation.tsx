"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  getOrCreateKeypair,
  makeSessionKey,
} from "@/lib/crypto/e2e";
import {
  searchUsers,
  createConversation,
  setPublicKey,
} from "@/modules/dm/actions";

type Person = {
  id: string;
  full_name: string | null;
  email: string | null;
  state: string | null;
  public_key: string | null;
};

export function NewConversation({
  myUserId,
  prefilled,
}: {
  myUserId: string;
  prefilled?: Person | null;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Person[]>(prefilled ? [prefilled] : []);
  const [searching, startSearch] = useTransition();
  const [creating, startCreate] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [myKp, setMyKp] = useState<{ publicKey: string; privateKey: string } | null>(null);

  // Ensure keypair exists
  useEffect(() => {
    (async () => {
      const kp = await getOrCreateKeypair();
      setMyKp(kp);
      // Sync to server in case it's not set
      await setPublicKey(kp.publicKey);
    })();
  }, []);

  function search() {
    if (query.trim().length < 2) return;
    startSearch(async () => {
      const found = await searchUsers(query);
      setResults(found);
    });
  }

  async function start(person: Person) {
    setError(null);
    if (!myKp) {
      setError("Encryption not ready. Please wait a moment.");
      return;
    }
    if (!person.public_key) {
      setError("That user hasn't set up encryption yet. Ask them to open Messages first.");
      return;
    }

    startCreate(async () => {
      try {
        // Encrypt the session key twice: once for the recipient, once for myself
        // (so I can decrypt it on this device too — and recover it later if I
        // re-import this private key on another device).
        const { encryptedForUsers, nonces } = await makeSessionKey(
          myKp.privateKey,
          {
            [person.id]: person.public_key!,
            [myUserId]: myKp.publicKey,
          },
        );

        const result = await createConversation({
          recipientUserId: person.id,
          encryptedSessionKeys: encryptedForUsers,
          sessionKeyNonces: nonces,
        });

        if ("error" in result && result.error) {
          setError(result.error);
          return;
        }
        if (result.ok && result.conversationId) {
          router.push(`/messages/${result.conversationId}`);
        }
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => { e.preventDefault(); search(); }}
        className="flex gap-2"
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or email…"
          className="flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={searching || query.trim().length < 2}
          className="rounded-md border border-zinc-700 px-4 py-2 text-sm hover:border-emerald-500 disabled:opacity-50"
        >
          {searching ? "…" : "Search"}
        </button>
      </form>

      {error && (
        <p className="rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      {results.length > 0 && (
        <ul className="space-y-2">
          {results.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => start(p)}
                disabled={creating || !p.public_key}
                className="flex w-full items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 text-left hover:border-emerald-700/50 disabled:opacity-50"
              >
                <Avatar name={p.full_name || p.email || ""} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{p.full_name || p.email}</span>
                    {p.state && (
                      <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-400">{p.state}</span>
                    )}
                  </div>
                  {p.email && p.full_name && (
                    <p className="text-xs text-zinc-500">{p.email}</p>
                  )}
                  {!p.public_key && (
                    <p className="text-xs text-amber-400">
                      Hasn&apos;t set up encryption — can&apos;t message yet
                    </p>
                  )}
                </div>
                {p.public_key && (
                  <span className="text-xs text-emerald-400">→</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {query.length >= 2 && !searching && results.length === 0 && (
        <p className="rounded-md border border-zinc-800 bg-zinc-950/40 p-4 text-center text-sm text-zinc-400">
          No users matched. They need to open /messages once to enable encryption.
        </p>
      )}
    </div>
  );
}

function Avatar({ name }: { name: string }) {
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
