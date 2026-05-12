import { notFound } from "next/navigation";
import Link from "next/link";
import { marked } from "marked";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "State briefing" };
export const dynamic = "force-dynamic";

const STATE_NAMES: Record<string, string> = {
  AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",
  CO:"Colorado",CT:"Connecticut",DE:"Delaware",DC:"District of Columbia",
  FL:"Florida",GA:"Georgia",HI:"Hawaii",ID:"Idaho",IL:"Illinois",IN:"Indiana",
  IA:"Iowa",KS:"Kansas",KY:"Kentucky",LA:"Louisiana",ME:"Maine",MD:"Maryland",
  MA:"Massachusetts",MI:"Michigan",MN:"Minnesota",MS:"Mississippi",MO:"Missouri",
  MT:"Montana",NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",NJ:"New Jersey",
  NM:"New Mexico",NY:"New York",NC:"North Carolina",ND:"North Dakota",
  OH:"Ohio",OK:"Oklahoma",OR:"Oregon",PA:"Pennsylvania",RI:"Rhode Island",
  SC:"South Carolina",SD:"South Dakota",TN:"Tennessee",TX:"Texas",UT:"Utah",
  VT:"Vermont",VA:"Virginia",WA:"Washington",WV:"West Virginia",WI:"Wisconsin",
  WY:"Wyoming",
};

/**
 * /briefings/state/[code] — per-state advocacy briefing.
 *
 * Server-rendered. Reads the active row from state_briefings (one row
 * per state at a time, see migration 0109). Renders the AI-generated
 * markdown to HTML using marked. Falls back gracefully if no briefing
 * exists yet — shows a "first generation queued" notice.
 *
 * Briefings regenerate via the daily cron job that calls
 * scripts/generate-state-briefing.mjs --all-states. Admin can manually
 * regenerate via the /admin/intel-health page (TODO link).
 */
