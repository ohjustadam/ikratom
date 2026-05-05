"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  decryptMessage,
  decryptSessionKeyForMe,
  encryptMessage,
  getOrCreateKeypair,
  fingerprintForPublicKey,
} from "@/lib/crypto/e2e";
import { sendMessage } from "@/modules/dm/actions";
import { blockUser } from "@/modules/dm/block-actions";

type MessageRow = {
  id: string;
  sender_id: string;
  ciphertext: string;
  nonce: string;
  created_at: string;
};

type Person = {
  id: string;
  full_name: string | null;
  email: string | null;
  state: string | null;
  public_key: string | null;
};

type DecryptedMessage = MessageRow & {
  plaintext?: string;
  decryptError?: string;
};

type GroupMember = {
  user_id: string;
  full_name: string | null;
  email: string | null;
  state: string | null;
  role: string;
  key_changed: boolean;
};

export function ConversationView({
  conversationId,
  myUserId,
  others,
  isGroup,
  groupName,
  groupMembers,
  myRoleInGroup,
  keyChanged,
  encryptedSessionKey,
  sessionKeyNonce,
  senderPublicKey,
  messages: initialMessages,
}: {
  conversationId: string;
  myUserId: string;
  others: Person[];
  isGroup: boolean;
  groupName: string | null;
  groupMembers: GroupMember[] | null;
  myRoleInGroup: string | null;
  keyChanged: boolean;
  encryptedSessionKey: string | null;
  sessionKeyNonce: string | null;
  senderPublicKey: string | null;
  messages: MessageRow[];
}) {
  const router = useRouter();
  const other = others[0];
  const display = isGroup
    ? (groupName ?? "Unnamed group")
    : (other?.full_name || other?.email || "Member");
  const subtitleCount = isGroup
    ? `${(groupMembers?.length ?? others.length + 1)} members`
    : null;

  const [sessionKey, setSessionKey] = useState<Uint8Array | null>(null);
  const [decryptedById, setDecryptedById] = useState<Record<string, DecryptedMessage>>({});
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [, startSend] = useTransition();
  const [otherFingerprint, setOtherFingerprint] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 1) Decrypt the session key on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const myKp = await getOrCreateKeypair();
        if (!encryptedSessionKey || !sessionKeyNonce || !senderPublicKey) {
          setError("Missing encryption metadata for this conversation.");
          return;
        }
        const sk = await decryptSessionKeyForMe({
          myPrivateKeyB64: myKp.privateKey,
          senderPublicKeyB64: senderPublicKey,
          ciphertextB64: encryptedSessionKey,
          nonceB64: sessionKeyNonce,
        });
        if (cancelled) return;
        setSessionKey(sk);

        if (other?.public_key) {
          const fp = await fingerprintForPublicKey(other.public_key);
          if (!cancelled) setOtherFingerprint(fp);
        }
      } catch (e) {
        setError(`Couldn't decrypt session key — ${(e as Error).message}. Was this conversation started on a different device?`);
      }
    })();
    return () => { cancelled = true; };
  }, [encryptedSessionKey, sessionKeyNonce, senderPublicKey, other?.public_key]);

  // 2) Decrypt all messages once we have the session key
  useEffect(() => {
    if (!sessionKey) return;
    let cancelled = false;
    (async () => {
      const out: Record<string, DecryptedMessage> = {};
      for (const m of initialMessages) {
        try {
          const pt = await decryptMessage({
            ciphertextB64: m.ciphertext,
            nonceB64: m.nonce,
            sessionKey,
          });
          out[m.id] = { ...m, plaintext: pt };
        } catch {
          out[m.id] = { ...m, decryptError: "Couldn't decrypt" };
        }
      }
      if (!cancelled) setDecryptedById(out);
    })();
    return () => { cancelled = true; };
  }, [sessionKey, initialMessages]);

  // 3) Auto-scroll to bottom when new messages decrypt
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [decryptedById]);

  const orderedMessages = useMemo(
    () => initialMessages.map((m) => decryptedById[m.id] ?? { ...m }),
    [initialMessages, decryptedById]
  );

  async function send() {
    if (!draft.trim() || !sessionKey) return;
    setError(null);
    const text = draft.trim();
    setDraft("");
    startSend(async () => {
      try {
        const { ciphertext, nonce } = await encryptMessage(text, sessionKey);
        const r = await sendMessage({ conversationId, ciphertext, nonce });
        if ("error" in r && r.error) {
          setError(r.error);
          setDraft(text);
          return;
        }
        router.refresh();
      } catch (e) {
        setError((e as Error).message);
        setDraft(text);
      }
    });
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col px-4 py-6 sm:px-6 lg:px-8" style={{ minHeight: "calc(100vh - 80px)" }}>
      <a href="/messages" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Messages
      </a>

      <header className="mt-2 mb-4 flex items-center gap-3 border-b border-zinc-800 pb-4">
        <Avatar name={display} group={isGroup} />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold">{display}</h1>
            {isGroup ? (
              <span className="rounded bg-purple-950/40 px-1.5 py-0.5 text-[10px] text-purple-300">
                Group
              </span>
            ) : other?.state ? (
              <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-400">{other.state}</span>
            ) : null}
            <span className="rounded bg-emerald-950/40 px-1.5 py-0.5 text-[10px] text-emerald-300">
              🔒 E2E
            </span>
          </div>
          {subtitleCount && (
            <p className="text-[11px] text-zinc-500">{subtitleCount}</p>
          )}
          {!isGroup && otherFingerprint && (
            <p className="mt-0.5 font-mono text-[10px] text-zinc-600" title="Verify with the other person out-of-band to confirm no one's intercepting.">
              Fingerprint: {otherFingerprint}
            </p>
          )}
        </div>

        {/* Action menu */}
        {isGroup ? (
          <a
            href={`/messages/${conversationId}/settings`}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs hover:border-emerald-500"
          >
            Settings
          </a>
        ) : other ? (
          <BlockMenu otherId={other.id} otherName={display} />
        ) : null}
      </header>

      {/* Key-change warning (1:1 only — groups have per-member key_changed) */}
      {!isGroup && keyChanged && (
        <div className="mb-3 rounded-md border border-amber-900/40 bg-amber-950/20 p-3 text-xs text-amber-200">
          <strong className="text-amber-300">⚠ Key changed</strong> — {display}&apos;s
          encryption key is different from when this conversation started. They likely
          got a new device. New messages still encrypt fine, but verify with them
          before sending sensitive info.
        </div>
      )}

      {/* Group: list of members with key-change flags */}
      {isGroup && groupMembers && groupMembers.some((m) => m.key_changed) && (
        <div className="mb-3 rounded-md border border-amber-900/40 bg-amber-950/20 p-3 text-xs text-amber-200">
          <strong className="text-amber-300">⚠ Some members&apos; keys changed</strong> —{" "}
          {groupMembers.filter((m) => m.key_changed).map((m) => m.full_name || m.email).join(", ")}.
          They likely got new devices. Verify before sharing sensitive info.
        </div>
      )}

      {error && (
        <p className="mb-3 rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      {/* Message list */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto pb-4">
        {orderedMessages.length === 0 ? (
          <p className="text-center text-sm text-zinc-500">
            No messages yet. Say hello below — your first message will be encrypted before it leaves your device.
          </p>
        ) : (
          orderedMessages.map((m) => {
            const isMine = m.sender_id === myUserId;
            return (
              <div
                key={m.id}
                className={`flex ${isMine ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                    isMine
                      ? "bg-emerald-500 text-zinc-950"
                      : "border border-zinc-800 bg-zinc-950/40 text-zinc-100"
                  }`}
                >
                  {m.plaintext !== undefined ? (
                    <p className="whitespace-pre-wrap">{m.plaintext}</p>
                  ) : m.decryptError ? (
                    <p className={isMine ? "italic opacity-70" : "italic text-zinc-500"}>
                      [encrypted — couldn&apos;t decrypt on this device]
                    </p>
                  ) : (
                    <p className={isMine ? "italic opacity-70" : "italic text-zinc-500"}>
                      Decrypting…
                    </p>
                  )}
                  <p className={`mt-1 text-[10px] ${isMine ? "text-zinc-900/60" : "text-zinc-600"}`}>
                    {timeShort(m.created_at)}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Composer */}
      <form
        onSubmit={(e) => { e.preventDefault(); send(); }}
        className="sticky bottom-0 border-t border-zinc-800 bg-zinc-950 pt-3"
      >
        <div className="flex gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={sessionKey ? "Type a message…" : "Initializing encryption…"}
            disabled={!sessionKey}
            rows={2}
            className="flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!sessionKey || !draft.trim()}
            className="self-end rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
          >
            Send
          </button>
        </div>
        <p className="mt-1 text-[11px] text-zinc-600">
          🔒 Encrypted on your device before send. Servers can&apos;t read this.
        </p>
      </form>
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

function BlockMenu({ otherId, otherName }: { otherId: string; otherName: string }) {
  const [busy, setBusy] = useState(false);
  async function block() {
    if (!confirm(`Block ${otherName}?\n\nThey won't be able to send you new messages. You can unblock from your account settings later.`)) return;
    setBusy(true);
    await blockUser(otherId);
    setBusy(false);
    window.location.href = "/messages";
  }
  return (
    <button
      onClick={block}
      disabled={busy}
      className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:border-red-500 hover:text-red-300 disabled:opacity-50"
      title="Block this user"
    >
      Block
    </button>
  );
}

function timeShort(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
