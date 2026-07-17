import { unstable_cache } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { CampaignBrowser } from "./CampaignBrowser";

export const metadata = { title: "Campaigns" };
export const dynamic = "force-dynamic";

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
  const supabase = await createClient();

  const [{ campaigns: enriched, counts }, { data: { user } }] = await Promise.all([
    getCampaignData(),
    supabase.auth.getUser(),
  ]);

  let userState: string | null = null;
  let emailConnected = false;
  if (user) {
    const [{ data: prof }, { data: integ }] = await Promise.all([
      supabase.from("profiles").select("state").eq("id", user.id).single(),
      // Light self-read (RLS allows own row) to drive the "sync your email"
      // nudge banner. The per-campaign action card does the authoritative
      // valid-token check (and a reconnect prompt if the token was revoked).
      supabase.from("email_integrations").select("account_email").eq("user_id", user.id).maybeSingle(),
    ]);
    userState = prof?.state ?? null;
    emailConnected = !!integ?.account_email;
  }

  return (
    <CampaignBrowser
      campaigns={enriched}
      userState={userState}
      actionCounts={counts}
      signedIn={!!user}
      emailConnected={emailConnected}
    />
  );
}

function sevRank(s: string): number {
  if (s === "critical") return 4;
  if (s === "alert") return 3;
  if (s === "watch") return 2;
  if (s === "routine") return 1;
  return 0;
}
