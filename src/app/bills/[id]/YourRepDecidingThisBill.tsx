"use client";

import { useEffect, useState } from "react";
import Link from "@/components/Link";
import { EmailOfficialButton } from "@/modules/compose/EmailOfficialButton";
import { useChromeMe } from "@/components/chrome/ChromeProvider";
import type { YourRepData } from "./your-rep-data";

/**
 * "YOUR rep is deciding this bill" — district-level urgency callout.
 *
 * Mission lever (the platform's whole point):
 *   When a bill sits in committee, only the ~10-20 legislators ON
 *   that committee can vote it out. Of those, only constituents of
 *   THOSE legislators have leverage. Lobbyists know this and target
 *   precisely; advocates almost never do.
 *
 * This component cross-references:
 *   bill.current_committee_name  ×  the signed-in user's reps' committee assignments
 *
 * Render outcomes:
 *   1. User signed in + rep IS on the committee
 *      → big emerald callout: "YOUR rep X is one of the votes. Call
 *        them. This is the moment your call matters." + tel: + mailto:
 *   2. User signed in + bill in committee + no rep match
 *      → soft note: "This bill is in [Committee]. Your reps aren't on
 *        it. The chair is [Name] ([Party]–[District])."
 *   3. User not signed in OR bill has no current_committee_name
 *      → renders nothing (silent). The bill page's SignUpNudge covers
 *        the "you should sign in" message.
 *
 * Free-tier rule: uses mailto: + tel: links, no transactional email
 * or paid SMS.
 */
/*
 * Client component (2026-10-05). It used to read cookies inside the cached
 * bill page, which production Next refuses (DYNAMIC_SERVER_USAGE): every bill
 * page 500'd. The viewer's data now comes from /api/bills/[id]/your-rep, fetched
 * only for signed-in members; anonymous visitors and crawlers never call it.
 */
