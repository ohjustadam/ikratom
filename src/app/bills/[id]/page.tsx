import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageShareWithAttribution } from "@/components/PageShareWithAttribution";
import { RemindMeButton } from "@/components/RemindMeButton";
import { SignUpNudge } from "@/components/SignUpNudge";
import { EnablePushNudge } from "@/components/EnablePushNudge";
import { BillTimeline } from "./BillTimeline";
import { YourRepDecidingThisBill } from "./YourRepDecidingThisBill";
import { displayTitle, displaySubtitle } from "@/lib/bill-title";
import { fetchOpenStatesBillDetail } from "@/lib/openstates-bill";
import { getTranslation } from "@/lib/translations";
import { readLocale } from "@/modules/auth/actions-locale";
import { BillFullText } from "./BillFullText";
import { BillLocalActionCard, type LocalMeta, type LocalOfficial } from "./BillLocalActionCard";
import { findSimilarBills } from "@/lib/bill-similarity";
import { IntelTipForm } from "./IntelTipForm";
import { Markdown } from "@/components/Markdown";

// Force dynamic so a bill that just synced doesn't get cached for hours
export const dynamic = "force-dynamic";

type BillRow = {
  id: string;
  state: string;
  bill_number: string;
  title: string | null;
  summary: string | null;
  summary_ai: string | null;
  advocacy_callout: string | null;
  status: string | null;
  kratom_relevance: string | null;
  relevance_confidence: number | null;
  last_action: string | null;
  last_action_at: string | null;
  source_url: string | null;
  official_url: string | null;
  session_id: string | null;
  scope: string | null;
  locality: string | null;
  enriched_at: string | null;
  last_synced_at: string | null;
  journey_narrative: string | null;
  amendments_count: number | null;
  journey_analyzed_at: string | null;
  substance_targeting: SubstanceTargeting | null;
  substance_targeting_analyzed_at: string | null;
  summary_long: string | null;
  bill_text_versions: Array<{ label: string; date: string | null; text: string; source_url: string }> | null;
  text_synced_at: string | null;
  local_meta: LocalMeta | null;
  local_meta_extracted_at: string | null;
  opposition_summary_md: string | null;
  repeal_plan_md: string | null;
};

type Stance = "bans" | "restricts" | "schedules" | "preserves" | "neutral" | "unaddressed";
type SubstanceEntry = {
  stance: Stance;
  scope: string | null;
  schedule: string | null;
  confidence: number;
  notes: string;
};
type SubstanceTargeting = {
  natural_leaf: SubstanceEntry;
  mitragynine: SubstanceEntry;
  seven_oh: SubstanceEntry;
  pseudoindoxyl: SubstanceEntry;
  synthetic: SubstanceEntry;
};

const SUBSTANCE_LABEL: Record<keyof SubstanceTargeting, { name: string; abbrev?: string; tooltip: string }> = {
  natural_leaf: { name: "Natural leaf", tooltip: "Whole-leaf or traditional preparation (heating, water/ethanol extraction)" },
  mitragynine: { name: "Mitragynine", abbrev: "MGM", tooltip: "Dominant natural alkaloid (~1-2% of leaf weight)" },
  seven_oh: { name: "7-OH", tooltip: "7-hydroxymitragynine — natural trace alkaloid (~0.04% in fresh leaf)" },
  pseudoindoxyl: { name: "Pseudoindoxyl", abbrev: "Pseudo", tooltip: "Mitragynine pseudoindoxyl — oxidation metabolite, often semi-synthetic" },
  synthetic: { name: "Synthetic", tooltip: "Lab-synthesized or biosynthesized alkaloids (recombinant, fermentation, etc.)" },
};

const STANCE_STYLE: Record<Stance, { label: string; cls: string; emoji: string }> = {
  bans:        { label: "Bans",        cls: "border-red-700/50 bg-red-950/30 text-red-300",         emoji: "🚫" },
  restricts:   { label: "Restricts",   cls: "border-amber-700/50 bg-amber-950/30 text-amber-300",   emoji: "⚠" },
  schedules:   { label: "Schedules",   cls: "border-red-700/50 bg-red-950/30 text-red-300",         emoji: "🚫" },
  preserves:   { label: "Preserves",   cls: "border-emerald-700/50 bg-emerald-950/30 text-emerald-300", emoji: "✓" },
  neutral:     { label: "Neutral",     cls: "border-zinc-700 bg-zinc-950/40 text-zinc-400",         emoji: "·" },
  unaddressed: { label: "Unaddressed", cls: "border-zinc-800 bg-zinc-950/20 text-zinc-500",         emoji: "—" },
};

const STATUS_LABEL: Record<string, string> = {
  introduced: "Introduced",
  committee: "In committee",
  passed_chamber: "Passed chamber",
  enacted: "Enacted",
  dead: "Dead",
};

