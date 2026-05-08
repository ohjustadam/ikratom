import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchOpenStatesBillDetail } from "@/lib/openstates-bill";
import { getTranslation } from "@/lib/translations";
import { readLocale } from "@/modules/auth/actions-locale";
import { BillFullText } from "./BillFullText";
import { BillLocalActionCard, type LocalMeta } from "./BillLocalActionCard";

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
    .select("state, bill_number, title")
    .eq("id", id)
    .single();
  return { title: data ? `${data.state} ${data.bill_number} — ${data.title?.slice(0, 80) ?? ""}` : "Bill" };
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
      "local_meta, local_meta_extracted_at",
    )
    .eq("id", id)
    .single();

  if (!billRaw) notFound();
  const bill = billRaw as unknown as BillRow;

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

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <a href={`/bills?state=${bill.state}`} className="text-xs text-zinc-500 hover:text-emerald-400">
        ← All {bill.state} bills
      </a>

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
          {bill.title || "(untitled)"}
        </h1>
        {bill.last_action_at && (
          <p className="mt-2 text-sm text-zinc-500">
            Last action <span className="text-zinc-300">{new Date(bill.last_action_at).toLocaleDateString()}</span>
            {daysSinceAction != null && daysSinceAction > 0 && (
              <span className="text-zinc-600"> · {daysSinceAction} days ago</span>
            )}
          </p>
        )}
      </header>

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
          billTitle={bill.title ?? ""}
          billState={bill.state}
          billLocality={bill.locality}
          agendaItemNumber={bill.local_meta.agenda_item_number}
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