export function YourRepDecidingThisBill({
  billId,
  currentCommitteeName,
}: {
  billId: string;
  billState?: string;
  currentCommitteeName: string | null;
}) {
  const { userId } = useChromeMe();
  const [data, setData] = useState<YourRepData | null>(null);

  useEffect(() => {
    if (!userId || !currentCommitteeName) return;
    let live = true;
    fetch(`/api/bills/${billId}/your-rep`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { data: YourRepData | null } | null) => { if (live) setData(j?.data ?? null); })
      .catch(() => { /* the callout is optional; stay silent */ });
    return () => { live = false; };
  }, [userId, billId, currentCommitteeName]);

  if (!currentCommitteeName || !data) return null;
  const { matches, isBattleground, leadership } = data;

  // Render: matches case (highest urgency)
  if (matches.length > 0) {
    const sectionShell = isBattleground
      ? "mb-6 rounded-lg border-2 border-amber-400 bg-amber-950/20 p-5 shadow-[0_0_32px_-8px_rgba(251,191,36,0.55)]"
      : "mb-6 rounded-lg border-2 border-emerald-500 bg-emerald-950/20 p-5 shadow-[0_0_24px_-8px_rgba(16,185,129,0.5)]";
    const chipShell = isBattleground
      ? "rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-950"
      : "rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-950";
    const headingShell = isBattleground
      ? "text-sm font-bold uppercase tracking-wider text-amber-300"
      : "text-sm font-bold uppercase tracking-wider text-emerald-300";
    return (
      <section className={sectionShell}>
        <div className="mb-3 flex items-center gap-2">
          <span className={chipShell}>
            {isBattleground ? "🔥 Battleground" : "⚡ Your call counts"}
          </span>
          <h2 className={headingShell}>
            Your rep is deciding this bill
          </h2>
        </div>
        <p className="text-sm text-zinc-200">
          This bill sits in the <span className="font-semibold">{currentCommitteeName}</span>
          {isBattleground ? (
            <> — historically one of the committees where kratom bills are won or lost.</>
          ) : (
            <>.</>
          )}
          {" "}{matches.length === 1 ? "Your representative is" : `${matches.length} of your representatives are`}{" "}
          on it. Lobbyists are calling them right now. They need to hear from constituents too.
        </p>
        <ul className="mt-3 space-y-3">
          {matches.map(({ rep, role, committeeName }) => {
            const roleLabel = ROLE_LABEL[role] ?? "Member";
            const roleAccent = role === "chair" ? "text-amber-300" : role === "vice_chair" ? "text-sky-300" : "text-zinc-300";
            const tel = rep.phone?.replace(/[^\d+]/g, "");
            return (
              <li
                key={rep.id}
                className="flex flex-wrap items-baseline justify-between gap-3 rounded-md border border-emerald-700/40 bg-emerald-950/15 p-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-zinc-100">
                    {rep.full_name}
                    {rep.party && (
                      <span className="ml-1.5 text-[10px] font-mono text-zinc-400">({rep.party})</span>
                    )}
                  </p>
                  <p className={`text-[11px] uppercase tracking-wider ${roleAccent}`}>
                    {roleLabel} · {committeeName}
                  </p>
                  <p className="text-[11px] text-zinc-500">
                    {rep.role.replace(/_/g, " ")}
                    {rep.district ? ` · District ${rep.district}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {tel && (
                    <a
                      href={`tel:${tel}`}
                      className="rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-400"
                      data-event="rep_call_committee"
                    >
                      📞 Call {rep.phone}
                    </a>
                  )}
                  <EmailOfficialButton
                    official={{
                      id: rep.id,
                      name: rep.full_name,
                      role: rep.role,
                      state: rep.state,
                      email: rep.email,
                      website: rep.website,
                    }}
                    context={{ kind: "bill", billId }}
                    source="bill_rep_committee"
                    variant="chip"
                  />
                  <Link
                    href={`/legislators/${rep.id}/briefing`}
                    className="rounded-md border border-emerald-700 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:border-emerald-500"
                    data-event="open_briefing_from_urgency_callout"
                    title="Full intel briefing: stance, leverage signals, action plan with talking points"
                  >
                    ◉ Brief →
                  </Link>
                  <Link
                    href={`/legislators/${rep.id}`}
                    className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:border-emerald-500"
                  >
                    Profile
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-[11px] text-zinc-500">
          Why this matters: the bill can&apos;t advance without a committee vote. The handful of legislators on this committee are the actual decision-makers — your call to them carries far more weight than a generic email to your at-large reps.
        </p>
      </section>
    );
  }

  // No-match fallback — still useful: tell user WHO is deciding so
  // they know the field even if they can't influence it directly.
  if (leadership.length > 0) {
    const chair = leadership.find((l) => l.role === "chair") ?? leadership[0];
    return (
      <aside className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
        <p className="text-xs text-zinc-400">
          📍 This bill is in the <span className="font-semibold text-zinc-200">{currentCommitteeName}</span>.
          Your reps aren&apos;t on this committee, so direct leverage is limited. The chair is{" "}
          <span className="text-zinc-200">{chair.full_name}</span>
          {chair.party && <span className="ml-1 text-zinc-500">({chair.party})</span>}
          {chair.district && <span className="ml-1 text-zinc-500">· District {chair.district}</span>}
          {". "}
          <Link href={`/legislators/committee?name=${encodeURIComponent(currentCommitteeName)}`} className="text-emerald-400 hover:underline">
            See all committee members →
          </Link>
        </p>
      </aside>
    );
  }

  // We know the committee but have no data on its members. Bare hint.
  return (
    <aside className="mb-6 rounded-md border border-zinc-800 bg-zinc-950/40 p-3 text-[11px] text-zinc-500">
      📍 This bill is in the <span className="text-zinc-200">{currentCommitteeName}</span>.
    </aside>
  );
}

const ROLE_LABEL: Record<string, string> = {
  chair: "Chair",
  vice_chair: "Vice chair",
  ranking_member: "Ranking member",
  member: "Member",
};
