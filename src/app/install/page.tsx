import Link from "next/link";

export const metadata = {
  title: "Install iKratom — home-screen app for any device",
  description: "Install iKratom as a phone app — free, no app store needed.",
};

export default function InstallIndexPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
      <header className="mb-8 text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          📱 Install iKratom
        </p>
        <h1 className="mt-2 text-3xl font-bold sm:text-4xl">Free. No app store. Works offline.</h1>
        <p className="mt-3 text-sm text-zinc-400">
          iKratom installs directly to your home screen — push notifications,
          full-screen UI, offline support. No Google Play / App Store account
          needed. Pick your device below.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/install/ios"
          className="block rounded-lg border border-zinc-800 bg-zinc-950/40 p-6 hover:border-emerald-500"
        >
          <p className="text-3xl"></p>
          <h2 className="mt-3 text-xl font-bold">iPhone / iPad</h2>
          <p className="mt-2 text-sm text-zinc-400">
            Safari → Share → Add to Home Screen. 30 seconds.
          </p>
          <p className="mt-3 text-xs font-semibold text-emerald-400">iOS instructions →</p>
        </Link>
        <Link
          href="/install/android"
          className="block rounded-lg border border-zinc-800 bg-zinc-950/40 p-6 hover:border-emerald-500"
        >
          <p className="text-3xl">🤖</p>
          <h2 className="mt-3 text-xl font-bold">Android</h2>
          <p className="mt-2 text-sm text-zinc-400">
            Chrome banner OR direct APK download. 1 minute.
          </p>
          <p className="mt-3 text-xs font-semibold text-emerald-400">Android instructions →</p>
        </Link>
        <Link
          href="/install/windows"
          className="block rounded-lg border border-zinc-800 bg-zinc-950/40 p-6 hover:border-emerald-500 sm:col-span-2"
        >
          <p className="text-3xl">💻</p>
          <h2 className="mt-3 text-xl font-bold">PC — Windows / Mac / Linux</h2>
          <p className="mt-2 text-sm text-zinc-400">
            One-click desktop app: own window, taskbar icon, push notifications.
            10 seconds — or grab the native .exe installer.
          </p>
          <p className="mt-3 text-xs font-semibold text-emerald-400">PC instructions →</p>
        </Link>
      </section>

      <section className="mt-8 rounded-md border border-zinc-800 bg-zinc-950/40 p-4">
        <h2 className="text-sm font-semibold text-zinc-300">Already installed?</h2>
        <p className="mt-2 text-xs text-zinc-400">
          Open the iKratom icon on your home screen. If you see the URL bar, the
          install didn&apos;t complete — go back to the platform-specific page above.
        </p>
      </section>

      <section className="mt-6 rounded-md border border-emerald-700/30 bg-emerald-950/10 p-4 text-sm">
        <p className="font-semibold text-emerald-300">Why install?</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-zinc-300">
          <li>Push notifications for bills that affect you (BoP rulings, hearings, votes)</li>
          <li>One-tap call tracker for your reps</li>
          <li>Works offline — your saved bills + briefings still readable</li>
          <li>Full-screen interface, no browser chrome</li>
          <li>Quick-action shortcuts directly from the home screen icon</li>
        </ul>
      </section>
    </div>
  );
}
