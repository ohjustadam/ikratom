import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OperationResponseClient } from "./OperationResponseClient";
import { EmailOfficialButton } from "@/modules/compose/EmailOfficialButton";
import { POSTURE_STANCE } from "@/modules/compose/default-letter";
import { matchStoriesForCluster, type MatchedStory } from "@/modules/stories/match";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;
type SP = Promise<{ scope?: string }>;

export async function generateMetadata({ params }: { params: Params }) {
  const { slug } = await params;
  const sb = await createClient();
  const { data } = await sb
    .from("bill_clusters")
    .select("name, summary_md, bill_count, state_count, posture")
    .eq("slug", slug)
    .maybeSingle();
  if (!data) return { title: "Operation response" };
  const c = data as { name: string; summary_md: string | null; bill_count: number; state_count: number; posture: string };
  return {
    title: `Respond to ${c.name} — coordinated kratom-policy action`,
    description: `One-click coordinated response across ${c.bill_count} bills in ${c.state_count} states. ${c.summary_md?.slice(0, 140) ?? ""}`,
    robots: { index: false },
  };
}

/**
 * /campaigns/operation/[slug] — Operation Response MVP.
 *
 * The symmetric counter to model-legislation coordination: a single
 * page that lets advocates fire customized messages to the most-
 * relevant legislator on every active bill in a detected operation.
 *
 * Adversaries push one bill pattern across 12 states. Our response:
 * one click, N states. Each bill row is independent — user can edit
 * any message before sending; mailto: opens their mail client.
 *
 * Scope filter at top: "your state" / "top 5 most active" / "all".
 * Default for signed-in users with a profile state = "your state";
 * default for anon = "top 5".
 *
 * MVP: targets primary sponsor (the bill's author). v2 will layer in
 * committee-chair + swingable-cosponsor targeting per bill, since the
 * primary sponsor is often the least swayable.
 */
