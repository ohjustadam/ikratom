"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { DEFAULT_PREFS, prefsFromRow, sanitizePrefs, type LoungePrefs } from "@/lib/chat-prefs";
import { saveLoungePrefs } from "./prefs-actions";

const MIRROR_KEY = "ikratom:lounge:prefs";
const SAVE_AFTER_MS = 900;

type Mirror = LoungePrefs & { uid: string };

function readMirror(uid: string): LoungePrefs | null {
  try {
    const v = JSON.parse(localStorage.getItem(MIRROR_KEY) ?? "null") as Partial<Mirror> | null;
    return v && v.uid === uid ? sanitizePrefs(v) : null;
  } catch {
    return null;
  }
}

function writeMirror(uid: string, p: LoungePrefs) {
  try { localStorage.setItem(MIRROR_KEY, JSON.stringify({ ...p, uid })); } catch { /* private mode */ }
}

/**
 * The member's Lounge settings. The account row (lounge_prefs) is the truth;
 * a copy on this device (tagged with the member's id, so a shared computer
 * never shows one member another's settings) lets them apply on page load
 * without a request. The account row is read straight from Supabase under
 * self-only RLS when the chat opens, or at once on a device with no copy.
 * Changes apply immediately and save to the account after a short pause.
 */
export function useLoungePrefs(uid: string | null) {
  const [prefs, setPrefs] = useState<LoungePrefs>(DEFAULT_PREFS);
  const [ready, setReady] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const current = useRef<LoungePrefs>(DEFAULT_PREFS);
  const synced = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const apply = useCallback((p: LoungePrefs) => { current.current = p; setPrefs(p); }, []);

  const syncFromAccount = useCallback(async () => {
    if (!uid || synced.current === uid) return;
    synced.current = uid;
    const { data, error } = await createClient()
      .from("lounge_prefs")
      .select("keep_open, text_size, easy_font, high_contrast, theme")
      .maybeSingle();
    if (error) { synced.current = null; return; }
    // A change made while this read was in flight wins over the stored row.
    if (timer.current) return;
    const p = prefsFromRow(data);
    apply(p);
    writeMirror(uid, p);
  }, [uid, apply]);

  useEffect(() => {
    if (!uid) { apply(DEFAULT_PREFS); setReady(true); return; }
    const mine = readMirror(uid);
    apply(mine ?? DEFAULT_PREFS);
    setReady(true);
    if (!mine) void syncFromAccount();
  }, [uid, apply, syncFromAccount]);

  const update = useCallback((patch: Partial<LoungePrefs>) => {
    if (!uid) return;
    const next = sanitizePrefs({ ...current.current, ...patch });
    apply(next);
    writeMirror(uid, next);
    setSaveError(null);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      timer.current = null;
      try {
        const r = await saveLoungePrefs(current.current);
        if ("error" in r) setSaveError(r.error);
      } catch {
        setSaveError("Couldn't save your chat settings. They still apply on this device.");
      }
    }, SAVE_AFTER_MS);
  }, [uid, apply]);

  return { prefs, ready, update, syncFromAccount, saveError };
}
