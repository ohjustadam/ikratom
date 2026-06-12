import Link from "next/link";
import { InstallPcButton } from "./InstallPcButton";

export const metadata = {
  title: "Install iKratom on your PC — Windows / Mac / Linux desktop app",
  description:
    "Install iKratom as a real desktop program — its own window, taskbar icon, Start-menu entry, and push notifications. Free, 10 seconds, no store.",
};

/**
 * PC install track. Primary path = PWA install (Chrome/Edge): a real
 * windowed app with taskbar/Start-menu presence and working push — and
 * zero SmartScreen friction because nothing is downloaded. The native
 * .exe (Tauri, GitHub Releases) is offered as the alternative for folks
 * who specifically want a downloaded installer.
 */
export default function InstallWindowsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
      <header className="mb-8 text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          💻 iKratom for PC
        </p>
        <h1 className="mt-2 text-3xl font-bold sm:text-4xl">
          A real desktop app. Ten seconds. Free.
        </h1>
        <p className="mt-3 text-sm text-zinc-400">
          Own window, taskbar icon, Start-menu entry, push notifications for
          bills and hearings — no browser tabs to lose. Works on Windows, Mac,
          and Linux via Chrome or Edge.
        </p>
      </header>

      <section className="mb-8">
        <InstallPcButton />
      </section>

      <section className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
          Manual install (any PC, 10 seconds)
        </h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-zinc-300">
          <li>
            Open <span className="font-mono text-emerald-300">ikratom.org</span> in{" "}
            <strong>Chrome</strong> or <strong>Edge</strong>.
          </li>
          <li>
            Click the <strong>⋮ / ⋯ menu</strong> (top-right) →{" "}
            <strong>Cast, save and share</strong> →{" "}
            <strong>Install iKratom…</strong>
            <span className="block text-xs text-zinc-500">
              (Edge: menu → Apps → Install iKratom. Some versions show an
              install icon directly in the address bar.)
            </span>
          </li>
          <li>
            Click <strong>Install</strong> — iKratom opens in its own window
            and lands in your Start menu / dock like any other program.
          </li>
        </ol>
      </section>

      <section className="mt-6 rounded-md border border-emerald-700/30 bg-emerald-950/10 p-4 text-sm">
        <p className="font-semibold text-emerald-300">What you get</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-zinc-300">
          <li>Push notifications on your desktop — bill movement, hearings, local fights</li>
          <li>Its own window + taskbar icon — no lost browser tabs</li>
          <li>Right-click the icon for instant shortcuts: Campaigns, Pulse, Messages</li>
          <li>Auto-updates with the site — never reinstall</li>
          <li>Pin it to the taskbar and advocacy is one click from anywhere</li>
        </ul>
      </section>

      <section className="mt-6 rounded-md border border-zinc-800 bg-zinc-950/40 p-4">
        <h2 className="text-sm font-semibold text-zinc-300">
          Prefer a downloaded installer (.exe)?
        </h2>
        <p className="mt-2 text-xs text-zinc-400">
          A native Windows installer (built on the open-source Tauri shell) is
          published on our{" "}
          <a
            href="https://github.com/ohjustadam/ikratom/releases"
            target="_blank"
            rel="noopener noreferrer"
            className="text-emerald-400 hover:underline"
          >
            GitHub Releases page ↗
          </a>
          . Heads up: until the project buys a code-signing certificate,
          Windows SmartScreen shows a &quot;unrecognized app&quot; warning on
          first run (click <em>More info → Run anyway</em>). The one-click
          install above has no such warning — it&apos;s the recommended path.
        </p>
      </section>

      <p className="mt-8 text-center text-xs text-zinc-500">
        On your phone instead? <Link href="/install/ios" className="text-emerald-400 hover:underline">iPhone</Link>
        {" · "}
        <Link href="/install/android" className="text-emerald-400 hover:underline">Android</Link>
      </p>
    </div>
  );
}
