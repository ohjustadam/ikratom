import { createClient } from "@/lib/supabase/server";
import { USMap } from "@/components/USMap";
import { ImpactStats } from "@/components/ImpactStats";
import { readLocale } from "@/modules/auth/actions-locale";
import { getMessages } from "@/i18n/messages";

export default async function HomePage() {
  const supabase = await createClient();
  const locale = await readLocale();
  const t = getMessages(locale);
  const { data: states } = await supabase
    .from("states")
    .select("abbr, kratom_status");
  const statusByAbbr: Record<string, string> = {};
  for (const s of states ?? []) {
    if (s.kratom_status) statusByAbbr[s.abbr] = s.kratom_status;
  }
  const isIntl = locale !== "en";
  return (
    <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
      {/* International callout — only when locale is non-English */}
      {isIntl && (
        <div className="mb-8 rounded-lg border border-amber-700/40 bg-amber-950/20 p-4 text-center text-sm text-amber-100">
          🌏 {t.intl.farmerCallout}
        </div>
      )}

      {/* Hero */}
      <section className="text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          {t.hero.eyebrow}
        </p>
        <h1 className="mt-4 text-5xl font-bold leading-tight sm:text-6xl">
          {t.hero.headline}
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-zinc-400">
          {t.hero.sub}
        </p>
        <div className="mt-10 flex items-center justify-center gap-4">
          <a
            href="/signup"
            className="rounded-md bg-emerald-500 px-6 py-3 font-semibold text-zinc-950 hover:bg-emerald-400"
          >
            {t.hero.ctaJoin}
          </a>
          <a
            href="/campaigns"
            className="rounded-md border border-zinc-700 px-6 py-3 font-semibold hover:border-emerald-500 hover:text-emerald-400"
          >
            {t.hero.ctaBrowse}
          </a>
          <a
            href="/how-it-works"
            className="rounded-md border border-zinc-700 px-6 py-3 font-semibold hover:border-emerald-500 hover:text-emerald-400"
          >
            See what it does
          </a>
        </div>
      </section>

      {/* Live impact dashboard — hides itself if no data yet */}
      <ImpactStats />

      {/* Pillars */}
      <section className="mt-24 grid gap-6 sm:grid-cols-3">
        <Pillar
          title="One-click action"
          body="Your info autofills. Click once, send personalized emails to every legislator that matters. Hours of work in two minutes."
        />
        <Pillar
          title="Real-time intelligence"
          body="Bill tracking, contact info, and news scraped daily. State-by-state. Never out of date."
        />
        <Pillar
          title="Built for the community"
          body="Nonpartisan. Independent. Not owned by any org. A tool for anyone who wants kratom to stay legal."
        />
      </section>

      {/* What iKratom is — full capability rundown.
          Pulled from docs/VISION.md framing. Mission control / war
          fighting machine vibe per docs/VALUES.md. */}
      <section className="mt-24">
        <div className="mb-8 text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
            What iKratom is
          </p>
          <h2 className="mt-2 text-3xl font-bold sm:text-4xl">
            The war room for kratom advocacy.
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-zinc-400">
            Most &ldquo;civic engagement&rdquo; tools are glorified email forms. iKratom
            is a coordinated action engine — bill tracking, AI-driven analysis,
            real-time alerts, encrypted comms, and a printable shop kit, all in
            one cockpit. While other tools send postcards, we run air traffic
            control.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Capability
            icon="📜"
            title="Real-time bill tracking"
            body="All 50 states + federal Congress. Deep-PDF analysis classifies every bill as friendly or hostile to natural-leaf kratom — local AI reads the actual statute text, not just the title."
          />
          <Capability
            icon="📨"
            title="One-click legislator email"
            body="Find your reps from your address. Personalized message prefilled. Send via your own Gmail — the email arrives genuinely from you, not from a service."
          />
          <Capability
            icon="🚨"
            title="Auto-generated campaigns"
            body="The moment a hostile bill drops, every matched advocate gets a push notification, an in-app alert, and email. Within seconds. No human bottleneck."
          />
          <Capability
            icon="💬"
            title="Live community Lounge"
            body="Realtime chat, presence (X online now), state-specific forums, recent activity ticker. Anti-spam + flood detection + URL gating + mute history with ban-review queue."
          />
          <Capability
            icon="🔒"
            title="End-to-end encrypted DMs"
            body="libsodium-encrypted direct messages. Even iKratom can't read them. For private war-room coordination."
          />
          <Capability
            icon="🌏"
            title="Multi-language"
            body="Indonesian, Thai, Malay, Vietnamese, Filipino, Spanish. For SE Asian farmers and distributors at the source of supply."
          />
          <Capability
            icon="🔔"
            title="Web push + alerts"
            body="VAPID-keyed browser/phone notifications. Saved searches let you define custom alert rules — get notified when a new bill matches your criteria."
          />
          <Capability
            icon="🛍️"
            title="Printable shop kit"
            body="Register a partner shop, print a 4-piece counter set (poster + card + window cling + sticker strip) with QR codes that credit signups back to that shop."
          />
          <Capability
            icon="🤖"
            title="Multi-AI orchestration"
            body="Local Ollama for privacy work, Gemini for grounded research, Groq for speed, Claude for novel work. The router picks the right model for each task — at $0/month."
          />
          <Capability
            icon="🎯"
            title="Discord integration"
            body="Existing kratom communities paste a webhook URL once and bill alerts auto-post to their channel. Sign-in-with-Discord for one-click signup."
          />
          <Capability
            icon="🪪"
            title="Verified vendors"
            body="Businesses can co-advocate with dual-signature emails (send as you OR as your shop) — legally distinct, clearly labeled."
          />
          <Capability
            icon="🛡️"
            title="Hard security"
            body="MFA + breach detection + per-IP rate limiting + audit logs on every privileged action. Trusted-device cookies skip routine MFA, never sensitive ops."
          />
        </div>

        <div className="mt-10 rounded-lg border border-emerald-700/40 bg-emerald-950/10 p-6 text-center">
          <p className="text-base font-semibold text-zinc-100">
            Free. Nonpartisan. No spam. No org affiliation.
          </p>
          <p className="mt-1 text-sm text-zinc-400">
            Built so individual people can wield democratic power without surrendering to a faction. Open architecture, everything documented, AI-assisted from day one.
          </p>
          <a
            href="/signup"
            className="mt-4 inline-block rounded-md bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-emerald-400"
          >
            Get in the cockpit →
          </a>
        </div>
      </section>

      {/* Map */}
      <section className="mt-24">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
              Where it stands
            </p>
            <h2 className="mt-1 text-2xl font-bold sm:text-3xl">
              The state of kratom legality
            </h2>
          </div>
          <a
            href="/forum"
            className="text-sm text-emerald-400 hover:underline"
          >
            Forums by state →
          </a>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 sm:p-6">
          <USMap statusByAbbr={statusByAbbr} />
        </div>
      </section>

      {/* Manifesto strip */}
      <section className="mt-24 rounded-lg border border-zinc-800 bg-zinc-950/60 p-8 sm:p-12">
        <h2 className="text-2xl font-bold sm:text-3xl">
          We&apos;re not yelling in the wind anymore.
        </h2>
        <p className="mt-4 text-zinc-400">
          The kratom advocacy community stalled out when the social platforms broke up
          our momentum. iKratom is a war room — built outside Facebook, outside Discord,
          outside any single org. A weapon for everyone who wants to put it on.
        </p>
      </section>
    </div>
  );
}

function Pillar({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-6">
      <h3 className="text-lg font-semibold text-emerald-400">{title}</h3>
      <p className="mt-2 text-sm text-zinc-400">{body}</p>
    </div>
  );
}

function Capability({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 transition hover:border-emerald-700/50">
      <div className="mb-2 flex items-center gap-2">
        <span aria-hidden className="text-xl">
          {icon}
        </span>
        <h3 className="text-sm font-bold text-zinc-100">{title}</h3>
      </div>
      <p className="text-xs leading-relaxed text-zinc-400">{body}</p>
    </div>
  );
}