export default async function OperationResponsePage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SP;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const sb = await createClient();

  const { data: cluster } = await sb
    .from("bill_clusters")
    .select("id, slug, name, posture, summary_md, bill_count, state_count")
    .eq("slug", slug)
    .maybeSingle();
  if (!cluster) notFound();
  const c = cluster as {
    id: string; slug: string; name: string; posture: string;
    summary_md: string | null; bill_count: number; state_count: number;
  };

  // Pull active bills in this cluster + each bill's primary sponsor +
  // sponsor's contact info, in a single round trip via nested joins.
  const { data: membersRaw } = await sb
    .from("bill_cluster_members")
    .select(
      "bills!inner(id, state, bill_number, title, status, kratom_relevance, current_committee_name, active, last_action_at)",
    )
    .eq("cluster_id", c.id)
    .eq("bills.active", true);

  type BillJoined = {
    id: string; state: string; bill_number: string; title: string | null;
    status: string | null; kratom_relevance: string | null;
    current_committee_name: string | null; active: boolean;
    last_action_at: string | null;
  };
  function normalizeBill(b: BillJoined | BillJoined[] | null): BillJoined | null {
    return Array.isArray(b) ? b[0] ?? null : b;
  }
  const bills: BillJoined[] = [];
  for (const m of (membersRaw ?? []) as Array<{ bills: BillJoined | BillJoined[] | null }>) {
    const b = normalizeBill(m.bills);
    if (b) bills.push(b);
  }
  if (bills.length === 0) notFound();
  const billIds = bills.map((b) => b.id);

  // Look up the primary sponsor per bill + their contact info.
  const { data: sponsorsRaw } = await sb
    .from("bill_sponsors")
    .select("bill_id, legislator_id, classification")
    .in("bill_id", billIds)
    .eq("classification", "primary");
  const legIdsForBills = new Map<string, string>();
  for (const s of (sponsorsRaw ?? []) as Array<{
    bill_id: string; legislator_id: string | null;
  }>) {
    if (s.legislator_id && !legIdsForBills.has(s.bill_id)) {
      legIdsForBills.set(s.bill_id, s.legislator_id);
    }
  }
  const legIds = [...new Set(legIdsForBills.values())];
  type LegInfo = {
    id: string; full_name: string; state: string; role: string;
    party: string | null; email: string | null; phone: string | null;
    title: string | null;
  };
  const legById = new Map<string, LegInfo>();
  if (legIds.length > 0) {
    const { data: legs } = await sb
      .from("legislators")
      .select("id, full_name, state, role, party, email, phone, title")
      .in("id", legIds)
      .eq("active", true);
    for (const l of (legs ?? []) as LegInfo[]) legById.set(l.id, l);
  }

  // Committee-chair targeting — for each bill in committee right now,
  // find the committee chair in that state. Chairs decide whether the
  // bill ever gets scheduled for a hearing; emailing them is way
  // higher leverage than emailing rank-and-file. We do a coarse
  // substring match between bills.current_committee_name and
  // legislator_committees.committee_name (same state) where role=chair.
  type ChairTarget = {
    bill: BillJoined;
    chair_id: string;
    full_name: string;
    state: string;
    email: string | null;
    phone: string | null;
    title: string | null;
    role: string;
    committee_name: string;
  };
  const chairTargets: ChairTarget[] = [];
  const billsInCommittee = bills.filter((b) => b.current_committee_name && b.current_committee_name.trim().length > 0);
  if (billsInCommittee.length > 0) {
    const statesInCommittee = [...new Set(billsInCommittee.map((b) => b.state))];
    const { data: chairRows } = await sb
      .from("legislator_committees")
      .select("legislator_id, committee_name, role, chamber, legislators!inner(id, full_name, state, role, title, email, phone, active)")
      .eq("role", "chair")
      .in("legislators.state", statesInCommittee)
      .eq("legislators.active", true);
    type ChairJoined = {
      legislator_id: string;
      committee_name: string;
      role: string;
      chamber: string | null;
      legislators: { id: string; full_name: string; state: string; role: string; title: string | null; email: string | null; phone: string | null; active: boolean }
                | Array<{ id: string; full_name: string; state: string; role: string; title: string | null; email: string | null; phone: string | null; active: boolean }>
                | null;
    };
    // Build a map: state → list of chair rows
    const chairsByState = new Map<string, ChairJoined[]>();
    for (const cr of (chairRows ?? []) as ChairJoined[]) {
      const leg = Array.isArray(cr.legislators) ? cr.legislators[0] : cr.legislators;
      if (!leg) continue;
      if (!chairsByState.has(leg.state)) chairsByState.set(leg.state, []);
      chairsByState.get(leg.state)!.push(cr);
    }
    // For each bill in committee, find the chair whose committee_name
    // best matches the bill's current_committee_name (case-insensitive
    // substring either direction). Deduplicate so the same chair isn't
    // listed twice if they chair multiple committees.
    const seenChair = new Set<string>(); // key: bill_id::chair_id
    for (const b of billsInCommittee) {
      const cmt = (b.current_committee_name ?? "").toLowerCase().trim();
      const candidates = chairsByState.get(b.state) ?? [];
      for (const cr of candidates) {
        const crCmt = cr.committee_name.toLowerCase().trim();
        if (!crCmt) continue;
        const matches =
          cmt === crCmt ||
          cmt.includes(crCmt) ||
          crCmt.includes(cmt);
        if (!matches) continue;
        const leg = Array.isArray(cr.legislators) ? cr.legislators[0] : cr.legislators;
        if (!leg) continue;
        const key = `${b.id}::${leg.id}`;
        if (seenChair.has(key)) continue;
        seenChair.add(key);
        if (!leg.email) continue; // no email = can't action
        chairTargets.push({
          bill: b,
          chair_id: leg.id,
          full_name: leg.full_name,
          state: leg.state,
          email: leg.email,
          phone: leg.phone,
          title: leg.title,
          role: leg.role,
          committee_name: cr.committee_name,
        });
      }
    }
  }

  // Per-bill stance signal on the primary sponsor — helps the advocate
  // calibrate the message tone (e.g. hostile sponsor = firm oppose).
  const stanceByLeg = new Map<string, string>();
  if (legIds.length > 0) {
    const { data: stances } = await sb
      .from("legislator_stance")
      .select("legislator_id, stance")
      .eq("topic", "kratom")
      .in("legislator_id", legIds);
    for (const s of (stances ?? []) as Array<{ legislator_id: string; stance: string }>) {
      stanceByLeg.set(s.legislator_id, s.stance);
    }
  }

  // Viewer's profile — used to default the scope filter to their state
  // and to personalize the message template with their name.
  type ViewerProfile = { full_name: string | null; state: string | null; city: string | null; zip: string | null };
  const { data: { user } } = await sb.auth.getUser();
  let viewerProfile: ViewerProfile | null = null;
  if (user) {
    const { data } = await sb
      .from("profiles")
      .select("full_name, state, city, zip")
      .eq("id", user.id)
      .maybeSingle();
    viewerProfile = (data ?? null) as ViewerProfile | null;
  }

  // Compose action rows: one per bill, with the most-impactful target
  // already attached. Filter to bills that have a target with an email
  // (otherwise the mailto: wouldn't work and the row is dead weight).
  type ActionRow = {
    bill: BillJoined;
    target: LegInfo | null;
    stance: string;
  };
  const allRows: ActionRow[] = bills.map((b) => {
    const legId = legIdsForBills.get(b.id);
    const target = legId ? legById.get(legId) ?? null : null;
    const stance = target ? (stanceByLeg.get(target.id) ?? "unknown") : "unknown";
    return { bill: b, target, stance };
  });
  const actionable = allRows.filter((r) => r.target && r.target.email);
  const noTarget = allRows.filter((r) => !r.target || !r.target.email);

  // States ordered by action count — used for "top 5 most active" scope
  const billsByState = new Map<string, ActionRow[]>();
  for (const r of actionable) {
    if (!billsByState.has(r.bill.state)) billsByState.set(r.bill.state, []);
    billsByState.get(r.bill.state)!.push(r);
  }
  const statesOrdered = [...billsByState.entries()].sort(
    (a, b) => b[1].length - a[1].length,
  );

  // Scope filter — narrow the action set so advocates aren't overwhelmed.
  // Three modes: 'my' (default for signed-in residents) / 'top5' /
  // 'all'. Anon defaults to 'top5'.
  type Scope = "my" | "top5" | "all";
  const scopeParam = (sp.scope as Scope | undefined);
  const myState = viewerProfile?.state ?? null;
  const defaultScope: Scope = myState ? "my" : "top5";
  const scope: Scope = (scopeParam === "my" || scopeParam === "top5" || scopeParam === "all")
    ? scopeParam
    : defaultScope;

  let visibleRows: ActionRow[] = [];
  if (scope === "my" && myState) {
    visibleRows = billsByState.get(myState) ?? [];
  } else if (scope === "top5") {
    visibleRows = statesOrdered.slice(0, 5).flatMap(([, rs]) => rs);
  } else {
    visibleRows = actionable;
  }

  // Filter chairs the same way as the regular action rows
  const visibleBillIds = new Set(visibleRows.map((r) => r.bill.id));
  const visibleChairs = chairTargets.filter((ct) => visibleBillIds.has(ct.bill.id));

  // Match resonant stories from the story bank for this operation.
  // Defensive — empty if no stories yet or matcher errors.
  let matchedStories: MatchedStory[] = [];
  try {
    matchedStories = await matchStoriesForCluster(c.slug, myState, 3);
  } catch { /* defensive */ }

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="text-xs">
        <Link href={`/intel/operations/${c.slug}`} className="text-zinc-500 hover:text-emerald-400">
          ← {c.name.split("—")[0].trim()} intel
        </Link>
      </div>

      <header className="mb-6 mt-2">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">
          ◉ Operation Response
        </p>
        <h1 className="mt-2 text-3xl font-bold sm:text-4xl">
          Coordinated response: {c.name.split("—")[0].trim()}
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-zinc-300">
          Adversaries push one model bill across many states. Your response goes the other way:
          one click, every active bill in this operation, customized message to each bill&apos;s
          primary sponsor.
        </p>
        <p className="mt-2 text-[11px] text-zinc-500">
          {actionable.length} actionable target{actionable.length === 1 ? "" : "s"} across {billsByState.size} state{billsByState.size === 1 ? "" : "s"}.
          {noTarget.length > 0 && (
            <> {noTarget.length} bill{noTarget.length === 1 ? "" : "s"} have no listed sponsor email — surfaced below for awareness.</>
          )}
        </p>
      </header>

      {/* Resonant stories — auto-matched from kratom_stories by
          tag + state. Advocates can copy these into their emails.
          Real stories move legislators in a way talking points
          never will. */}
      {matchedStories.length > 0 && (
        <section className="mb-6 rounded-lg border border-violet-700/40 bg-violet-950/15 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-300">
            📖 Resonant stories · paste into your message
          </p>
          <p className="mt-1 text-[11px] text-zinc-300">
            Real stories from kratom advocates matched to this operation. Paste any of them into your
            email — legislators read constituent stories far more carefully than talking points.
          </p>
          <ul className="mt-3 space-y-2">
            {matchedStories.map((s) => (
              <li key={s.id} className="rounded-md border border-violet-700/30 bg-violet-950/10 p-3 text-[11px]">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  {s.title && <span className="font-semibold text-violet-100">{s.title}</span>}
                  <span className="text-[10px] text-zinc-500">
                    — {s.display_name ?? "Anonymous"}
                    {s.state && `, ${s.state}`}
                  </span>
                  {s.is_local && (
                    <span className="rounded bg-violet-500 px-1 py-0.5 text-[9px] font-bold uppercase text-zinc-950">
                      Local
                    </span>
                  )}
                  {s.tags.length > 0 && (
                    <span className="ml-auto text-[9px] text-zinc-500">
                      {s.tags.slice(0, 4).join(" · ")}
                    </span>
                  )}
                </div>
                <p className="mt-2 whitespace-pre-wrap text-[11px] leading-relaxed text-zinc-300">
                  {s.body.length > 600 ? `${s.body.slice(0, 600)}…` : s.body}
                </p>
                <p className="mt-2 text-[10px] text-zinc-500">
                  <Link href={`/stories/${s.id}`} className="hover:text-violet-300">Open full story →</Link>
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[10px] text-zinc-500">
            Want to share your own? <Link href="/stories/new" className="text-violet-300 hover:underline">Submit a story</Link> — approved stories become available to other advocates writing about similar bills.
          </p>
        </section>
      )}

      {/* Target the chairs — committee chairs holding cluster bills.
          Higher leverage than rank-and-file sponsors because chairs
          decide whether a bill ever gets scheduled. */}
      {visibleChairs.length > 0 && (
        <section className="mb-6 rounded-lg border-2 border-amber-700/50 bg-amber-950/15 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-300">
            🎯 High-leverage target · {visibleChairs.length} committee chair{visibleChairs.length === 1 ? "" : "s"}
          </p>
          <p className="mt-1 text-[11px] text-zinc-300">
            These legislators chair the committees currently holding bills in this operation.
            Chairs decide whether a bill gets scheduled, amended, or quietly killed in drawer — emailing
            them is typically the highest-leverage action available.
          </p>
          <ul className="mt-3 space-y-2">
            {visibleChairs.map((ct) => (
              <li key={`${ct.bill.id}::${ct.chair_id}`} className="rounded-md border border-amber-700/40 bg-amber-950/10 p-3 text-[11px]">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-950">
                    Chair
                  </span>
                  <Link href={`/legislators/${ct.chair_id}/briefing`} className="font-semibold text-amber-100 hover:underline">
                    {ct.title ? `${ct.title} ` : ""}{ct.full_name}
                  </Link>
                  <span className="font-mono text-[10px] text-zinc-500">{ct.state}</span>
                  <span className="text-[10px] text-zinc-500">
                    chairs <strong className="text-zinc-300">{ct.committee_name}</strong>
                  </span>
                </div>
                <p className="mt-1 text-[10px] text-zinc-400">
                  Holds <Link href={`/bills/${ct.bill.id}`} className="font-mono hover:text-emerald-400">{ct.bill.state} {ct.bill.bill_number}</Link>
                  {ct.bill.title && <> — {ct.bill.title.slice(0, 80)}{ct.bill.title.length > 80 ? "…" : ""}</>}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <EmailOfficialButton
                    official={{
                      id: ct.chair_id,
                      name: ct.full_name,
                      role: ct.role,
                      title: ct.title,
                      state: ct.state,
                      email: ct.email,
                    }}
                    context={{
                      kind: "bill",
                      billId: ct.bill.id,
                      stance: POSTURE_STANCE[c.posture] ?? "neutral",
                      ask:
                        c.posture === "restrictive"
                          ? `You chair the ${ct.committee_name}, which holds this bill. As chair you decide whether it moves — please decline to schedule it for a hearing, or, if it is scheduled, allow full public comment from kratom consumers, shop owners, veterans, and medical professionals before any vote.`
                          : `You chair the ${ct.committee_name}, which holds this bill. As chair you decide whether it moves — please schedule it for a hearing as soon as possible; many constituents rely on access to this substance.`,
                    }}
                    source="operation_chair"
                    label="📨 Email chair"
                    className="rounded-md bg-amber-500 px-3 py-1 text-[11px] font-semibold text-zinc-950 hover:bg-amber-400"
                  />
                  {ct.phone && (
                    <a
                      href={`tel:${ct.phone.replace(/[^0-9+]/g, "")}`}
                      className="rounded-md border border-amber-700/40 bg-zinc-950/40 px-3 py-1 text-[11px] text-amber-200 hover:bg-amber-950/30"
                    >
                      📞 {ct.phone}
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[10px] text-zinc-500">
            Chair contact templates are scoped to the chair&apos;s decision-power (scheduling), not policy
            position. Sponsor-targeted templates below — these complement, not replace, the bill-by-bill
            response.
          </p>
        </section>
      )}

      <OperationResponseClient
        cluster={{ slug: c.slug, name: c.name, posture: c.posture }}
        rows={visibleRows}
        scope={scope}
        myState={myState}
        viewerName={viewerProfile?.full_name ?? null}
        viewerCity={viewerProfile?.city ?? null}
        viewerZip={viewerProfile?.zip ?? null}
        scopeCounts={{
          my: myState ? (billsByState.get(myState)?.length ?? 0) : 0,
          top5: statesOrdered.slice(0, 5).reduce((s, [, rs]) => s + rs.length, 0),
          all: actionable.length,
        }}
      />

      {noTarget.length > 0 && (
        <section className="mt-8 rounded-md border border-zinc-800 bg-zinc-950/40 p-4 text-[11px] text-zinc-500">
          <p className="font-semibold text-zinc-300">Bills without contactable sponsor on file:</p>
          <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
            {noTarget.map((r) => (
              <li key={r.bill.id}>
                <Link href={`/bills/${r.bill.id}`} className="font-mono hover:text-emerald-400">
                  {r.bill.state} {r.bill.bill_number}
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-2 opacity-80">
            Sponsor email backfill is ongoing — these will become actionable as the legislator-sync
            cron resolves them.
          </p>
        </section>
      )}

      <footer className="mt-8 text-[10px] text-zinc-600">
        Templates are draft-only — your mail client opens each message so you can edit before
        sending. Free-tier mailto: pattern (no transactional email service). Logged-in users get
        their name + city auto-filled into the template.
      </footer>
    </div>
  );
}
