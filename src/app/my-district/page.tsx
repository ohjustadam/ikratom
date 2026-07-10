import Link from "next/link";
import { getProfile } from "@/modules/auth/actions";
import { createClient } from "@/lib/supabase/server";
import { SignUpNudge } from "@/components/SignUpNudge";
import { StatusHeader, type StateStatusData } from "@/app/states/[code]/StatusHeader";
import { resolveBillHrefs } from "@/modules/state-status/evidence";
import { STATE_NAMES } from "@/lib/state-names";
import { normalizeLocality } from "@/lib/locality";
import { rankActions, type RankableBill, type RankableCampaign } from "@/modules/district/rank";
import { EmailOfficialButton } from "@/modules/compose/EmailOfficialButton";
import { httpUrlOrNull } from "@/modules/compose/send-links";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "My District — your reps + your top action · iKratom",
  description: "Your state's kratom + 7-OH status, the single highest-priority action in your area, and your local representatives — in one place.",
};

const LOCAL_ROLES = ["mayor", "city_council", "county_executive", "county_commissioner"];

/**
 * /my-district — the answer-first personal action hub. For a signed-in user
 * with civic info: their state's canonical status, the SINGLE highest-priority
 * action (ranked, see modules/district/rank.ts), and their local layer (reps +
 * upcoming meetings). Take-action links out to /campaigns/[slug] (which owns
 * target resolution + cooldown gates). Degrades gracefully: anon → signup
 * nudge; no state → complete-profile prompt; missing data → calm empty states.
 */
