import { siteConfig } from "@/config/site.config";

export const metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold">Privacy Policy</h1>
        <p className="mt-2 text-sm text-zinc-500">Last updated: 2026-07-05</p>
      </header>

      <div className="space-y-6 text-sm leading-relaxed text-zinc-300">
        <section className="rounded-lg border border-emerald-700/40 bg-emerald-950/10 p-5">
          <h2 className="mb-2 text-lg font-semibold text-emerald-300">In one paragraph</h2>
          <p>
            We collect what we need to match you to your specific elected officials and run the
            platform — name, email, address, optional role tags. We do not sell, share with
            advertisers, or use any third-party tracking. Your direct messages are end-to-end
            encrypted; we literally cannot read them. Your address is never shown publicly.
            You can export or delete everything anytime.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-zinc-100">What we collect</h2>
          <ul className="list-disc space-y-2 pl-6">
            <li>
              <strong>Email + password</strong> — for authentication. Passwords are hashed by
              Supabase using bcrypt; we never see the plaintext.
            </li>
            <li>
              <strong>Full name + address</strong> (optional) — used to match you to your specific
              U.S. House and state legislative districts via the Census Geocoder. Address is{" "}
              <strong>never shown publicly</strong>. Without it, you can still browse but can&apos;t
              use one-click campaign actions.
            </li>
            <li>
              <strong>Phone</strong> (optional) — only used if you&apos;ve provided it for a campaign
              auto-fill. Never shared.
            </li>
            <li>
              <strong>Role tags</strong> — shop owner / medical professional / advocate leader. Used
              to surface relevant features. Shown publicly on your profile (badge only — never
              identifying details).
            </li>
            <li>
              <strong>Public key</strong> — for end-to-end encrypted DMs. Generated on your device.
              Your <em>private</em> key never leaves your device.
            </li>
            <li>
              <strong>Activity logs</strong> — campaign actions you&apos;ve sent (which campaign,
              which legislator, when). Used for de-duplication, spam prevention, and showing your
              own action history. Never shared in identifiable form.
            </li>
            <li>
              <strong>Forum posts + reactions</strong> — public by design. Visible to anyone who
              browses the forum.
            </li>
            <li>
              <strong>Direct messages</strong> — stored as encrypted ciphertext. The server cannot
              decrypt them. Only you and the other participants (with their device keys) can read.
            </li>
            <li>
              <strong>Gmail OAuth refresh token</strong> (only if you connect Gmail) — encrypted at
              rest in our database, used solely to send campaign emails on your behalf via Gmail&apos;s
              API. We never read your Gmail. Only the <code className="text-xs">gmail.send</code>{" "}
              scope is requested.
            </li>
            <li>
              <strong>Web push subscription</strong> (only if you enable notifications) — the browser
              push endpoint + its encryption keys, so we can deliver the alerts you opted into. Stored
              only while notifications are on; removed when you turn them off.
            </li>
            <li>
              <strong>Product analytics</strong> — we use PostHog (first-party product analytics) and
              Vercel performance metrics to see how the app is used and where it&apos;s slow. Page
              views and clicks are captured; a sampled minority of sessions are replayed for debugging
              with <strong>all form inputs masked</strong> (we never record what you type). Anonymous
              visitors get no analytics profile. No third-party ad networks, no cross-site tracking,
              and we never sell data. You can opt out in your browser&apos;s Do-Not-Track / our
              settings.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-zinc-100">What we do NOT collect</h2>
          <ul className="list-disc space-y-1 pl-6">
            <li>Third-party ad/tracking networks or cross-site trackers (no Google Analytics, no Facebook Pixel, no ad cookies). Our product analytics (PostHog/Vercel, above) are first-party and never sold or shared.</li>
            <li>Browser fingerprints or device IDs</li>
            <li>Location beyond the address you voluntarily entered</li>
            <li>Contents of your DMs (literally cannot — they&apos;re encrypted before they leave your device)</li>
            <li>Anything from your Gmail beyond what we send on your behalf</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-zinc-100">How your data is protected</h2>
          <ul className="list-disc space-y-1 pl-6">
            <li>All data encrypted in transit (HTTPS / TLS 1.3)</li>
            <li>All data encrypted at rest (Supabase managed Postgres)</li>
            <li>Row-level security: you can only read your own profile + sent messages</li>
            <li>Direct messages encrypted client-side with libsodium (Curve25519 + XChaCha20-Poly1305)</li>
            <li>No advertising partners, no data brokers, no third-party sharing</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-zinc-100">Third-party services we use</h2>
          <p>For the platform to function we rely on:</p>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li><strong>Supabase</strong> — database + auth (your data lives here)</li>
            <li><strong>Vercel</strong> — application hosting</li>
            <li><strong>OpenStates, congress-legislators, Census</strong> — public legislator data sources we sync from (no data flows the other way)</li>
            <li><strong>Google Gemini</strong> — when admins use AI-suggest local officials or news scraping (we send queries, never user data)</li>
            <li><strong>Google OAuth + Gmail API</strong> — only if you connect Gmail. Only <code className="text-xs">gmail.send</code> scope.</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-zinc-100">Your rights</h2>
          <ul className="list-disc space-y-1 pl-6">
            <li><strong>Access</strong> — view your data anytime in <a href="/account" className="text-emerald-400 hover:underline">/account</a></li>
            <li><strong>Export</strong> — download a JSON copy of everything we have on you from /account</li>
            <li><strong>Delete</strong> — full account deletion is one click; data is purged immediately</li>
            <li><strong>Correction</strong> — edit your profile directly</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-zinc-100">Children</h2>
          <p>
            {siteConfig.name} is intended for adults 18+. We do not knowingly collect data from minors.
            If you believe a minor has created an account, contact us and we&apos;ll remove it.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-zinc-100">Contact</h2>
          <p>
            Questions or data requests:{" "}
            <a href={`mailto:${siteConfig.links.support}`} className="text-emerald-400 hover:underline">
              {siteConfig.links.support}
            </a>
          </p>
        </section>
      </div>
    </div>
  );
}
