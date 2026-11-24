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
import { LetThemKnow } from "./LetThemKnow";

type Person = {
  id: string;
  username: string | null;
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
  const [searched, setSearched] = useState<string | null>(null);
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
    const q = query.trim();
    if (q.length < 2) return;
    startSearch(async () => {
      const found = await searchUsers(q);
      setResults(found);
      setSearched(q.replace(/^@/, ""));
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
          placeholder="Search by @username…"
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
          {results.map((p) => {
            const name = p.username ? `@${p.username}` : "Member";
            const who = (
              <div className="flex items-center gap-2">
                <span className="wrap-anywhere font-medium">{name}</span>
                {p.state && (
                  <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-400">{p.state}</span>
                )}
              </div>
            );
            return (
              <li key={p.id}>
                {p.public_key ? (
                  <button
                    onClick={() => start(p)}
                    disabled={creating}
                    className="flex w-full items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 text-left hover:border-emerald-700/50 disabled:opacity-50"
                  >
                    <Avatar name={p.username || "?"} />
                    <div className="min-w-0 flex-1">{who}</div>
                    <span className="text-xs text-emerald-400">→</span>
                  </button>
                ) : (
                  // No key yet: they have never opened Messages. Offer to tell them.
                  <div className="flex w-full items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
                    <Avatar name={p.username || "?"} />
                    <div className="min-w-0 flex-1">
                      {who}
                      <LetThemKnow id={p.id} handle={name} />
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {searched && !searching && results.length === 0 && (
        <p className="rounded-md border border-zinc-800 bg-zinc-950/40 p-4 text-center text-sm text-zinc-400">
          No member&apos;s @handle contains &ldquo;{searched}&rdquo;. Check the spelling, or ask them for their handle.
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