export default async function MyDistrictPage() {
  const { profile } = await getProfile();

  if (!profile) {
    return (
      <Shell>
        <p className="mt-2 text-sm text-zinc-400">
          Sign in to see your state&apos;s status, your representatives, and the single
          highest-priority action in your area.
        </p>
        <div className="mt-6">
          <SignUpNudge context="default" />
        </div>
      </Shell>
    );
  }

  const state = profile.state ?? null;
  if (!state) {
    return (
      <Shell>
        <div className="mt-6 rounded-lg border border-amber-700/50 bg-amber-950/20 p-5 text-sm text-amber-100">
          <p>
            Add your state + address so we can match you to your representatives and the
            bills in your district. Your address is used only for matching — never shared.
          </p>
          <Link
            href="/account"
            className="mt-3 inline-block rounded bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-500"
          >
            Complete your profile →
          </Link>
        </div>
      </Shell>
    );
  }

  const stateName = STATE_NAMES[state] ?? state;
  const userLocality = normalizeLocality(profile.city ?? null, state); // "City, ST" | null
  const supabase = await createClient();
  const now = Date.now();
  const horizon = new Date(now + 90 * 86_400_000).toISOString();

  // Parallel reads. state_status uses maybeSingle so a missing table (0173
  // not yet applied) returns null and the header just doesn't render.
  const [statusRes, campaignsRes, meetingsRes, repsRes] = await Promise.all([
    supabase
      .from("state_status")
      .select("derived_leaf_status, derived_7oh_status, basis, admin_leaf_status, admin_7oh_status, admin_note, confirmed_at, leaf_evidence_bill, sevenoh_evidence_bill")
      .eq("state", state)
      .maybeSingle(),
    supabase
      .from("campaigns")
      .select("id, slug, title, blurb, state, bill_id, target_locality, created_at")
      .or(`state.eq.${state},state.is.null`)
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("municipal_meetings")
      .select("id, locality, body_name, meeting_at, agenda_url")
      .eq("state", state)
      .eq("moderation_status", "approved")
      .gte("meeting_at", new Date(now).toISOString())
      .lte("meeting_at", horizon)
      .order("meeting_at", { ascending: true })
      .limit(5),
    userLocality
      ? supabase
          .from("legislators")
          .select("id, full_name, role, title, email, phone, website")
          .eq("state", state)
          .eq("locality", userLocality)
          .in("role", LOCAL_ROLES)
          .eq("active", true)
          .limit(20)
      : Promise.resolve({ data: [] as LocalRep[] }),
  ]);

  const stateStatus = (statusRes.data as StateStatusData | null) ?? null;
  const statusBillHrefs = stateStatus
    ? await resolveBillHrefs(state, [stateStatus.leaf_evidence_bill, stateStatus.sevenoh_evidence_bill])
    : {};
  const campaigns = (campaignsRes.data as RankableCampaign[] | null) ?? [];
  const meetings = (meetingsRes.data as Meeting[] | null) ?? [];
  const localReps = (repsRes.data as LocalRep[] | null) ?? [];

  // Pull linked bills for the campaign pool, then rank.
  const billIds = Array.from(new Set(campaigns.map((c) => c.bill_id).filter(Boolean))) as string[];
  const billsById = new Map<string, RankableBill>();
  if (billIds.length > 0) {
    const { data: bills } = await supabase
      .from("bills")
      .select("id, status, kratom_relevance, last_action_at, scope")
      .in("id", billIds);
    for (const b of (bills as RankableBill[] | null) ?? []) billsById.set(b.id, b);
  }
  const ranked = rankActions(campaigns, billsById, { userState: state, userLocality, now });
  const top = ranked[0] ?? null;
  const more = ranked.slice(1, 4);

  const districtBits = [
    profile.congressional_district ? `CD-${profile.congressional_district}` : null,
    profile.state_senate_district ? `SD-${profile.state_senate_district}` : null,
    profile.state_house_district ? `HD-${profile.state_house_district}` : null,
  ].filter(Boolean);

  return (
    <Shell subtitle={`${stateName}${userLocality ? ` · ${userLocality}` : ""}`}>
      {districtBits.length > 0 && (
        <p className="mt-1 text-xs text-zinc-500">Your districts: {districtBits.join(" · ")}</p>
      )}

      <div className="mt-4">
        <StatusHeader status={stateStatus} billHrefs={statusBillHrefs} />
      </div>

      {/* Your top action */}
      <section className="mt-8">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-emerald-400">Your top action</h2>
        {top ? (
          <div className="mt-2 rounded-lg border border-emerald-700/40 bg-emerald-950/15 p-5">
            <h3 className="text-lg font-bold text-zinc-100">{top.title}</h3>
            {top.blurb && <p className="mt-1 text-sm text-zinc-400">{top.blurb}</p>}
            {top.reasons.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {top.reasons.map((r) => (
                  <span key={r} className="rounded-full border border-zinc-700 bg-zinc-900/60 px-2 py-0.5 text-[11px] text-zinc-300">
                    {r}
                  </span>
                ))}
              </div>
            )}
            <Link
              href={top.slug ? `/campaigns/${top.slug}` : "/campaigns"}
              className="mt-4 inline-block rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-500"
            >
              Take action →
            </Link>
          </div>
        ) : (
          <p className="mt-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5 text-sm text-zinc-400">
            No active campaigns in your area right now — you&apos;re clear. We&apos;ll push you the
            moment something needs action.{" "}
            <Link href="/account#notifications" className="text-emerald-400 hover:underline">Check your alert settings →</Link>
          </p>
        )}

        {more.length > 0 && (
          <div className="mt-4">
            <p className="text-[11px] uppercase tracking-wider text-zinc-500">More active actions</p>
            <ul className="mt-2 space-y-1.5">
              {more.map((c) => (
                <li key={c.id}>
                  <Link
                    href={c.slug ? `/campaigns/${c.slug}` : "/campaigns"}
                    className="flex items-center justify-between gap-3 rounded border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm text-zinc-200 hover:border-emerald-700/50"
                  >
                    <span className="truncate">{c.title}</span>
                    <span className="shrink-0 text-xs text-zinc-500">{c.reasons[0] ?? "Take action"} →</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* In your district — local layer */}
      <section className="mt-8">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-emerald-400">In your district</h2>

        <div className="mt-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
          <h3 className="text-sm font-semibold text-zinc-100">Your local officials</h3>
          {localReps.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {localReps.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="font-medium text-zinc-100">{r.full_name}</span>
                  <span className="text-xs text-zinc-500">{r.title || r.role}</span>
                  <span className="flex gap-2 text-xs">
                    <EmailOfficialButton
                      official={{ id: r.id, name: r.full_name, role: r.role, title: r.title, state, email: r.email, website: r.website }}
                      source="my_district"
                      variant="inline"
                      label={r.email ? "email" : "contact"}
                    />
                    {r.phone && <a href={`tel:${r.phone}`} className="text-emerald-400 hover:underline">call</a>}
                    {httpUrlOrNull(r.website) && <a href={httpUrlOrNull(r.website)!} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">site</a>}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-zinc-400">
              {userLocality
                ? <>We don&apos;t have your city/county officials yet. <Link href={`/states/${state}`} className="text-emerald-400 hover:underline">Request coverage on your state page →</Link></>
                : <>Add your address to match local officials. <Link href="/account" className="text-emerald-400 hover:underline">Complete your profile →</Link></>}
            </p>
          )}
        </div>

        <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
          <h3 className="text-sm font-semibold text-zinc-100">Upcoming meetings in {stateName}</h3>
          {meetings.length > 0 ? (
            <ul className="mt-3 space-y-2 text-sm">
              {meetings.map((m) => (
                <li key={m.id} className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-zinc-200">{m.body_name}{m.locality ? ` · ${m.locality}` : ""}</span>
                  <span className="text-xs text-zinc-500">
                    {new Date(m.meeting_at).toLocaleDateString()}
                    {m.agenda_url && <> · <a href={m.agenda_url} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">agenda</a></>}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-zinc-400">No public meetings on the calendar in the next 90 days.</p>
          )}
        </div>
      </section>

      <div className="mt-8 text-sm">
        <Link href={`/states/${state}`} className="text-emerald-400 hover:underline">
          Full {stateName} picture — every bill, alert, and campaign →
        </Link>
      </div>
    </Shell>
  );
}

type LocalRep = {
  id: string;
  full_name: string;
  role: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
};
type Meeting = {
  id: string;
  locality: string | null;
  body_name: string | null;
  meeting_at: string;
  agenda_url: string | null;
};

function Shell({ children, subtitle }: { children: React.ReactNode; subtitle?: string }) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 lg:px-8 text-zinc-100">
      <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">🗳 My district</p>
      <h1 className="mt-2 text-3xl font-bold sm:text-4xl">Your district</h1>
      {subtitle && <p className="mt-1 text-sm text-zinc-400">{subtitle}</p>}
      {children}
    </div>
  );
}
