import { notFound } from "next/navigation";
import { unstable_cache } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { ROLE_LABEL } from "@/lib/legislators";
import { ShareButtons } from "@/components/ShareButtons";
import { OfficialAvatar } from "@/components/OfficialAvatar";
import { getLegislatorIntel } from "@/lib/legislator-intel";
import { EmailOfficialButton } from "@/modules/compose/EmailOfficialButton";
import { httpUrlOrNull } from "@/modules/compose/send-links";

const APP_URL = process.env.APP_URL ?? "https://www.ikratom.org";

type Legislator = {
  id: string;
  state: string;
  role: string;
  district: string | null;
  full_name: string;
  party: string | null;
  email: string | null;
  phone: string | null;
  office_address: string | null;
  website: string | null;
  level: string | null;
  locality: string | null;
  body: string | null;
  title: string | null;
  active: boolean;
  portrait_url: string | null;
};

const RELEVANCE_TAG: Record<string, { label: string; cls: string }> = {
  pro: { label: "Pro-kratom", cls: "bg-emerald-950/40 text-emerald-300" },
  anti: { label: "Anti-kratom", cls: "bg-red-950/40 text-red-300" },
  neutral: { label: "Neutral", cls: "bg-zinc-900 text-zinc-400" },
};

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("legislators")
    .select("full_name, state, role, district, party, title, portrait_url")
    .eq("id", id)
    .single();
  if (!data) return { title: "Legislator" };
  const d = data as { full_name: string; state: string; role: string; district: string | null; party: string | null; title: string | null; portrait_url: string | null };
  const roleStr = ROLE_LABEL[d.role] ?? d.role;
  const title = `${d.full_name} — ${d.state} ${roleStr}${d.district ? ` D${d.district}` : ""}`;
  const description = `Contact + kratom voting record for ${d.full_name}, ${d.state} ${roleStr}${d.party ? ` (${d.party})` : ""}. Tracked live on iKratom.`;
  const url = `${APP_URL.replace(/\/+$/, "")}/legislators/${id}`;
  const images = d.portrait_url ? [{ url: d.portrait_url, alt: d.full_name }] : undefined;
  return {
    title,
    description,
    openGraph: { type: "profile", title, description, url, siteName: "iKratom", images },
    twitter: { card: "summary", title, description, images },
    alternates: { canonical: url },
  };
}

/**
 * Public read-set for one legislator, cached per id.
 *
 * WHY (2026-08-30 credit burn): this page ran ~11 live DB queries on EVERY
 * request across 1,001 sitemap URLs. On Netlify's credit-free tier each of
 * those crawler hits is billed twice — web requests AND compute — and both are
 * meters the API does not expose, so they silently consumed ~57% of the month's
 * credits while our own estimator reported 32%.
 *
 * SCOPE IS DELIBERATELY NARROW. service-role bypasses RLS, so only tables
 * verified to have anon/service PARITY are in here:
 *   legislators        9332 = 9332
 *   bill_vote_members 13222 = 13222
 *   campaigns          228 = 228 — ONLY with .eq("active", true), which is
 *                      exactly what RLS exposes (service-role sees 2810 rows
 *                      total: drafts, pending_review, superseded). Dropping
 *                      that filter would publish 2,582 unpublished campaigns.
 *
 * NOT in here, on purpose: getLegislatorIntel(). It reads `legislator_stance`,
 * where anon sees 0 rows and service-role sees 4,329 — those stances are held
 * from the public deliberately, and auto-publishing AI-written stances about
 * named legislators is a standing prohibition. It keeps the RLS-enforced,
 * cookie-bound client. Do NOT "optimise" it in here.
 */
