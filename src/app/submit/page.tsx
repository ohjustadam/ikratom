import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Submit something",
  description:
    "Submit a story, send an intel tip, start a campaign — central hub for adding content to iKratom.",
};
export const dynamic = "force-dynamic";

/**
 * /submit — one-stop "create new X" directory.
 *
 * Auto-filters by the signed-in user's role so people only see what
 * they can actually do. Surfaces every form/intake on the platform
 * with a one-line "what you'd use this for" + the direct link.
 *
 * Designed per ROADMAP.md (2026-05-12) — was a hidden surface
 * before; users had to know each form's URL by heart.
 */
export default async function SubmitHubPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/submit");

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin, is_owner, is_advocate_leader, state")
    .eq("id", user.id)
    .single();

  const isAdmin = !!(profile?.is_admin || profile?.is_owner);
  const isLeader = !!profile?.is_advocate_leader || isAdmin;
  const userState = profile?.state ?? null;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          Submit hub
        </p>
        <h1 className="mt-2 text-3xl font-bold">What do you want to add?</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Every place you can submit content to iKratom, in one list. Filtered to
          what your role can do.
        </p>
      </header>

      {/* ── For everyone ────────────────────────────────────────── */}
      <Section title="Open to all advocates">
        <SubmitCard
          href="/alerts/submit"
          emoji="🚨"
          title="Submit an intel tip"
          body="See a hostile rule proposal, BoP agenda item, or news that should be on /pulse? Send it — admin reviews + publishes."
        />
        <SubmitCard
          href="/stories/new"
          emoji="📖"
          title="Share your kratom story"
          body="Your authentic voice helps shape advocacy. Stories appear on /stories after admin review."
        />
        {userState ? (
          <SubmitCard
            href={`/forum/${userState}/new`}
            emoji="💬"
            title={`Start a ${userState} forum thread`}
            body="Bring up a question, share state-specific intel, or organize. Visible to everyone signed in."
          />
        ) : (
          <SubmitCard
            href="/forum"
            emoji="💬"
            title="Start a forum thread"
            body="Pick your state forum first. Set your address in /account if you want it auto-routed."
          />
        )}
        <SubmitCard
          href="/account/saved-searches"
          emoji="🔔"
          title="Create a saved search"
          body="Custom alert rules — get notified when a new bill matches your criteria."
        />
        <SubmitCard
          href="/account/email-presets"
          emoji="✉"
          title="Save an email tone preset"
          body="Up to 5 reusable templates you can pick from when sending campaign actions."
        />
        <SubmitCard
          href="/account/vendor"
          emoji="🏪"
          title="Apply to be a verified vendor"
          body="Shop owners — get verified to send advocacy emails as your shop in addition to as yourself."
        />
      </Section>

      {/* ── Leader-only ─────────────────────────────────────────── */}
      {isLeader && (
        <Section title="Advocate leaders" tone="accent">
          <SubmitCard
            href="/leader/field-signup"
            emoji="📍"
            title="Onboard a recruit (field signup)"
            body="In-person signup flow for your phone. Collect email + first name + zip; magic-link email lets them finish their profile."
            accent
          />
          <SubmitCard
            href="/admin/campaigns/new"
            emoji="📣"
            title="Author a campaign"
            body="Create a call-to-action campaign. Admin reviews before activation."
          />
          <SubmitCard
            href="/admin/locals/new"
            emoji="🏛"
            title="Add local officials"
            body="City or county officials your area's bills should target."
          />
          <SubmitCard
            href="/admin/library/new"
            emoji="📚"
            title="Add a library item"
            body="Research, white papers, talking points, videos."
          />
        </Section>
      )}

      {/* ── Admin-only ──────────────────────────────────────────── */}
      {isAdmin && (
        <Section title="Admins + owner" tone="admin">
          <SubmitCard
            href="/admin/bills/new"
            emoji="📜"
            title="Add a bill (manual)"
            body="For municipal / county bills OpenStates doesn't track."
          />
          <SubmitCard
            href="/admin/events/new"
            emoji="🎤"
            title="Add a town hall or hearing"
            body="Public events where advocates should show up."
          />
          <SubmitCard
            href="/admin/partners/new"
            emoji="🤝"
            title="Add a partner shop"
            body="Partner shop with print kit (QR poster + card + window cling + stickers)."
          />
          <SubmitCard
            href="/admin/discord-integrations/new"
            emoji="🤖"
            title="Add a Discord integration"
            body="Connect a partner server's webhook for bill alerts + campaign launches."
          />
          <SubmitCard
            href="/admin/announcements"
            emoji="📢"
            title="Post an announcement"
            body="Shows in every user's 'What's new' widget until they dismiss or it expires."
          />
          <SubmitCard
            href="/admin/emergency"
            emoji="🚨"
            title="Engage emergency mode"
            body="Site-wide red banner. FDA action, hostile federal bills, scheduling rumors."
          />
        </Section>
      )}

      <footer className="mt-10 rounded-md border border-zinc-800 bg-zinc-950/40 p-4 text-xs text-zinc-500">
        <p className="font-semibold text-zinc-200">Don&apos;t see what you&apos;re looking for?</p>
        <p className="mt-1">
          Most things admins handle (legislators, news, bills) sync automatically. If you have
          a tip about something we should know, the <a href="/alerts/submit" className="text-emerald-400 hover:underline">intel-tip flow</a> is the right path.
        </p>
      </footer>
    </div>
  );
}

function Section({
  title,
  tone = "neutral",
  children,
}: {
  title: string;
  tone?: "neutral" | "accent" | "admin";
  children: React.ReactNode;
}) {
  const accent =
    tone === "accent" ? "text-emerald-400" :
    tone === "admin" ? "text-amber-400" :
    "text-zinc-400";
  return (
    <section className="mb-8">
      <h2 className={`mb-3 text-xs font-semibold uppercase tracking-wider ${accent}`}>
        {title}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </section>
  );
}

function SubmitCard({
  href,
  emoji,
  title,
  body,
  accent,
}: {
  href: string;
  emoji: string;
  title: string;
  body: string;
  accent?: boolean;
}) {
  const cls = accent
    ? "border-emerald-700/50 bg-emerald-950/20 hover:border-emerald-500"
    : "border-zinc-800 bg-zinc-950/40 hover:border-emerald-500";
  return (
    <a
      href={href}
      className={`block rounded-lg border p-4 transition ${cls}`}
    >
      <h3 className="text-sm font-semibold text-zinc-100">
        <span aria-hidden className="mr-1.5">{emoji}</span>
        {title}
      </h3>
      <p className="mt-1 text-xs text-zinc-400">{body}</p>
    </a>
  );
}