export default async function StateBriefingPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code: rawCode } = await params;
  const code = rawCode.toUpperCase();
  const stateName = STATE_NAMES[code];
  if (!stateName) notFound();

  const supabase = await createClient();

  const { data: briefing } = await supabase
    .from("state_briefings")
    .select("body_md, manual_addendum_md, generated_at, generated_by_provider, data_snapshot")
    .eq("state", code)
    .eq("is_active", true)
    .maybeSingle();

  // If user is signed in + their state matches, pull their reps for the
  // "Your reps" footer — concrete contact info next to the analytical briefing.
  const { data: { user } } = await supabase.auth.getUser();
  let myReps: Array<{ full_name: string; role: string; district: string | null; email: string | null; phone: string | null }> = [];
  let viewerState: string | null = null;
  if (user) {
    const { data: prof } = await supabase
      .from("profiles")
      .select("state, state_senate_district, state_house_district, congressional_district")
      .eq("id", user.id)
      .single();
    viewerState = prof?.state ?? null;
    if (viewerState === code) {
      const { data } = await supabase
        .from("legislators")
        .select("full_name, role, district, email, phone")
        .eq("state", code)
        .eq("active", true)
        .in("role", ["state_senate", "state_house", "us_senate", "us_house"])
        .or(
          [
            `district.eq.${prof?.state_senate_district ?? ""}`,
            `district.eq.${prof?.state_house_district ?? ""}`,
            `district.eq.${prof?.congressional_district ?? ""}`,
          ].join(","),
        )
        .limit(10);
      myReps = data ?? [];
    }
  }

  const generatedAt = briefing?.generated_at ? new Date(briefing.generated_at) : null;
  const ageHrs = generatedAt ? Math.round((Date.now() - generatedAt.getTime()) / 3_600_000) : null;

  let bodyHtml = "";
  if (briefing?.body_md) {
    const combined = briefing.manual_addendum_md
      ? `${briefing.manual_addendum_md}\n\n---\n\n${briefing.body_md}`
      : briefing.body_md;
    bodyHtml = await marked.parse(combined, { gfm: true, breaks: false });
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <nav className="mb-2 text-xs text-zinc-500">
        <Link href="/briefings" className="hover:text-emerald-400">← All briefings</Link>
        {" · "}
        <Link href="/briefings/state" className="hover:text-emerald-400">All state briefings</Link>
      </nav>

      <header className="mb-6 border-b border-zinc-800 pb-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          Field-work briefing
        </p>
        <h1 className="mt-2 text-3xl font-bold sm:text-4xl">
          {stateName} <span className="text-zinc-500">({code})</span>
        </h1>
        {generatedAt && (
          <p className="mt-2 font-mono text-xs text-zinc-500">
            Updated {ageHrs != null && ageHrs < 48 ? `${ageHrs}h ago` : generatedAt.toISOString().slice(0, 10)}
            {" · "}
            {briefing?.generated_by_provider ?? "?"}
            {briefing?.data_snapshot && typeof briefing.data_snapshot === "object" && "billCount" in briefing.data_snapshot && (
              <> · based on {(briefing.data_snapshot as { billCount: number }).billCount} bills · {(briefing.data_snapshot as { legCount: number }).legCount} legislators</>
            )}
          </p>
        )}
      </header>

      {!briefing ? (
        <div className="rounded-md border border-amber-700/40 bg-amber-950/15 p-6 text-sm text-amber-200">
          <p className="font-semibold">No briefing generated yet for {stateName}.</p>
          <p className="mt-2 text-amber-300/80">
            The daily generator runs nightly. Admin: trigger manually with{" "}
            <code className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-xs">
              node --env-file=.env.local scripts/generate-state-briefing.mjs --state {code}
            </code>
          </p>
        </div>
      ) : (
        <article
          className="briefing-md"
          dangerouslySetInnerHTML={{ __html: bodyHtml }}
        />
      )}

      {/* Your reps — concrete contact info if viewer is signed in + state matches */}
      {viewerState === code && myReps.length > 0 && (
        <section className="mt-10 rounded-lg border border-emerald-700/30 bg-emerald-950/10 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-emerald-300">
            📞 Your reps in {stateName}
          </h2>
          <ul className="mt-3 space-y-2 text-sm">
            {myReps.map((r, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-2">
                <span className="font-semibold text-zinc-100">{r.full_name}</span>
                <span className="rounded bg-zinc-900 px-2 py-0.5 text-[10px] font-mono uppercase text-zinc-400">
                  {r.role}{r.district ? ` · district ${r.district}` : ""}
                </span>
                {r.email && (
                  <a href={`mailto:${r.email}`} className="text-xs text-emerald-400 hover:underline">
                    {r.email}
                  </a>
                )}
                {r.phone && (
                  <a href={`tel:${r.phone}`} className="text-xs text-zinc-400 hover:underline">
                    {r.phone}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Cross-links to surfaces filtered for this state */}
      <section className="mt-8 flex flex-wrap gap-2 text-xs">
        <Link
          href={`/campaigns?state=${code}`}
          className="rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-1.5 hover:border-emerald-500"
        >
          📨 {stateName} campaigns
        </Link>
        <Link
          href={`/bills?state=${code}`}
          className="rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-1.5 hover:border-emerald-500"
        >
          📜 {stateName} bills
        </Link>
        <Link
          href={`/legislators?state=${code}`}
          className="rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-1.5 hover:border-emerald-500"
        >
          🏛️ {stateName} legislators
        </Link>
        <Link
          href={`/forum/${code}`}
          className="rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-1.5 hover:border-emerald-500"
        >
          💬 {stateName} forum
        </Link>
        <Link
          href={`/bop-watch?state=${code}`}
          className="rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-1.5 hover:border-emerald-500"
        >
          🛡️ {stateName} BoP watch
        </Link>
      </section>
    </div>
  );
}
