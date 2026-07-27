import Link from "next/link";
import { getContent } from "@/lib/editable-content";
import { donateConfig } from "@/config/donate.config";

/**
 * The home-page donation ask.
 *
 * The sitewide DonateStrip is deliberately one line at 11px, because it sits on
 * every page. It has no room to say WHY the platform needs money, and an ask
 * with no reason converts badly. This band is the home-page version: enough
 * space to explain the situation honestly, without turning the landing page
 * into a fundraiser.
 *
 * Placed after the value + proof bands and before the signup close on purpose.
 * A visitor who has not yet seen what the tool does has no reason to fund it,
 * and putting the ask after the final signup CTA would bury it.
 *
 * Owner-editable like the rest of the donation flow: copy comes from the
 * `home.donate.headline` / `home.donate.body` keys at /admin/content/<key>, and
 * saving an EMPTY headline hides the whole band — the same escape hatch
 * DonateStrip has. These are separate keys from the `donate.*` ones so the
 * short home ask and the full /donate appeal can be tuned independently.
 *
 * Cookieless + cached: `getContent` reads through unstable_cache with a
 * service-role client, so this does NOT drag the home page back into dynamic
 * rendering (the thing that caused the Fluid-CPU outage). It also fails soft —
 * if the DB is unreachable, the shipped defaults below still render.
 */
export async function HomeDonateBand() {
  const headline = await getContent(
    "home.donate.headline",
    "This platform is free. Keeping it free costs money."
  );
  const body = await getContent(
    "home.donate.body",
    "No ads, nothing for sale, and no organization funding it — iKratom runs entirely on donations from the people who use it. That is what pays for hosting and data, and what lets us fix things fast when they break. If this has saved you time, chipping in keeps it online."
  );

  // Owner hid the band by saving an empty headline.
  if (!headline.trim()) return null;

  return (
    <section className="mt-16 rounded-lg border border-emerald-700/40 bg-emerald-950/15 p-8">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-xl font-bold leading-snug sm:text-2xl">
          💚 {headline}
        </p>

        {body.trim() && (
          <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-zinc-300">
            {body}
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          {/* Primary CTA goes to /donate rather than straight to a payment
              link: that page explains the situation properly and carries every
              method, including "something else" for donors who can use neither
              Cash App nor PayPal. */}
          <Link
            href="/donate"
            className="rounded-md bg-emerald-500 px-6 py-3 font-semibold text-zinc-950 transition-colors hover:bg-emerald-400"
          >
            {donateConfig.ctaLabel} →
          </Link>

          {/* One-click path for the common case, per the product rule that any
              action should take 1-2 clicks. Cash App is always configured;
              PayPal is optional and lives on /donate where it can auto-hide. */}
          <a
            href={donateConfig.cashAppUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md border border-zinc-700 px-6 py-3 font-semibold transition-colors hover:border-emerald-500 hover:text-emerald-400"
          >
            Cash App {donateConfig.cashtag}
          </a>
        </div>

        <p className="mt-4 text-xs text-zinc-500">
          iKratom is a nonpartisan advocacy tool, not a registered charity —
          contributions are not tax-deductible.
        </p>
      </div>
    </section>
  );
}
