import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { extractSponsor, extractBlurb, repealPath } from "@/lib/takeback";
import { PageShareWithAttribution } from "@/components/PageShareWithAttribution";

export const metadata = {
  title: "Takeback — the offense + defense plan for every banned state",
  description: "Every US state that bans kratom: who pushed the ban, what political coalition backed it, and the concrete repeal plan. Plus imminent state-level threats.",
};
export const dynamic = "force-dynamic";

/**
 * /takeback — hub for the banned-state takeback intel that lives per-bill
 * via opposition_summary_md + repeal_plan_md (migration 0141).
 *
 * Owner directive: 'we need info on the banned states as well as what
 * forces pushed against kratom and where that political trail leads...
 * action plans. who to contact. ...offense and defense. a plan to take
 * back states that have been banned.'
 *
 * Per-bill detail pages already render the full content. This hub answers
 * the question 'show me everything across all banned states at once' so
 * organizers can see the pattern (admin-rule bans vs statutory; old vs new;
 * which state is easiest to flip first) without clicking into each.
 *
 * Surfaces:
 *   1. Imminent (TN HB 1649 if Lee still hasn't signed) — pinned + amber
 *   2. The 6 historical enacted bans — grid of cards, summary blurb each
 *   3. Pattern observations — admin-rule states (AR/RI/VT) are easier
 *      targets than statutory (AL/IN/WI)
 *   4. Take-action CTAs — subscribe to bill updates, view full plans
 */
type Row = {
  id: string;
  state: string;
  bill_number: string;
  title: string | null;
  status: string | null;
  last_action_at: string | null;
  effective_date: string | null;
  opposition_summary_md: string | null;
  repeal_plan_md: string | null;
};

const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AR: "Arkansas", IN: "Indiana", RI: "Rhode Island",
  VT: "Vermont", WI: "Wisconsin", TN: "Tennessee",
};

// Helpers (extractSponsor, extractBlurb, repealPath) moved to
// src/lib/takeback.ts so they're independently testable.
// See tests in src/lib/__tests__/takeback.test.ts.

