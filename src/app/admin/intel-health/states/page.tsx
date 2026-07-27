import { redirect } from "next/navigation";
import Link from "next/link";
import { getAdminContext } from "@/modules/admin/actions";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Per-state Intel Health" };
export const dynamic = "force-dynamic";

/**
 * /admin/intel-health/states — per-state grid showing intel coverage.
 *
 * For each of the 50 states + DC, surface:
 *   - active bill count
 *   - upcoming approved municipal_meetings count
 *   - approved policy_alerts count (last 30d)
 *   - user count (advocates registered with that state)
 *   - briefing freshness
 *
 * Goal: spot coverage gaps. A state with 0 users + 0 alerts + 0
 * meetings is a recruitment + intel-gathering opportunity. A state
 * with high alerts + low users is a target for outreach.
 *
 * Color-coded:
 *   - green: ≥3 users + active intel
 *   - amber: 1-2 users OR thin intel
 *   - red: no users + no intel = blind spot
 */
const STATE_NAMES: Record<string, string> = {
  AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",
  CO:"Colorado",CT:"Connecticut",DE:"Delaware",DC:"D.C.",
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

type StateStat = {
  state: string;
  users: number;
  active_bills: number;
  upcoming_meetings: number;
  alerts_30d: number;
  briefing_generated_at: string | null;
  briefing_body_len: number;
  briefing_critique: {
    enabled: boolean;
    revisions_applied: number;
    unresolved_reason: string | null;
  } | null;
  news_mentions: number;
  state_lobbyists_active: number;
  bill_votes: number;
  court_cases: number;
  audit_flags: string[];
};

export default async function PerStateIntelHealthPage() {
  const ctx = await getAdminContext({ require: "moderate_intel_queue" });
  if (!ctx.ok) redirect("/dashboard");

  const supabase = await createClient();
  const now = new Date();
  const horizon = new Date(now.getTime() + 90 * 86_400_000);
  const since30d = new Date(now.getTime() - 30 * 86_400_000).toISOString();

  // Pull aggregates per state. We do these as 6 separate queries
  // and merge in JS — each is bounded by state and is fast.
  //
  // briefings: only the currently-active row per state (the table
  // stacks old briefings via is_active=false), and include the
  // critique audit trail from D5 + the body length for the D7
  // health check.
  const [users, bills, meetings, alerts, briefings, newsMentions, stateLobbyists, billVotes, courtCases, federalRulemaking, federalAwards] = await Promise.all([
    supabase.from("profiles").select("state").not("state", "is", null),
    supabase.from("bills").select("state").eq("active", true),
    supabase.from("municipal_meetings")
      .select("state, meeting_at")
      .eq("moderation_status", "approved")
      .gte("meeting_at", now.toISOString())
      .lte("meeting_at", horizon.toISOString()),
    supabase.from("policy_alerts")
      .select("locality")
      .eq("moderation_status", "approved")
      .in("severity", ["critical", "alert", "watch"])
      .gte("created_at", since30d),
    supabase.from("state_briefings")
      .select("state, generated_at, body_md, data_snapshot")
      .eq("is_active", true),
    // D4 Phase 1: news mentions per state. Joined through legislators
    // since the mentions table has legislator_id, not state directly.
    supabase.from("legislator_news_mentions")
      .select("legislator_id, legislators!inner(state)"),
    // D2 pilot: currently-active kratom-industry lobbyist registrations
    // per state (Utah seeded; other states queued).
    supabase.from("state_lobbyist_registrations")
      .select("state")
      .eq("is_kratom_relevant", true)
      .is("end_date", null),
    // D1 voting record coverage — joined to bills for state.
    // Surfaces the LEGISCAN_API_KEY blocker plainly: when this comes
    // back empty across all 51 states, the secret isn't set.
    supabase.from("bill_votes")
      .select("bill_id, bills!inner(state)"),
    // Court litigation per state (CourtListener sync).
    supabase.from("court_cases")
      .select("state")
      .not("state", "is", null),
    // Federal rulemaking — NATIONAL layer, not per-state. We just
    // count totals + open-for-comment count for the top-line stats.
    supabase.from("federal_rulemaking")
      .select("open_for_comment, agency_id"),
    // Federal awards — NATIONAL layer. Total $ flowing federally
    // for kratom-related work.
    supabase.from("federal_awards")
      .select("amount, is_research"),
  ]);

  // Aggregate
  const stats: Record<string, StateStat> = {};
  for (const code of Object.keys(STATE_NAMES)) {
    stats[code] = {
      state: code, users: 0, active_bills: 0, upcoming_meetings: 0, alerts_30d: 0,
      briefing_generated_at: null, briefing_body_len: 0, briefing_critique: null,
      news_mentions: 0, state_lobbyists_active: 0, bill_votes: 0, court_cases: 0, audit_flags: [],
    };
  }

  for (const r of users.data ?? []) {
    const s = r.state?.toUpperCase();
    if (s && stats[s]) stats[s].users++;
  }
  for (const r of bills.data ?? []) {
    const s = r.state?.toUpperCase();
    if (s && stats[s]) stats[s].active_bills++;
  }
  for (const r of meetings.data ?? []) {
    const s = r.state?.toUpperCase();
    if (s && stats[s]) stats[s].upcoming_meetings++;
  }
  for (const r of alerts.data ?? []) {
    // locality can be "NY" or "Marshall, IL"
    const loc = r.locality?.trim() ?? "";
    let code: string | null = null;
    if (/^[A-Z]{2}$/.test(loc)) code = loc;
    else {
      const m = loc.match(/,\s*([A-Z]{2})\s*$/i);
      if (m) code = m[1].toUpperCase();
    }
    if (code && stats[code]) stats[code].alerts_30d++;
  }
  // D5 + D7 telemetry from active briefings
  type BriefingRow = { state: string; generated_at: string | null; body_md: string | null; data_snapshot: BriefingSnapshot | null };
  type BriefingSnapshot = {
    critique?: {
      enabled?: boolean;
      revisions_applied?: number;
      history?: Array<{ needs_revision?: boolean; revised?: boolean; issues?: string[]; rejection_reason?: string }>;
    };
  };
  for (const r of (briefings.data ?? []) as BriefingRow[]) {
    const s = r.state?.toUpperCase();
    if (!s || !stats[s]) continue;
    stats[s].briefing_generated_at = r.generated_at;
    stats[s].briefing_body_len = r.body_md?.length ?? 0;
    const c = r.data_snapshot?.critique;
    if (c) {
      const history = Array.isArray(c.history) ? c.history : [];
      const stuck = history.find(h => h.needs_revision === true && h.revised === false);
      stats[s].briefing_critique = {
        enabled: !!c.enabled,
        revisions_applied: c.revisions_applied ?? 0,
        unresolved_reason: stuck
          ? `critique flagged ${stuck.issues?.length ?? 0} issue(s), revision blocked (${stuck.rejection_reason ?? "provider_or_quota"})`
          : null,
      };
    }
    // D7 audit flags — inlined here so the page shows the same
    // signals the audit script produces, without shelling out.
    const ageMs = r.generated_at ? Date.now() - new Date(r.generated_at).getTime() : Infinity;
    const ageDays = ageMs / 86_400_000;
    if (ageDays > 7) stats[s].audit_flags.push(`stale ${ageDays.toFixed(0)}d`);
    if ((r.body_md?.length ?? 0) < 2000) stats[s].audit_flags.push(`low quality ${r.body_md?.length ?? 0} chars`);
    if (stats[s].briefing_critique?.unresolved_reason) stats[s].audit_flags.push("critique blocked");
  }
  // States with no active briefing at all
  for (const code of Object.keys(STATE_NAMES)) {
    if (stats[code].briefing_generated_at === null) {
      stats[code].audit_flags.push("no briefing");
    }
  }
  // D4 news mentions
  type MentionJoined = { legislator_id: string; legislators: { state: string | null } | { state: string | null }[] | null };
  for (const r of (newsMentions.data ?? []) as MentionJoined[]) {
    const legState = Array.isArray(r.legislators) ? r.legislators[0]?.state : r.legislators?.state;
    const s = legState?.toUpperCase();
    if (s && stats[s]) stats[s].news_mentions++;
  }
  // D2 active kratom-industry state lobbyists
  for (const r of (stateLobbyists.data ?? []) as Array<{ state: string | null }>) {
    const s = r.state?.toUpperCase();
    if (s && stats[s]) stats[s].state_lobbyists_active++;
  }
  // D1 voting records — joined through bills
  type VoteJoined = { bill_id: string; bills: { state: string | null } | { state: string | null }[] | null };
  for (const r of (billVotes.data ?? []) as VoteJoined[]) {
    const billState = Array.isArray(r.bills) ? r.bills[0]?.state : r.bills?.state;
    const s = billState?.toUpperCase();
    if (s && stats[s]) stats[s].bill_votes++;
  }
  // Court cases (CourtListener sync)
  for (const r of (courtCases.data ?? []) as Array<{ state: string | null }>) {
    const s = r.state?.toUpperCase();
    if (s && stats[s]) stats[s].court_cases++;
  }

  // Sort by activity total descending
  const sorted = Object.values(stats).sort((a, b) =>
    (b.users + b.active_bills + b.upcoming_meetings + b.alerts_30d) -
    (a.users + a.active_bills + a.upcoming_meetings + a.alerts_30d)
  );

  // Coverage tier
  function tierOf(s: StateStat): { tier: "high" | "mid" | "low"; tone: string } {
    const intel = s.active_bills + s.upcoming_meetings + s.alerts_30d;
    if (s.users >= 3 && intel >= 1) return { tier: "high", tone: "border-emerald-700/40 bg-emerald-950/15" };
    if (s.users >= 1 || intel >= 1) return { tier: "mid", tone: "border-amber-700/30 bg-amber-950/10" };
    return { tier: "low", tone: "border-red-700/30 bg-red-950/10" };
  }

  const totals = sorted.reduce(
    (acc, s) => ({
      users: acc.users + s.users,
      bills: acc.bills + s.active_bills,
      meetings: acc.meetings + s.upcoming_meetings,
      alerts: acc.alerts + s.alerts_30d,
      news_mentions: acc.news_mentions + s.news_mentions,
      state_lobbyists: acc.state_lobbyists + s.state_lobbyists_active,
      bill_votes: acc.bill_votes + s.bill_votes,
      flagged: acc.flagged + (s.audit_flags.length > 0 ? 1 : 0),
    }),
    { users: 0, bills: 0, meetings: 0, alerts: 0, news_mentions: 0, state_lobbyists: 0, bill_votes: 0, flagged: 0 },
  );

  // Federal rulemaking aggregates (NATIONAL — not per-state).
  type FedRuleRow = { open_for_comment: boolean | null; agency_id: string | null };
  const fedRows = (federalRulemaking.data ?? []) as FedRuleRow[];
  const fedTotal = fedRows.length;
  const fedOpenForComment = fedRows.filter(r => r.open_for_comment).length;

  // Federal awards aggregates (NATIONAL — money flowing federally).
  type FedAwardRow = { amount: number | null; is_research: boolean | null };
  const awardRows = (federalAwards.data ?? []) as FedAwardRow[];
  const awardCount = awardRows.length;
  const awardTotalDollars = awardRows.reduce((a, r) => a + (Number(r.amount) || 0), 0);

  // Surface ops blockers: when an entire intel layer is at 0 across
  // all 51 states, something is broken at the secrets/cron level —
  // not a per-state coverage gap. Surface plainly so the owner knows
  // exactly what to fix.
  const opsBlockers: Array<{ layer: string; why: string; action: string }> = [];
  if (totals.bill_votes === 0) {
    opsBlockers.push({
      layer: "Voting roll-call records (D1)",
      why: "0 rows across all 51 states — the LegiScan sync is silently no-op'ing.",
      action: "Set LEGISCAN_API_KEY in GitHub Actions secrets (Settings → Secrets → Actions). Free key at legiscan.com/legiscan. Next daily cron will backfill.",
    });
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <Link href="/admin/intel-health" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Intel Health
      </Link>

      <header className="mt-2 mb-6">
        <h1 className="text-3xl font-bold">Per-state intel health</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Coverage grid for all 50 states + DC. Spot blind spots (no users
          + no intel = red) and outreach opportunities (high alerts + low
          users = amber).
        </p>
      </header>

      {/* Ops blockers — entire-pipeline outages that need owner action
          rather than per-state work. Surfaced loudly because silent
          failure was exactly how D1's missing-secret bug hid for days. */}
      {opsBlockers.length > 0 && (
        <section className="mb-6 rounded-lg border-2 border-red-600/60 bg-red-950/25 p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-red-300">⚠ Ops blockers</h2>
          <p className="mt-1 text-[11px] text-red-200/80">
            Entire intel layers stuck at 0 across all 51 states — not per-state coverage gaps, pipeline outages. Owner action required.
          </p>
          <ul className="mt-3 space-y-2">
            {opsBlockers.map((b, i) => (
              <li key={i} className="rounded border border-red-700/50 bg-red-950/30 p-2.5 text-[11px]">
                <p className="font-semibold text-red-200">{b.layer}</p>
                <p className="mt-0.5 text-zinc-400">{b.why}</p>
                <p className="mt-1 text-emerald-300">→ {b.action}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Top-line totals */}
      <section className="mb-6 grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5">
        <Stat label="Total advocates" value={totals.users} />
        <Stat label="Active bills" value={totals.bills} />
        <Stat label="Upcoming meetings" value={totals.meetings} />
        <Stat label="Alerts (30d)" value={totals.alerts} />
        <Stat label="News mentions" value={totals.news_mentions} />
        <Stat label="State lobbyists" value={totals.state_lobbyists} />
        <Stat label="Voting records" value={totals.bill_votes} tone={totals.bill_votes === 0 ? "warn" : undefined} />
        <Stat label="Court cases" value={(fedTotal > 0 || totals.bill_votes > 0) ? sorted.reduce((a, s) => a + s.court_cases, 0) : 0} />
        <Stat label="Federal docs" value={fedTotal} />
        <Stat
          label="🚨 Open fed comments"
          value={fedOpenForComment}
          tone={fedOpenForComment > 0 ? "warn" : undefined}
        />
        <Stat label="Federal awards" value={awardCount} />
        <Stat label="Federal $ awarded" value={awardTotalDollars} format="dollars" />
      </section>
      {fedOpenForComment > 0 && (
        <section className="mb-6 rounded-lg border-2 border-amber-600/60 bg-amber-950/25 p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-amber-300">⚠ Federal public comment periods open NOW</h2>
          <p className="mt-1 text-[11px] text-amber-200/80">
            {fedOpenForComment} federal rulemaking docket{fedOpenForComment === 1 ? "" : "s"} accepting public comments right now. These are direct-influence moves for advocates — comments submitted via Regulations.gov are part of the official record.
          </p>
        </section>
      )}
      {totals.flagged > 0 && (
        <section className="mb-6 rounded-lg border border-red-700/50 bg-red-950/15 p-3 text-[11px] text-red-200">
          {totals.flagged} state briefing{totals.flagged === 1 ? "" : "s"} flagged for regen (see per-state cards below).
        </section>
      )}

      {/* Per-state grid */}
      <section>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((s) => {
            const { tier, tone } = tierOf(s);
            const briefingAge = s.briefing_generated_at
              ? Math.floor((Date.now() - new Date(s.briefing_generated_at).getTime()) / 86_400_000)
              : null;
            const flagged = s.audit_flags.length > 0;
            const cardTone = flagged ? "border-red-700/50 bg-red-950/15" : tone;
            return (
              <div key={s.state} className={`rounded-md border p-3 ${cardTone}`}>
                <div className="flex items-baseline justify-between">
                  <p className="font-mono text-lg font-bold text-zinc-100">{s.state}</p>
                  <span className={`text-[10px] font-bold uppercase ${
                    flagged ? "text-red-300" :
                    tier === "high" ? "text-emerald-300" :
                    tier === "mid" ? "text-amber-300" : "text-red-300"
                  }`}>
                    {flagged ? "needs regen" :
                     tier === "high" ? "covered" : tier === "mid" ? "partial" : "blind"}
                  </span>
                </div>
                <p className="text-[11px] text-zinc-500">{STATE_NAMES[s.state]}</p>
                <ul className="mt-2 space-y-0.5 text-[11px] text-zinc-300">
                  <li className="flex justify-between"><span>👥 Advocates</span><span className="font-mono">{s.users}</span></li>
                  <li className="flex justify-between"><span>📜 Bills</span><span className="font-mono">{s.active_bills}</span></li>
                  <li className="flex justify-between"><span>📅 Meetings</span><span className="font-mono">{s.upcoming_meetings}</span></li>
                  <li className="flex justify-between"><span>🚨 Alerts (30d)</span><span className="font-mono">{s.alerts_30d}</span></li>
                  <li className="flex justify-between"><span>📰 News mentions</span><span className="font-mono">{s.news_mentions}</span></li>
                  <li className="flex justify-between"><span>🏛 State lobbyists</span><span className="font-mono">{s.state_lobbyists_active}</span></li>
                  <li className="flex justify-between"><span>🗳 Voting records</span><span className={`font-mono ${s.bill_votes === 0 ? "text-red-400" : ""}`}>{s.bill_votes}</span></li>
                  <li className="flex justify-between"><span>⚖ Court cases</span><span className="font-mono">{s.court_cases}</span></li>
                </ul>
                {flagged && (
                  <ul className="mt-2 space-y-0.5 rounded border border-red-800/40 bg-red-950/20 p-1.5 text-[10px] text-red-200">
                    {s.audit_flags.map((f, i) => (<li key={i}>⚠ {f}</li>))}
                  </ul>
                )}
                {s.briefing_critique && !flagged && (
                  <p className="mt-2 text-[10px] text-zinc-500">
                    🔄 critique{s.briefing_critique.revisions_applied > 0
                      ? ` · ${s.briefing_critique.revisions_applied} revision${s.briefing_critique.revisions_applied === 1 ? "" : "s"} applied`
                      : " ✓ clean"}
                  </p>
                )}
                <div className="mt-2 flex items-center justify-between text-[10px]">
                  <span className="text-zinc-600">
                    {briefingAge !== null
                      ? `briefing ${briefingAge}d old · ${s.briefing_body_len.toLocaleString()} chars`
                      : <span className="text-red-400">no briefing</span>}
                  </span>
                  <Link href={`/briefings/state/${s.state}`} className="text-emerald-400 hover:underline">
                    view →
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <p className="mt-8 text-[10px] text-zinc-600">
        Generated {new Date().toISOString().slice(0, 19).replace("T", " ")} UTC. Refresh page for latest.
      </p>
    </div>
  );
}

function Stat({ label, value, tone, format }: { label: string; value: number; tone?: "warn"; format?: "dollars" }) {
  const borderCls = tone === "warn" ? "border-red-700/50 bg-red-950/20" : "border-zinc-800 bg-zinc-950/40";
  const valueCls = tone === "warn" ? "text-red-200" : "text-zinc-100";
  const displayValue = format === "dollars"
    ? (value >= 1_000_000 ? `$${(value / 1_000_000).toFixed(1)}M` : value >= 1_000 ? `$${(value / 1_000).toFixed(0)}k` : `$${value}`)
    : value.toLocaleString();
  return (
    <div className={`rounded-lg border p-3 ${borderCls}`}>
      <p className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${valueCls}`}>{displayValue}</p>
    </div>
  );
}