const getLegislatorPublicSnapshot = unstable_cache(
  async (id: string) => {
    const sb = createServiceRoleClient();
    const { data: legRaw } = await sb
      .from("legislators")
      .select("id, state, role, district, full_name, party, email, phone, office_address, website, level, locality, body, title, active, portrait_url")
      .eq("id", id)
      .single();
    if (!legRaw) return null;
    const leg = legRaw as unknown as Legislator;

    const [{ data: explicitCampaigns }, { data: roleCampaigns }, { data: voteRowsRaw }] = await Promise.all([
      sb.from("campaigns").select("id, slug, title, state, blurb").eq("active", true).contains("target_legislator_ids", [id]),
      sb.from("campaigns").select("id, slug, title, state, blurb").eq("active", true).eq("state", leg.state).contains("target_roles", [leg.role]),
      sb.from("bill_vote_members")
        .select("vote_text, vote_value, bill_votes!inner(id, vote_date, chamber, motion, passed, bills!inner(id, state, bill_number, title, kratom_relevance))")
        .eq("legislator_id", id)
        .limit(500),
    ]);
    return { leg, explicitCampaigns, roleCampaigns, voteRowsRaw };
  },
  ["legislator-public"],
  { revalidate: 900, tags: ["legislator-detail"] },
);