export default async function TakebackPage() {
  const sb = await createClient();
  const { data } = await sb
    .from("bills")
    .select("id, state, bill_number, title, status, last_action_at, effective_date, opposition_summary_md, repeal_plan_md")
    .not("opposition_summary_md", "is", null)
    .order("state", { ascending: true });

  const rows = (data ?? []) as Row[];
  const imminent = rows.filter((r) => r.status === "passed_chamber");
  const enacted = rows.filter((r) => r.status === "enacted");
  const adminRule = enacted.filter((r) => /(DEA-list|DOH-rule|Reg-Drugs)/i.test(r.bill_number));
  const statutory = enacted.filter((r) => !/(DEA-list|DOH-rule|Reg-Drugs)/i.test(r.bill_number));

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <Link href="/" className="text-xs text-zinc-500 hover:text-emerald-400">← Home</Link>

      <header className="mt-3 mb-8 flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-amber-300">
            🎯 Takeback intel
          </p>
          <h1 className="mt-2 text-3xl font-bold sm:text-4xl">
            Every banned state has a path back.<br/>
            <span className="text-zinc-400">Here&apos;s the plan.</span>
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-zinc-400">
            Six US states ban kratom. A seventh (Tennessee) is one signature away. For each, we&apos;ve mapped who pushed the ban, what coalition backed it, what funding trail (where documented), and the concrete repeal sequence — named legislators most likely to carry a Kratom Consumer Protection Act, coalition partners ready to engage, hardest constraints. Open one to see the full plan; subscribe to get pinged when status changes.
          </p>
        </div>
        <PageShareWithAttribution
          path="/takeback"
          title="Takeback — the plan to repeal every kratom ban"
          summary="Every banned state, who pushed the ban, and the concrete repeal sequence."
        />
      </header>

      {/* IMMINENT — TN. Pinned + amber so it dominates. */}
      {imminent.length > 0 && (
        <section className="mb-10 rounded-lg border-2 border-amber-600/60 bg-amber-950/20 p-6">
          <p className="text-xs font-bold uppercase tracking-wider text-amber-300">
            🚨 Imminent — the fight is now ({imminent.length})
          </p>
          <p className="mt-1 text-[11px] text-amber-200/80">
            These bills have passed at least one chamber. Pre-signature veto pressure is the highest-leverage moment in any state-level kratom fight.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {imminent.map((r) => (
              <BanCard key={r.id} row={r} highlight />
            ))}
          </div>
        </section>
      )}

      {/* ADMIN-RULE — AR/RI/VT. Easier repeal path. */}
      {adminRule.length > 0 && (
        <section className="mb-10">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-bold uppercase tracking-wider text-emerald-300">
              Easiest repeal targets · {adminRule.length} admin-rule bans
            </h2>
            <span className="text-[10px] text-zinc-500">No legislative vote required</span>
          </div>
          <p className="mt-1 text-[11px] text-zinc-400">
            States where the ban was enacted by a Department of Health rule, not the legislature. A future Governor + Health Director sympathetic to the KCPA model can rescind via the same rule-making process. These are the highest-leverage repeal targets per dollar of organizing effort.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {adminRule.map((r) => <BanCard key={r.id} row={r} />)}
          </div>
        </section>
      )}

      {/* STATUTORY — AL/IN/WI. Harder. */}
      {statutory.length > 0 && (
        <section className="mb-10">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-300">
              Statutory bans · {statutory.length}
            </h2>
            <span className="text-[10px] text-zinc-500">Legislative repeal required</span>
          </div>
          <p className="mt-1 text-[11px] text-zinc-400">
            States where the ban was passed by the legislature. Repeal requires a fresh bill, a sponsor, and a floor vote. Harder path — but coalition-building, KCPA framing, and named-legislator targeting still apply.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {statutory.map((r) => <BanCard key={r.id} row={r} />)}
          </div>
        </section>
      )}

      {/* Pattern observations */}
      <section className="mt-12 rounded-lg border border-emerald-700/30 bg-emerald-950/10 p-5">
        <h2 className="text-sm font-bold uppercase tracking-wider text-emerald-300">
          Cross-state pattern
        </h2>
        <ul className="mt-3 space-y-2 text-sm text-zinc-300 leading-relaxed">
          <li>
            <strong className="text-emerald-200">→ Admin-rule bans (AR / RI / VT)</strong> can be rescinded by a state Health Department without legislative action. These are the cleanest repeal targets — engagement at Governor + Health Director level.
          </li>
          <li>
            <strong className="text-emerald-200">→ Statutory bans (AL / IN / WI)</strong> need a Kratom Consumer Protection Act bill carrier. Look for legislators on the Judiciary or Healthcare committees who have voted for harm-reduction measures in other contexts.
          </li>
          <li>
            <strong className="text-emerald-200">→ Imminent fights (TN)</strong> are highest-leverage at the pre-signature veto moment. A signed bill becomes a multi-year repeal effort.
          </li>
          <li>
            <strong className="text-emerald-200">→ The conflation tactic</strong> — labeling natural-leaf kratom as &quot;gas station heroin&quot; — is the through-line of every recent push. Disaggregating natural leaf from 7-OH-concentrated derivatives is the unifying messaging defense across all 7 states.
          </li>
        </ul>
      </section>

      {/* CTA */}
      <section className="mt-10 rounded-lg border-2 border-emerald-700/50 bg-emerald-950/15 p-6 text-center">
        <p className="text-lg font-bold leading-snug text-zinc-100">
          The fight isn&apos;t one-and-done.
        </p>
        <p className="mt-2 text-sm text-zinc-300">
          Each banned state has a repeal coalition forming. Subscribe to the bill page in your state of interest and you&apos;ll get push notifications when the next move happens.
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/signup"
            className="rounded-md bg-emerald-500 px-5 py-2.5 font-semibold text-zinc-950 hover:bg-emerald-400"
          >
            Join the network — 90 seconds →
          </Link>
          <Link
            href="/banned"
            className="rounded-md border border-red-700/50 bg-red-950/15 px-5 py-2.5 font-semibold text-red-300 hover:border-red-400"
          >
            🚫 All banned places (states + counties + cities)
          </Link>
        </div>
      </section>

      <footer className="mt-8 rounded-md border border-zinc-800 bg-zinc-950/40 p-4 text-[11px] text-zinc-400">
        <p>
          <strong className="text-zinc-200">Why this exists.</strong>{" "}
          The kratom-policy opposition has been organized for years. The advocacy side has been organized for months. This page is the &quot;here&apos;s the play&quot; document — public, free, editable, named-actor specific — to close that gap. Each plan is editorial. We update them as the political map changes. Submit corrections via the intel-tip form on any bill page.
        </p>
      </footer>
    </div>
  );
}

function BanCard({ row, highlight }: { row: Row; highlight?: boolean }) {
  const sponsor = extractSponsor(row.opposition_summary_md);
  const blurb = extractBlurb(row.opposition_summary_md);
  const path = repealPath(row);
  const cls = highlight
    ? "border-amber-600/60 bg-amber-950/15 hover:border-amber-400"
    : "border-zinc-800 bg-zinc-950/40 hover:border-emerald-500";
  return (
    <Link
      href={`/bills/${row.id}`}
      className={`block rounded-lg border-2 p-4 transition ${cls}`}
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-2xl font-bold text-zinc-100">{row.state}</span>
        <span className="text-sm text-zinc-400">{STATE_NAMES[row.state] ?? row.state}</span>
        <span className={`ml-auto rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase ${path.cls}`}>
          {path.label}
        </span>
      </div>
      <p className="mt-1 font-mono text-[11px] text-zinc-500">{row.bill_number}</p>
      {row.effective_date && row.status === "passed_chamber" && (
        <p className="mt-1 rounded bg-amber-950/40 px-1.5 py-0.5 inline-block text-[10px] font-semibold text-amber-200">
          effective {new Date(row.effective_date).toLocaleDateString()} if signed
        </p>
      )}
      <p className="mt-2 text-[10px] uppercase tracking-wider text-zinc-500">Pushed by</p>
      <p className="text-[12px] leading-snug text-zinc-200 line-clamp-2">{sponsor}</p>
      {blurb && (
        <>
          <p className="mt-2 text-[10px] uppercase tracking-wider text-zinc-500">Repeal path</p>
          <p className="text-[11px] leading-snug text-zinc-400 line-clamp-3">{path.note}</p>
        </>
      )}
      <p className="mt-3 text-[11px] font-semibold text-emerald-400">
        Open full plan →
      </p>
    </Link>
  );
}
