"use client";

import Link from "@/components/Link";
import { CHAT_THEMES, MAX_TEXT_SIZE, THEMES, type LoungePrefs } from "@/lib/chat-prefs";
import { ChatToggle } from "./ChatToggle";
import type { ChatWindow } from "./use-chat-window";

const SIZE_NAMES = ["Normal", "Large", "Larger", "Very large", "Biggest"];
const step =
  "flex min-h-12 min-w-14 items-center justify-center rounded-lg border border-[var(--lc-border)] font-bold hover:bg-[var(--lc-surface)] disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-[var(--lc-accent)]";

/**
 * Reading comfort for the Lounge (B8): text size, easy-read letters, high
 * contrast and a few color themes. Saved to the member's account; window
 * place and size stay on this device.
 */
export function ChatSettings({
  prefs,
  update,
  saveError,
  win,
  onDone,
}: {
  prefs: LoungePrefs;
  update: (patch: Partial<LoungePrefs>) => void;
  saveError: string | null;
  win: ChatWindow;
  onDone: () => void;
}) {
  return (
    <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3 text-[length:var(--lc-size)]">
      <ChatToggle label="Keep chat open when I change pages" checked={prefs.keepOpen} onChange={(v) => update({ keepOpen: v })} />

      <div className="rounded-lg border border-[var(--lc-border)] px-3 py-2">
        <p className="font-medium">Text size</p>
        <div className="mt-2 flex items-center gap-2">
          <button type="button" className={step} disabled={prefs.textSize <= 0} onClick={() => update({ textSize: prefs.textSize - 1 })} aria-label="Smaller text">
            A−
          </button>
          <span className="flex-1 text-center" aria-live="polite">{SIZE_NAMES[prefs.textSize]}</span>
          <button type="button" className={`${step} text-lg`} disabled={prefs.textSize >= MAX_TEXT_SIZE} onClick={() => update({ textSize: prefs.textSize + 1 })} aria-label="Bigger text">
            A+
          </button>
        </div>
      </div>

      <ChatToggle label="Easy-read letters" hint="A font made so I, l and 1 never look alike." checked={prefs.easyFont} onChange={(v) => update({ easyFont: v })} />
      <ChatToggle label="High contrast" hint="Black background with white and yellow text." checked={prefs.highContrast} onChange={(v) => update({ highContrast: v })} />

      <fieldset className="rounded-lg border border-[var(--lc-border)] px-3 py-2">
        <legend className="px-1 font-medium">Colors</legend>
        {prefs.highContrast && <p className="text-[0.8em] text-[var(--lc-muted)]">High contrast is on, so it sets the colors.</p>}
        <div className="mt-1 grid grid-cols-2 gap-2">
          {CHAT_THEMES.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={prefs.theme === t}
              onClick={() => update({ theme: t })}
              className={`flex min-h-12 items-center gap-2 rounded-lg border px-2 text-left focus-visible:outline-2 focus-visible:outline-[var(--lc-accent)] ${prefs.theme === t ? "border-[var(--lc-accent)] ring-1 ring-[var(--lc-accent)]" : "border-[var(--lc-border)]"}`}
            >
              <span aria-hidden className="h-6 w-6 shrink-0 rounded-full border border-black/20" style={{ background: THEMES[t].swatch }} />
              <span>{THEMES[t].label}</span>
            </button>
          ))}
        </div>
      </fieldset>

      {win.wide && (
        <button type="button" onClick={win.reset} className="min-h-12 w-full rounded-lg border border-[var(--lc-border)] px-3 text-left hover:bg-[var(--lc-surface)]">
          Put the chat window back in the corner, at its normal size
        </button>
      )}

      <p className="text-[0.8em] text-[var(--lc-muted)]">
        {saveError ?? "These follow your account to your other devices. Where the window sits stays on this device."}
      </p>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[0.85em]">
        <Link href="/forum" className="text-[var(--lc-name)] underline">Open the full forum</Link>
        <Link href="/connect" className="text-[var(--lc-name)] underline">Groups and friends</Link>
      </div>
      <button type="button" onClick={onDone} className="min-h-12 w-full rounded-lg bg-[var(--lc-accent)] font-semibold text-[var(--lc-on-accent)]">
        Done
      </button>
    </div>
  );
}
