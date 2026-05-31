"use client";

import { useEffect, useState, useTransition } from "react";
import { publicHandle } from "@/lib/public-handle";
import { useRouter } from "next/navigation";
import { getOrCreateKeypair, makeSessionKey } from "@/lib/crypto/e2e";
import { searchUsers, setPublicKey } from "@/modules/dm/actions";
import { createGroupConversation } from "@/modules/dm/group-actions";

type Person = {
  id: string;
  username: string | null;
  state: string | null;
  public_key: string | null;
};

export function NewGroup({ myUserId }: { myUserId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Person[]>([]);
  const [picked, setPicked] = useState<Person[]>([]);
  const [searching, startSearch] = useTransition();
  const [creating, startCreate] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [myKp, setMyKp] = useState<{ publicKey: string; privateKey: string } | null>(null);

  useEffect(() => {
    (async () => {
      const kp = await getOrCreateKeypair();
      setMyKp(kp);
      await setPublicKey(kp.publicKey);
    })();
  }, []);

  function search() {
    if (query.trim().length < 2) return;
    startSearch(async () => {
      const found = await searchUsers(query);
      // Exclude self + already-picked
      const pickedIds = new Set([myUserId, ...picked.map((p) => p.id)]);
      setResults(found.filter((p) => !pickedIds.has(p.id) && !!p.public_key));
    });
  }

  function add(p: Person) {
    setPicked((s) => [...s, p]);
    setResults((s) => s.filter((r) => r.id !== p.id));
  }

  function remove(id: string) {
    setPicked((s) => s.filter((p) => p.id !== id));
  }

  async function create() {
    setError(null);
    if (!myKp) {
      setError("Encryption not ready.");
      return;
    }
    if (!name.trim()) {
      setError("Give your group a name.");
      return;
    }
    if (picked.length === 0) {
      setError("Add at least one other member.");
      return;
    }

    startCreate(async () => {
      try {
        const memberIds = [myUserId, ...picked.map((p) => p.id)];
        // pubkeysByMember includes all (me + picked)
        const pubkeysByMember: Record<string, string> = { [myUserId]: myKp.publicKey };
        for (const p of picked) {
          if (!p.public_key) {
            setError(`${publicHandle(p)} hasn't set up encryption — skip them or have them open Messages first.`);
            return;
          }
          pubkeysByMember[p.id] = p.public_key;
        }

        const { encryptedForUsers, nonces } = await makeSessionKey(myKp.privateKey, pubkeysByMember);

        const result = await createGroupConversation({
          name,
          description,
          memberIds,
          encryptedSessionKeys: encryptedForUsers,
          sessionKeyNonces: nonces,
          pubkeySnapshots: pubkeysByMember,
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
    <div className="space-y-5">
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-5 space-y-3">
        <div>
          <label className="block text-xs font-medium text-zinc-400">Group name *</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            placeholder="OK shop owners · KCPA defenders · etc."
            className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-zinc-400">Description (optional)</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            maxLength={500}
            className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
          />
        </div>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-5 space-y-3">
        <h2 className="text-sm font-semibold">Members</h2>
        {picked.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {picked.map((p) => (
              <li key={p.id} className="flex items-center gap-2 rounded-full bg-emerald-950/30 px-3 py-1 text-xs">
                <span className="text-emerald-300">{publicHandle(p)}</span>
                <button
                  onClick={() => remove(p.id)}
                  className="text-zinc-500 hover:text-red-400"
                  title="Remove"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={(e) => { e.preventDefault(); search(); }} className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by @username…"
            className="flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={searching || query.trim().length < 2}
            className="rounded-md border border-zinc-700 px-3 py-2 text-sm hover:border-emerald-500 disabled:opacity-50"
          >
            {searching ? "…" : "Search"}
          </button>
        </form>

        {results.length > 0 && (
          <ul className="space-y-1">
            {results.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => add(p)}
                  className="flex w-full items-center justify-between rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-left text-sm hover:border-emerald-500"
                >
                  <span>
                    <span className="font-medium">{publicHandle(p)}</span>
                    {p.state && <span className="ml-2 text-xs text-zinc-500">{p.state}</span>}
                  </span>
                  <span className="text-xs text-emerald-400">+ Add</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && (
        <p className="rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-zinc-500">
          {picked.length === 0 ? "No members yet" : `${picked.length + 1} total (you + ${picked.length})`}
        </p>
        <button
          onClick={create}
          disabled={creating || !name.trim() || picked.length === 0}
          className="rounded-md bg-emerald-500 px-5 py-2 font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          {creating ? "Creating…" : "Create group →"}
        </button>
      </div>
    </div>
  );
}
