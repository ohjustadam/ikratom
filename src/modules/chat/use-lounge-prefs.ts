"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { DEFAULT_PREFS, prefsFromRow, sanitizePrefs, type LoungePrefs } from "@/lib/chat-prefs";
import { saveLoungePrefs } from "./prefs-actions";

const MIRROR_KEY = "ikratom:lounge:prefs";
const SAVE_AFTER_MS = 900;

type Mirror = { prefs: LoungePrefs; dirty: boolean };

function readMirror(uid: string): Mirror | null {
  try {
    const v = JSON.parse(localStorage.getItem(MIRROR_KEY) ?? "null") as (Partial<LoungePrefs> & { uid?: string; dirty?: boolean }) | null;
    return v && v.uid === uid ? { prefs: sanitizePrefs(v), dirty: v.dirty === true } : null;
  } catch {
    return null;
  }
}

function writeMirror(uid: string, p: LoungePrefs, dirty: boolean) {
  try { localStorage.setItem(MIRROR_KEY, JSON.stringify({ ...p, uid, dirty })); } catch { /* private mode */ }
}

/**
 * The member's Lounge settings. The account row (lounge_prefs) follows them
 * to other devices; a copy on this device (tagged with the member's id, so a
 * shared computer never shows one member another's settings) applies them on
 * page load without a request.
 *
 * A change applies at once, is marked unsaved on the device, and saves to the
 * account after a short pause. Reading the account (when the chat opens, or
 * at once on a device with no copy) never overwrites an unsaved change: that
 * change is pushed instead. So leaving the page right after a tap, or a save
 * that failed, can't quietly undo what the member chose.
 */
export function useLoungePrefs(uid: string | null) {
  const [prefs, setPrefs] = useState<LoungePrefs>(DEFAULT_PREFS);
  const [ready, setReady] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const current = useRef<LoungePrefs>(DEFAULT_PREFS);
  const synced = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const apply = useCallback((p: LoungePrefs) => { current.current = p; setPrefs(p); }, []);

  const save = useCallback(async () => {
    if (!uid) return;
    const sent = current.current;
    try {
      const r = await saveLoungePrefs(sent);
      if ("error" in r) { setSaveError(r.error); return; }
      if (current.current === sent && !timer.current) writeMirror(uid, sent, false);
    } catch {
      setSaveError("Couldn't save your chat settings. They still apply on this device.");
    }
  }, [uid]);

  const syncFromAccount = useCallback(async () => {
    if (!uid || synced.current === uid) return;
    synced.current = uid;
    if (timer.current || readMirror(uid)?.dirty) { void save(); return; }
    const { data, error } = await createClient()
      .from("lounge_prefs")
      .select("keep_open, text_size, easy_font, high_contrast, theme")
      .maybeSingle();
    if (error) { synced.current = null; return; }
    // No row yet: nothing saved on any device, so keep what this one shows.
    if (!data || timer.current) return;
    const p = prefsFromRow(data);
    apply(p);
    writeMirror(uid, p, false);
  }, [uid, apply, save]);

  useEffect(() => {
    if (!uid) { apply(DEFAULT_PREFS); setReady(true); return; }
    const mine = readMirror(uid);
    apply(mine?.prefs ?? DEFAULT_PREFS);
    setReady(true);
    // No copy here: fetch the account's. An unsaved change left by the last
    // page: push it now rather than waiting for the chat to open.
    if (!mine || mine.dirty) void syncFromAccount();
  }, [uid, apply, syncFromAccount]);

  const update = useCallback((patch: Partial<LoungePrefs>) => {
    if (!uid) return;
    const next = sanitizePrefs({ ...current.current, ...patch });
    apply(next);
    writeMirror(uid, next, true);
    setSaveError(null);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; void save(); }, SAVE_AFTER_MS);
  }, [uid, apply, save]);

  return { prefs, ready, update, syncFromAccount, saveError };
}
