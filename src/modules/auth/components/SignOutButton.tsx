"use client";

// Client component (2026-07-22) so it can be rendered from the client-side
// header. `signOut` lives in a "use server" module, so passing it to
// <form action={...}> from a client component still works — the server action
// is invoked over the network exactly as before. Sign-out behaviour unchanged.
import { signOut } from "../actions";

export function SignOutButton() {
  return (
    <form action={signOut}>
      <button
        type="submit"
        className="text-sm text-zinc-400 hover:text-emerald-400"
      >
        Sign out
      </button>
    </form>
  );
}
