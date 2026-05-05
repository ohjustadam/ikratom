import { getProfile } from "@/modules/auth/actions";
import { createClient } from "@/lib/supabase/server";
import { getUserLegislators } from "@/lib/legislators";
import { MyRepCard } from "./MyRepCard";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const { profile, email } = await getProfile();
  const profileComplete = !!(profile?.full_name && profile?.state && profile?.zip);
  const districtsResolved = !!(
    profile?.congressional_district ||
    profile?.state_senate_district ||
    profile?.state_house_district
  );

  let myReps: Awaited<ReturnType<typeof getUserLegislators>> = [];
  if (profile?.state) {
    const supabase = await createClient();
    myReps = await getUserLegislators(supabase, profile);
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
      <header className="mb-10">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          War room
        </p>
        <h1 className="mt-2 text-3xl font-bold">
          Welcome back, {profile?.full_name || email}.
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          Your toolbelt. One click per action.
        </p>
      </header>

      {!profileComplete && (
        <Banner
          tone="amber"
          title="Finish your profile to unlock one-click actions"
          body="We need your name, state, and ZIP to autofill emails to your legislators."
          cta={{ href: "/account", label: "Complete profile →" }}
        />
      )}

      {profileComplete && !districtsResolved && (
        <Banner
          tone="amber"
          title="We couldn't auto-detect your districts"
          body="Add your full street address so we can match you to your specific U.S. House and state legislative districts."
          cta={{ href: "/account", label: "Update address →" }}
        />
      )}

      {/* Your reps */}
      {myReps.length > 0 && (
        <section className="mb-10">
          <div className="mb-3 flex items-end justify-between">
            <h2 className="text-lg font-semibold">Your representatives</h2>
            <a
              href="/legislators"
              className="text-xs text-emerald-400 hover:underline"
            >
              See all in {profile?.state} →
            </a>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {myReps.map((l) => (
              <MyRepCard key={l.id} legislator={l} />
            ))}
          </ul>
        </section>
      )}

      {/* Action cards */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card
          href="/campaigns"
          title="Active campaigns"
          body="Take action on bills moving right now."
          accent
        />
        <Card
          href="/legislators"
          title="All legislators"
          body={
            profile?.state
              ? `Search every official in ${profile.state}.`
              : "Search every state legislature."
          }
        />
        <Card href="/bills" title="Bill tracker" body="Every kratom & 7-OH bill, all 50 states." />
        <Card href="/forum" title="State forums" body="Talk strategy with advocates in your state." />
        <Card href="/news" title="Kratom news" body="Daily AI-curated updates per state." />
        <Card href="/library" title="Library" body="Videos, books, transcripts." />
        <Card href="/messages" title="Messages" body="🔒 End-to-end encrypted DMs + groups." />
        <Card href="/account" title="Account" body="Update civic info & notifications." />
      </section>
    </div>
  );
}

function Banner({
  tone,
  title,
  body,
  cta,
}: {
  tone: "amber" | "emerald";
  title: string;
  body: string;
  cta: { href: string; label: string };
}) {
  const bg = tone === "amber" ? "border-amber-900/40 bg-amber-950/20" : "border-emerald-900/40 bg-emerald-950/20";
  const titleCol = tone === "amber" ? "text-amber-300" : "text-emerald-300";
  const btnBg = tone === "amber" ? "bg-amber-500" : "bg-emerald-500";
  const btnHover = tone === "amber" ? "hover:bg-amber-400" : "hover:bg-emerald-400";
  return (
    <div className={`mb-8 rounded-lg border p-5 ${bg}`}>
      <h2 className={`text-sm font-semibold ${titleCol}`}>{title}</h2>
      <p className="mt-1 text-sm text-zinc-400">{body}</p>
      <a
        href={cta.href}
        className={`mt-3 inline-block rounded-md px-4 py-2 text-sm font-semibold text-zinc-950 ${btnBg} ${btnHover}`}
      >
        {cta.label}
      </a>
    </div>
  );
}

function Card({
  href, title, body, accent, disabled,
}: {
  href: string;
  title: string;
  body: string;
  accent?: boolean;
  disabled?: boolean;
}) {
  const base = "block rounded-lg border p-5 transition";
  const cls = disabled
    ? "border-zinc-900 bg-zinc-950/40 opacity-50 cursor-not-allowed"
    : accent
    ? "border-emerald-700/50 bg-emerald-950/20 hover:border-emerald-500"
    : "border-zinc-800 bg-zinc-950/40 hover:border-emerald-700/50";
  const content = (
    <>
      <h3 className={`text-base font-semibold ${accent ? "text-emerald-300" : "text-zinc-100"}`}>
        {title}
      </h3>
      <p className="mt-1 text-sm text-zinc-400">{body}</p>
    </>
  );
  if (disabled) return <div className={`${base} ${cls}`}>{content}</div>;
  return <a href={href} className={`${base} ${cls}`}>{content}</a>;
}
