import Link from "next/link";
import { notFound } from "next/navigation";
import { unstable_cache } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { jsonLdSafe } from "@/lib/jsonld";
import { SignUpNudge } from "@/components/SignUpNudge";
import { EnablePushNudge } from "@/components/EnablePushNudge";
import { DraftResponsePanel } from "./DraftResponsePanel";
import { YourRepDecidingThisBill } from "@/app/bills/[id]/YourRepDecidingThisBill";
import { bestSourceUrl, publisherFromUrl } from "@/lib/source-link";

export const dynamic = "force-dynamic";

const SITE = process.env.NEXT_PUBLIC_APP_URL || "https://www.ikratom.org";

const KIND_LABEL: Record<string, string> = {
  bill_event: "Legislation",
  bop_hearing: "Board of Pharmacy",
  ag_enforcement: "AG action",
  ag_action: "AG action",
  fda_action: "FDA action",
  dea_action: "DEA action",
  court_ruling: "Court ruling",
  news_break: "Breaking news",
  intel_tip: "Intel tip",
  city_event: "Municipal event",
  city_ordinance: "Municipal ordinance",
  scraper_stale: "Pipeline",
};

type Props = { params: Promise<{ id: string }> };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Everything on /alerts/[id] EXCEPT the signed-in-only rebuttal panel is public
// and keyed by the alert id, so the whole public read-set (alert + linked
// campaign/news/bill + real-event-date) serves from ONE cached service-role
// snapshot (#827 egress pattern; part 2 — the /alerts/[id] crawl surface,
// ~5k alerts). generateMetadata shares it; the viewer (getUser) stays
// request-bound in the component below.
const getAlertData = unstable_cache(
  async (id: string) => {
    const sb = createServiceRoleClient();
    const { data: a } = await sb
      .from("policy_alerts")
      .select("id, kind, severity, title, body, locality, source_url, bill_id, briefing_slug, bop_board_id, action_required, campaign_id, moderation_status, moderation_note, moderated_by, moderated_at, occurs_at, expires_at, created_at, updated_at, discord_posted_at, dedupe_key, auto_pushed_at, auto_pushed_count, specific_locality, officials_extracted_at, public_byline")
      .eq("id", id)
      .maybeSingle();
    // Public visibility parity: the page renders ONLY approved alerts, and
    // service-role bypasses RLS — so re-apply the gate here (null → notFound).
    if (!a || a.moderation_status !== "approved") return null;

    const linkedCampaign = a.campaign_id
      ? (await sb.from("campaigns")
          .select("id, slug, title, blurb, active, mobilization_type, state")
          .eq("id", a.campaign_id)
          .maybeSingle()).data
      : null;

    // active=true replicates news public RLS — a deactivated false-positive
    // must not resurface as the alert's source link.
    const linkedNews = (await sb
      .from("news_items")
      .select("id, duplicate_of, title, source_name, url, resolved_url, published_at")
      .eq("policy_alert_id", a.id)
      .eq("active", true)
      .order("published_at", { ascending: false })
      .limit(1)
      .maybeSingle()).data;

    const linkedBill = a.bill_id
      ? (await sb.from("bills")
          .select("id, state, bill_number, title, status, kratom_relevance, current_committee_name, last_action_at")
          .eq("id", a.bill_id)
          .maybeSingle()).data
      : null;
    const linkedBillCommittee =
      typeof linkedBill?.current_committee_name === "string" && linkedBill.current_committee_name.length > 0
        ? linkedBill.current_committee_name
        : null;

    // Real event date (mirrors push-critical-alerts): occurs_at → linked-news
    // published_at → linked-bill last_action_at. Returned as an ISO STRING —
    // unstable_cache serializes JSON, so Date objects don't survive.
    let realEventDate: string | null = a.occurs_at ?? null;
    if (!realEventDate && linkedNews?.published_at) realEventDate = linkedNews.published_at;
    if (!realEventDate && linkedBill?.last_action_at) realEventDate = linkedBill.last_action_at;

    return { a, linkedCampaign, linkedNews, linkedBill, linkedBillCommittee, realEventDate };
  },
  ["alert-detail"],
  { revalidate: 600, tags: ["alert-detail"] },
);

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return { title: "Alert · iKratom" };
  const snap = await getAlertData(id);
  if (!snap) return { title: "Alert · iKratom" };
  const a = snap.a;
  const sevEmoji = a.severity === "critical" ? "🚨" : a.severity === "alert" ? "⚠️" : "👁️";
  return {
    title: `${sevEmoji} ${a.locality ?? "Federal"}: ${a.title.slice(0, 80)} · iKratom`,
    description: a.body
      ? a.body.split("\n")[0].slice(0, 200)
      : `${KIND_LABEL[a.kind] ?? "Policy"} alert in ${a.locality ?? "the US"}.`,
    openGraph: {
      title: `${sevEmoji} ${a.title}`,
      description: a.body?.split("\n")[0].slice(0, 200) ?? "",
      url: `${SITE}/alerts/${id}`,
      siteName: "iKratom",
      type: "article",
    },
  };
}

