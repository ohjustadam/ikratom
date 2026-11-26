"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useSignIn } from "@/components/auth/SignInContext";
import { useChromeMe } from "@/components/chrome/ChromeProvider";
import { chatStyleVars } from "@/lib/chat-prefs";
import { LoungeLauncher } from "./LoungeLauncher";
import { LOUNGE_SEEN_EVENT, useLoungeSeen } from "./use-lounge-seen";
import { useLoungeFeed } from "./use-lounge-feed";
import { useLoungePrefs } from "./use-lounge-prefs";
import { useLoungeOpen } from "./use-lounge-open";
import { useChatWindow } from "./use-chat-window";
import { useTabAwake } from "./use-tab-awake";
import { useEventFlag } from "./use-event-flag";
import { easyReadFont } from "./easy-font";
import { ChatFrame } from "./ChatFrame";
import { ChatHeader } from "./ChatHeader";
import { ChatSettings } from "./ChatSettings";
import { ChatMessages } from "./ChatMessages";
import { ChatComposer } from "./ChatComposer";
import { useLoungeSend } from "./use-lounge-send";

/**
 * The Lounge live chat as a floating window on every page (the full Lounge
 * lives on /forum, where this hides). B8 phase 1 (owner ask 2026-11-25): move
 * and resize on a wide screen, a three-height bottom sheet on phones, "keep
 * open across pages", reading comfort, bold / italic, emoji and reactions.
 *
 * Realtime runs only while the panel is open, the member is signed in and the
 * tab is awake; otherwise the socket is dropped (free Supabase: 200 at once)
 * and the launcher's unread badge (/api/me) carries the news. Signed-out
 * visitors see no messages. Identity is publicHandle() only. Mounted in
 * src/app/layout.tsx inside <SignInProvider>.
 */
export function ChatPopup() {
  const { user, ready, requireSignIn } = useSignIn();
  const pathname = usePathname();
  const me = useChromeMe();
  const meId = user?.id ?? null;
  const myUsername = me.username?.toLowerCase() ?? null;
  const { prefs, ready: prefsReady, update, syncFromAccount, saveError } = useLoungePrefs(meId);
  const { open, setOpen, highlightId } = useLoungeOpen(prefs.keepOpen, prefsReady);
  const awake = useTabAwake();
  const feed = useLoungeFeed(open && !!meId && awake, meId);
  const win = useChatWindow();
  const badgeCleared = useEventFlag(LOUNGE_SEEN_EVENT);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const composer = useLoungeSend({ signedIn: !!meId, requireSignIn, setError: feed.setError });

  useLoungeSeen(open && !!meId, feed.messages.length);
  // Opening the chat picks up settings changed on another device.
  useEffect(() => { if (open) void syncFromAccount(); }, [open, syncFromAccount]);

  if (!ready || pathname === "/forum") return null;

  if (!open) {
    return (
      <LoungeLauncher
        anchor="fixed right-3 bottom-[calc(5rem+env(safe-area-inset-bottom))] lg:right-5 lg:bottom-5"
        unread={badgeCleared ? 0 : me.unreadLounge ?? 0}
        onOpenLounge={() => setOpen(true)}
      />
    );
  }

  const people = [...new Set(Object.values(feed.authorMap).map((a) => a.username?.toLowerCase()).filter((u): u is string => !!u && u !== myUsername))];
  return (
    <ChatFrame win={win} vars={chatStyleVars(prefs)} fontClass={prefs.easyFont ? easyReadFont.className : ""}>
      <ChatHeader
        win={win}
        signedIn={!!meId}
        keepOpen={prefs.keepOpen}
        onKeepOpen={(v) => update({ keepOpen: v })}
        settingsOpen={settingsOpen}
        onSettings={() => setSettingsOpen((v) => !v)}
        onClose={() => { setOpen(false); setSettingsOpen(false); }}
      />
      {settingsOpen && meId ? (
        <ChatSettings prefs={prefs} update={update} saveError={saveError} win={win} onDone={() => setSettingsOpen(false)} />
      ) : (
        <ChatMessages
          messages={feed.messages} loaded={feed.loaded} authorMap={feed.authorMap} reactions={feed.reactions}
          meId={meId} myUsername={myUsername} highlightId={highlightId}
          onReply={composer.replyTo} onDelete={composer.remove} onReact={feed.react}
        />
      )}
      <div className="shrink-0 border-t border-[var(--lc-border)] p-2">
        {meId ? (
          <ChatComposer draft={composer.draft} setDraft={composer.setDraft} inputRef={composer.inputRef} people={people} sending={composer.sending} onSend={() => void composer.send()} />
        ) : (
          <button type="button" onClick={() => void requireSignIn()} className="min-h-11 w-full rounded-md border border-[var(--lc-border)] bg-[var(--lc-surface)] px-3 text-sm font-medium text-[var(--lc-name)]">
            Sign in to join the chat
          </button>
        )}
        {feed.error && <p role="alert" className="mt-1.5 rounded border border-red-900/40 bg-red-950/40 px-2 py-1 text-xs text-red-300">{feed.error}</p>}
      </div>
    </ChatFrame>
  );
}
