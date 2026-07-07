import Link from "next/link";

export const metadata = {
  title: "Install iKratom on Android",
};

export default function InstallAndroidPage() {
  // APK download link comes from env (Cloudflare R2 or repo Releases).
  // Falls back to the PWA-install path if not configured yet.
  const apkUrl = process.env.IKRATOM_APK_URL ?? null;

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <Link href="/install" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Install
      </Link>
      <header className="mt-2 mb-8">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          🤖 Android install
        </p>
        <h1 className="mt-2 text-3xl font-bold">Two ways to install on Android</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Pick whichever fits — Method A is faster, Method B is the real
          Android app (closer to Play Store quality without needing the store).
        </p>
      </header>

      {/* Method A — PWA via Chrome */}
      <section className="mb-8 rounded-lg border border-emerald-700/30 bg-emerald-950/10 p-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-300">
          Method A — Recommended · 30 seconds
        </p>
        <h2 className="mt-1 text-2xl font-bold">Install via Chrome banner</h2>
        <ol className="mt-4 space-y-3">
          <Step n="1" title="Open ikratom.org in Chrome">
            <p className="text-sm text-zinc-300">
              Must be Chrome (or any Chromium-based browser like Edge, Brave,
              Samsung Internet). Firefox does not currently support PWA install.
            </p>
          </Step>
          <Step n="2" title="Watch for the install banner">
            <p className="text-sm text-zinc-300">
              Chrome shows an &ldquo;Install iKratom?&rdquo; banner at the bottom.
              Tap <span className="font-semibold text-emerald-300">Install</span>.
            </p>
            <p className="mt-2 text-xs text-zinc-500">
              No banner? Tap the ⋮ menu (top-right) → &ldquo;Install app&rdquo; or
              &ldquo;Add to Home screen&rdquo;.
            </p>
          </Step>
          <Step n="3" title="Open from app drawer">
            <p className="text-sm text-zinc-300">
              The iKratom icon appears in your app drawer. Tap to launch
              full-screen.
            </p>
          </Step>
        </ol>
      </section>

      {/* Method B — APK */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
          Method B — Power-user · 2 minutes
        </p>
        <h2 className="mt-1 text-2xl font-bold">Sideload the Android APK</h2>
        <p className="mt-2 text-sm text-zinc-300">
          A native Android app wrapper (built via{" "}
          <a href="https://github.com/GoogleChromeLabs/bubblewrap" target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">
            Bubblewrap
          </a>
          {" "}— Google&apos;s official TWA toolchain). Closer to a Play Store
          install without going through Google&apos;s review queue.
        </p>

        {apkUrl ? (
          <div className="mt-4 space-y-4">
            <ol className="space-y-3">
              <Step n="1" title="Download the APK">
                <a
                  href={apkUrl}
                  className="mt-1 inline-flex items-center gap-2 rounded-md bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-emerald-400"
                  download
                >
                  ⬇ Download ikratom-latest.apk
                </a>
              </Step>
              <Step n="2" title="Enable installs from your browser">
                <p className="text-sm text-zinc-300">
                  Settings → Apps → Special access → Install unknown apps →
                  Chrome → Allow. (Path varies by Android version + manufacturer.)
                </p>
              </Step>
              <Step n="3" title="Open the downloaded APK">
                <p className="text-sm text-zinc-300">
                  Tap the file in your Downloads (or notification shade) →
                  Install → Open.
                </p>
              </Step>
            </ol>
          </div>
        ) : (
          <div className="mt-4 rounded-md border border-amber-700/30 bg-amber-950/10 p-3 text-xs text-amber-100">
            <p className="font-semibold">📲 Direct APK download is being finalized.</p>
            <p className="mt-1">
              Use the Chrome install above (Method A) — it installs the identical app
              today, with home-screen icon and push notifications. The standalone APK
              is coming shortly.
            </p>
          </div>
        )}
      </section>

      <section className="mt-8 rounded-md border border-zinc-800 bg-zinc-950/40 p-4 text-xs text-zinc-400">
        <p className="font-semibold text-zinc-300">Both methods deliver:</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Full-screen, no browser chrome</li>
          <li>Push notifications (with permission)</li>
          <li>Offline support for bills + briefings you&apos;ve viewed</li>
          <li>Quick-action shortcuts from the home screen icon</li>
          <li>Web Speech API for in-app call transcription</li>
        </ul>
      </section>
    </div>
  );
}

function Step({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-600 font-bold text-zinc-950">
        {n}
      </span>
      <div>
        <h3 className="text-sm font-bold">{title}</h3>
        <div className="mt-1">{children}</div>
      </div>
    </li>
  );
}
