import { headers } from "next/headers";

export const metadata = {
  title: "Embed widget for partners",
  description:
    "Drop-in widget that turns any kratom-shop page into a recruitment node for kratom advocacy.",
};

const STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL",
  "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME",
  "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH",
  "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
  "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
];

export default async function EmbedDemoPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; tone?: string }>;
}) {
  const sp = await searchParams;
  const state = (sp.state ?? "OK").toUpperCase();
  const tone = sp.tone === "urgent" ? "urgent" : "neutral";

  const h = await headers();
  // Build the absolute URL so the snippet works regardless of dev/prod host
  const proto = (h.get("x-forwarded-proto") ?? "https").split(",")[0];
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "ikratom.org").split(",")[0];
  const scriptSrc = `${proto}://${host}/embed/v1/email-rep.js`;

  const snippet = `<script src="${scriptSrc}" data-state="${state}" data-tone="${tone}"></script>`;

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
      <header className="mb-10">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          For partners + shop owners
        </p>
        <h1 className="mt-3 text-4xl font-bold sm:text-5xl">
          Turn your storefront into a recruitment node
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-zinc-400">
          One line of HTML. Renders a call-to-action card on your site. When a
          customer clicks, they land on iKratom and can email their state
          legislators in 30 seconds. You get credit for the action.
        </p>
      </header>

      {/* Live preview */}
      <section className="mb-10">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Live preview
        </h2>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-6">
          <p className="mb-4 text-xs text-zinc-500">
            This is what the widget looks like on your site:
          </p>
          {/* The widget script self-injects below this script tag */}
          <div className="not-prose">
            {/* eslint-disable-next-line @next/next/no-sync-scripts */}
            <script src={`/embed/v1/email-rep.js?state=${state}&tone=${tone}&_=${Date.now()}`} data-state={state} data-tone={tone}></script>
          </div>
        </div>
      </section>

      {/* Configurator */}
      <section className="mb-10">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Configure
        </h2>
        <form
          method="GET"
          className="flex flex-wrap items-end gap-4 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5"
        >
          <div>
            <label htmlFor="state" className="block text-xs font-medium text-zinc-400">
              State
            </label>
            <select
              id="state"
              name="state"
              defaultValue={state}
              className="mt-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
            >
              <option value="FED">Federal (default)</option>
              {STATES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="tone" className="block text-xs font-medium text-zinc-400">
              Tone
            </label>
            <select
              id="tone"
              name="tone"
              defaultValue={tone}
              className="mt-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
            >
              <option value="neutral">Neutral (emerald)</option>
              <option value="urgent">Urgent (red)</option>
            </select>
          </div>
          <button
            type="submit"
            className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400"
          >
            Update preview
          </button>
        </form>
      </section>

      {/* Install snippet */}
      <section className="mb-10">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Copy + paste this where you want the card to appear
        </h2>
        <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950 p-4">
          <code className="block whitespace-pre font-mono text-xs text-emerald-300">
            {snippet}
          </code>
        </div>
        <p className="mt-3 text-sm text-zinc-400">
          Drop the line into any HTML page (Shopify section, WordPress widget,
          Squarespace code block, plain HTML). The card renders right where the
          script tag sits.
        </p>
      </section>

      {/* What it does */}
      <section className="mb-10 rounded-lg border border-zinc-800 bg-zinc-950/40 p-6">
        <h2 className="mb-4 text-lg font-bold">What happens when a customer clicks</h2>
        <ol className="space-y-3 text-sm text-zinc-300">
          <li className="flex gap-3">
            <span className="font-mono text-emerald-400">1.</span>
            <span>
              They land on iKratom in a new tab. Your existing tab stays open
              — they don&apos;t lose their place on your site.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="font-mono text-emerald-400">2.</span>
            <span>
              We capture your domain as the referrer in a private cookie (60
              days). It&apos;s never shown publicly.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="font-mono text-emerald-400">3.</span>
            <span>
              They sign up if needed (free, takes 30 seconds), then are
              auto-routed to a campaign for{" "}
              <span className="font-mono text-emerald-300">
                {state === "FED" ? "federal" : state}
              </span>{" "}
              legislators.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="font-mono text-emerald-400">4.</span>
            <span>
              When they send the email, the action is credited to your domain
              in our database.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="font-mono text-emerald-400">5.</span>
            <span>
              Future ask: we&apos;ll add a partner dashboard so you can see
              click-throughs + sent emails attributed to your shop. For now,
              email <code className="rounded bg-zinc-900 px-1.5 py-0.5 text-xs text-zinc-300">ohjustadam@proton.me</code>
              {" "}for stats on your domain.
            </span>
          </li>
        </ol>
      </section>

      {/* Privacy / FAQ */}
      <section className="mb-10 rounded-lg border border-zinc-800 bg-zinc-950/40 p-6 text-sm text-zinc-300">
        <h2 className="mb-4 text-lg font-bold">FAQ</h2>
        <dl className="space-y-4">
          <div>
            <dt className="font-semibold text-zinc-100">Does this slow my site down?</dt>
            <dd className="mt-1 text-zinc-400">
              The script is ~3KB, served from a CDN with aggressive caching, and
              loads non-blocking. Your page renders before it.
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-zinc-100">Does it set tracking cookies on my visitors?</dt>
            <dd className="mt-1 text-zinc-400">
              No cookies on your visitor in your domain. We set a referral
              cookie only after they click through and land on iKratom — and
              even there, it&apos;s an HTTPOnly session marker, not an ad
              identifier. We don&apos;t share this data with anyone.
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-zinc-100">Can I customize the look?</dt>
            <dd className="mt-1 text-zinc-400">
              Two tones today: <code className="rounded bg-zinc-900 px-1 text-zinc-200">neutral</code>{" "}
              (emerald) and <code className="rounded bg-zinc-900 px-1 text-zinc-200">urgent</code>{" "}
              (red, for active threats). More themes are coming. The card is in
              an isolated style scope so it won&apos;t fight your site&apos;s CSS.
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-zinc-100">Is iKratom partisan?</dt>
            <dd className="mt-1 text-zinc-400">
              No. iKratom is independent of any single advocacy org and has no
              political alignment. The only position is keeping kratom legal
              and regulated sensibly.
            </dd>
          </div>
        </dl>
      </section>

      <p className="text-center text-xs text-zinc-500">
        Questions? Email{" "}
        <a href="mailto:ohjustadam@proton.me" className="text-emerald-400 hover:underline">
          ohjustadam@proton.me
        </a>
      </p>
    </div>
  );
}
