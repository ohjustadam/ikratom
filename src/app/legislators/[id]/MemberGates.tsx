"use client";

import { useEffect, useState } from "react";
import { useChromeMe } from "@/components/chrome/ChromeProvider";
import type { MemberIntelPayload } from "@/app/api/legislators/[id]/member/route";

/**
 * The two member-only regions of a legislator page, moved client-side.
 *
 * WHY (2026-09-04): deciding these on the server cost a cookie read, which made
 * all 1,001 legislator URLs render per-request. The page is now static; these
 * two components fetch the member half after hydration. Crawlers don't run JS,
 * so a bot renders the signed-out state from the CDN at zero compute.
 *
 * The gated content is FETCHED, never shipped hidden in the HTML. Putting it in
 * the page and hiding it with a client check would leave the signup wall
 * bypassable with view-source, and the pressure index is derived from
 * `legislator_stance`, which RLS withholds from the public entirely. The
 * signed-out state here is byte-identical to what the server used to render.
 */

// One in-flight request per legislator, shared by both components on the page.
const cache = new Map<string, Promise<MemberIntelPayload>>();

function fetchMemberIntel(id: string): Promise<MemberIntelPayload> {
  let p = cache.get(id);
  if (!p) {
    p = fetch(`/api/legislators/${id}/member`, { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : { signedIn: false, pressureIndex: null, votes: [] }))
      .catch(() => ({ signedIn: false, pressureIndex: null, votes: [] }) as MemberIntelPayload);
    cache.set(id, p);
  }
  return p;
}

function useMemberIntel(id: string) {
  const me = useChromeMe();
  const [data, setData] = useState<MemberIntelPayload | null>(null);

  useEffect(() => {
    // Only members have anything to fetch — never spend a request on a visitor
    // we already know is signed out.
    if (!me.userId) { setData(null); return; }
    let alive = true;
    fetchMemberIntel(id).then((d) => { if (alive) setData(d); });
    return () => { alive = false; };
  }, [id, me.userId]);

  return { data, signedIn: !!me.userId };
}

/* ─── Pressure index ─────────────────────────────────────────────────────── */

export function PressureIndexPill({ legislatorId }: { legislatorId: string }) {
  const { data, signedIn } = useMemberIntel(legislatorId);

  if (signedIn && data?.pressureIndex != null) {
    return (
      <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-300">
        🎯 Pressure {data.pressureIndex}
      </span>
    );
  }
  // Signed out, still loading, or a member whose tier doesn't include stance
  // data: the sign-in prompt is the honest resting state.
  if (signedIn) {
    return (
      <span className="rounded-full border border-zinc-800 px-2 py-0.5 text-[10px] uppercase tracking-wider text-zinc-500">
        🎯 Pressure index
      </span>
    );
  }
  return (
    <a
      href={`/login?redirect=/legislators/${legislatorId}`}
      className="rounded-full border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-400 hover:border-emerald-500"
    >
      🎯 Pressure index — sign in (free)
    </a>
  );
}

/* ─── Voting record ──────────────────────────────────────────────────────── */

export type VoteSummary = {
  fullName: string;
  participated: number;
  rollcalls: number;
  missedVotes: number;
  restrictCount: number;
};

export function MemberVotingRecord({
  legislatorId,
  summary,
}: {
  legislatorId: string;
  summary: VoteSummary;
}) {
  const { data, signedIn } = useMemberIntel(legislatorId);
  const { fullName, participated, rollcalls, missedVotes, restrictCount } = summary;

  // Signed out (and the first paint for everyone): the public teaser. These
  // counts are computed server-side from public roll-call data, so they render
  // instantly with no layout shift and no request.
  if (!signedIn || !data?.votes.length) {
    return (
      <p className="text-xs text-zinc-400">
        {fullName} voted in {participated} of {rollcalls} recorded kratom roll-call{rollcalls === 1 ? "" : "s"}
        {missedVotes > 0 ? <> · missed {missedVotes}</> : null}
        {restrictCount > 0 ? <> · voted to restrict kratom {restrictCount}×</> : null}.{" "}
        {signedIn ? null : (
          <>
            <a href="/signup" className="text-emerald-400 hover:underline">Create a free account</a> to see how they voted on each bill.
          </>
        )}
      </p>
    );
  }

  return (
    <>
      {rollcalls > 0 && (
        <p className="mb-3 text-xs text-zinc-300">
          Voted in <strong className="text-zinc-100">{participated}</strong> of {rollcalls} recorded kratom roll-call{rollcalls === 1 ? "" : "s"}
          {missedVotes > 0 ? <span className="text-amber-300"> · missed {missedVotes} (absent / did not vote)</span> : null}.
        </p>
      )}
      <ul className="space-y-1.5">
        {data.votes.map((v) => {
          const absent = v.vote_value === 3 || v.vote_value === 4;
          const restrictive = (v.vote_value === 1 && v.bill.kratom_relevance === "anti") || (v.vote_value === 2 && v.bill.kratom_relevance === "pro");
          const supportive = (v.vote_value === 2 && v.bill.kratom_relevance === "anti") || (v.vote_value === 1 && v.bill.kratom_relevance === "pro");
          const tone = absent ? "bg-amber-950/50 text-amber-300" : restrictive ? "bg-red-900/60 text-red-100" : supportive ? "bg-emerald-900/60 text-emerald-100" : "bg-zinc-800 text-zinc-300";
          const label = v.vote_value === 1 ? "Yea" : v.vote_value === 2 ? "Nay" : v.vote_value === 4 ? "Absent" : v.vote_value === 3 ? "Did not vote" : (v.vote_text ?? "—");
          return (
            <li key={v.voteId} className="rounded border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-[11px]">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <a href={`/bills/${v.bill.id}`} className="font-mono font-semibold text-zinc-100 hover:text-emerald-400">{v.bill.state} {v.bill.bill_number}</a>
                {v.bill.kratom_relevance === "anti" && <span className="rounded bg-red-950/40 px-1.5 py-0.5 text-red-300">Anti</span>}
                {v.bill.kratom_relevance === "pro" && <span className="rounded bg-emerald-950/40 px-1.5 py-0.5 text-emerald-300">Pro</span>}
                {v.chamber && <span className="font-mono uppercase text-zinc-500">{v.chamber}</span>}
                {v.motion && <span className="text-zinc-400">{v.motion}</span>}
                <span className={`ml-auto rounded px-1.5 py-0.5 font-mono font-bold ${tone}`}>{label}</span>
                {v.passed === true && <span className="font-bold text-emerald-300">PASSED</span>}
                {v.passed === false && <span className="text-zinc-500">failed</span>}
                {v.vote_date && <span className="font-mono text-zinc-500">{v.vote_date}</span>}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
