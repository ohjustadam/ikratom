import { redirect } from "next/navigation";
import { getCreatorContext } from "@/modules/admin/actions";
import { createClient } from "@/lib/supabase/server";
import { computePriority } from "@/lib/campaign-priority";
import { AdminCampaignTable, type AdminCampaignRow } from "./AdminCampaignTable";

export const metadata = { title: "Admin · Campaigns" };

const TERMINAL = new Set(["dead", "enacted", "vetoed", "failed", "withdrawn"]);
const sevRank = (s: string) => ({ critical: 4, alert: 3, watch: 2, routine: 1 }[s] ?? 0);

export default async function AdminCampaignsPage() {
  const ctx = await getCreatorContext({ require: "author_campaigns" });
  if (!ctx.ok) redirect("/dashboard");

  const supabase = await createClient();
  const { data: campaigns } = await supabase
    .from("campaigns")
    .select("id, slug, title, state, active, auto_generated, created_at, bill_id");
  const list = campaigns ?? [];

  // Per-campaign action signals (all-time, 14d, 60d) — paged past the 1k cap.
  const now = Date.now();
  const d14 = new Date(now - 14 * 86_400_000).toISOString();
  const d60 = new Date(now - 60 * 86_400_000).toISOString();
  const all: Record<string, number> = {};
  const recent: Record<string, number> = {};
  const since60: Record<string, number> = {};
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase.from("campaign_actions").select("campaign_id, sent_at").not("campaign_id", "is", null).range(from, from + 999);
    if (!data?.length) break;
    for (const r of data) {
      const id = r.campaign_id as string;
      all[id] = (all[id] ?? 0) + 1;
      if (r.sent_at >= d14) recent[id] = (recent[id] ?? 0) + 1;
      if (r.sent_at >= d60) since60[id] = (since60[id] ?? 0) + 1;
    }
    if (data.length < 1000) break;
  }

  // Highest linked-alert severity per campaign.
  const ids = list.map((c) => c.id);
  const sev: Record<string, string> = {};
  if (ids.length) {
    const { data: alerts } = await supabase
      .from("policy_alerts").select("campaign_id, severity").in("campaign_id", ids).eq("moderation_status", "approved");
    for (const a of alerts ?? []) {
      const cid = a.campaign_id as string;
      if (!sev[cid] || sevRank(a.severity as string) > sevRank(sev[cid])) sev[cid] = a.severity as string;
    }
  }

  // Linked bill status (concluded?).
  const billIds = [...new Set(list.map((c) => c.bill_id).filter(Boolean) as string[])];
  const billConcluded: Record<string, boolean> = {};
  if (billIds.length) {
    const { data: bills } = await supabase.from("bills").select("id, status, active").in("id", billIds);
    for (const b of bills ?? []) {
      billConcluded[(b as { id: string }).id] =
        (b as { active: boolean | null }).active === false || TERMINAL.has(String((b as { status: string }).status ?? "").toLowerCase());
    }
  }

  const rows: AdminCampaignRow[] = list.map((c) => {
    const ageDays = Math.floor((now - new Date(c.created_at).getTime()) / 86_400_000);
    const { score, tier } = computePriority({
      actions14d: recent[c.id] ?? 0,
      actionsAll: all[c.id] ?? 0,
      severity: sev[c.id] ?? null,
      hasBill: !!c.bill_id,
      billConcluded: c.bill_id ? !!billConcluded[c.bill_id] : false,
      quiet60: (since60[c.id] ?? 0) === 0,
      ageDays,
    });
    return {
      id: c.id, slug: c.slug, title: c.title, state: c.state, active: c.active,
      auto_generated: !!c.auto_generated, actionsAll: all[c.id] ?? 0, actions14d: recent[c.id] ?? 0, score, tier,
    };
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
      <a href="/admin" className="text-xs text-zinc-500 hover:text-emerald-400">← Admin</a>
      <header className="mt-2 mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold">Campaigns</h1>
          <p className="mt-1 text-sm text-zinc-400">
            {list.length} total · {list.filter((c) => c.active).length} active · ranked by priority (recent action + urgency + live fight)
          </p>
        </div>
        <a href="/admin/campaigns/new" className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400">
          + New campaign
        </a>
      </header>
      <AdminCampaignTable rows={rows} />
    </div>
  );
}