/**
 * /alerts/[id] — single-alert detail page.
 *
 * Replaces the previous /pulse#alert-{id} anchor-jump approach (which
 * silently no-op'd because /pulse never rendered alert anchors).
 * Now notification clicks land on a dedicated page with full body,
 * source link, linked campaign, and cross-links.
 *
 * Public read — anyone can view if approved + visible.
 */
export default async function AlertDetailPage({ params }: Props) {
  const { id } = await params;
  // Validate the id BEFORE the cache so random-uuid crawls can't seed junk.
  if (!UUID_RE.test(id)) notFound();
  const snap = await getAlertData(id);
  if (!snap) notFound();
  const { a, linkedCampaign, linkedNews, linkedBill, linkedBillCommittee, realEventDate: realEventDateStr } = snap;

  // Viewer stays request-bound (uncached) — drives the signed-in-only AI
  // rebuttal panel below. All the public data above came from the snapshot.
  const sb = await createClient();
  const { data: { user: viewer } } = await sb.auth.getUser();

  const sourceUrl = bestSourceUrl(linkedNews?.resolved_url, linkedNews?.url, a.source_url);
  const sourceTitle = linkedNews?.title ?? null;
  const sourcePublisher = linkedNews?.source_name ?? publisherFromUrl(sourceUrl);
  // Internal-first: link our own /news reader (resolve duplicate → canonical
  // so we never land on a non-canonical copy), keeping users in-app.
  const internalNewsHref = linkedNews ? `/news/${linkedNews.duplicate_of ?? linkedNews.id}` : null;

  const sevEmoji = a.severity === "critical" ? "🚨" : a.severity === "alert" ? "⚠️" : "👁️";
  const sevLabel = a.severity?.toUpperCase() ?? "WATCH";
  const sevTone =
    a.severity === "critical" ? "border-red-700/50 bg-red-950/15 text-red-300" :
    a.severity === "alert" ? "border-amber-700/40 bg-amber-950/15 text-amber-300" :
    "border-zinc-800 bg-zinc-950/40 text-zinc-300";

  const created = new Date(a.created_at);
  const occurs = a.occurs_at ? new Date(a.occurs_at) : null;
  const expires = a.expires_at ? new Date(a.expires_at) : null;

  // "Real event date" (mirrors push-critical-alerts.mjs, PR #199) — surfaces
  // the stale-news banner for direct/shared-link arrivals. Computed in the
  // cached snapshot (occurs_at → linked-news published_at → linked-bill
  // last_action_at) as an ISO string; rehydrate to a Date here.
  const realEventDate: Date | null = realEventDateStr ? new Date(realEventDateStr) : null;
  const eventAgeDays = realEventDate
    ? Math.floor((Date.now() - realEventDate.getTime()) / 86_400_000)
    : null;
  const isStale = eventAgeDays !== null && eventAgeDays > 7;

  // Locality state extraction for cross-links
  let stateCode: string | null = null;
  const loc = a.locality?.trim() ?? "";
  if (/^[A-Z]{2}$/.test(loc)) stateCode = loc;
  else {
    const m = loc.match(/,\s*([A-Z]{2})\s*$/i);
    if (m) stateCode = m[1].toUpperCase();
  }

  // Schema.org NewsArticle JSON-LD — most AI summarizers + Google
  // News surface a higher-quality citation when an article advertises
  // itself with structured data. We're presenting policy news that
  // the platform aggregated/classified, so NewsArticle fits.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: a.title,
    description: a.body
      ? a.body.split("\n")[0].slice(0, 300)
      : `${KIND_LABEL[a.kind] ?? "Policy"} alert in ${a.locality ?? "the US"}.`,
    datePublished: a.created_at,
    dateModified: a.updated_at ?? a.created_at,
    author: { "@type": "Organization", name: "iKratom", url: SITE },
    publisher: { "@type": "Organization", name: "iKratom", url: SITE },
    articleSection: KIND_LABEL[a.kind] ?? "Policy",
    keywords: ["kratom", "policy", a.kind, a.locality].filter(Boolean).join(", "),
    isAccessibleForFree: true,
    url: `${SITE}/alerts/${id}`,
    mainEntityOfPage: { "@type": "WebPage", "@id": `${SITE}/alerts/${id}` },
    ...(a.source_url ? { isBasedOn: a.source_url } : {}),
    ...(stateCode ? { contentLocation: { "@type": "AdministrativeArea", name: stateCode } } : {}),
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdSafe(jsonLd) }}
      />
      <Link href="/pulse" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Pulse feed
      </Link>

      {/* Stale-news warning — shown when the underlying event is
          older than 7 days. Direct visitors (shared link, /pulse
          browse) get visual context that this is archive, not breaking. */}
      {isStale && (
        <div className="mt-3 rounded-md border border-amber-700/40 bg-amber-950/20 p-3 text-xs text-amber-200">
          <span className="font-bold">📜 Archive notice</span> — the underlying
          event for this alert happened <strong>{eventAgeDays} days ago</strong>.
          We surface it here for context, but it&apos;s not breaking news.
          {stateCode && (
            <> Want what&apos;s happening now? <Link href={`/pulse?state=${stateCode}`} className="font-semibold text-amber-300 hover:underline">See live {stateCode} alerts →</Link></>
          )}
        </div>
      )}

      {/* Hero */}
      <header className="mt-2 mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded border px-3 py-1 text-xs font-bold uppercase tracking-wider ${sevTone}`}>
            {sevEmoji} {sevLabel}
          </span>
          <span className="rounded bg-zinc-900 px-2 py-0.5 font-mono text-[11px] uppercase text-zinc-300">
            {KIND_LABEL[a.kind] ?? a.kind}
          </span>
          {a.locality && (
            <span className="rounded bg-zinc-900 px-2 py-0.5 font-mono text-[11px] uppercase text-zinc-400">
              📍 {a.locality}
            </span>
          )}
          {a.action_required && (
            <span className="rounded bg-emerald-950/40 px-2 py-0.5 text-[11px] font-bold uppercase text-emerald-300 animate-pulse">
              ⚡ action required
            </span>
          )}
        </div>
        <h1 className="mt-3 text-3xl font-bold leading-tight sm:text-4xl">{a.title}</h1>
        <p className="mt-2 text-xs text-zinc-500">
          Added {created.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}
          {occurs && (
            <> · Occurs {occurs.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</>
          )}
          {expires && expires.getTime() > Date.now() && (
            <> · Expires {expires.toLocaleString(undefined, { month: "short", day: "numeric" })}</>
          )}
          {a.public_byline && (
            <> · Reported by <span className="text-zinc-400">{a.public_byline}</span></>
          )}
        </p>
      </header>

      {/* Linked campaign — top CTA when available */}
      {linkedCampaign?.active && (
        <section className="mb-6 rounded-lg border border-emerald-700/50 bg-emerald-950/20 p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-emerald-300">
            ⚡ Take action now
          </p>
          <p className="mt-2 text-base font-semibold text-zinc-100">{linkedCampaign.title}</p>
          {linkedCampaign.blurb && (
            <p className="mt-1 text-sm text-zinc-400">{linkedCampaign.blurb}</p>
          )}
          <Link
            href={`/campaigns/${linkedCampaign.slug}`}
            className="mt-3 inline-block rounded-md bg-emerald-500 px-5 py-2 font-bold text-zinc-950 hover:bg-emerald-400"
          >
            Open campaign →
          </Link>
        </section>
      )}

      {/* Body */}
      {a.body && (
        <section className="mb-6 rounded-md border border-zinc-800 bg-zinc-950/40 p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
            Details
          </h2>
          <div className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-200">
            {/* Strip the legacy raw "**Source:** name — <google-redirect-url>"
                line + any bare Google-News URL — it's ugly and the clean source
                link lives in its own section below. */}
            {a.body
              .replace(/\n*\*\*Source:\*\*[^\n]*(?:\n|$)/g, "\n")
              .replace(/https?:\/\/news\.google\.com\/\S+/g, "")
              .replace(/\n{3,}/g, "\n\n")
              .trim()}
          </div>
        </section>
      )}

      {/* "YOUR rep is deciding this bill" — committee-leverage callout
          surfaced at the alert level so the urgency signal hits users
          on the first touchpoint with the bill (not just when they
          click through to /bills/[id]). Component handles its own auth
          + state checks and returns null when not applicable. */}
      {linkedBill && (
        <YourRepDecidingThisBill
          billId={linkedBill.id}
          billState={linkedBill.state}
          currentCommitteeName={linkedBillCommittee}
        />
      )}

      {/* Linked bill */}
      {linkedBill && (
        <section className="mb-6 rounded-md border border-zinc-800 bg-zinc-950/40 p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
            Linked bill
          </h2>
          <Link
            href={`/bills/${linkedBill.id}`}
            className="mt-2 flex items-baseline gap-2 hover:text-emerald-400"
          >
            <span className="font-mono text-base font-bold">{linkedBill.state} {linkedBill.bill_number}</span>
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
              linkedBill.kratom_relevance === "anti"
                ? "bg-red-950/40 text-red-300"
                : "bg-emerald-950/40 text-emerald-300"
            }`}>
              {linkedBill.kratom_relevance === "anti" ? "🚫 restrictive" : "✅ supportive"}
            </span>
            <span className="text-xs text-zinc-500">{linkedBill.status}</span>
          </Link>
          {linkedBill.title && (
            <p className="mt-1 text-sm text-zinc-400">{linkedBill.title}</p>
          )}
        </section>
      )}

      {/* Source — internal-first: link OUR /news reader so users stay in-app,
          with the external publisher URL demoted to a secondary "view at
          source" link. Falls back to the external link (then a text citation)
          only when we have no internal news item yet. */}
      {internalNewsHref ? (
        <section className="mb-6 flex flex-wrap items-stretch gap-2">
          <Link
            href={internalNewsHref}
            className="inline-flex max-w-full items-center gap-2 rounded-md border border-emerald-700/50 bg-emerald-950/20 px-4 py-2 text-sm text-emerald-200 hover:border-emerald-500"
          >
            <span aria-hidden>📰</span>
            <span className="min-w-0">
              <span className="block truncate font-medium">{sourceTitle ?? "Read our coverage"}</span>
              <span className="block text-xs text-emerald-400/80">Read in iKratom →</span>
            </span>
          </Link>
          {sourceUrl && (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-400 hover:border-zinc-500"
            >
              {sourcePublisher ? `${sourcePublisher} ↗` : "View at source ↗"}
            </a>
          )}
        </section>
      ) : sourceUrl ? (
        <section className="mb-6">
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex max-w-full items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-200 hover:border-emerald-500"
          >
            <span aria-hidden>📰</span>
            <span className="min-w-0">
              <span className="block truncate font-medium">{sourceTitle ?? "Read the original article"}</span>
              {sourcePublisher && <span className="block text-xs text-zinc-500">{sourcePublisher} ↗</span>}
            </span>
          </a>
        </section>
      ) : sourceTitle ? (
        <section className="mb-6 text-sm text-zinc-400">
          <span className="font-medium text-zinc-300">Source:</span> {sourceTitle}
          {sourcePublisher ? ` — ${sourcePublisher}` : ""}
        </section>
      ) : null}

      {/* AI rebuttal generator — signed-in only. Mission-critical lever:
          equalizes against astroturf form-letter campaigns by generating
          individually-personalized comment letters. See PR #218. */}
      {viewer && (
        <div className="mt-6">
          <DraftResponsePanel
            alertId={a.id}
            alertTitle={a.title}
            sourceUrl={sourceUrl}
          />
        </div>
      )}

      {/* Signup nudge — high intent: someone clicked through to a
          specific alert means they care about kratom policy and would
          benefit from push notifications on the next one. */}
      <SignUpNudge context="alert" stateCode={stateCode ?? undefined} className="mt-8" />
      <EnablePushNudge context="alert" stateCode={stateCode ?? undefined} className="mt-4" />

      {/* Cross-links */}
      <section className="mt-8 flex flex-wrap gap-2 text-xs">
        <Link href="/pulse" className="rounded border border-zinc-800 bg-zinc-950/40 px-3 py-1.5 hover:border-emerald-500">
          🚨 All alerts
        </Link>
        {stateCode && (
          <>
            <Link href={`/states/${stateCode}`} className="rounded border border-zinc-800 bg-zinc-950/40 px-3 py-1.5 hover:border-emerald-500">
              📍 {stateCode} hub
            </Link>
            <Link href={`/pulse?state=${stateCode}`} className="rounded border border-zinc-800 bg-zinc-950/40 px-3 py-1.5 hover:border-emerald-500">
              🚨 {stateCode} alerts only
            </Link>
            <Link href={`/calendar?state=${stateCode}`} className="rounded border border-zinc-800 bg-zinc-950/40 px-3 py-1.5 hover:border-emerald-500">
              📅 {stateCode} calendar
            </Link>
          </>
        )}
      </section>
    </div>
  );
}