const RELEVANCE_STYLE: Record<string, { label: string; cls: string }> = {
  pro: { label: "Pro-kratom", cls: "bg-emerald-950/40 text-emerald-300 border-emerald-700/40" },
  anti: { label: "Anti-kratom", cls: "bg-red-950/40 text-red-300 border-red-700/40" },
  neutral: { label: "Neutral", cls: "bg-zinc-900 text-zinc-400 border-zinc-700" },
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("bills")
    .select("state, bill_number, title, summary_ai, summary, kratom_relevance, status")
    .eq("id", id)
    .single();

  if (!data) return { title: "Bill" };
  const stance = data.kratom_relevance === "anti"
    ? "kratom-hostile" : data.kratom_relevance === "pro" ? "kratom-supportive" : "kratom-neutral";
  const title = `${data.state} ${data.bill_number} — ${data.title?.slice(0, 80) ?? ""}`;
  const description = (data.summary_ai ?? data.summary ?? "").slice(0, 200) ||
    `${data.state} bill ${data.bill_number}, ${stance}. Status: ${data.status ?? "tracking"}. Tracked live on iKratom.`;
  const url = `${(process.env.APP_URL ?? "https://www.ikratom.org").replace(/\/+$/, "")}/bills/${id}`;

  return {
    title,
    description,
    openGraph: {
      type: "article",
      title,
      description,
      url,
      siteName: "iKratom",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
    alternates: { canonical: url },
  };
}

export default async function BillDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: billRaw } = await supabase
    .from("bills")
    .select(
      "id, state, bill_number, title, summary, summary_ai, advocacy_callout, " +
      "status, kratom_relevance, relevance_confidence, last_action, last_action_at, " +
      "source_url, official_url, session_id, scope, locality, " +
      "enriched_at, last_synced_at, " +
      "journey_narrative, amendments_count, journey_analyzed_at, " +
      "substance_targeting, substance_targeting_analyzed_at, " +
      "summary_long, bill_text_versions, text_synced_at, " +
      "local_meta, local_meta_extracted_at, " +
      "opposition_summary_md, repeal_plan_md",
    )
    .eq("id", id)
    .single();

  if (!billRaw) notFound();
  const bill = billRaw as unknown as BillRow;

  // Separate fetch for the current_committee_* columns. Done as a
  // discrete query so the page degrades gracefully on environments
  // where migration 0123 hasn't been applied yet (e.g. preview
  // branches built before db:push runs). On failure these stay null
  // and the YourRepDecidingThisBill component silently renders nothing.
  let currentCommitteeName: string | null = null;
  try {
    const { data: extra } = await supabase
      .from("bills")
      .select("current_committee_name")
      .eq("id", id)
      .single();
    if (extra && typeof (extra as { current_committee_name?: unknown }).current_committee_name === "string") {
      currentCommitteeName = (extra as { current_committee_name: string }).current_committee_name;
    }
  } catch {
    // Column doesn't exist yet — silent no-op.
  }

  // Bill stakeholders — people of interest beyond gov officials.
  // Editorial-curated allies, experts, journalists, opponents,
  // affected business owners. Defensive so pre-migration falls
  // through to empty.
  type StakeholderRow = {
    id: string;
    name: string;
    title: string | null;
    organization: string | null;
    role_type: string;
    reasoning: string;
    email: string | null;
    phone: string | null;
    website: string | null;
    twitter_handle: string | null;
    linkedin_url: string | null;
  };
  let stakeholders: StakeholderRow[] = [];
  try {
    const { data } = await supabase
      .from("bill_stakeholders")
      .select("id, name, title, organization, role_type, reasoning, email, phone, website, twitter_handle, linkedin_url")
      .eq("bill_id", id)
      .order("role_type", { ascending: true });
    stakeholders = (data ?? []) as StakeholderRow[];
  } catch {
    // Pre-migration deploy — silent.
  }

  // Phase 3 D6: cross-state bill similarity. Pulls every embedded
  // active bill, computes cosine similarity in-process, returns top
  // N from OTHER states. Wrapped defensively so a pre-migration
  // deploy (before 0131) or a row without an embedding falls back
  // to empty without breaking the page.
  let similarBills: Awaited<ReturnType<typeof findSimilarBills>> = [];
  try {
    // 0.6 floor is empirically tuned: a KCPA-named bill in SC matches
    // its peers in MO/IL/KS/NE at 62-69%. Going to 0.7 misses real
    // matches; going below 0.55 starts surfacing unrelated kratom bills.
    similarBills = await findSimilarBills(supabase, id, { limit: 5, minSimilarity: 0.6 });
  } catch {
    // Pre-migration deploy or query error — silent fallback.
  }

  // Linked campaigns (auto-generated or hand-written for this bill)
  const { data: campaignsRaw } = await supabase
    .from("campaigns")
    .select("id, slug, title, active, auto_generated, created_at")
    .eq("bill_id", bill.id)
    .order("created_at", { ascending: false });
  const campaigns = (campaignsRaw ?? []) as Array<{
    id: string;
    slug: string;
    title: string;
    active: boolean;
    auto_generated: boolean;
    created_at: string;
  }>;

  // For municipal/county bills: fetch the full slate of local officials
  // for this locality from the legislators table. Each renders as a row
  // in BillLocalActionCard with mailto:/tel:/website buttons. Adds the
  // entire council, not just the 1-2 names the article called out by
  // name (those come through local_meta.officials_to_contact and get
  // merged in the card without dupes).
  const isLocalScope = bill.scope === "municipal" || bill.scope === "county";
  let localOfficials: LocalOfficial[] = [];
  if (isLocalScope && bill.locality) {
    const { data: legs } = await supabase
      .from("legislators")
      .select("id, full_name, role, title, district, party, email, phone, website")
      .eq("state", bill.state)
      .eq("locality", bill.locality)
      .in("role", ["city_council", "mayor", "county_executive", "county_commissioner"])
      .eq("active", true)
      .order("role", { ascending: true });
    localOfficials = (legs ?? []) as LocalOfficial[];
  }

  // Find the alert linked to this bill so we can pass its source URL
  // to the card as a "look up contact" fallback when officials lack
  // direct email/phone in our DB.
  let alertSourceUrl: string | null = null;
  if (isLocalScope) {
    const { data: alerts } = await supabase
      .from("policy_alerts")
      .select("source_url")
      .eq("bill_id", bill.id)
      .order("created_at", { ascending: false })
      .limit(1);
    alertSourceUrl = alerts?.[0]?.source_url ?? null;
  }

  // Determine if the calling user is signed in + already subscribed to
  // this bill, so the "🔔 Notify me" button renders in the right state.
  const { data: { user: viewer } } = await supabase.auth.getUser();
  const viewerSignedIn = !!viewer;
  let initiallySubscribed = false;
  if (viewer) {
    const { data: sub } = await supabase
      .from("bill_subscriptions")
      .select("user_id")
      .eq("user_id", viewer.id)
      .eq("bill_id", bill.id)
      .maybeSingle();
    initiallySubscribed = !!sub;
  }

  // Action count across all campaigns for this bill
  const { count: totalActions } = campaigns.length > 0
    ? await supabase
        .from("campaign_actions")
        .select("id", { count: "exact", head: true })
        .in("campaign_id", campaigns.map((c) => c.id))
    : { count: 0 };

  // Live fetch from OpenStates — cached 1 hour. Returns null on quota /
  // network error and we fall back to DB-only fields. Skip for non-state
  // scopes (OpenStates doesn't cover county/municipal).
  const isLocal = bill.scope === "county" || bill.scope === "municipal";
  const detail = isLocal
    ? null
    : await fetchOpenStatesBillDetail(bill.state, bill.bill_number);

  // Sponsors (synced into bill_sponsors). Linked to legislator detail when
  // we matched their full_name during sync; otherwise just shown as a name.
  const { data: sponsorsRaw } = await supabase
    .from("bill_sponsors")
    .select("legislator_id, name, classification, party, district")
    .eq("bill_id", bill.id)
    .order("classification", { ascending: true });
  const sponsors = (sponsorsRaw ?? []) as Array<{
    legislator_id: string | null;
    name: string;
    classification: string;
    party: string | null;
    district: string | null;
  }>;

  // Staleness assessment
  const lastActionMs = bill.last_action_at ? new Date(bill.last_action_at).getTime() : null;
  const daysSinceAction = lastActionMs
    ? Math.floor((Date.now() - lastActionMs) / 86400_000)
    : null;
  const isStale = daysSinceAction != null && daysSinceAction > 365;

  const relevance = RELEVANCE_STYLE[bill.kratom_relevance ?? "neutral"] ?? RELEVANCE_STYLE.neutral;
  const status = bill.status ? (STATUS_LABEL[bill.status] ?? bill.status) : null;

  // Similar bills: same stance + active + within last 365 days, excluding
  // this bill. Surfaces "this anti-kratom bill is moving in 4 states this
  // session" insight.
  const since = new Date(Date.now() - 365 * 86400_000).toISOString().slice(0, 10);
  const { data: similarRaw } = bill.kratom_relevance
    ? await supabase
        .from("bills")
        .select("id, state, bill_number, title, status, last_action_at, scope")
        .eq("kratom_relevance", bill.kratom_relevance)
        .eq("active", true)
        .neq("id", bill.id)
        .gte("last_action_at", since)
        .order("last_action_at", { ascending: false })
        .limit(8)
    : { data: [] };
  const similar = (similarRaw ?? []) as Array<{
    id: string; state: string; bill_number: string; title: string | null;
    status: string | null; last_action_at: string | null; scope: string | null;
  }>;

  // schema.org Legislation — when AI agents answer 'what's NY S 1234?',
  // this gives them a structured record (jurisdiction, status, last
  // action, dates) to cite rather than paraphrasing the page text.
  const SITE = process.env.NEXT_PUBLIC_APP_URL || "https://www.ikratom.org";
  const stanceLabel = bill.kratom_relevance === "anti"
    ? "Restrictive"
    : bill.kratom_relevance === "pro"
    ? "Supportive"
    : "Neutral";
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Legislation",
    "@id": `${SITE}/bills/${bill.id}`,
    name: `${bill.state} ${bill.bill_number}`,
    legislationIdentifier: `${bill.state} ${bill.bill_number}`,
    legislationJurisdiction: {
      "@type": "AdministrativeArea",
      name: bill.state,
      addressCountry: "US",
    },
    ...(bill.title ? { headline: bill.title } : {}),
    ...(bill.title ? { description: bill.title.slice(0, 500) } : {}),
    ...(bill.last_action_at ? { datePublished: bill.last_action_at } : {}),
    ...(bill.last_action_at ? { dateModified: bill.last_action_at } : {}),
    ...(bill.status ? { legislationType: bill.status } : {}),
    isAccessibleForFree: true,
    keywords: ["kratom", "policy", bill.state, bill.kratom_relevance, stanceLabel.toLowerCase()].filter(Boolean).join(", "),
    publisher: { "@type": "Organization", name: "iKratom", url: SITE },
    url: `${SITE}/bills/${bill.id}`,
    mainEntityOfPage: { "@type": "WebPage", "@id": `${SITE}/bills/${bill.id}` },
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="flex items-center justify-between gap-2">
        <a href={`/bills?state=${bill.state}`} className="text-xs text-zinc-500 hover:text-emerald-400">
          ← All {bill.state} bills
        </a>
        <div className="flex items-center gap-2">
          <RemindMeButton
            targetKind="bill"
            targetId={bill.id}
            defaultTitle={`${bill.state} ${bill.bill_number}: ${(bill.title ?? "follow up").slice(0, 60)}`}
            defaultMessage="Check status / contact rep"
          />
          <PageShareWithAttribution
            path={`/bills/${bill.id}`}
            title={`${bill.state} ${bill.bill_number}: ${bill.title?.slice(0, 80) ?? "(no title)"}`}
            summary={(bill.summary_ai ?? bill.summary ?? "").slice(0, 180) || `Tracked on iKratom — ${bill.state} bill ${bill.bill_number}.`}
          />
        </div>
      </div>

      {/* Header */}
      <header className="mt-3 mb-6">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded bg-zinc-900 px-2 py-1 font-mono text-zinc-300">
            {bill.state} · {bill.bill_number}
          </span>
          {bill.scope && bill.scope !== "state" && (
            <span className="rounded bg-purple-950/40 px-2 py-1 capitalize text-purple-300">
              {bill.scope}
            </span>
          )}
          {bill.locality && (
            <span className="rounded bg-zinc-900 px-2 py-1 text-zinc-300">
              📍 {bill.locality}
            </span>
          )}
          {bill.session_id && (
            <span
              className="rounded bg-zinc-900 px-2 py-1 text-zinc-400"
              title="Legislative session this bill belongs to"
            >
              Session {bill.session_id}
            </span>
          )}
          <span className={`rounded border px-2 py-1 font-semibold ${relevance.cls}`}>
            {relevance.label}
          </span>
          {bill.relevance_confidence != null && (
            <span className="text-zinc-500">
              {Math.round(bill.relevance_confidence * 100)}% confidence
            </span>
          )}
          {status && (
            <span className="rounded bg-zinc-900 px-2 py-1 text-zinc-400">{status}</span>
          )}
        </div>
        <h1 className="mt-3 text-2xl font-bold leading-tight sm:text-3xl">
          {displayTitle(bill.title, 120)}
        </h1>
        {displaySubtitle(bill.title) && (
          <p className="mt-1 text-sm text-zinc-400 leading-snug">
            {displaySubtitle(bill.title)}
          </p>
        )}
        {bill.last_action_at && (
          <p className="mt-2 text-sm text-zinc-500">
            Last action <span className="text-zinc-300">{new Date(bill.last_action_at).toLocaleDateString()}</span>
            {daysSinceAction != null && daysSinceAction > 0 && (
              <span className="text-zinc-600"> · {daysSinceAction} days ago</span>
            )}
          </p>
        )}
      </header>

      {/* Active battle hero — shows prominently when this is an
          ongoing anti-kratom fight at the local level. Suffolk's
          tabled-resolution case is the prototype. */}
      {bill.kratom_relevance === "anti"
        && (bill.scope === "county" || bill.scope === "municipal")
        && (bill.status === "committee" || bill.status === "introduced") && (
        <section className="mb-6 rounded-lg border-2 border-red-600/60 bg-red-950/25 p-5">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-red-300">⚠ Active battle</p>
          <h2 className="mt-1 text-lg font-bold text-zinc-100">
            {bill.locality ?? bill.state} kratom ban — fight is ongoing
          </h2>
          {bill.last_action && (
            <p className="mt-2 text-sm text-zinc-300">
              <span className="text-zinc-500">Most recent:</span> {bill.last_action}
            </p>
          )}
          <p className="mt-2 text-[12px] text-zinc-400">
            This is an active local-level kratom-restriction fight. The sponsors are listed below;
            the &quot;Take action&quot; section has emails and call scripts; and the &quot;People of interest&quot; section
            below names experts, journalists, and allies who can amplify a counter-narrative.
            {bill.locality?.includes("Suffolk") && " — Vote was tabled; we are watching the next General Meeting agenda automatically."}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <RemindMeButton
              targetKind="bill"
              targetId={bill.id}
              defaultTitle={`Check ${bill.state} ${bill.bill_number} status`}
              defaultMessage={`Tabled / pending. Re-check site for next-meeting date.`}
            />
            <IntelTipForm
              billId={bill.id}
              billTitle={bill.title ?? bill.bill_number}
              billState={bill.state}
              billLocality={bill.locality}
            />
          </div>
        </section>
      )}

      {/* Signup nudge for anonymous visitors. Bills are high-intent
          — someone reading a specific bill detail is the ideal target
          for "get pushed when this bill changes status". */}
      <SignUpNudge context="bill" stateCode={bill.state} className="mb-6" />
      <EnablePushNudge context="bill" stateCode={bill.state} className="mb-6" />

      {/* Takeback playbook — editorial content for enacted-ban + imminent-ban
          bills. Two sections: who pushed the ban (opposition_summary_md) and
          the concrete plan to repeal (repeal_plan_md). Rendered as a single
          composite section so the analytical context and the action plan stay
          adjacent. Only fires when at least one column is populated, which is
          by-design only for the 7 banning states + imminent TN. */}
      {(bill.opposition_summary_md || bill.repeal_plan_md) && (
        <section className="mb-6 rounded-lg border-2 border-amber-700/40 bg-gradient-to-br from-zinc-950/60 to-amber-950/15 p-5">
          <div className="mb-3 flex flex-wrap items-baseline gap-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-300">
              🎯 Takeback intel
            </p>
            <span className="text-[10px] text-zinc-500">
              who pushed this · what the political trail looks like · how to repeal
            </span>
          </div>
          <p className="text-[11px] leading-relaxed text-zinc-400">
            Editorial-curated political-action intel for this {bill.status === "enacted" ? "enacted ban" : "imminent ban"}. Sources, named legislators, and a phased repeal plan. Most of the work of repealing a state ban is naming the right allies and constraints — that&apos;s what this section is for.
          </p>

          {bill.opposition_summary_md && (
            <div className="mt-4 rounded-md border border-red-800/40 bg-red-950/15 p-4">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-red-300">
                ⚠ Who pushed this ban
              </p>
              <Markdown>{bill.opposition_summary_md}</Markdown>
            </div>
          )}

          {bill.repeal_plan_md && (
            <div className="mt-4 rounded-md border border-emerald-800/40 bg-emerald-950/15 p-4">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-emerald-300">
                🛠 Repeal action plan
              </p>
              <Markdown>{bill.repeal_plan_md}</Markdown>
            </div>
          )}

          <p className="mt-4 text-[10px] uppercase tracking-wider text-zinc-600">
            Editorial — submit corrections + additional intel via the &quot;Add local intel&quot; button on the people-of-interest section below.
          </p>
        </section>
      )}

      {/* "YOUR REP IS DECIDING THIS BILL" — district-level urgency.
          When the bill is in a committee that one of the user's reps
          sits on, this is the highest-leverage moment for that user.
          Renders silently when not applicable (no committee data,
          not signed in, wrong state, no rep match). */}
      <YourRepDecidingThisBill
        billId={bill.id}
        billState={bill.state}
        currentCommitteeName={currentCommitteeName}
      />

      {/* Per-bill timeline — surfaces the legislative-journey stage tracker
          + full action history. Lobbyists know the planned next-step
          calendar; this gives advocates the same intel + a status badge. */}
      <BillTimeline billId={bill.id} currentStatus={bill.status} />

      {/* Stale warning — most important for SB-1639-style problems */}
      {isStale && (
        <div className="mb-6 rounded-lg border border-amber-700/50 bg-amber-950/20 p-4 text-sm">
          <p className="font-semibold text-amber-300">
            ⚠ This bill appears to be from a closed legislative session
          </p>
          <p className="mt-1 text-amber-200/80">
            No legislative activity in {daysSinceAction} days. Most US state sessions
            run 12 months or less, so a bill silent for over a year has almost
            certainly died when its session ended. Emailing legislators about
            dead bills wastes their attention. Verify with the official source
            below before taking action — and if a successor bill exists in the
            current session, search for that instead.
          </p>
        </div>
      )}

      {/* Local action playbook — for city/county ordinances where the
          intel didn't come from LegiScan. Calendar buttons, mailto:
          public-comment links, dial-in numbers, join URLs, officials.
          Renders only when scope is municipal/county AND the AI
          extractor populated local_meta. State bills skip this and go
          straight to Substance Impact. */}
      {(bill.scope === "municipal" || bill.scope === "county") && bill.local_meta && (
        <BillLocalActionCard
          meta={bill.local_meta}
          billId={bill.id}
          billTitle={bill.title ?? ""}
          billState={bill.state}
          billLocality={bill.locality}
          agendaItemNumber={bill.local_meta.agenda_item_number}
          officials={localOfficials}
          sourceUrl={alertSourceUrl}
          signedIn={viewerSignedIn}
          initiallySubscribed={initiallySubscribed}
        />
      )}

      {/* Substance impact — per-alkaloid stance. Placed FIRST because
          the most common reader question is "does this bill affect
          plain leaf or just 7-OH?" and we want them to see the answer
          before any prose. Five fixed substance classes ensure the
          rendering is consistent across every bill. */}
      {bill.substance_targeting && (
        <section className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
              Substance impact
            </h2>
            <span className="text-[10px] uppercase tracking-wider text-zinc-600">
              what each part of the kratom umbrella sees
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {(Object.keys(SUBSTANCE_LABEL) as Array<keyof SubstanceTargeting>).map((k) => {
              const entry = bill.substance_targeting?.[k];
              if (!entry) return null;
              const meta = SUBSTANCE_LABEL[k];
              const style = STANCE_STYLE[entry.stance] ?? STANCE_STYLE.unaddressed;
              return (
                <div
                  key={k}
                  className={`rounded-md border p-3 ${style.cls}`}
                  title={meta.tooltip}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-semibold">
                      {meta.name}
                      {meta.abbrev && (
                        <span className="ml-1 text-[10px] opacity-70">({meta.abbrev})</span>
                      )}
                    </span>
                    <span className="text-base leading-none">{style.emoji}</span>
                  </div>
                  <div className="mt-1 text-[11px] font-mono uppercase tracking-wider opacity-80">
                    {style.label}
                    {entry.schedule && entry.schedule !== "-" && (
                      <span className="ml-1">· Sch. {entry.schedule}</span>
                    )}
                  </div>
                  {entry.scope && entry.scope !== "-" && entry.stance !== "unaddressed" && (
                    <div className="mt-0.5 text-[10px] opacity-70">
                      {entry.scope.replace(/_/g, " ")}
                    </div>
                  )}
                  {entry.notes && (
                    <p className="mt-1.5 text-[10px] leading-snug opacity-75">{entry.notes}</p>
                  )}
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-[10px] uppercase tracking-wider text-zinc-600">
            AI-classified per-alkaloid stance.{" "}
            {bill.substance_targeting_analyzed_at && (
              <>Analyzed {new Date(bill.substance_targeting_analyzed_at).toLocaleDateString()}.</>
            )}{" "}
            <span className="normal-case tracking-normal">
              We distinguish natural leaf, MGM, 7-OH, pseudoindoxyl, and synthetic
              derivatives — &ldquo;kratom&rdquo; alone is too coarse.
            </span>
          </p>
        </section>
      )}

      {/* Cumulative journey — when the bill has been amended at least
          once, show the full trajectory (introduced → each amendment →
          current state → cumulative impact). */}
      {bill.journey_narrative && (bill.amendments_count ?? 0) >= 2 && (
        <section className="mb-6 rounded-lg border border-emerald-900/40 bg-gradient-to-br from-zinc-950/40 to-emerald-950/10 p-5">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-emerald-300">
              Bill journey
            </h2>
            <span className="rounded-full bg-emerald-950/40 px-2 py-0.5 text-[10px] font-mono uppercase text-emerald-300">
              {bill.amendments_count} versions tracked
            </span>
          </div>
          <p className="mb-3 text-[11px] text-zinc-500">
            How the bill evolved from introduction through every amendment to the current
            text. Helps you see what was kept, removed, and added — instead of only
            reading the latest snapshot.
          </p>
          <div className="space-y-3 text-sm leading-relaxed text-zinc-200">
            {bill.journey_narrative
              .split(/\n\s*\n/)
              .filter((p) => p.trim().length > 0)
              .map((para, i) => (
                <p key={i}>{para.trim()}</p>
              ))}
          </div>
          {bill.journey_analyzed_at && (
            <p className="mt-3 text-[10px] uppercase tracking-wider text-zinc-600">
              AI-synthesized from action timeline + version texts ·{" "}
              last analyzed {new Date(bill.journey_analyzed_at).toLocaleDateString()}
            </p>
          )}
        </section>
      )}

      {/* Substantive briefing-grade summary (200-300 words). When
          present, this REPLACES the 2-sentence summary_ai because it
          covers everything the short version did and more. */}
      {bill.summary_long ? (
        <section className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
            Briefing
          </h2>
          <div className="mt-3 space-y-3 text-sm leading-relaxed text-zinc-200">
            {bill.summary_long
              .split(/\n\s*\n/)
              .filter((p) => p.trim().length > 0)
              .map((para, i) => (
                <p key={i}>{para.trim()}</p>
              ))}
          </div>
          {bill.advocacy_callout && (
            <div className="mt-4 rounded-md border border-emerald-900/30 bg-emerald-950/20 p-3">
              <p className="text-xs font-semibold text-emerald-400">For advocates:</p>
              <TranslatedSection
                type="bill_callout"
                id={bill.id}
                sourceText={bill.advocacy_callout}
                className="mt-1 text-sm text-emerald-200"
              />
            </div>
          )}
          {bill.journey_analyzed_at && (
            <p className="mt-3 text-[10px] uppercase tracking-wider text-zinc-600">
              AI-summarized · last reviewed {new Date(bill.journey_analyzed_at).toLocaleDateString()}
            </p>
          )}
        </section>
      ) : bill.summary_ai && (
        <section className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Plain English
          </h2>
          {(() => {
            // Note: this IIFE inside JSX is server-side; await is fine.
            return null;
          })()}
          {/* The actual translated content is fetched + rendered below */}
          <TranslatedSection
            type="bill_summary"
            id={bill.id}
            sourceText={bill.summary_ai}
          />
          {bill.advocacy_callout && (
            <div className="mt-4 rounded-md border border-emerald-900/30 bg-emerald-950/20 p-3">
              <p className="text-xs font-semibold text-emerald-400">For advocates:</p>
              <TranslatedSection
                type="bill_callout"
                id={bill.id}
                sourceText={bill.advocacy_callout}
                className="mt-1 text-sm text-emerald-200"
              />
            </div>
          )}
          {bill.enriched_at && (
            <p className="mt-3 text-[10px] uppercase tracking-wider text-zinc-600">
              AI-summarized · last reviewed {new Date(bill.enriched_at).toLocaleDateString()}
            </p>
          )}
        </section>
      )}

      {/* Full bill text — every captured version, switchable via tabs.
          Lets readers compare introduced vs amended versions on-site
          instead of bouncing to the state portal. */}
      {bill.bill_text_versions && bill.bill_text_versions.length > 0 && (
        <BillFullText versions={bill.bill_text_versions} />
      )}

      {/* Phase 3 D6: cross-state bill similarity. Surfaces semantic
          matches of this bill in OTHER states — when this is a KCPA
          variant or a 7-OH ban, the top match is usually the bill it
          was templated from. Cosine similarity ≥ 0.7 filter, top 5. */}
      {similarBills.length > 0 && (
        <section className="mb-6 rounded-lg border border-violet-500/30 bg-violet-950/10 p-5">
          <h2 className="mb-2 flex flex-wrap items-baseline gap-2 text-sm font-semibold uppercase tracking-wider text-violet-300">
            🔗 Similar bills in other states
            <span className="text-[10px] font-normal text-zinc-500">
              (top {similarBills.length} text-similarity matches above 60%)
            </span>
          </h2>
          <p className="text-[11px] text-zinc-400">
            Bills sharing language or scope with this one. High match scores often indicate a coalition shopping the same template across states.
          </p>
          <ul className="mt-3 space-y-2">
            {similarBills.map((s) => (
              <li key={s.bill.id}>
                <a
                  href={`/bills/${s.bill.id}`}
                  className="block rounded-md border border-violet-700/20 bg-zinc-950/40 p-2.5 transition hover:border-violet-500"
                >
                  <div className="flex flex-wrap items-baseline gap-2 text-[11px]">
                    <span className="font-mono font-semibold text-zinc-200">
                      {s.bill.state} · {s.bill.bill_number}
                    </span>
                    {s.bill.kratom_relevance === "anti" && (
                      <span className="rounded bg-red-950/40 px-1.5 py-0.5 text-red-300">Anti</span>
                    )}
                    {s.bill.kratom_relevance === "pro" && (
                      <span className="rounded bg-emerald-950/40 px-1.5 py-0.5 text-emerald-300">Pro</span>
                    )}
                    <span className="ml-auto font-mono text-violet-300">
                      {(s.similarity * 100).toFixed(0)}% match
                    </span>
                  </div>
                  {s.bill.title && (
                    <p className="mt-1 text-xs leading-snug text-zinc-100">
                      {s.bill.title.slice(0, 140)}{s.bill.title.length > 140 ? "…" : ""}
                    </p>
                  )}
                  <p className="mt-1 text-[10px] text-zinc-600">
                    status: {s.bill.status ?? "?"}
                    {s.bill.last_action_at && (
                      <span> · last action {new Date(s.bill.last_action_at).toLocaleDateString()}</span>
                    )}
                  </p>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Linked campaigns */}
      {campaigns.length > 0 && campaigns.some((c) => c.active) && (
        <section className="mb-6 rounded-lg border-2 border-emerald-700/50 bg-gradient-to-br from-emerald-950/30 to-zinc-950/40 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-emerald-300">
            Take action
          </h2>
          <ul className="mt-3 space-y-2">
            {campaigns
              .filter((c) => c.active)
              .map((c) => (
                <li key={c.id}>
                  <a
                    href={`/campaigns/${c.slug}`}
                    className="flex items-center justify-between gap-3 rounded-md border border-emerald-700/40 bg-emerald-950/20 px-4 py-3 hover:border-emerald-500"
                  >
                    <span className="text-sm font-medium text-zinc-100">{c.title}</span>
                    <span className="text-xs text-emerald-300">Open campaign →</span>
                  </a>
                </li>
              ))}
          </ul>
          {(totalActions ?? 0) > 0 && (
            <p className="mt-3 text-xs text-zinc-500">
              {totalActions?.toLocaleString()} action{totalActions === 1 ? "" : "s"} taken
              across all campaigns for this bill.
            </p>
          )}
        </section>
      )}

      {/* Inactive linked campaigns (legacy, for transparency) */}
      {campaigns.some((c) => !c.active) && (
        <section className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Past campaigns for this bill (inactive)
          </h3>
          <ul className="mt-2 space-y-1">
            {campaigns
              .filter((c) => !c.active)
              .map((c) => (
                <li key={c.id} className="text-xs text-zinc-500">
                  <span className="font-mono">{c.slug}</span>
                  <span className="ml-2 text-zinc-600">
                    created {new Date(c.created_at).toLocaleDateString()}
                  </span>
                </li>
              ))}
          </ul>
        </section>
      )}

      {/* OpenStates abstracts (additional summaries) */}
      {detail && detail.abstracts.length > 0 && (
        <section className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Official abstracts
          </h2>
          {detail.abstracts.map((a, i) => (
            <div key={i} className="mt-3">
              {a.note && (
                <p className="text-xs font-semibold text-zinc-400">{a.note}</p>
              )}
              <p className="mt-1 whitespace-pre-line text-sm text-zinc-300">
                {a.abstract}
              </p>
            </div>
          ))}
        </section>
      )}

      {/* DB raw summary (fallback if no live detail abstracts) */}
      {!detail?.abstracts?.length && bill.summary && (
        <section className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Official abstract
          </h2>
          <p className="mt-2 whitespace-pre-line text-sm text-zinc-300">{bill.summary}</p>
        </section>
      )}

      {/* Bill text + sources */}
      <section className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Read the actual bill text
        </h2>
        <div className="mt-3 space-y-2">
          {detail?.versions && detail.versions.length > 0 ? (
            detail.versions.map((v, i) => (
              <div key={i}>
                <p className="text-xs text-zinc-500">
                  {v.note} · {v.date}
                </p>
                <ul className="mt-1 space-y-1">
                  {v.links.map((l, j) => (
                    <li key={j}>
                      <a
                        href={l.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-emerald-400 hover:underline"
                      >
                        {l.media_type.includes("pdf") ? "📄 " : "🔗 "}
                        Open {l.media_type.split("/").pop() ?? "document"} ↗
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          ) : (
            <p className="text-sm text-zinc-400">
              We don&apos;t have direct version links cached. Use the source link
              below to navigate to the official bill text.
            </p>
          )}
        </div>

        {/* Sponsors */}
        {sponsors.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Sponsors ({sponsors.length})
            </p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {sponsors.map((s, i) => {
                const inner = (
                  <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs ${
                    s.classification === "primary"
                      ? "border-amber-700/50 bg-amber-950/20 text-amber-200"
                      : "border-zinc-800 bg-zinc-950/40 text-zinc-300"
                  }`}>
                    {s.classification === "primary" && <span title="Primary sponsor">★</span>}
                    <span>{s.name}</span>
                    {s.party && <span className="text-zinc-500">({s.party}{s.district ? ` · D${s.district}` : ""})</span>}
                  </span>
                );
                return (
                  <li key={`${s.name}-${i}`}>
                    {s.legislator_id ? (
                      <a href={`/legislators/${s.legislator_id}`} className="hover:opacity-80">{inner}</a>
                    ) : inner}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* Sources */}
        <div className="mt-4 space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Official sources
          </p>
          {/* Direct state-legislature link is the most credible — show first */}
          {bill.official_url && (
            <p>
              <a
                href={bill.official_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-emerald-400 hover:underline"
              >
                ⭐ Official state legislature page ↗
              </a>
            </p>
          )}
          {detail?.sources && detail.sources.length > 0 ? (
            <ul className="space-y-1">
              {detail.sources
                .filter((s) => s.url !== bill.official_url) // dedupe
                .map((s, i) => (
                  <li key={i}>
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-emerald-400 hover:underline"
                    >
                      {s.note || s.url}
                    </a>
                  </li>
                ))}
            </ul>
          ) : null}
          {bill.source_url && (
            <p>
              <a
                href={bill.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-emerald-400 hover:underline"
              >
                View on OpenStates ↗
              </a>
            </p>
          )}
        </div>
      </section>

      {/* Sponsors */}
      {detail?.sponsorships && detail.sponsorships.length > 0 && (
        <section className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Sponsors
          </h2>
          <ul className="mt-3 grid gap-1 sm:grid-cols-2">
            {detail.sponsorships.map((s, i) => (
              <li key={i} className="text-sm text-zinc-300">
                {s.primary && <span className="text-emerald-400">★ </span>}
                {s.name}
                {s.party && <span className="ml-2 text-zinc-500">({s.party})</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* People of interest (bill_stakeholders) — allies, experts,
          journalists, opponents, affected business owners. Editorial
          curation. Surfaces grouped by role_type. */}
      {stakeholders.length > 0 && (() => {
        const ROLE_META: Record<string, { emoji: string; label: string; tone: string }> = {
          ally: { emoji: "🤝", label: "Allies", tone: "border-emerald-700/40 bg-emerald-950/15" },
          expert: { emoji: "🎓", label: "Subject-matter experts", tone: "border-sky-700/40 bg-sky-950/15" },
          journalist: { emoji: "📰", label: "Journalists / outlets", tone: "border-amber-700/40 bg-amber-950/15" },
          opponent: { emoji: "⚠", label: "Opponents to track", tone: "border-red-700/40 bg-red-950/15" },
          affected: { emoji: "🏪", label: "Affected business / community", tone: "border-violet-700/40 bg-violet-950/15" },
          community: { emoji: "🌐", label: "Community + harm-reduction", tone: "border-teal-700/40 bg-teal-950/15" },
        };
        const grouped = new Map<string, StakeholderRow[]>();
        for (const s of stakeholders) {
          if (!grouped.has(s.role_type)) grouped.set(s.role_type, []);
          grouped.get(s.role_type)!.push(s);
        }
        const order = ["ally", "expert", "affected", "community", "journalist", "opponent"];
        return (
          <section className="mb-6 rounded-lg border border-violet-700/30 bg-zinc-950/40 p-5">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-violet-300">
                People of interest ({stakeholders.length})
              </h2>
              <IntelTipForm
                billId={bill.id}
                billTitle={bill.title ?? bill.bill_number}
                billState={bill.state}
                billLocality={bill.locality}
              />
            </div>
            <p className="mt-1 text-[11px] text-zinc-500">
              Allies, experts, journalists, affected business owners, and opponents to track — beyond the sponsors above. Editorial-curated; submit local intel with the button above to grow this list.
            </p>
            <div className="mt-4 space-y-3">
              {order.flatMap(role => {
                const rows = grouped.get(role) ?? [];
                if (rows.length === 0) return [];
                const meta = ROLE_META[role] ?? { emoji: "·", label: role, tone: "border-zinc-700 bg-zinc-950/40" };
                return [(
                  <div key={role} className={`rounded-md border p-3 ${meta.tone}`}>
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-200">
                      {meta.emoji} {meta.label} ({rows.length})
                    </p>
                    <ul className="space-y-2">
                      {rows.map(s => (
                        <li key={s.id} className="text-[12px]">
                          <p className="font-semibold text-zinc-100">{s.name}</p>
                          {(s.title || s.organization) && (
                            <p className="text-[11px] text-zinc-400">
                              {s.title}{s.title && s.organization ? " · " : ""}{s.organization}
                            </p>
                          )}
                          <p className="mt-1 text-[11px] leading-snug text-zinc-300">{s.reasoning}</p>
                          {(s.email || s.phone || s.website || s.twitter_handle || s.linkedin_url) && (
                            <p className="mt-1 flex flex-wrap gap-2 text-[10px]">
                              {s.email && <a href={`mailto:${s.email}`} className="text-emerald-400 hover:underline">{s.email}</a>}
                              {s.phone && <a href={`tel:${s.phone}`} className="text-emerald-400 hover:underline">{s.phone}</a>}
                              {s.website && <a href={s.website} target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline">website</a>}
                              {s.twitter_handle && <a href={`https://twitter.com/${s.twitter_handle.replace(/^@/, "")}`} target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline">@{s.twitter_handle.replace(/^@/, "")}</a>}
                              {s.linkedin_url && <a href={s.linkedin_url} target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline">LinkedIn</a>}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )];
              })}
            </div>
          </section>
        );
      })()}

      {/* Action history */}
      {detail?.actions && detail.actions.length > 0 && (
        <section className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Action history
          </h2>
          <ol className="mt-3 space-y-2">
            {detail.actions.slice(0, 30).map((a, i) => (
              <li key={i} className="text-xs text-zinc-300">
                <span className="font-mono text-zinc-500">{a.date}</span>
                {" — "}
                <span>{a.description}</span>
                {a.organization?.name && (
                  <span className="ml-1 text-zinc-600">({a.organization.name})</span>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Similar bills (same stance, active in last 365d) */}
      {similar.length > 0 && (
        <section className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Similar bills moving now ({similar.length})
          </h2>
          <p className="mt-1 text-xs text-zinc-400">
            Other {bill.kratom_relevance}-classified bills active in the last
            12 months. Often the same template legislation moving through
            multiple states at once.
          </p>
          <ul className="mt-3 space-y-2">
            {similar.map((s) => (
              <li key={s.id} className="rounded-md border border-zinc-900 bg-zinc-950 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-zinc-300">
                    {s.state} · {s.bill_number}
                  </span>
                  {s.scope && s.scope !== "state" && (
                    <span className="rounded bg-purple-950/40 px-1.5 py-0.5 capitalize text-purple-300">
                      {s.scope}
                    </span>
                  )}
                  {s.status && (
                    <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-zinc-400">
                      {STATUS_LABEL[s.status] ?? s.status}
                    </span>
                  )}
                  {s.last_action_at && (
                    <span className="ml-auto text-zinc-500">
                      {new Date(s.last_action_at).toLocaleDateString()}
                    </span>
                  )}
                </div>
                <a href={`/bills/${s.id}`} className="mt-1 block text-zinc-200 hover:text-emerald-400">
                  {s.title ?? "(untitled)"}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Sync metadata footer */}
      <p className="mt-8 text-center text-xs text-zinc-600">
        Bill data last synced{" "}
        {bill.last_synced_at ? new Date(bill.last_synced_at).toLocaleString() : "unknown"}.
        {detail
          ? " Live OpenStates lookup successful (cached 1 hour)."
          : " Live OpenStates lookup unavailable — showing cached fields only."}
      </p>
    </div>
  );
}

/**
 * Renders translated text for an entity if a translation is cached for the
 * current locale; falls back to the original. Server component (async).
 */
async function TranslatedSection({
  type, id, sourceText, className,
}: {
  type: "bill_summary" | "bill_callout";
  id: string;
  sourceText: string;
  className?: string;
}) {
  const locale = await readLocale();
  if (locale === "en") {
    return <p className={className ?? "mt-2 text-base text-zinc-200"}>{sourceText}</p>;
  }
  const supabase = await createClient();
  const translated = await getTranslation(supabase, { type, id }, locale);
  if (!translated) {
    return (
      <div>
        <p className={className ?? "mt-2 text-base text-zinc-200"}>{sourceText}</p>
        <p className="mt-1 text-[10px] text-zinc-600">
          (No translation available yet — admin: run <code className="rounded bg-zinc-950 px-1">npm run translate:content</code>.)
        </p>
      </div>
    );
  }
  return (
    <div>
      <p className={className ?? "mt-2 text-base text-zinc-200"}>{translated}</p>
      <details className="mt-2 text-xs text-zinc-500">
        <summary className="cursor-pointer">Show original (English)</summary>
        <p className="mt-1">{sourceText}</p>
      </details>
    </div>
  );
}
