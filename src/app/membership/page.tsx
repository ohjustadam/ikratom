import Link from "next/link";
import { siteConfig } from "@/config/site.config";

export const metadata = {
  title: "Account levels — iKratom",
  description:
    "What you get as an anonymous visitor, with a free account, and (coming soon) with iKratom Pro.",
};

const PRO_LIVE = siteConfig.features.proSubscription;

type Tier = {
  key: string;
  name: string;
  price: string;
  blurb: string;
  cta: { label: string; href: string } | null;
  badge?: string;
  highlight?: boolean;
  features: string[];
  footnote?: string;
};

const TIERS: Tier[] = [
  {
    key: "anon",
    name: "Anonymous",
    price: "Free",
    blurb: "No account needed — the full public toolbelt.",
    cta: { label: "Browse legislators", href: "/legislators" },
    features: [
      "Browse every tracked bill, legislator, and official",
      "Real contact info — email, phone, office address",
      "One-click mailto: emails to your reps",
      "Live bill status + directory search",
      "Public threat-matrix rankings",
    ],
  },
  {
    key: "free",
    name: "Free account",
    price: "Free",
    blurb: "Sign up to make it yours — your reps, your actions, your intel.",
    cta: { label: "Create a free account", href: "/login" },
    highlight: true,
    badge: "Most popular",
    features: [
      "Everything in Anonymous",
      "Your reps auto-matched from your address",
      "Per-official Pressure Index — where your effort matters most",
      "Save reps + set follow-up reminders",
      "Track the actions you've sent",
      "Join campaigns and the community",
    ],
    footnote:
      "Verify your account (confirm email, enable 2FA, complete your profile — all free) to unlock the deepest intel: stance memos, rationale, and the full dossier.",
  },
  {
    key: "pro",
    name: "iKratom Pro",
    price: PRO_LIVE ? "Monthly" : "Coming soon",
    blurb: "For shop owners, organizers, and power advocates running campaigns.",
    cta: PRO_LIVE ? { label: "See plans", href: "/membership/pro" } : null,
    badge: "Coming soon",
    features: [
      "Multi-state watchlists + saved legislator lists",
      "Real-time alerts — bill movement, committee scheduling, votes",
      "CSV / data export (legislators, votes, donor signals)",
      "Coalition tools — coordinate group actions, track team sends",
      "Early access to new intel surfaces",
      "Priority support",
    ],
    footnote:
      "Planned — not yet available. The platform stays free for individual advocates; Pro adds power-user tooling on top.",
  },
];

export default function MembershipPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
      <header className="mb-10 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">Account levels</p>
        <h1 className="mt-2 text-3xl font-bold sm:text-4xl">Pick how you want to advocate</h1>
        <p className="mx-auto mt-3 max-w-2xl text-sm text-zinc-400">
          {siteConfig.name} is free for individual advocates — always. Create a free account to unlock your
          personalized intel; Pro (coming soon) adds tooling for organizers.
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-3">
        {TIERS.map((t) => (
          <section
            key={t.key}
            className={`relative flex flex-col rounded-xl border p-6 ${
              t.highlight
                ? "border-emerald-600/60 bg-emerald-950/10 ring-1 ring-emerald-700/30"
                : "border-zinc-800 bg-zinc-950/40"
            }`}
          >
            {t.badge && (
              <span
                className={`absolute right-4 top-4 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                  t.highlight ? "bg-emerald-500 text-zinc-950" : "bg-zinc-800 text-zinc-400"
                }`}
              >
                {t.badge}
              </span>
            )}
            <h2 className="text-lg font-bold">{t.name}</h2>
            <p className="mt-1 text-2xl font-bold text-emerald-300">{t.price}</p>
            <p className="mt-2 text-xs text-zinc-400">{t.blurb}</p>
            <ul className="mt-4 flex-1 space-y-2 text-sm">
              {t.features.map((f, i) => (
                <li key={i} className="flex items-start gap-2 text-zinc-300">
                  <span className={`mt-0.5 ${t.key === "pro" ? "text-zinc-600" : "text-emerald-400"}`}>
                    {t.key === "pro" ? "○" : "✓"}
                  </span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            {t.footnote && <p className="mt-4 text-[11px] leading-relaxed text-zinc-500">{t.footnote}</p>}
            {t.cta ? (
              <Link
                href={t.cta.href}
                className={`mt-5 block rounded-md px-4 py-2 text-center text-sm font-semibold ${
                  t.highlight
                    ? "bg-emerald-500 text-zinc-950 hover:bg-emerald-400"
                    : "border border-zinc-700 text-zinc-200 hover:border-emerald-500"
                }`}
              >
                {t.cta.label}
              </Link>
            ) : (
              <div className="mt-5 rounded-md border border-dashed border-zinc-700 px-4 py-2 text-center text-sm text-zinc-500">
                Coming soon
              </div>
            )}
          </section>
        ))}
      </div>

      <p className="mt-10 text-center text-xs text-zinc-600">
        Questions?{" "}
        <a href={`mailto:${siteConfig.links.support}`} className="text-emerald-400 hover:underline">
          {siteConfig.links.support}
        </a>
      </p>
    </div>
  );
}
