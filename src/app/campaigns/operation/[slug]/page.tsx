import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OperationResponseClient } from "./OperationResponseClient";

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

  // Per-bill stance signal on the primary sponsor — helps the advocate
  // calibrate the message tone (e.g. hostile sponsor = firm oppose).
  const stanceByLeg = new Map<string, string>();
  if (legIds.length > 0) {
    const { data: stances } = await sb
      .from("legislator_kratom_stance")
      .select("legislator_id, stance")
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
