"use client";

import { useCallback, useRef } from "react";

/**
 * Cloudflare Turnstile widget for the auth forms (src/lib/captcha.ts).
 *
 *   const { slot: captchaSlot, ...captcha } = useTurnstile("signin");
 *   <div ref={captchaSlot} />                // where the widget may appear (destructured:
 *                                            // the React compiler lint rejects `ref={captcha.slot}`)
 *   const token = await captcha.getToken();  // in the submit handler
 *   captcha.reset();                         // after the call: tokens are single-use
 *
 * `slot` is a callback ref, so the widget renders whenever its div mounts (a
 * modal opening, a form coming back after "try again") and is removed when it
 * unmounts. It runs in "interaction-only" mode, so most people never see it.
 * With no NEXT_PUBLIC_TURNSTILE_SITE_KEY it renders nothing and getToken()
 * resolves null at once, so forms keep working in dev and before the key is set.
 */

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
/** Long enough for someone to answer an interactive challenge. */
const WAIT_MS = 20_000;

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};
declare global {
  interface Window { turnstile?: TurnstileApi }
}

let scriptPromise: Promise<TurnstileApi | null> | null = null;
function loadTurnstile(): Promise<TurnstileApi | null> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptPromise ??= new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = SCRIPT_SRC;
    s.async = true;
    s.onload = () => resolve(window.turnstile ?? null);
    s.onerror = () => { scriptPromise = null; resolve(null); };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export function useTurnstile(action: string) {
  const widgetId = useRef<string | null>(null);
  const token = useRef<string | null>(null);
  const waiters = useRef<((t: string | null) => void)[]>([]);
  /** Script blocked or offline: don't make people wait for a token that can't come. */
  const unavailable = useRef(false);

  const settle = useCallback((t: string | null) => {
    token.current = t;
    const pending = waiters.current;
    waiters.current = [];
    pending.forEach((w) => w(t));
  }, []);

  const slot = useCallback((el: HTMLDivElement | null) => {
    if (!SITE_KEY || !el) return;
    let live = true;
    loadTurnstile().then((api) => {
      if (!api) {
        unavailable.current = true; // blocked or offline: submit without a token
        return settle(null);
      }
      unavailable.current = false;
      if (!live || widgetId.current) return;
      widgetId.current = api.render(el, {
        sitekey: SITE_KEY,
        action,
        theme: "dark",
        size: "flexible",
        appearance: "interaction-only",
        callback: (t: string) => settle(t),
        "expired-callback": () => { token.current = null; },
        "error-callback": () => settle(null),
      });
    });
    return () => {
      live = false;
      if (widgetId.current) window.turnstile?.remove(widgetId.current);
      widgetId.current = null;
      token.current = null;
    };
  }, [action, settle]);

  /** The current token, waiting for the widget if it hasn't produced one yet. */
  const getToken = useCallback((): Promise<string | null> => {
    if (!SITE_KEY || unavailable.current) return Promise.resolve(null);
    if (token.current) return Promise.resolve(token.current);
    return new Promise((resolve) => {
      const done = (t: string | null) => { clearTimeout(timer); resolve(t); };
      const timer = setTimeout(() => {
        waiters.current = waiters.current.filter((w) => w !== done);
        resolve(null);
      }, WAIT_MS);
      waiters.current.push(done);
    });
  }, []);

  /** Drop the used token and fetch a fresh one for the next attempt. */
  const reset = useCallback(() => {
    token.current = null;
    if (widgetId.current) window.turnstile?.reset(widgetId.current);
  }, []);

  return { slot, getToken, reset, enabled: !!SITE_KEY };
}
