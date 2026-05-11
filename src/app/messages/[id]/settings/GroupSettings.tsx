"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addGroupMember, getMyConversationKeyData, removeGroupMember, updateGroup } from "@/modules/dm/group-actions";
import { searchUsers } from "@/modules/dm/actions";
import { getOrCreateKeypair, encryptSessionKeyForRecipient, decryptSessionKeyForMe } from "@/lib/crypto/e2e";

type Member = {
  user_id: string;
  full_name: string | null;
  email: string | null;
  state: string | null;
  role: string;
  key_changed: boolean;
};

export function GroupSettings({
  conversationId,
  myUserId,
  myRole,
  name: initialName,
  description: initialDescription,
  members,
}: {
  conversationId: string;
  myUserId: string;
  myRole: string;
  name: string;
  description: string;
  members: Member[];
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [, startTransition] = useTransition();
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const isPrivileged = myRole === "owner" || myRole === "admin";

  // Add-member state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{
    id: string; full_name: string | null; email: string | null; state: string | null; public_key: string | null;
  }>>([]);
  const [searching, startSearchTransition] = useTransition();
  const [adding, setAdding] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);

  function doSearch() {
    setAddError(null);
    if (searchQuery.trim().length < 2) return;
    startSearchTransition(async () => {
      const found = await searchUsers(searchQuery);
      const existingMemberIds = new Set(members.map((m) => m.user_id));
      // Filter out members + users without a public key
      setSearchResults(found.filter((u) => !existingMemberIds.has(u.id) && !!u.public_key));
    });
  }

  async function addMember(newMember: { id: string; full_name: string | null; email: string | null; public_key: string | null }) {
    if (!newMember.public_key) {
      setAddError("That user hasn't set up encryption yet (they need to open Messages first).");
      return;
    }
    setAddError(null);
    setAdding(newMember.id);
    try {
      // 1. Get our own slot data
      const keyDataResult = await getMyConversationKeyData(conversationId);
      if ("error" in keyDataResult && keyDataResult.error) {
        setAddError(keyDataResult.error);
        return;
      }
      const keyData = keyDataResult as { ok: true; ciphertextB64: string; nonceB64: string; senderPublicKeyB64: string };

      // 2. Decrypt our session key
      const myKp = await getOrCreateKeypair();
      const sessionKey = await decryptSessionKeyForMe({
        myPrivateKeyB64: myKp.privateKey,
        senderPublicKeyB64: keyData.senderPublicKeyB64,
        ciphertextB64: keyData.ciphertextB64,
        nonceB64: keyData.nonceB64,
      });

      // 3. Re-encrypt for the new member
      const reEncrypted = await encryptSessionKeyForRecipient({
        sessionKey,
        myPrivateKeyB64: myKp.privateKey,
        recipientPublicKeyB64: newMember.public_key,
      });

      // 4. Server-side add
      const result = await addGroupMember({
        conversationId,
        newMemberId: newMember.id,
        encryptedSessionKeyForNewMember: reEncrypted.ciphertextB64,
        nonce: reEncrypted.nonceB64,
        newMemberPubkey: newMember.public_key,
      });
      if ("error" in result && result.error) {
        setAddError(result.error);
        return;
      }
      setSearchResults((r) => r.filter((x) => x.id !== newMember.id));
      router.refresh();
    } catch (e) {
      setAddError((e as Error).message);
    } finally {
      setAdding(null);
    }
  }

  function save() {
    setSaveMsg(null);
    startTransition(async () => {
      const r = await updateGroup({
        conversationId,
        name: name.trim() !== initialName ? name : undefined,
        description: description !== initialDescription ? description : undefined,
      });
      if ("error" in r && r.error) setSaveMsg(`✗ ${r.error}`);
      else {
        setSaveMsg("✓ Saved");
        router.refresh();
      }
    });
  }

  function remove(memberId: string) {
    const member = members.find((m) => m.user_id === memberId);
    if (!member) return;
    if (!confirm(`Remove ${member.full_name ?? member.email} from the group?`)) return;
    startTransition(async () => {
      const r = await removeGroupMember({ conversationId, memberId });
      if ("error" in r && r.error) {
        alert(r.error);
      } else {
        router.refresh();
      }
    });
  }

  function leave() {
    if (!confirm("Leave this group? You'll lose access to past messages on this device.")) return;
    startTransition(async () => {
      const r = await removeGroupMember({ conversationId, memberId: myUserId });
      if ("error" in r && r.error) alert(r.error);
      else router.push("/messages");
    });
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-5 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">Details</h2>
        <div>
          <label className="block text-xs font-medium text-zinc-400">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!isPrivileged}
            maxLength={80}
            className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none disabled:opacity-50"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-zinc-400">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={!isPrivileged}
            rows={2}
            maxLength={500}
            className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none disabled:opacity-50"
          />
        </div>
        {isPrivileged && (
          <div className="flex items-center gap-3">
            <button
              onClick={save}
              className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400"
            >
              Save
            </button>
            {saveMsg && <span className="text-xs text-zinc-400">{saveMsg}</span>}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Members ({members.length})
        </h2>
        <ul className="divide-y divide-zinc-900">
          {members.map((m) => {
            const display = m.full_name ?? m.email ?? "Member";
            const isMe = m.user_id === myUserId;
            return (
              <li key={m.user_id} className="flex items-center justify-between py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{display}</span>
                    {m.role !== "member" && (
                      <span className="rounded bg-amber-950/40 px-1.5 py-0.5 text-[10px] uppercase text-amber-300">
                        {m.role}
                      </span>
                    )}
                    {isMe && (
                      <span className="text-xs text-zinc-500">(you)</span>
                    )}
                    {m.key_changed && (
                      <span className="rounded bg-amber-950/40 px-1.5 py-0.5 text-[10px] text-amber-300" title="Key changed since they joined">
                        ⚠ key changed
                      </span>
                    )}
                  </div>
                  {m.state && <p className="text-xs text-zinc-500">{m.state}</p>}
                </div>
                {!isMe && isPrivileged && m.role !== "owner" && (
                  <button
                    onClick={() => remove(m.user_id)}
                    className="rounded-md border border-zinc-700 px-2.5 py-1 text-xs hover:border-red-500 hover:text-red-300"
                  >
                    Remove
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {/* Add member — owner/admin only */}
      {isPrivileged && (
        <section className="rounded-lg border border-emerald-700/40 bg-emerald-950/10 p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-emerald-300">
            ➕ Add member
          </h2>
          <p className="mb-3 text-xs text-zinc-400">
            Search by name or email. They need to have opened Messages at least once
            (sets up their encryption key). New members can only read messages sent
            after they join — past messages stay private to current members.
          </p>
          <div className="flex gap-2">
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); doSearch(); } }}
              placeholder="Name or email…"
              className="flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
            />
            <button
              onClick={doSearch}
              disabled={searching || searchQuery.trim().length < 2}
              className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
            >
              {searching ? "…" : "Search"}
            </button>
          </div>

          {addError && (
            <p className="mt-3 rounded-md border border-red-900/50 bg-red-950/20 p-3 text-sm text-red-300">
              {addError}
            </p>
          )}

          {searchResults.length > 0 && (
            <ul className="mt-3 divide-y divide-zinc-900 rounded-md border border-zinc-800 bg-zinc-950/60">
              {searchResults.map((u) => {
                const display = u.full_name ?? u.email ?? "User";
                return (
                  <li key={u.id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-zinc-200">{display}</p>
                      {u.state && <p className="text-[11px] text-zinc-500">{u.state}</p>}
                    </div>
                    <button
                      onClick={() => addMember(u)}
                      disabled={adding === u.id}
                      className="shrink-0 rounded-md border border-emerald-700/40 px-3 py-1 text-xs text-emerald-300 hover:border-emerald-500 disabled:opacity-50"
                    >
                      {adding === u.id ? "Adding…" : "Add"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {searchQuery.trim().length >= 2 && !searching && searchResults.length === 0 && (
            <p className="mt-3 text-xs text-zinc-500">No matching users found.</p>
          )}
        </section>
      )}

      <section className="rounded-lg border border-red-900/40 bg-red-950/10 p-5">
        <h2 className="mb-2 text-sm font-semibold text-red-300">Danger zone</h2>
        <p className="mb-3 text-xs text-zinc-400">
          {myRole === "owner"
            ? "As owner, leaving deletes the group for everyone. (Future: transfer ownership first.)"
            : "Leave the group. You won't see new messages here."}
        </p>
        <button
          onClick={leave}
          className="rounded-md border border-red-700/50 px-4 py-2 text-sm text-red-300 hover:bg-red-950/40"
        >
          Leave group
        </button>
      </section>
    </div>
  );
}
