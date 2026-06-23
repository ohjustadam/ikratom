import { createClient } from "@/lib/supabase/server";
import { CampaignBrowser } from "./CampaignBrowser";

export const metadata = { title: "Campaigns" };
export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const supabase = await createClient();

  const [{ data: campaigns }, { data: { user } }] = await Promise.all([
    supabase
      .from("campaigns")
      .select("id, slug, title, blurb, state, target_locality, bill_id, mobilization_type, auto_generated, created_at, active, is_standing")
      .eq("active", true)
      .order("created_at", { ascending: false }),
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

  // Per-campaign action counts (for social proof)
  const ids = (campaigns ?? []).map((c) => c.id);
  const counts: Record<string, number> = {};
  if (ids.length > 0) {
    const { data: actionRows } = await supabase
      .from("campaign_actions")
      .select("campaign_id")
      .in("campaign_id", ids);
    for (const r of actionRows ?? []) {
      counts[r.campaign_id] = (counts[r.campaign_id] ?? 0) + 1;
    }
  }

  // Pull linked-bill metadata for scope (state/federal/municipal/county)
  // and stance (anti/pro/neutral). Used to drive filter chips so the
  // user can tell at a glance what kind of action each campaign is.
  const billIds = Array.from(new Set(
    (campaigns ?? []).map((c) => c.bill_id).filter(Boolean) as string[],
  ));
  const billMeta: Record<string, { scope: string | null; kratom_relevance: string | null; status: string | null }> = {};
  if (billIds.length > 0) {
    const { data: billRows } = await supabase
      .from("bills")
      .select("id, scope, kratom_relevance, status")
      .in("id", billIds);
    for (const b of billRows ?? []) {
      billMeta[(b as { id: string }).id] = {
        scope: (b as { scope: string | null }).scope,
        kratom_relevance: (b as { kratom_relevance: string | null }).kratom_relevance,
        status: (b as { status: string | null }).status,
      };
    }
  }

  // Pull linked-alert severity so urgent campaigns can rise to the top.
  const campaignToSeverity: Record<string, string> = {};
  if (ids.length > 0) {
    const { data: alertRows } = await supabase
      .from("policy_alerts")
      .select("campaign_id, severity")
      .in("campaign_id", ids)
      .eq("moderation_status", "approved");
    for (const r of alertRows ?? []) {
      const cid = (r as { campaign_id: string }).campaign_id;
      const sev = (r as { severity: string }).severity;
      // Keep the highest severity per campaign
      const existing = campaignToSeverity[cid];
      if (!existing || sevRank(sev) > sevRank(existing)) {
        campaignToSeverity[cid] = sev;
      }
    }
  }

  // Decorate the campaigns with derived fields the browser uses for chips
  const enriched = (campaigns ?? []).map((c) => {
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
