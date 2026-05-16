"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { SignInModal } from "./SignInModal";
import { MfaStepUpModal } from "./MfaStepUpModal";

/**
 * SignInContext — global gate for in-page sign-in prompts.
 *
 * Owner directive 2026-05-15: "making sure no one can upload any forms,
 * files or urls without being signed into an account. if they arent
 * signed in and trying to do so on any public form, button, ect.. then
 * a prompt to login should appear in a popup to sign in there, rather
 * than redirecting them to another page. then once they are signed in
 * it keeps them there and allows the submission."
 *
 * Usage in a component that gates an action:
 *
 *   const { user, requireSignIn } = useSignIn();
 *
 *   async function onSubmit() {
 *     if (!user) {
 *       const ok = await requireSignIn();
 *       if (!ok) return; // user closed the modal
 *     }
 *     // ... do the submit
 *   }
 *
 * Implementation:
 *   - One <SignInModal> mounted at the root level (in layout.tsx)
 *   - requireSignIn() opens the modal and returns a Promise that resolves
 *     to true on successful sign-in, false on cancel
 *   - On sign-in success, supabase.auth events fire and we update the
 *     `user` state — no page reload needed.
 */

export type AuthUser = {
  id: string;
  email: string | null;
} | null;

type SignInContextValue = {
  user: AuthUser;
  /** True after the initial getUser() resolves. Pages can skip ssr-flash
   *  by waiting on this. */
  ready: boolean;
  /** Open the sign-in modal. Resolves to true on success, false on cancel. */
  requireSignIn: () => Promise<boolean>;
  /** Open the MFA step-up modal. Resolves to true on success, false on
   *  cancel. After success, the server has set the 1-hour mfa_bypass
   *  cookie — the caller can retry the original admin action immediately. */
  requireMfa: () => Promise<boolean>;
};

const Ctx = createContext<SignInContextValue | null>(null);

export function useSignIn(): SignInContextValue {
  const v = useContext(Ctx);
  if (!v) {
    throw new Error("useSignIn must be used inside <SignInProvider>");
  }
  return v;
}

export function SignInProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser>(null);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [mfaOpen, setMfaOpen] = useState(false);
  // Promise resolver kept in a ref so requireSignIn() can resolve later
  // when the user finishes the modal flow.
  const resolverRef = useRef<((ok: boolean) => void) | null>(null);
  const mfaResolverRef = useRef<((ok: boolean) => void) | null>(null);

  useEffect(() => {
    const sb = createClient();
    let active = true;

    sb.auth.getUser().then(({ data }) => {
      if (!active) return;
      setUser(data.user ? { id: data.user.id, email: data.user.email ?? null } : null);
      setReady(true);
    });

    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      const u = session?.user;
      setUser(u ? { id: u.id, email: u.email ?? null } : null);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const requireSignIn = useCallback(() => {
    return new Promise<boolean>((resolve) => {
      // If for some reason we're already signed in by the time this is
      // called, short-circuit true.
      if (user) {
        resolve(true);
        return;
      }
      resolverRef.current = resolve;
      setOpen(true);
    });
  }, [user]);

  const onSignedIn = useCallback(() => {
    setOpen(false);
    resolverRef.current?.(true);
    resolverRef.current = null;
  }, []);

  const onClose = useCallback(() => {
    setOpen(false);
    resolverRef.current?.(false);
    resolverRef.current = null;
  }, []);

  const requireMfa = useCallback(() => {
    return new Promise<boolean>((resolve) => {
      mfaResolverRef.current = resolve;
      setMfaOpen(true);
    });
  }, []);

  const onMfaVerified = useCallback(() => {
    setMfaOpen(false);
    mfaResolverRef.current?.(true);
    mfaResolverRef.current = null;
  }, []);

  const onMfaClose = useCallback(() => {
    setMfaOpen(false);
    mfaResolverRef.current?.(false);
    mfaResolverRef.current = null;
  }, []);

  return (
    <Ctx.Provider value={{ user, ready, requireSignIn, requireMfa }}>
      {children}
      <SignInModal open={open} onClose={onClose} onSignedIn={onSignedIn} />
      <MfaStepUpModal open={mfaOpen} onClose={onMfaClose} onVerified={onMfaVerified} />
    </Ctx.Provider>
  );
}
