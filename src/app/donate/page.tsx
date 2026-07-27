import Link from "next/link";
import { getContent } from "@/lib/editable-content";
import { donateConfig } from "@/config/donate.config";

export const metadata = {
  title: "Support iKratom",
  description:
    "iKratom is free and runs entirely on community donations. Chip in via Cash App or PayPal to keep the platform online and improving.",
};

// Public, viewer-independent, and read through the cached cookieless helper —
// so this page can be served without a per-request render. Revalidate is short
// because the owner will edit this copy while the appeal is live.
export const revalidate = 300;

/**
 * /donate — the full donation ask.
 *
 * The bottom strip is one line at 11px; it cannot carry an explanation, and a
 * cramped ask converts badly. This is where the situation gets explained
 * honestly and every payment method lives, including "something else" — the
 * owner specifically wanted donors who can't use Cash App or PayPal to still
 * have a path rather than bouncing.
 *
 * All body copy comes from editable-content keys, so the owner can rewrite the
 * appeal at /admin/content/<key> without a deploy. The values here are the
 * shipped defaults.
 */
export default async function DonatePage() {
  const headline = await getContent(
    "donate.headline",
    "We're back — and we need your help to stay here."
  );
  const body = await getContent(
    "donate.body",
    "iKratom was down for a few days because of a technical issue with our hosting. Everything is fixed, and your account and data were never at risk.\n\n" +
      "Here's the honest part: this platform is free, has no ads, and sells nothing. It runs entirely on donations. Funding is what lets us respond fast when something breaks, keep the data current, and keep building. Nobody can promise an outage will never happen again — but having resources to dedicate to it is what turns a crisis into a short inconvenience.\n\n" +
      "If you can give anything at all, it genuinely matters. And if you can't, you're still welcome here — that will never change."
  );

  const hasPaypal = !!donateConfig.paypalUrl;

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-bold sm:text-3xl">💚 {headline}</h1>

      <div className="mt-5 space-y-4 text-[15px] leading-relaxed text-zinc-300">
        {body.split("\n\n").map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>

      <div className="mt-8 space-y-3">
        <a
          href={donateConfig.cashAppUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between rounded-xl border border-emerald-700/50 bg-emerald-950/30 px-5 py-4 transition-colors hover:border-emerald-500"
        >
          <span>
            <span className="block font-semibold text-emerald-300">Cash App</span>
            <span className="block font-mono text-sm text-zinc-400">{donateConfig.cashtag}</span>
          </span>
          <span aria-hidden className="text-emerald-400">→</span>
        </a>

        {/* Auto-hides until a PayPal.me handle is configured — better a missing
            option than a dead link on a donation page. */}
        {hasPaypal && (
          <a
            href={donateConfig.paypalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between rounded-xl border border-sky-700/50 bg-sky-950/30 px-5 py-4 transition-colors hover:border-sky-500"
          >
            <span>
              <span className="block font-semibold text-sky-300">PayPal</span>
              <span className="block font-mono text-sm text-zinc-400">
                paypal.me/{donateConfig.paypalHandle}
              </span>
            </span>
            <span aria-hidden className="text-sky-400">→</span>
          </a>
        )}

        <a
          href={`mailto:${donateConfig.contactEmail}?subject=${encodeURIComponent("Another way to donate")}`}
          className="flex items-center justify-between rounded-xl border border-zinc-700 bg-zinc-900/50 px-5 py-4 transition-colors hover:border-zinc-500"
        >
          <span>
            <span className="block font-semibold text-zinc-200">Another way to give</span>
            <span className="block text-sm text-zinc-400">
              Prefer a different method, or want to give monthly? Get in touch.
            </span>
          </span>
          <span aria-hidden className="text-zinc-400">→</span>
        </a>
      </div>

      <p className="mt-8 text-center text-sm text-zinc-500">
        Thank you — genuinely. This project exists because people chose to share it.
      </p>

      <p className="mt-6 text-center text-xs text-zinc-600">
        Donations support hosting, data, and development. iKratom is a nonpartisan
        advocacy tool and is not a registered charity — contributions are not tax-deductible.{" "}
        <Link href="/support" className="underline hover:text-zinc-400">
          More about the project
        </Link>
      </p>
    </div>
  );
}
