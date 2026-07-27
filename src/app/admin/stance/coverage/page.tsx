import { redirect } from "next/navigation";
import Link from "next/link";
import { getAdminContext } from "@/modules/admin/actions";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Stance coverage matrix" };
export const dynamic = "force-dynamic";

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

const PRIORITY_STATES = new Set(["NY", "FL", "TX", "CA", "OH", "MI", "TN", "MO", "PA", "GA"]);

type Row = {
  state: string;
  legislators: number;
  candidates: number;        // legs with sponsorships OR kratom committee
  stanced: number;           // legs with any legislator_stance (kratom) row
  reviewed: number;          // stanced + stance != 'unknown' (admin set explicit value)
  active_bills: number;
};

/**
 * /admin/stance/coverage — at-a-glance: which states have legislator
 * stance data, which are blank, and where the gaps are.
 *
 * For each state shows:
 *   - Total active legislators
 *   - "Candidates" with kratom signal (sponsorship or relevant committee)
 *   - How many of those have a stance draft (AI-generated)
 *   - How many have a reviewed/non-unknown stance (admin-flipped)
 *   - Active bill count (so empty-stance states with bills surface as gaps)
 *
 * Coverage % = stanced / candidates. Color-coded:
 *   green 80%+ · amber 30-80% · red <30% · zinc (n/a, no candidates)
 */
