import { unstable_cache } from "next/cache";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { CampaignBrowser } from "./CampaignBrowser";

export const metadata = { title: "Campaigns" };
/**
 * Static + ISR, 15 minutes.
 *
 * WHY (2026-09-08 egress emergency). This was force-dynamic and opened a
 * cookie-bound Supabase client on every request for three per-user values —
 * home state, signed-in, and whether email is connected. The campaign DATA was
 * already behind unstable_cache; the cookie read was what kept the ROUTE
 * dynamic, so every crawler hit still cost a render.
 *
 * All three now come from the /api/me chrome read that real browsers already
 * make and crawlers never do.
 *
 * The second reason matters more than egress: a STATIC page keeps serving even
 * if Supabase stops answering. On the free plan, exceeding the egress cap
 * RESTRICTS the project rather than billing for it — every dynamic route 500s,
 * while a prerendered one is just a file on the CDN. Making the public pages
 * static is outage insurance, not only a saving.
 */
/**
 * ⚠ FROZEN WINDOW — RESTORE TO 900 ON 2026-09-16. ⚠
 *
 * Supabase free-tier egress was at 96.3% with the cycle resetting 09-16, and
 * exceeding it RESTRICTS the project (the API stops answering; the site goes
 * down). ISR is lazy — a cached page only re-renders when a request arrives
 * after its window — so the window IS the per-page cost ceiling. Stretching it
 * past the reset means this page renders at most once more for the rest of the
 * cycle and then costs nothing at all, while still serving instantly from the
 * CDN.
 *
 * The usual objection — "but the content goes stale" — barely applies here:
 * the cron fleet is ALREADY deferred by the egress gate, so the underlying
 * data is not moving either. Freezing the presentation of data that is itself
 * frozen loses almost nothing, and on-demand revalidation still works if
 * something genuinely urgent needs to publish.
 *
 * tests/egress-freeze-expiry.test.ts turns red after 2026-09-16 so this
 * reverts on evidence rather than on someone remembering.
 */
export const revalidate = 604800; // 7d — frozen; normal is 900

type EnrichedCampaign = {
  id: string;
  slug: string;
  title: string;
  blurb: string | null;
  state: string | null;
  target_locality: string | null;
  active: boolean;
  auto_generated: boolean;
  mobilization_type: string | null;
  created_at: string;
  scope: "state" | "federal" | "municipal" | "county" | "unknown";
  stance: "anti" | "pro" | "neutral" | "unknown";
  bill_status: string | null;
  severity: string | null;
  is_standing: boolean;
};

// Public campaign list + derived chip metadata (bill scope/stance/status,
// alert severity) + per-campaign action counts. Identical for every visitor,
// so it's cached across requests instead of 4 table reads per view — the
// biggest egress saver on this page. Service-role client because the data is
// public and unstable_cache can't use the cookie-bound request client.
const getCampaignData = unstable_cache(
  async (): Promise<{ campaigns: EnrichedCampaign[]; counts: Record<string, number> }> => {
    const supabase = createServiceRoleClient();

    const { data: campaigns } = await supabase
      .from("campaigns")
      .select("id, slug, title, blurb, state, target_locality, bill_id, mobilization_type, auto_generated, created_at, active, is_standing")
      .eq("active", true)
      .order("created_at", { ascending: false });

    const ids = (campaigns ?? []).map((c) => c.id);
    const billIds = Array.from(new Set(
      (campaigns ?? []).map((c) => c.bill_id).filter(Boolean) as string[],
    ));

    const [{ data: actionRows }, { data: billRows }, { data: alertRows }] = await Promise.all([
      // Per-campaign action counts (for social proof)
      ids.length > 0
        ? supabase.from("campaign_actions").select("campaign_id").in("campaign_id", ids)
        : Promise.resolve({ data: [] as { campaign_id: string }[] }),
      // Pull linked-bill metadata for scope (state/federal/municipal/county)
      // and stance (anti/pro/neutral). Used to drive filter chips so the
      // user can tell at a glance what kind of action each campaign is.
      billIds.length > 0
        ? supabase.from("bills").select("id, scope, kratom_relevance, status").in("id", billIds)
        : Promise.resolve({ data: [] as { id: string; scope: string | null; kratom_relevance: string | null; status: string | null }[] }),
      // Pull linked-alert severity so urgent campaigns can rise to the top.
      ids.length > 0
        ? supabase.from("policy_alerts").select("campaign_id, severity").in("campaign_id", ids).eq("moderation_status", "approved")
        : Promise.resolve({ data: [] as { campaign_id: string; severity: string }[] }),
    ]);

    const counts: Record<string, number> = {};
    for (const r of actionRows ?? []) {
      counts[r.campaign_id] = (counts[r.campaign_id] ?? 0) + 1;
    }

    const billMeta: Record<string, { scope: string | null; kratom_relevance: string | null; status: string | null }> = {};
    for (const b of billRows ?? []) {
      billMeta[(b as { id: string }).id] = {
        scope: (b as { scope: string | null }).scope,
        kratom_relevance: (b as { kratom_relevance: string | null }).kratom_relevance,
        status: (b as { status: string | null }).status,
      };
    }

    const campaignToSeverity: Record<string, string> = {};
    for (const r of alertRows ?? []) {
      const cid = (r as { campaign_id: string }).campaign_id;
      const sev = (r as { severity: string }).severity;
      // Keep the highest severity per campaign
      const existing = campaignToSeverity[cid];
      if (!existing || sevRank(sev) > sevRank(existing)) {
        campaignToSeverity[cid] = sev;
      }
    }

    // Decorate the campaigns with derived fields the browser uses for chips
    const enriched: EnrichedCampaign[] = (campaigns ?? []).map((c) => {
      const bm = c.bill_id ? billMeta[c.bill_id] : null;
      const scope: "state" | "federal" | "municipal" | "county" | "unknown" =
        bm?.scope === "municipal" ? "municipal" :
        bm?.scope === "county" ? "county" :
        bm?.scope === "federal" || c.state === null ? "federal" :
        bm?.scope === "state" || c.state ? "state" :
        "unknown";
      const stance: "anti" | "pro" | "neutral" | "unknown" =
        bm?.kratom_relevance === "anti" ? "anti" :
        bm?.kratom_relevance === "pro" ? "pro" :
        bm?.kratom_relevance === "neutral" ? "neutral" :
        "unknown";
      return {
        id: c.id,
        slug: c.slug,
        title: c.title,
        blurb: c.blurb,
        state: c.state,
        target_locality: c.target_locality ?? null,
        active: c.active,
        auto_generated: !!c.auto_generated,
        mobilization_type: c.mobilization_type ?? null,
        created_at: c.created_at,
        scope,
        stance,
        bill_status: bm?.status ?? null,
        severity: campaignToSeverity[c.id] ?? null,
        is_standing: !!(c as { is_standing?: boolean }).is_standing,
      };
    });

    return { campaigns: enriched, counts };
  },
  ["campaigns-index"],
  { revalidate: 600, tags: ["campaigns-index"] },
);

export default async function CampaignsPage() {
  const { campaigns: enriched, counts } = await getCampaignData();
  return <CampaignBrowser campaigns={enriched} actionCounts={counts} />;
}

function sevRank(s: string): number {
  if (s === "critical") return 4;
  if (s === "alert") return 3;
  if (s === "watch") return 2;
  if (s === "routine") return 1;
  return 0;
}
