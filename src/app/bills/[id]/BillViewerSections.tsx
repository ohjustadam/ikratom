"use client";

import { EmailOfficialButton } from "@/modules/compose/EmailOfficialButton";
import { EmailGroupButton } from "@/modules/compose/EmailGroupButton";
import { useBillViewer } from "./useBillViewer";

/**
 * The four per-reader sections of a bill page.
 *
 * All of these used to be resolved on the server, which is what kept ~680 bill
 * pages dynamic — every crawler hit re-querying Supabase for data about a
 * visitor who was never signed in. They now come from one shared fetch of
 * /api/bills/[id]/viewer (see useBillViewer).
 *
 * THEY ARE FETCHED, NEVER RENDERED-THEN-HIDDEN. The page is cached and served
 * to everyone, so anything gated must genuinely not be in the HTML. That
 * matters most for the committee table: its tiers are derived from
 * legislator_stance, which is RLS-gated, and the API route deliberately runs on
 * the reader's own session so anon and unverified readers get stance-blind
 * tiers exactly as they did before caching.
 */

/** "N actions taken across all campaigns for this bill." */
export function ActionsTakenLine({ billId }: { billId: string }) {
  const { data } = useBillViewer(billId);
  if (data.totalActions <= 0) return null;
  return (
    <p className="mt-3 text-xs text-zinc-500">
      {data.totalActions.toLocaleString()} action{data.totalActions === 1 ? "" : "s"} taken
      across all campaigns for this bill.
    </p>
  );
}

/**
 * Federal "email your officials". State and local scopes are viewer-INDEPENDENT
 * and stay in the cached page; only the federal branch needs the reader's own
 * delegation, so only that one renders here.
 */
export function FederalEmailOfficials({
  billId,
  stance,
}: {
  billId: string;
  stance: "oppose" | "support" | "neutral";
}) {
  const { data } = useBillViewer(billId);
  const g = data.officialGroups;
  if (!g || (g.groups.length === 0 && !g.needsProfile)) return null;
  return (
    <section id="email-officials" className="mb-6 rounded-lg border-2 border-emerald-700/50 bg-gradient-to-br from-emerald-950/25 to-zinc-950/40 p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-emerald-300">
        ✉ Email your officials about this bill
      </h2>
      <p className="mt-1 text-[11px] text-zinc-500">
        Draft a personalized letter and send it to the officials who decide this bill — your voice, your email address. Pick a group:
      </p>
      <div className="mt-3">
        <EmailGroupButton
          groups={g.groups}
          billId={billId}
          stance={stance}
          needsProfile={g.needsProfile}
          scope={g.scope}
        />
      </div>
    </section>
  );
}

/** Committee leverage — every member of the committee deciding this bill. */
export function CommitteeLeverage({
  billId,
  currentCommitteeName,
}: {
  billId: string;
  currentCommitteeName: string | null;
}) {
  const { data, loading } = useBillViewer(billId);
  const members = data.committeeMembers;

  // Distinguish "still loading" from "no committee": rendering nothing during
  // the fetch would read as a bill nobody is deciding, which is the opposite
  // of what this section exists to say.
  if (loading) {
    return (
      <div className="mt-4 rounded-md border border-zinc-800 bg-zinc-950/30 p-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-600">
          🎯 Committee leverage
        </p>
        <div className="mt-2 space-y-1.5">
          <div className="h-7 animate-pulse rounded bg-zinc-900/70" />
          <div className="h-7 animate-pulse rounded bg-zinc-900/50" />
        </div>
      </div>
    );
  }
  if (members.length === 0) return null;

  const callable = members.filter(
    (m) => m.tier === "flippable_target" || m.tier === "hostile_decision_maker" || m.committee_role === "chair",
  );

  return (
    <div className="mt-4 rounded-md border border-emerald-700/40 bg-emerald-950/10 p-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-emerald-300">
        🎯 Committee leverage · who&apos;s deciding this bill
      </p>
      <p className="mt-1 text-[10px] text-zinc-500">
        The bill is in <span className="font-mono text-zinc-300">{currentCommitteeName ?? "committee"}</span>.
        {" "}{members.length} member{members.length === 1 ? "" : "s"}, ranked by threat-matrix tier.
        <span className="ml-1 text-emerald-300">
          {callable.length > 0
            ? `${callable.length} priority call target${callable.length === 1 ? "" : "s"} below.`
            : ""}
        </span>
      </p>
      <ul className="mt-2 space-y-1.5">
        {members.map((m) => {
          const isPriority =
            m.tier === "flippable_target" ||
            m.tier === "hostile_decision_maker" ||
            m.committee_role === "chair";
          return (
            <li key={m.legislator_id}>
              <div className={`block rounded border px-2.5 py-1.5 text-[11px] ${m.tier_color}`} title={m.rationale}>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <a href={`/legislators/${m.legislator_id}/briefing`} className="font-semibold hover:underline">
                    {m.full_name}
                  </a>
                  <span className="rounded bg-zinc-900/40 px-1.5 py-0.5 font-mono text-[9px] uppercase">
                    {m.role.replace(/_/g, " ")}
                  </span>
                  {m.district && <span className="text-[10px] text-zinc-400">D{m.district}</span>}
                  {m.party && <span className="text-[10px] text-zinc-400">{m.party}</span>}
                  {m.committee_role === "chair" && (
                    <span className="rounded bg-amber-950/40 px-1.5 py-0.5 text-[9px] font-bold text-amber-300">
                      🪑 CHAIR
                    </span>
                  )}
                  {m.committee_role === "vice_chair" && (
                    <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[9px] uppercase text-zinc-400">
                      vice chair
                    </span>
                  )}
                  <span className="ml-auto flex items-center gap-2">
                    <span className="font-mono text-[10px]">{m.tier_emoji} {m.tier_label}</span>
                    <span className="font-mono text-[9px] opacity-75">T{m.threat_score}·V{m.vulnerability_score}</span>
                  </span>
                </div>
                {/* Contact row — only when we have a phone/email AND this member
                    is a priority target. Keeps the panel scannable; the briefing
                    covers full contact details for any row clicked through. */}
                {isPriority && (m.phone || m.email) && (
                  <div className="mt-1 flex flex-wrap items-center gap-2 border-t border-zinc-900/40 pt-1 text-[10px]">
                    {m.phone && (
                      <a
                        href={`tel:${m.phone.replace(/[^\d+]/g, "")}`}
                        className="rounded bg-emerald-950/40 px-2 py-0.5 font-mono text-emerald-200 hover:bg-emerald-900/40"
                      >
                        📞 {m.phone}
                      </a>
                    )}
                    <EmailOfficialButton
                      official={{
                        id: m.legislator_id,
                        name: m.full_name,
                        role: m.role,
                        title: m.title,
                        state: m.state,
                        email: m.email,
                        website: m.website,
                      }}
                      context={{ kind: "bill", billId }}
                      source="bill_committee"
                      variant="inline"
                      label={m.email ? "✉ email" : "🌐 contact"}
                    />
                    <span className="text-zinc-500">
                      — {m.tier === "flippable_target" ? "highest conversion ROI" : m.committee_role === "chair" ? "controls the calendar" : "blocking leverage"}
                    </span>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
