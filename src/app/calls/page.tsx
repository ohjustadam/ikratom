import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getUserLegislators } from "@/lib/legislators";
import { listMyCalls, listMyAchievements } from "@/modules/calls/actions";

export const metadata = { title: "Call your reps — track + earn" };
export const dynamic = "force-dynamic";

const BADGE_META: Record<string, { emoji: string; title: string; desc: string }> = {
  first_call: { emoji: "🎉", title: "First call", desc: "You made your first tracked call. The hardest one is done." },
  capital_seven: { emoji: "🏛️", title: "Capital Seven", desc: "Reached 7 distinct legislators." },
  coast_to_coast: { emoji: "🗺️", title: "Coast to Coast", desc: "Calls placed in 5+ states." },
  century_club: { emoji: "💯", title: "Century Club", desc: "100 tracked calls." },
};

/**
 * /calls — the call hub.
 *
 * Signed-in users see:
 *   - Their priority targets (their own reps, plus champions/hostiles for
 *     any active campaign they care about)
 *   - Their badges + active goals
 *   - Recent call history
 *
 * The tactile feature: tapping any rep launches the device dialer with
 * full call-tracking UI (see modules/calls/CallTracker.tsx).
 */
export default async function CallsPage() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <header className="text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
            Calls — the highest-leverage move
          </p>
          <h1 className="mt-2 text-3xl font-bold">Pick a number. Make a call. Track it.</h1>
          <p className="mt-3 text-sm text-zinc-400">
            Legislators count phone calls 100x more than emails. iKratom turns
            every call into a tracked action with optional on-device transcript
            + AI summary — fully free, no audio ever leaves your phone.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Link
              href="/signup"
              className="rounded-md bg-emerald-500 px-5 py-2.5 font-semibold text-zinc-950 hover:bg-emerald-400"
            >
              Sign up to start →
            </Link>
            <Link
              href="/login"
              className="rounded-md border border-zinc-700 px-5 py-2.5 hover:border-emerald-500"
            >
              Sign in
            </Link>
          </div>
        </header>
      </div>
    );
  }

  // Profile / state
  const { data: profile } = await sb
    .from("profiles")
    .select("state, state_senate_district, state_house_district, congressional_district, full_name")
    .eq("id", user.id)
    .single();

  // Their own reps (top 4 = state senate, state house, US senate × 2 in their state)
  const myReps = profile
    ? await getUserLegislators(sb, {
        state: profile.state ?? null,
        congressional_district: profile.congressional_district ?? null,
        state_senate_district: profile.state_senate_district ?? null,
        state_house_district: profile.state_house_district ?? null,
      })
    : [];

  // Champions + hostiles in their state (highest-leverage strangers).
  // Supabase types the joined `legislators` as an array even when !inner
  // returns a single row — coerce explicitly.
  let leverageTargets: Array<{ id: string; full_name: string; role: string; district: string | null; phone: string | null; party: string | null; stance: string }> = [];
  if (profile?.state) {
    const { data: stances } = await sb
      .from("legislator_kratom_stance")
      .select("stance, legislators!inner(id, full_name, role, district, phone, party, state)")
      .eq("legislators.state", profile.state)
      .in("stance", ["champion", "hostile"])
      .limit(10);
    type StanceRow = { stance: string; legislators: { id: string; full_name: string; role: string; district: string | null; phone: string | null; party: string | null; state: string | null } };
    leverageTargets = ((stances ?? []) as unknown as StanceRow[]).map((s) => ({
      id: s.legislators.id,
      full_name: s.legislators.full_name,
      role: s.legislators.role,
      district: s.legislators.district,
      phone: s.legislators.phone,
      party: s.legislators.party,
      stance: s.stance,
    })).filter((t) => t.phone);
  }

  const myCalls = await listMyCalls(20);
  const myAchievements = await listMyAchievements();

  const totalCalls = myCalls.filter((c) => c.ended_at).length;
  const reachedCalls = myCalls.filter((c) => c.outcome === "reached").length;
  const distinctRecipients = new Set(myCalls.map((c) => c.recipient_name).filter(Boolean)).size;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          Calls — direct line to power
        </p>
        <h1 className="mt-2 text-3xl font-bold">Your call dashboard</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Phone calls move legislators more than any other channel. Pick a target
          below — the app launches your dialer, optionally transcribes the call
          on-device (free), summarizes after, and feeds intel back to the platform.
        </p>
      </header>

      {/* Stats */}
      <section className="mb-6 grid grid-cols-3 gap-3">
        <Stat label="Calls tracked" value={totalCalls} />
        <Stat label="Reached" value={reachedCalls} sub={`${totalCalls > 0 ? Math.round((reachedCalls / totalCalls) * 100) : 0}% rate`} />
        <Stat label="Distinct recipients" value={distinctRecipients} />
      </section>

      {/* Badges */}
      {myAchievements.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-emerald-300">🏅 Your badges</h2>
          <div className="flex flex-wrap gap-2">
            {myAchievements.map((a) => {
              const meta = BADGE_META[a.badge_code] ?? { emoji: "✨", title: a.badge_code, desc: "" };
              return (
                <div
                  key={a.badge_code}
                  className="rounded-md border border-emerald-700/40 bg-emerald-950/20 px-3 py-2"
                  title={meta.desc}
                >
                  <span className="text-lg">{meta.emoji}</span>{" "}
                  <span className="text-xs font-semibold text-emerald-200">{meta.title}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Your reps */}
      {myReps.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-zinc-300">📍 Your reps in {profile?.state}</h2>
          <ul className="space-y-2">
            {myReps.filter((r) => r.phone).map((r) => (
              <CallableRow key={r.id} leg={{
                id: r.id, full_name: r.full_name, role: r.role,
                district: r.district, phone: r.phone, party: r.party ?? null,
                state: profile?.state ?? null, stance: null,
              }} />
            ))}
          </ul>
        </section>
      )}

      {/* Champions + hostiles (high leverage) */}
      {leverageTargets.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-zinc-300">
            🎯 Highest-leverage calls in {profile?.state}
          </h2>
          <p className="mb-2 text-xs text-zinc-500">
            <span className="text-emerald-400">Champions</span> need reinforcement;{" "}
            <span className="text-red-400">hostile legislators</span> need to hear from constituents directly.
          </p>
          <ul className="space-y-2">
            {leverageTargets.map((t) => (
              <CallableRow key={t.id} leg={{
                id: t.id, full_name: t.full_name, role: t.role,
                district: t.district, phone: t.phone, party: t.party,
                state: profile?.state ?? null, stance: t.stance,
              }} />
            ))}
          </ul>
        </section>
      )}

      {/* History */}
      {myCalls.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-zinc-300">📜 Recent calls</h2>
          <ul className="space-y-1">
            {myCalls.map((c) => (
              <li key={c.id} className="flex flex-wrap items-baseline gap-2 rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm">
                <span className="font-mono text-[10px] text-zinc-500">{c.started_at.slice(0, 10)}</span>
                <span className="font-semibold text-zinc-100">{c.recipient_name ?? "(unknown)"}</span>
                {c.state && <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] uppercase text-zinc-500">{c.state}</span>}
                <span className="text-xs text-zinc-500">
                  {c.outcome === "reached" ? "✓ reached" :
                   c.outcome === "voicemail" ? "📨 voicemail" :
                   c.outcome === "no_answer" ? "🔇 no answer" :
                   c.outcome === "busy" ? "☎️ busy" :
                   c.outcome === "declined" ? "🚫 declined" : ""}
                </span>
                {c.duration_seconds && <span className="text-[11px] text-zinc-600">{Math.round(c.duration_seconds / 60)}m</span>}
                {c.moderation_status === "approved" && <span className="text-[10px] font-semibold text-emerald-400">PUBLISHED</span>}
                {c.moderation_status === "pending_review" && <span className="text-[10px] font-semibold text-amber-400">PENDING</span>}
              </li>
            ))}
          </ul>
          <Link href="/account/calls" className="mt-2 inline-block text-xs text-emerald-400 hover:underline">
            Full history →
          </Link>
        </section>
      )}

      {/* Empty state */}
      {myCalls.length === 0 && (
        <section className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-6 text-center">
          <p className="text-2xl">📞</p>
          <p className="mt-2 text-sm text-zinc-400">
            No calls tracked yet. Pick a target above to start.
          </p>
        </section>
      )}
    </div>
  );
}