export default async function StanceCoveragePage() {
  const ctx = await getAdminContext({ require: "edit_stance" });
  if (!ctx.ok) redirect("/dashboard");

  const sb = await createClient();

  // Pull candidate + stance + bill counts per state in three queries
  const [legs, sponsors, kratomCommittees, stances, bills] = await Promise.all([
    sb.from("legislators").select("id, state").eq("active", true),
    sb.from("bill_sponsors").select("legislator_id, bills!inner(state, active, kratom_relevance)"),
    sb.from("legislator_committees").select("legislator_id, legislators!inner(state)").eq("is_kratom_relevant", true),
    sb.from("legislator_stance").select("legislator_id, stance, legislators!inner(state)").eq("topic", "kratom"),
    sb.from("bills").select("state").eq("active", true).in("kratom_relevance", ["anti", "pro"]),
  ]);

  // Init rows
  const rows: Record<string, Row> = {};
  for (const code of Object.keys(STATE_NAMES)) {
    rows[code] = { state: code, legislators: 0, candidates: 0, stanced: 0, reviewed: 0, active_bills: 0 };
  }
  for (const l of legs.data ?? []) {
    const s = (l as { state?: string }).state?.toUpperCase();
    if (s && rows[s]) rows[s].legislators++;
  }
  for (const b of bills.data ?? []) {
    const s = (b as { state?: string }).state?.toUpperCase();
    if (s && rows[s]) rows[s].active_bills++;
  }

  // Build per-state candidate set (sponsorship OR kratom committee)
  const candidateByState: Record<string, Set<string>> = {};
  for (const code of Object.keys(STATE_NAMES)) candidateByState[code] = new Set();

  type SponsorRow = { legislator_id: string; bills: { state: string; active: boolean; kratom_relevance: string } | Array<{ state: string; active: boolean; kratom_relevance: string }> };
  for (const sp of (sponsors.data ?? []) as SponsorRow[]) {
    const bill = Array.isArray(sp.bills) ? sp.bills[0] : sp.bills;
    if (!bill?.active || !["anti", "pro", "neutral"].includes(bill.kratom_relevance)) continue;
    const s = bill.state?.toUpperCase();
    if (s && candidateByState[s] && sp.legislator_id) candidateByState[s].add(sp.legislator_id);
  }
  type CommitteeRow = { legislator_id: string; legislators: { state: string } | Array<{ state: string }> };
  for (const c of (kratomCommittees.data ?? []) as CommitteeRow[]) {
    const leg = Array.isArray(c.legislators) ? c.legislators[0] : c.legislators;
    if (!leg) continue;
    const s = leg.state?.toUpperCase();
    if (s && candidateByState[s] && c.legislator_id) candidateByState[s].add(c.legislator_id);
  }
  for (const code of Object.keys(STATE_NAMES)) {
    rows[code].candidates = candidateByState[code].size;
  }

  // Stance counts
  type StanceRow = { legislator_id: string; stance: string; legislators: { state: string } | Array<{ state: string }> };
  for (const st of (stances.data ?? []) as StanceRow[]) {
    const leg = Array.isArray(st.legislators) ? st.legislators[0] : st.legislators;
    if (!leg) continue;
    const s = leg.state?.toUpperCase();
    if (s && rows[s]) {
      rows[s].stanced++;
      if (st.stance && st.stance !== "unknown") rows[s].reviewed++;
    }
  }

  // Sort: priority states first, then by coverage % desc, then alpha
  const sorted = Object.values(rows).sort((a, b) => {
    const aP = PRIORITY_STATES.has(a.state) ? 1 : 0;
    const bP = PRIORITY_STATES.has(b.state) ? 1 : 0;
    if (aP !== bP) return bP - aP;
    const aC = a.candidates > 0 ? a.stanced / a.candidates : 0;
    const bC = b.candidates > 0 ? b.stanced / b.candidates : 0;
    if (bC !== aC) return bC - aC;
    return a.state.localeCompare(b.state);
  });

  // Totals
  const totals = sorted.reduce((acc, r) => ({
    legs: acc.legs + r.legislators,
    candidates: acc.candidates + r.candidates,
    stanced: acc.stanced + r.stanced,
    reviewed: acc.reviewed + r.reviewed,
    bills: acc.bills + r.active_bills,
  }), { legs: 0, candidates: 0, stanced: 0, reviewed: 0, bills: 0 });

  function coverageTier(r: Row): { tone: string; label: string } {
    if (r.candidates === 0) return { tone: "border-zinc-800 bg-zinc-950/40 text-zinc-500", label: "no candidates" };
    const pct = r.stanced / r.candidates;
    if (pct >= 0.8) return { tone: "border-emerald-700/40 bg-emerald-950/15 text-emerald-300", label: `${Math.round(pct * 100)}%` };
    if (pct >= 0.3) return { tone: "border-amber-700/30 bg-amber-950/10 text-amber-300", label: `${Math.round(pct * 100)}%` };
    return { tone: "border-red-700/40 bg-red-950/15 text-red-300", label: `${Math.round(pct * 100)}%` };
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <Link href="/admin/intel-health" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Intel Health
      </Link>

      <header className="mt-2 mb-6">
        <h1 className="text-3xl font-bold">Legislator stance coverage</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Per-state breakdown of which legislators have AI-drafted (and/or
          admin-reviewed) kratom stances. NY was the model state with 153
          drafts; this matrix shows where the multi-state expansion stands.
        </p>
      </header>

      {/* Totals */}
      <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Active legislators" value={totals.legs} />
        <Stat label="Kratom candidates" value={totals.candidates} sub="sponsorship or kratom committee" />
        <Stat label="With AI draft" value={totals.stanced} sub={`${totals.candidates > 0 ? Math.round((totals.stanced / totals.candidates) * 100) : 0}% of candidates`} />
        <Stat label="Admin reviewed" value={totals.reviewed} sub={`stance ≠ unknown`} />
        <Stat label="Active bills" value={totals.bills} />
      </section>

      {/* Per-state grid */}
      <section>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((r) => {
            const tier = coverageTier(r);
            const isPriority = PRIORITY_STATES.has(r.state);
            return (
              <div key={r.state} className={`rounded-md border p-3 ${tier.tone}`}>
                <div className="flex items-baseline justify-between">
                  <p className="font-mono text-lg font-bold text-zinc-100">
                    {r.state}{isPriority && <span className="ml-1 text-[10px] font-normal text-amber-400">⭐</span>}
                  </p>
                  <span className="text-[10px] font-bold uppercase">
                    {tier.label}
                  </span>
                </div>
                <p className="text-[11px] text-zinc-500">{STATE_NAMES[r.state]}</p>
                <ul className="mt-2 space-y-0.5 text-[11px] text-zinc-300">
                  <li className="flex justify-between"><span>Legislators</span><span className="font-mono">{r.legislators}</span></li>
                  <li className="flex justify-between"><span>Candidates</span><span className="font-mono">{r.candidates}</span></li>
                  <li className="flex justify-between"><span>AI-drafted</span><span className="font-mono">{r.stanced}</span></li>
                  <li className="flex justify-between"><span>Admin reviewed</span><span className="font-mono">{r.reviewed}</span></li>
                  <li className="flex justify-between"><span>Active bills</span><span className="font-mono">{r.active_bills}</span></li>
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      <p className="mt-8 rounded-md border border-zinc-800 bg-zinc-950/40 p-3 text-[11px] text-zinc-400">
        <strong className="text-zinc-200">Run drafts:</strong> The daily cron processes the 10
        ⭐ priority states. To process all 50 + DC in one shot:
        {" "}<code className="rounded bg-zinc-900 px-1 text-emerald-300">npm run db:stance -- --all-states</code>{" "}
        — wait, that&apos;s a misremembered command. The actual invocation is:
        {" "}<code className="rounded bg-zinc-900 px-1 text-emerald-300">node --env-file=.env.local scripts/draft-legislator-stance.mjs --all-states</code>
      </p>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
      <p className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-zinc-100">{value}</p>
      {sub && <p className="mt-0.5 text-[10px] text-zinc-500">{sub}</p>}
    </div>
  );
}
