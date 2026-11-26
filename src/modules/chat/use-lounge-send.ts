"use client";

import { useRef, useState } from "react";
import { postChatMessage, deleteChatMessage } from "./actions";
import { MAX_BODY } from "./ChatComposer";

/**
 * The Lounge composer's actions: send (the draft comes back if it fails),
 * reply (prefills @username), and delete your own message. Realtime delivers
 * the result, so nothing is appended optimistically.
 */
export function useLoungeSend(opts: {
  signedIn: boolean;
  requireSignIn: () => Promise<boolean>;
  setError: (e: string | null) => void;
}) {
  const { signedIn, requireSignIn, setError } = opts;
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  async function send() {
    const body = draft.trim();
    if (!body) return;
    if (body.length > MAX_BODY) { setError(`Message is too long (${MAX_BODY} characters at most).`); return; }
    if (!signedIn && !(await requireSignIn())) return;
    setError(null);
    setDraft("");
    setSending(true);
    // A network drop rejects the server action: put the words back, say so.
    try {
      const r = await postChatMessage({ body, room: "lounge" });
      if ("error" in r) { setError(r.error ?? "Failed"); setDraft(body); }
      else if ("held" in r && r.held) setError("Your message is held for review and will appear once a moderator approves it.");
    } catch {
      setDraft(body);
      setError("Couldn't send. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  }

  function replyTo(username: string) {
    const prefix = `@${username} `;
    const next = draft.startsWith(prefix) ? draft : prefix + draft.replace(/^@\S+\s*/, "");
    setDraft(next);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(next.length, next.length);
    });
  }

  async function remove(id: string) {
    if (!confirm("Delete this message?")) return;
    try {
      const r = await deleteChatMessage(id);
      if ("error" in r) setError(r.error ?? "Failed");
    } catch {
      setError("Couldn't delete. Check your connection and try again.");
    }
  }

  return { draft, setDraft, sending, inputRef, send, replyTo, remove };
}
