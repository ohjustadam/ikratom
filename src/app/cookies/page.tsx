import { siteConfig } from "@/config/site.config";

export const metadata = { title: "Cookie Policy" };

export default function CookiesPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold">Cookie Policy</h1>
        <p className="mt-2 text-sm text-zinc-500">Last updated: 2026-05-05</p>
      </header>

      <div className="space-y-6 text-sm leading-relaxed text-zinc-300">
        <section className="rounded-lg border border-emerald-700/40 bg-emerald-950/10 p-5">
          <h2 className="mb-2 text-lg font-semibold text-emerald-300">In short</h2>
          <p>
            We use exactly two cookies. Both are essential for the site to work. We do{" "}
            <strong>not</strong> use any tracking, advertising, or analytics cookies, and we do not
            share any data with third parties for ad purposes.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-zinc-100">The cookies we set</h2>
          <table className="w-full text-xs">
            <thead className="text-zinc-500">
              <tr className="border-b border-zinc-800">
                <th className="py-2 text-left">Cookie</th>
                <th className="py-2 text-left">Purpose</th>
                <th className="py-2 text-left">Duration</th>
                <th className="py-2 text-left">Required</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-zinc-900">
                <td className="py-3 font-mono">sb-*-auth-token</td>
                <td className="py-3">
                  Keeps you signed in. HttpOnly, Secure, SameSite=Lax. Set by Supabase.
                </td>
                <td className="py-3">~1 hour (auto-refresh)</td>
                <td className="py-3 text-emerald-300">Required</td>
              </tr>
              <tr className="border-b border-zinc-900">
                <td className="py-3 font-mono">g_oauth_state</td>
                <td className="py-3">
                  CSRF protection during the Gmail OAuth flow (only set briefly while connecting).
                </td>
                <td className="py-3">10 minutes</td>
                <td className="py-3 text-emerald-300">Required (only if connecting Gmail)</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-zinc-100">Browser storage we use</h2>
          <p>In addition to cookies, the platform uses:</p>
          <ul className="mt-2 list-disc space-y-2 pl-6">
            <li>
              <strong>IndexedDB</strong> — to store your end-to-end encryption private key locally
              for direct messages. This key never leaves your device. Cleared when you delete
              site data or when you regenerate keys from /account.
            </li>
            <li>
              <strong>localStorage</strong> — none currently. We may use it later for UI
              preferences (theme, dismissed banners) — none of it gets sent to our server.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-zinc-100">Third-party cookies</h2>
          <p>
            None set by us. If you connect Gmail (optional), Google sets its own auth cookies during
            the OAuth flow per Google&apos;s privacy policy.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-zinc-100">Disabling cookies</h2>
          <p>
            Because the only cookies we set are required for sign-in and OAuth, disabling them via
            your browser will prevent you from logging in. You can still browse public pages
            (campaigns, forum, library, news, legislators, map) without any cookies.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-zinc-100">Contact</h2>
          <p>
            Questions:{" "}
            <a href={`mailto:${siteConfig.links.support}`} className="text-emerald-400 hover:underline">
              {siteConfig.links.support}
            </a>
          </p>
        </section>
      </div>
    </div>
  );
}
