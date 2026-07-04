import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getAdminContext } from "@/modules/admin/actions";
import { siteConfig } from "@/config/site.config";

export const metadata = { title: "Operator cockpit" };
export const dynamic = "force-dynamic";

/**
 * /admin/ops — the single-screen daily operator cockpit.
 *
 * Designed to be the first page you open every morning. Pulls one
 * critical number from every important admin surface so you don't have
 * to bounce across automation / abuse-signals / intel-health /
 * moderation queues to figure out where to focus.
 *
 * What it surfaces (in priority order):
 *   1. Cron health — any source SILENT? Top banner if yes.
 *   2. Read-only mode status — if engaged, big amber banner.
 *   3. Abuse signals — failed-login spikes or honeypot triggers in last 24h.
 *   4. Moderation queue depth — pending policy_alerts, pending stories.
 *   5. Today's activity — campaign sends, new signups, new bills.
 *   6. Active operations — current cluster activity in last 7d.
 *
 * Every metric links to its drill-in dashboard. This page is the
 * triage layer; the others are the workbench.
 */

type AlertRow = { id: string; severity: string; created_at: string };
type ScraperRun = { source: string; finished_at: string | null; status: string };

export default async function OpsCockpitPage() {
  const ctx = await getAdminContext();
  if (!ctx.ok) redirect("/dashboard");

  // Service-role for admin-only tables (auth_events, etc).
  const sb = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const now = Date.now();
  const cutoff24Iso = new Date(now - 24 * 3600 * 1000).toISOString();
  const cutoff7Iso = new Date(now - 7 * 86400 * 1000).toISOString();
  const cutoff7Date = new Date(now - 7 * 86400 * 1000).toISOString().slice(0, 10);
  const cutoff30Date = new Date(now - 30 * 86400 * 1000).toISOString().slice(0, 10);

  // Pull everything in parallel — one trip per source, fan out widely.
  const [
    scraperLatestRes,
    siteConfigRes,
    pendingAlertsRes,
    pendingStoriesRes,
    pendingTipsRes,
    recentAuthEventsRes,
    recentSignupsRes,
    recentCampaignActionsRes,
    activeOpsRes,
    activeBillsTodayRes,
  ] = await Promise.all([
    sb.from("scraper_runs_latest")
      .select("source, finished_at, status"),
    sb.from("site_config")
      .select("emergency_mode, read_only_mode, read_only_reason, updated_at")
      .eq("id", true)
      .maybeSingle(),
    sb.from("policy_alerts")
      .select("id, severity, created_at", { count: "exact" })
      .eq("moderation_status", "pending"),
    sb.from("kratom_stories")
      .select("id", { count: "exact", head: true })
      .eq("moderation_status", "pending"),
    sb.from("policy_alerts")
      .select("id", { count: "exact", head: true })
      .eq("kind", "intel_tip")
      .eq("moderation_status", "pending"),
    sb.from("auth_events")
      .select("kind, status, error_code, ip, created_at")
      .gte("created_at", cutoff24Iso)
      .limit(1000),
    sb.from("auth_events")
      .select("id", { count: "exact", head: true })
      .eq("kind", "signup")
      .eq("status", "ok")
      .gte("created_at", cutoff24Iso),
    sb.from("campaign_actions")
      .select("id", { count: "exact", head: true })
      .gte("sent_at", cutoff24Iso),
    sb.from("bill_cluster_members")
      .select("bill_clusters!inner(slug, name, posture), bills!inner(state, last_action_at, active)")
      .eq("bills.active", true)
      .gte("bills.last_action_at", cutoff30Date)
      .limit(1500),
    sb.from("bills")
      .select("id, state, bill_number, last_action_at", { count: "exact" })
      .eq("active", true)
      .gte("last_action_at", cutoff7Date)
      .order("last_action_at", { ascending: false })
      .limit(10),
  ]);

  // ── Cron health
  type LatestRow = { source: string; finished_at: string | null; status: string };
  const scraperLatest = (scraperLatestRes.data ?? []) as LatestRow[];

  // Map each source to its expected interval. Same data the
  // /admin/automation page uses — keep it in sync if you add sources there.
  const EXPECTED: Record<string, number> = {
    sync_news_rss: 4, classify_news_policy: 4, push_critical_alerts: 4,
    push_state_news: 4, scrape_protectkratom_org: 4, correlate_news_to_bills: 4,
    sync_bill_sponsors: 36, detect_bill_clusters: 36, draft_legislator_stance: 36,
    sync_legislator_donors: 36, sync_lda_kratom: 36, scrape_bop_findings: 36,
    sync_research_pubmed: 36, generate_state_briefing: 36, fire_meeting_reminders: 36,
    sync_nonprofit_990s: 216, broadcast_whats_new: 216,
  };
  let silentCount = 0;
  let staleCount = 0;
  for (const r of scraperLatest) {
    const expected = EXPECTED[r.source];
    if (!expected) continue;
    if (!r.finished_at) continue;
    const ageH = (now - new Date(r.finished_at).getTime()) / 3600_000;
    if (ageH > expected * 3) silentCount += 1;
    else if (ageH > expected * 1.5) staleCount += 1;
  }

  // ── Read-only mode
  type SiteConfig = {
    emergency_mode: boolean; read_only_mode: boolean | null;
    read_only_reason: string | null; updated_at: string | null;
  };
  const siteCfg = (siteConfigRes.data as SiteConfig | null) ?? {
    emergency_mode: false, read_only_mode: false, read_only_reason: null, updated_at: null,
  };

  // ── Pending moderation
  type AuthEvt = { kind: string; status: string; error_code: string | null; ip: string | null; created_at: string };
  const events = (recentAuthEventsRes.data ?? []) as AuthEvt[];
  const honeypotHits = events.filter((e) => e.error_code === "honeypot_triggered").length;
  const timingTrapHits = events.filter((e) => e.error_code === "timing_trap_triggered").length;
  // Failed-login per IP concentrations (≥5 from same IP in 24h)
  const failByIp = new Map<string, number>();
  for (const e of events) {
    if (e.kind !== "login" || e.status !== "fail") continue;
    failByIp.set(e.ip ?? "(no-ip)", (failByIp.get(e.ip ?? "(no-ip)") ?? 0) + 1);
  }
  const ipConcentrations = [...failByIp.values()].filter((n) => n >= 5).length;
  const pendingAlerts = (pendingAlertsRes.data ?? []) as AlertRow[];
  const pendingCriticalAlerts = pendingAlerts.filter((a) => a.severity === "critical").length;

  // ── Active ops (last 30d, by state)
  type OpRow = {
    bill_clusters: { slug: string; name: string; posture: string } | Array<{ slug: string; name: string; posture: string }> | null;
    bills: { state: string } | Array<{ state: string }> | null;
  };
  const norm = <T,>(x: T | T[] | null): T | null => Array.isArray(x) ? x[0] ?? null : x;
  const opsState = new Set<string>();
  const opsCluster = new Set<string>();
  for (const r of (activeOpsRes.data ?? []) as OpRow[]) {
    const cl = norm(r.bill_clusters);
    const bl = norm(r.bills);
    if (cl) opsCluster.add(cl.slug);
    if (bl) opsState.add(bl.state);
  }

  // ── Recent bill movement (top 10 freshest)
  type ActiveBill = { id: string; state: string; bill_number: string; last_action_at: string | null };
  const recentBills = (activeBillsTodayRes.data ?? []) as ActiveBill[];

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <Link href="/admin" className="text-xs text-zinc-500 hover:text-emerald-400">← Admin</Link>
      <header className="mt-2 mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">
          ◉ Operator cockpit
        </p>
        <h1 className="mt-2 text-3xl font-bold sm:text-4xl">Morning glance · {new Date().toLocaleDateString()}</h1>
        <p className="mt-2 max-w-3xl text-sm text-zinc-400">
          One screen, one read. Every critical signal across the platform — cron, abuse, moderation,
          activity — surfaced here so you don&apos;t have to bounce across four dashboards. Each metric
          links to its drill-in view.
        </p>
      </header>

      {/* Work the site — the "act on it" tools (see a problem here → fix it here) */}
      <section className="mb-6 rounded-lg border border-emerald-800/50 bg-emerald-950/10 p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-emerald-300">🧰 Work the site</h2>
        <p className="mt-1 text-[11px] text-zinc-400">
          Your in-site command center — diagnose, moderate, and fix from here, no coding session needed.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {siteConfig.features.adminAiChief && (
            <ActionLink href="/admin/ai-editor" emoji="🧭" label="AI Editor-in-Chief"
              sub="Ask it what's wrong; it looks things up and proposes fixes you confirm." />
          )}
          <ActionLink href="/admin/master-edit" emoji="🛠" label="Master edit"
            sub="Spreadsheet editor over bills / campaigns / officials / alerts / states." />
          <ActionLink href="/admin/moderation" emoji="🛡" label="Moderation hub"
            sub="One-click auto-resolve the campaign + intel review queues." />
        </div>
      </section>

      {/* Big banners — only render when something needs immediate attention */}
      {silentCount > 0 && (
        <section className="mb-4 rounded-lg border-2 border-red-600/60 bg-red-950/30 p-4">
          <p className="text-sm font-bold uppercase text-red-300">
            🚨 {silentCount} cron source{silentCount === 1 ? "" : "s"} SILENT
          </p>
          <p className="mt-1 text-xs text-red-200">
            Past 3× expected interval. Background sync stack is degraded. Open{" "}
            <Link href="/admin/automation" className="underline">automation health</Link>.
          </p>
        </section>
      )}

      {siteCfg.read_only_mode && (
        <section className="mb-4 rounded-lg border-2 border-amber-600/60 bg-amber-950/30 p-4">
          <p className="text-sm font-bold uppercase text-amber-300">
            ⏸ Read-only mode is ON
          </p>
          <p className="mt-1 text-xs text-amber-200">
            Non-admin mutations refused.{" "}
            {siteCfg.read_only_reason && <>Reason: <em>&quot;{siteCfg.read_only_reason}&quot;</em>. </>}
            <Link href="/admin/emergency" className="underline">Toggle off</Link> when triage is done.
          </p>
        </section>
      )}

      {siteCfg.emergency_mode && (
        <section className="mb-4 rounded-lg border-2 border-red-600/60 bg-red-950/30 p-4">
          <p className="text-sm font-bold uppercase text-red-300">🚨 Emergency banner is showing site-wide</p>
          <p className="mt-1 text-xs text-red-200">
            Edit / toggle off at <Link href="/admin/emergency" className="underline">/admin/emergency</Link>.
          </p>
        </section>
      )}

      {/* Top-line metric grid */}
      <section className="mb-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Metric href="/admin/automation" tone={silentCount > 0 ? "red" : staleCount > 0 ? "amber" : "emerald"}
          label="Cron sources" value={scraperLatest.length}
          sub={`${silentCount} silent · ${staleCount} stale`} />
        <Metric href="/admin/abuse-signals" tone={ipConcentrations > 0 ? "red" : honeypotHits + timingTrapHits > 0 ? "amber" : "zinc"}
          label="Abuse (24h)" value={honeypotHits + timingTrapHits}
          sub={`${ipConcentrations} IP login concentration${ipConcentrations === 1 ? "" : "s"}`} />
        <Metric href="/admin/intel-queue" tone={pendingCriticalAlerts > 0 ? "red" : pendingAlerts.length > 0 ? "amber" : "zinc"}
          label="Pending policy alerts" value={pendingAlerts.length}
          sub={`${pendingCriticalAlerts} critical waiting`} />
        <Metric href="/admin/stories" tone={(pendingStoriesRes.count ?? 0) > 0 ? "amber" : "zinc"}
          label="Pending stories" value={pendingStoriesRes.count ?? 0}
          sub={`${pendingTipsRes.count ?? 0} intel tips queued`} />
      </section>

      {/* Activity row */}
      <section className="mb-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Metric href="/admin/users" tone="emerald"
          label="New signups (24h)" value={recentSignupsRes.count ?? 0}
          sub="ok-status auth_events.signup" />
        <Metric href="/admin/campaigns" tone="emerald"
          label="Campaign sends (24h)" value={recentCampaignActionsRes.count ?? 0}
          sub="One row per legislator contacted" />
        <Metric href="/intel/operations" tone="emerald"
          label="Active operations" value={opsCluster.size}
          sub={`Active in ${opsState.size} state${opsState.size === 1 ? "" : "s"} · 30d`} />
        <Metric href="/bills" tone="emerald"
          label="Bills moved (7d)" value={activeBillsTodayRes.count ?? 0}
          sub="Active bills with recent action_at" />
      </section>

      {/* Recently active bills — fast scan */}
      {recentBills.length > 0 && (
        <section className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
            🚀 Bills moved most recently
          </h2>
          <ul className="mt-2 flex flex-wrap gap-2 text-[11px]">
            {recentBills.map((b) => (
              <li key={b.id}>
                <Link
                  href={`/bills/${b.id}`}
                  className="rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1 hover:border-emerald-500"
                >
                  <span className="font-mono font-semibold text-zinc-200">{b.state} {b.bill_number}</span>
                  {b.last_action_at && (
                    <span className="ml-2 text-[10px] text-zinc-500">{b.last_action_at}</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Jump-tos */}
      <section className="mb-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <Quicklink href="/admin/automation" emoji="⚙" label="Automation health" />
        <Quicklink href="/admin/abuse-signals" emoji="🚨" label="Abuse signals" />
        <Quicklink href="/admin/intel-health" emoji="🩺" label="Intel pipeline health" />
        <Quicklink href="/admin/intel-queue" emoji="📥" label="Moderation: alerts" />
        <Quicklink href="/admin/stories" emoji="📖" label="Moderation: stories" />
        <Quicklink href="/admin/emergency" emoji="🚨" label="Emergency / read-only" />
        <Quicklink href="/admin/audit" emoji="📋" label="Admin action audit" />
        <Quicklink href="/admin/users" emoji="👥" label="Users" />
        <Quicklink href="/admin/data-quality" emoji="🧹" label="Data quality" />
      </section>

      <footer className="mt-8 rounded-md border border-zinc-800 bg-zinc-950/40 p-4 text-[10px] text-zinc-500">
        <p>
          <strong className="text-zinc-300">How to use this page:</strong> open every morning. If any banner is red,
          fix that first. If banners are clear, scan the metric grid for orange tones. If everything is emerald or zinc,
          you can stop reading and go ship features.
        </p>
        <p className="mt-2">
          To add a metric here, edit <code className="rounded bg-zinc-900 px-1">src/app/admin/ops/page.tsx</code>.
          Keep the page single-screen on a laptop — if it scrolls past one fold, it&apos;s lost its job.
        </p>
      </footer>
    </div>
  );
}

function Metric({
  href, tone, label, value, sub,
}: {
  href: string;
  tone: "red" | "amber" | "emerald" | "zinc";
  label: string;
  value: number;
  sub: string;
}) {
  const toneCls = {
    red: "border-red-700/40 bg-red-950/15",
    amber: "border-amber-700/40 bg-amber-950/15",
    emerald: "border-emerald-700/30 bg-emerald-950/10",
    zinc: "border-zinc-800 bg-zinc-950/40",
  }[tone];
  const valueCls = {
    red: "text-red-300",
    amber: "text-amber-300",
    emerald: "text-emerald-300",
    zinc: "text-zinc-200",
  }[tone];
  return (
    <Link
      href={href}
      className={`block rounded-lg border ${toneCls} p-3 transition hover:brightness-110`}
    >
      <p className="text-[10px] uppercase tracking-wider text-zinc-400">{label}</p>
      <p className={`mt-1 text-3xl font-bold ${valueCls}`}>{value.toLocaleString()}</p>
      <p className="mt-1 text-[10px] text-zinc-500">{sub}</p>
    </Link>
  );
}

function Quicklink({ href, emoji, label }: { href: string; emoji: string; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-[11px] hover:border-emerald-500"
    >
      <span className="text-base">{emoji}</span>
      <span className="text-zinc-200">{label}</span>
    </Link>
  );
}

function ActionLink({ href, emoji, label, sub }: { href: string; emoji: string; label: string; sub: string }) {
  return (
    <Link
      href={href}
      className="block rounded-md border border-zinc-800 bg-zinc-950/40 p-3 transition hover:border-emerald-500 hover:brightness-110"
    >
      <p className="flex items-center gap-2 text-sm font-medium text-zinc-100">
        <span className="text-base">{emoji}</span>{label}
      </p>
      <p className="mt-1 text-[11px] text-zinc-500">{sub}</p>
    </Link>
  );
}
