import Link from "next/link";
import { AppearanceControls } from "./AppearanceControls";

export const metadata = { title: "Appearance · Account" };

/**
 * /account/appearance — theme, brand color, and war-room mode. The controls
 * are client-side (they manipulate <html data-*> live and persist to
 * localStorage + the profile via saveUiPrefs). Available to everyone; signed-in
 * users additionally get cross-device sync.
 */
export default function AppearancePage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 lg:px-8">
      <Link href="/account" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Account
      </Link>
      <header className="mt-2 mb-8">
        <h1 className="text-3xl font-bold">Appearance</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Make iKratom yours. Changes preview instantly; when you&apos;re signed in
          they follow you across devices.
        </p>
      </header>
      <AppearanceControls />
    </div>
  );
}