import { CallTracker } from "@/modules/calls/CallTracker";

function CallableRow({ leg }: {
  leg: { id: string; full_name: string; role: string; district: string | null; phone: string | null; party: string | null; state: string | null; stance: string | null };
}) {
  if (!leg.phone) return null;
  return (
    <li className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
      <details>
        <summary className="flex cursor-pointer flex-wrap items-baseline gap-2 text-sm">
          <span className="font-semibold text-zinc-100">{leg.full_name}</span>
          <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] uppercase text-zinc-500">{leg.role}{leg.district ? ` · D${leg.district}` : ""}</span>
          {leg.party && <span className="text-[10px] text-zinc-500">[{leg.party}]</span>}
          {leg.stance === "champion" && <span className="rounded bg-emerald-700 px-1.5 py-0.5 text-[10px] font-bold uppercase text-zinc-950">champion</span>}
          {leg.stance === "hostile" && <span className="rounded bg-red-700 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">hostile</span>}
          <span className="ml-auto font-mono text-xs text-emerald-400">{leg.phone}</span>
        </summary>
        <div className="mt-3 border-t border-zinc-800 pt-3">
          <CallTracker
            legislatorId={leg.id}
            recipientName={leg.full_name}
            recipientPhone={leg.phone}
            recipientRole={leg.role}
            state={leg.state}
          />
        </div>
      </details>
    </li>
  );
}

function Stat({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-zinc-100">{value}</p>
      {sub && <p className="mt-0.5 text-[10px] text-zinc-500">{sub}</p>}
    </div>
  );
}