export default async function LegislatorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  // Public, viewer-identical data — served from the per-id cache above.
  const snap = await getLegislatorPublicSnapshot(id);
  if (!snap) notFound();
  const { leg, explicitCampaigns, roleCampaigns, voteRowsRaw } = snap;

  // One consolidated intel pull — stance, sponsorships, committees, donor,
  // kratom-adjacent trades + the computed verdict (threat tier · pressure
  // index · follow-the-money). Single source of truth shared with the intel
  // briefing memo (src/lib/legislator-intel.ts), so the two surfaces can
  // never drift.
  const intel = await getLegislatorIntel(supabase, leg);
  const { verdict, donor: donorProfile, summary, currentlyDeciding, sponsorships: sponsored } = intel;
  const { threat, pressureIndex, moneyConflict } = verdict;

  // Campaigns targeting this legislator come from the cached snapshot above.

  const targetingCampaigns = new Map<string, { id: string; slug: string; title: string; state: string | null; blurb: string | null }>();
  for (const c of [...(explicitCampaigns ?? []), ...(roleCampaigns ?? [])] as Array<{ id: string; slug: string; title: string; state: string | null; blurb: string | null }>) {
    targetingCampaigns.set(c.id, c);
  }

  // Voting record — roll-call votes now attributable via the P1 legiscan_people_id backfill
  const { data: { user } } = await supabase.auth.getUser();
  const signedIn = !!user;
  type VBill = { id: string; state: string; bill_number: string; title: string | null; kratom_relevance: string | null };
  type RawBV = { id: string; vote_date: string | null; chamber: string | null; motion: string | null; passed: boolean | null; bills: VBill[] | VBill | null };
  type RawVoteRow = { vote_text: string | null; vote_value: number | null; bill_votes: RawBV[] | RawBV | null };
  // Roll-call votes also come from the cached snapshot above.
  type VoteRow = { voteId: string; chamber: string | null; motion: string | null; passed: boolean | null; vote_date: string | null; vote_value: number | null; vote_text: string | null; bill: VBill };
  const votes: VoteRow[] = [];
  for (const r of ((voteRowsRaw ?? []) as unknown as RawVoteRow[])) {
    const bv = Array.isArray(r.bill_votes) ? r.bill_votes[0] : r.bill_votes;
    if (!bv) continue;
    const b = Array.isArray(bv.bills) ? bv.bills[0] : bv.bills;
    if (!b) continue;
    votes.push({ voteId: bv.id, chamber: bv.chamber, motion: bv.motion, passed: bv.passed, vote_date: bv.vote_date, vote_value: r.vote_value, vote_text: r.vote_text, bill: b });
  }
  votes.sort((a, z) => (z.vote_date ?? "").localeCompare(a.vote_date ?? ""));
  let restrictCount = 0;
  for (const v of votes) {
    if ((v.vote_value === 1 && v.bill.kratom_relevance === "anti") || (v.vote_value === 2 && v.bill.kratom_relevance === "pro")) restrictCount++;
  }
  // Attendance / participation. Honest by construction: each row is a roll-call
  // this legislator was a recorded member of, so tenure is handled implicitly
  // (no pre-/post-term roll-calls counted). LegiScan vote codes: 1=Yea, 2=Nay,
  // 3=Not Voting, 4=Absent. Only counts kratom roll-calls (the only ones synced).
  let participated = 0, missedVotes = 0;
  for (const v of votes) {
    if (v.vote_value === 1 || v.vote_value === 2) participated++;
    else if (v.vote_value === 3 || v.vote_value === 4) missedVotes++;
  }
  const rollcalls = participated + missedVotes;

  const roleLabel = ROLE_LABEL[leg.role] ?? leg.role;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <a href={`/legislators?state=${leg.state}`} className="text-xs text-zinc-500 hover:text-emerald-400">
        ← {leg.state} legislators
      </a>

      <header className="mt-3 mb-6">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded bg-zinc-900 px-2 py-1 font-mono text-zinc-300">{leg.state}</span>
          <span className="rounded bg-zinc-900 px-2 py-1 text-zinc-300">{roleLabel}</span>
          {leg.district && (
            <span className="rounded bg-zinc-900 px-2 py-1 text-zinc-400">District {leg.district}</span>
          )}
          {leg.party && <span className="text-zinc-500">({leg.party})</span>}
          {leg.locality && (
            <span className="rounded bg-zinc-900 px-2 py-1 text-zinc-300">📍 {leg.locality}</span>
          )}
          {!leg.active && (
            <span className="rounded bg-amber-950/40 px-2 py-1 text-amber-300">No longer in office</span>
          )}
        </div>
        <div className="mt-3 flex items-center gap-4">
          <OfficialAvatar name={leg.full_name} portraitUrl={leg.portrait_url} size="lg" />
          <div className="min-w-0">
            <h1 className="text-3xl font-bold sm:text-4xl">{leg.full_name}</h1>
            {leg.title && <p className="mt-1 text-sm text-zinc-400">{leg.title}</p>}
          </div>
        </div>
        <div className="mt-3">
          <a
            href={`/legislators/${leg.id}/briefing`}
            className="inline-flex items-center gap-2 rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-400"
            data-event="open_legislator_briefing"
          >
            ◉ Open intel briefing →
          </a>
          <span className="ml-2 text-[10px] text-zinc-500">
            Stance + leverage signals + action plan for contacting this person
          </span>
        </div>
      </header>

      {/* Intel verdict — the dossier read at a glance (full memo at /briefing) */}
      <section className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">Intel verdict</h2>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${threat.tier_color}`} title={threat.rationale}>
            {threat.tier_emoji} {threat.tier_label}
            <span className="ml-1 font-mono text-[9px] opacity-75">T{threat.threat_score}·V{threat.vulnerability_score}</span>
          </span>
          {signedIn ? (
            <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-300">
              🎯 Pressure {pressureIndex}
            </span>
          ) : (
            <a href={`/login?redirect=/legislators/${leg.id}`} className="rounded-full border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-400 hover:border-emerald-500">
              🎯 Pressure index — sign in (free)
            </a>
          )}
        </div>
        <p className="mt-2 text-xs text-zinc-400">{threat.rationale}</p>
        {moneyConflict && (
          <div className={`mt-3 rounded-md border-l-2 p-3 ${
            moneyConflict.level === "aligned" ? "border-red-500 bg-red-950/15" :
            moneyConflict.level === "ally" ? "border-emerald-600 bg-emerald-950/15" :
            moneyConflict.level === "watch" ? "border-amber-500 bg-amber-950/10" :
            "border-zinc-700 bg-zinc-950/40"
          }`}>
            <p className="text-xs font-semibold text-zinc-100">💰 {moneyConflict.headline}</p>
            <p className="mt-1 text-xs leading-relaxed text-zinc-300">{moneyConflict.narrative}</p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-400"><span className="font-semibold text-zinc-300">Why it matters: </span>{moneyConflict.whyItMatters}</p>
          </div>
        )}
      </section>

      {/* Contact */}
      <section className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">Contact</h2>
        <ul className="space-y-2 text-sm">
          {(leg.email || leg.website) && (
            <li>
              <EmailOfficialButton
                official={{ id: leg.id, name: leg.full_name, role: leg.role, title: leg.title, state: leg.state, email: leg.email, website: leg.website }}
                context={{ kind: "legislator" }}
                source="legislator_profile"
                variant="button"
              />
            </li>
          )}
          {leg.phone && (
            <li>
              <span className="text-zinc-500">Phone: </span>
              <a href={`tel:${leg.phone}`} className="text-amber-300 hover:text-amber-200">{leg.phone}</a>
              <span className="ml-3 text-xs text-zinc-500">(Phone calls weigh more than emails — call them.)</span>
            </li>
          )}
          {leg.office_address && (
            <li>
              <span className="text-zinc-500">Office: </span>
              <span className="text-zinc-200">{leg.office_address}</span>
            </li>
          )}
          {httpUrlOrNull(leg.website) && (
            <li>
              <a href={httpUrlOrNull(leg.website)!} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">
                Official website ↗
              </a>
            </li>
          )}
          {!leg.email && !leg.phone && !leg.website && (
            <li className="text-zinc-500">No public contact info on file. Try the official chamber directory.</li>
          )}
        </ul>
      </section>

      {/* Kratom record summary */}
      {summary.total > 0 && (
        <section className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Kratom record
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat value={summary.total} label="Bills sponsored" />
            <Stat value={summary.anti} label="Anti-kratom" warn={summary.anti > 0} />
            <Stat value={summary.pro} label="Pro-kratom" accent={summary.pro > 0} />
            <Stat value={summary.leafTargeting} label="Restrict natural leaf" warn={summary.leafTargeting > 0} />
          </div>
          {summary.anti > 0 && (
            <p className="mt-3 text-xs text-amber-200">
              ⚠ This legislator has sponsored {summary.anti} anti-kratom bill{summary.anti === 1 ? "" : "s"}.
              When you contact them, lead with your story.
            </p>
          )}
          {summary.pro > 0 && summary.anti === 0 && (
            <p className="mt-3 text-xs text-emerald-300">
              ✓ This legislator has sponsored pro-kratom legislation. Thank-you emails matter — they keep allies engaged.
            </p>
          )}
        </section>
      )}

      {/* Currently deciding — bills in committees this legislator sits on
          right now. Renders silently when there are no matches (most
          common case for non-committee-seat legislators). */}
      {currentlyDeciding.length > 0 && (
        <section className="mb-6 rounded-lg border-2 border-emerald-500 bg-emerald-950/15 p-5 shadow-[0_0_24px_-8px_rgba(16,185,129,0.5)]">
          <div className="mb-3 flex items-center gap-2">
            <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-950">
              ⚡ Currently deciding
            </span>
            <h2 className="text-sm font-bold uppercase tracking-wider text-emerald-300">
              Bills in committees {leg.full_name} sits on
            </h2>
          </div>
          <p className="text-xs text-zinc-400">
            {currentlyDeciding.length} active bill{currentlyDeciding.length === 1 ? "" : "s"} in committees where this legislator currently serves. These are the bills where their vote directly determines the outcome.
          </p>
          <ul className="mt-3 space-y-2">
            {currentlyDeciding.map((d) => {
              const isAnti = d.kratom_relevance === "anti";
              const isPro = d.kratom_relevance === "pro";
              const roleLabel =
                d.role === "chair" ? "Chair" :
                d.role === "vice_chair" ? "Vice chair" :
                d.role === "ranking_member" ? "Ranking member" :
                "Member";
              return (
                <li key={d.bill_id}>
                  <a
                    href={`/bills/${d.bill_id}`}
                    className="block rounded-md border border-emerald-700/40 bg-emerald-950/10 p-3 transition hover:border-emerald-500 hover:bg-emerald-950/25"
                  >
                    <div className="flex flex-wrap items-baseline gap-2 text-[11px]">
                      <span className="font-mono font-semibold text-zinc-200">
                        {d.state} · {d.bill_number}
                      </span>
                      {isAnti && (
                        <span className="rounded bg-red-950/40 px-1.5 py-0.5 text-red-300">
                          Anti
                        </span>
                      )}
                      {isPro && (
                        <span className="rounded bg-emerald-950/40 px-1.5 py-0.5 text-emerald-300">
                          Pro
                        </span>
                      )}
                      <span className="text-zinc-500">·</span>
                      <span className="text-zinc-400">
                        {d.committee_name} <span className="text-zinc-600">({roleLabel})</span>
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-snug text-zinc-100">
                      {d.title?.slice(0, 110) ?? "(untitled)"}{d.title && d.title.length > 110 ? "…" : ""}
                    </p>
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Sponsored bills */}
      {sponsored.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Sponsored kratom bills ({sponsored.length})
          </h2>
          <ul className="space-y-2">
            {sponsored.map((s, i) => {
              const tag = RELEVANCE_TAG[s.kratom_relevance ?? "neutral"] ?? RELEVANCE_TAG.neutral;
              return (
                <li
                  key={`${s.bill_id}-${i}`}
                  className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4"
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-zinc-300">
                      {s.state} · {s.bill_number}
                    </span>
                    <span className={`rounded px-1.5 py-0.5 font-semibold ${tag.cls}`}>{tag.label}</span>
                    {s.targets_natural_leaf === true && (
                      <span className="rounded bg-red-950/40 px-1.5 py-0.5 text-red-300">🚨 leaf</span>
                    )}
                    <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-zinc-500 capitalize">
                      {s.classification}
                    </span>
                    {s.last_action_at && (
                      <span className="ml-auto text-zinc-500">
                        {new Date(s.last_action_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  <h3 className="mt-2 text-sm font-medium leading-snug">
                    <a href={`/bills/${s.bill_id}`} className="hover:text-emerald-400">
                      {s.title || "(untitled)"}
                    </a>
                  </h3>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Voting record — roll-call votes (post-P1 vote-linkage) */}
      {votes.length > 0 && (
        <section className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
          <div className="mb-3 flex flex-wrap items-baseline gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">Voting record ({votes.length})</h2>
            <span className="text-[10px] uppercase tracking-wider text-zinc-600">a vote is a fact</span>
          </div>
          {!signedIn ? (
            <p className="text-xs text-zinc-400">
              {leg.full_name} voted in {participated} of {rollcalls} recorded kratom roll-call{rollcalls === 1 ? "" : "s"}
              {missedVotes > 0 ? <> · missed {missedVotes}</> : null}
              {restrictCount > 0 ? <> · voted to restrict kratom {restrictCount}×</> : null}.{" "}
              <a href="/signup" className="text-emerald-400 hover:underline">Create a free account</a> to see how they voted on each bill.
            </p>
          ) : (
            <>
            {rollcalls > 0 && (
              <p className="mb-3 text-xs text-zinc-300">
                Voted in <strong className="text-zinc-100">{participated}</strong> of {rollcalls} recorded kratom roll-call{rollcalls === 1 ? "" : "s"}
                {missedVotes > 0 ? <span className="text-amber-300"> · missed {missedVotes} (absent / did not vote)</span> : null}.
              </p>
            )}
            <ul className="space-y-1.5">
              {votes.map((v) => {
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
          )}
        </section>
      )}

      {/* Donor profile (federal only) */}
      {donorProfile && donorProfile.resolved_status === "matched" && donorProfile.total_receipts && donorProfile.total_receipts > 0 && (
        <section className="mb-6 rounded-lg border border-amber-700/40 bg-amber-950/10 p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-amber-300">
              💰 Donor profile — {donorProfile.cycle} cycle
            </h2>
            <span className="text-[10px] text-zinc-500">
              public data via OpenFEC · synced {donorProfile.synced_at ? new Date(donorProfile.synced_at).toLocaleDateString() : "?"}
            </span>
          </div>
          <p className="mt-2 text-2xl font-bold text-zinc-100">
            ${(donorProfile.total_receipts / 1_000_000).toFixed(2)}M total receipts
          </p>

          {donorProfile.kratom_relevant && (
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
              {[
                { key: "pharma", label: "💊 Pharma", color: "text-red-300" },
                { key: "tobacco", label: "🚬 Tobacco", color: "text-red-300" },
                { key: "alcohol", label: "🍷 Alcohol", color: "text-amber-300" },
                { key: "retail", label: "🛒 Retail", color: "text-zinc-300" },
                { key: "hospital_health", label: "🏥 Hospital/Health", color: "text-zinc-300" },
              ].map((b) => {
                const amount = donorProfile.kratom_relevant?.[b.key as keyof typeof donorProfile.kratom_relevant] ?? 0;
                if (!amount || amount <= 0) return null;
                const total = donorProfile.kratom_relevant?.total ?? donorProfile.total_receipts ?? 0;
                const share = total > 0 ? (amount / total * 100).toFixed(1) : "?";
                return (
                  <div key={b.key} className="rounded border border-zinc-800 bg-zinc-950/60 p-2">
                    <div className={`text-[10px] font-bold uppercase ${b.color}`}>{b.label}</div>
                    <div className="mt-1 font-mono text-sm font-bold text-zinc-100">
                      ${(amount / 1000).toFixed(0)}k
                    </div>
                    <div className="text-[10px] text-zinc-500">{share}% of receipts</div>
                  </div>
                );
              })}
            </div>
          )}

          {(donorProfile.top_industries?.length ?? 0) > 0 && (
            <details className="mt-3 rounded border border-zinc-800 bg-zinc-950/60 p-3">
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Top {Math.min(donorProfile.top_industries!.length, 10)} industries by contribution
              </summary>
              <ol className="mt-2 space-y-1 text-xs">
                {donorProfile.top_industries!.slice(0, 10).map((i, idx) => (
                  <li key={idx} className="flex items-baseline gap-2 border-b border-zinc-900 py-1 last:border-b-0">
                    <span className="font-mono text-zinc-600">{idx + 1}.</span>
                    <span className="flex-1 text-zinc-300">{i.industry}</span>
                    <span className="font-mono text-zinc-400">${(i.amount / 1000).toFixed(0)}k</span>
                  </li>
                ))}
              </ol>
            </details>
          )}

          <p className="mt-3 text-[11px] text-zinc-500">
            Public campaign-finance data. Useful narrative for legislator emails — &ldquo;You took $X from
            industries that profit when kratom is banned. Please vote on the merits, not on donor
            interest.&rdquo;
          </p>
        </section>
      )}

      {/* Targeting campaigns */}
      {targetingCampaigns.size > 0 && (
        <section className="mb-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Active campaigns targeting them
          </h2>
          <ul className="space-y-2">
            {Array.from(targetingCampaigns.values()).map((c) => (
              <li
                key={c.id}
                className="rounded-lg border border-emerald-700/40 bg-emerald-950/20 p-4"
              >
                <a href={`/campaigns/${c.slug}`} className="block">
                  <p className="text-sm font-semibold text-emerald-300">{c.title}</p>
                  {c.blurb && <p className="mt-1 text-xs text-zinc-300">{c.blurb}</p>}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Share */}
      <section className="mt-8 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Share this profile
        </p>
        <p className="mt-1 text-sm text-zinc-400">
          Tag your network — point constituents at their actual rep.
        </p>
        <div className="mt-3">
          <ShareButtons
            url={`${APP_URL}/legislators/${leg.id}`}
            title={`${leg.full_name} — ${leg.state} ${roleLabel} on kratom`}
            text={`Kratom record for ${leg.full_name}: ${summary.anti} anti-kratom bill${summary.anti === 1 ? "" : "s"} sponsored.`}
            target={{ kind: "campaign", campaignId: Array.from(targetingCampaigns.values())[0]?.id ?? leg.id }}
          />
        </div>
      </section>
    </div>
  );
}

function Stat({ value, label, accent, warn }: { value: number; label: string; accent?: boolean; warn?: boolean }) {
  const cls = accent
    ? "border-emerald-700/50 bg-emerald-950/20"
    : warn
    ? "border-red-900/40 bg-red-950/20"
    : "border-zinc-800 bg-zinc-950/40";
  const valueCls = accent ? "text-emerald-300" : warn ? "text-red-300" : "text-zinc-100";
  return (
    <div className={`rounded-lg border p-3 text-center ${cls}`}>
      <div className={`text-2xl font-bold tabular-nums ${valueCls}`}>{value.toLocaleString()}</div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
    </div>
  );
}
