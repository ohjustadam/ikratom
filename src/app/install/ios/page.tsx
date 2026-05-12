import Link from "next/link";

export const metadata = {
  title: "Install iKratom on iPhone / iPad",
};

export default function InstallIosPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <Link href="/install" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Install
      </Link>
      <header className="mt-2 mb-8">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          📱 iOS / iPadOS install
        </p>
        <h1 className="mt-2 text-3xl font-bold">Add iKratom to your home screen</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Works on iPhone, iPad. Takes 30 seconds. Free. No App Store.
        </p>
      </header>

      <ol className="space-y-5">
        <Step n="1" title="Open this page in Safari">
          <p className="text-sm text-zinc-300">
            You&apos;re reading this page right now — but if you opened the link in
            another browser (Chrome, Firefox), tap the address bar and re-open
            it in Safari. The &ldquo;Add to Home Screen&rdquo; option only appears in Safari.
          </p>
        </Step>
        <Step n="2" title="Tap the Share button">
          <p className="text-sm text-zinc-300">
            Bottom toolbar — the square with an arrow pointing up.{" "}
            <span className="font-mono text-emerald-400">⬆️</span> If you don&apos;t
            see it, scroll up so the toolbar reappears.
          </p>
        </Step>
        <Step n="3" title="Scroll down → Add to Home Screen">
          <p className="text-sm text-zinc-300">
            In the share menu, scroll until you see &ldquo;Add to Home Screen&rdquo;.
            Tap it. Confirm the name (default: &ldquo;iKratom&rdquo;) and tap{" "}
            <span className="font-mono">Add</span>.
          </p>
        </Step>
        <Step n="4" title="Open iKratom from your home screen">
          <p className="text-sm text-zinc-300">
            You&apos;ll see the green iKratom icon on your home screen. Tap it —
            the app launches full-screen, no Safari chrome.
          </p>
        </Step>
        <Step n="5" title="Enable notifications" optional>
          <p className="text-sm text-zinc-300">
            Once inside the app, go to <span className="font-mono text-emerald-400">/account/security</span>{" "}
            and tap &ldquo;Enable push notifications&rdquo;. Required to get alerts
            about hostile bills, hearing schedules, and emergency mode.
          </p>
        </Step>
      </ol>

      <section className="mt-10 rounded-md border border-amber-700/30 bg-amber-950/10 p-4">
        <p className="text-sm font-semibold text-amber-300">⚠ iOS limitations to know</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-100">
          <li>Push notifications require iOS 16.4+.</li>
          <li>Background sync is limited — open the app every few days to keep bill data fresh.</li>
          <li>Web Speech API (for call transcription) works in Safari on iOS 14.5+.</li>
        </ul>
      </section>

      <section className="mt-6 rounded-md border border-zinc-800 bg-zinc-950/40 p-4 text-xs text-zinc-400">
        <p className="font-semibold text-zinc-300">Verifying the install worked</p>
        <p className="mt-2">
          When you open the iKratom home-screen icon, the URL bar should be hidden.
          If you still see the Safari address bar, the install didn&apos;t complete.
          Delete the icon and try again from step 1.
        </p>
      </section>
    </div>
  );
}

function Step({ n, title, optional, children }: { n: string; title: string; optional?: boolean; children: React.ReactNode }) {
  return (
    <li className="rounded-md border border-zinc-800 bg-zinc-950/40 p-4">
      <div className="flex items-baseline gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-600 font-bold text-zinc-950">
          {n}
        </span>
        <h3 className="text-base font-bold">
          {title}
          {optional && <span className="ml-2 text-[10px] font-normal uppercase tracking-wider text-zinc-500">optional</span>}
        </h3>
      </div>
      <div className="mt-2 pl-10">{children}</div>
    </li>
  );
}
