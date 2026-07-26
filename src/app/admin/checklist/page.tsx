import { redirect } from "next/navigation";
import Link from "next/link";
import { getAdminContext, getAdminQueueCounts } from "@/modules/admin/actions";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { summarizeCronHealth } from "@/lib/cron-expectations";

export const metadata = { title: "Daily checklist & operator manual" };
export const dynamic = "force-dynamic";

/**
 * /admin/checklist — the owner's daily routine as a LIVE checklist, plus the
 * instruction manual for every in-site backend tool (owner ask 2026-07-05:
 * "a checklist like page for everything that should be checked daily along
 * with whatever insite tools to use; a clear instruction manual for insite
 * backend features and what they do and when they should be used").
 *
 * Relationship to /admin/ops: the cockpit is the one-glance dashboard (every
 * signal, links out); THIS page is the guided routine — ordered steps, each
 * with its live status, which tool to open, and what to do when it's red.
 * New-admin onboarding starts here; muscle-memory operators live in /ops.
 *
 * Doc sibling: docs/RUNBOOK_owner_ops.md (the out-of-site copy). Keep the
 * two aligned when adding a surface.
 */

type Tone = "ok" | "warn" | "bad" | "info";

export default async function ChecklistPage() {
  const ctx = await getAdminContext({ require: "view_ops_console" });
  if (!ctx.ok) redirect("/dashboard");

  const sb = createServiceRoleClient();
  const now = Date.now();
  const cutoff24 = new Date(now - 24 * 3600_000).toISOString();

  const [latestRes, cfgRes, authRes, pendCampRes, pendAlertRes, pendCallRes, errRunsRes, briefRes, queues] =
    await Promise.all([
      sb.from("scraper_runs_latest").select("source, finished_at, status"),
      sb.from("site_config").select("emergency_mode, read_only_mode").eq("id", true).maybeSingle(),
      sb.from("auth_events").select("kind, status, error_code, ip").gte("created_at", cutoff24).limit(1000),
      sb.from("campaigns").select("id", { count: "exact", head: true }).eq("review_state", "pending_review"),
      sb.from("policy_alerts").select("id", { count: "exact", head: true }).eq("moderation_status", "pending"),
      sb.from("call_sessions").select("id", { count: "exact", head: true }).eq("moderation_status", "pending_review"),
      sb.from("scraper_runs").select("id", { count: "exact", head: true }).eq("status", "error").gte("started_at", cutoff24),
      sb.from("scraper_runs").select("finished_at").eq("source", "fire_daily_brief_push").eq("status", "success")
        .order("finished_at", { ascending: false }).limit(1).maybeSingle(),
      getAdminQueueCounts(),
    ]);

  // ── 1. Cron flow
  const cron = summarizeCronHealth(
    (latestRes.data ?? []) as { source: string; finished_at: string | null }[], now,
  );
  const cronTone: Tone = cron.silent.length > 0 ? "bad" : cron.stale.length > 0 ? "warn" : "ok";

  // ── 2. Failed runs (24h)
  const errCount = errRunsRes.count ?? 0;
  const errTone: Tone = errCount > 3 ? "bad" : errCount > 0 ? "warn" : "ok";

  // ── 3. Daily brief (Eastern "today"; fires ~10:17 UTC — before that,
  //      yesterday's success is still on time, so only red past 48h)
  const etDate = (d: number | string) => new Date(d).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const briefAt = briefRes.data?.finished_at ? new Date(briefRes.data.finished_at).getTime() : null;
  const briefToday = briefAt !== null && etDate(briefAt) === etDate(now);
  const briefTone: Tone = briefToday ? "ok" : briefAt !== null && now - briefAt < 48 * 3600_000 ? "warn" : "bad";

  // ── 4/5. Review queues
  const pendCampaigns = pendCampRes.count ?? 0;
  const pendAlerts = pendAlertRes.count ?? 0;
  const otherQueues: { label: string; href: string; count: number }[] = [
    { label: "Forum flags", href: "/admin/forum", count: queues.forum },
    { label: "Lounge", href: "/admin/lounge", count: queues.loungeBanReview },
    { label: "Stories", href: "/admin/stories", count: queues.stories },
    { label: "Call intel", href: "/admin/calls", count: pendCallRes.count ?? 0 },
    { label: "Sync discrepancies", href: "/admin/sync-discrepancies", count: queues.syncDiscrepancies },
    { label: "Local-rep requests", href: "/admin/local-rep-requests", count: queues.localRepRequests },
    { label: "Vendor applications", href: "/admin/vendor-applications", count: queues.vendorApplications },
  ];
  const otherTotal = otherQueues.reduce((n, q) => n + q.count, 0);

  // ── 6. Abuse (24h)
  const events = (authRes.data ?? []) as { kind: string; status: string; error_code: string | null; ip: string | null }[];
  const traps = events.filter((e) => e.error_code === "honeypot_triggered" || e.error_code === "timing_trap_triggered").length;
  const failByIp = new Map<string, number>();
  for (const e of events) {
    if (e.kind === "login" && e.status === "fail") failByIp.set(e.ip ?? "-", (failByIp.get(e.ip ?? "-") ?? 0) + 1);
  }
  const ipBursts = [...failByIp.values()].filter((n) => n >= 5).length;
  const abuseTone: Tone = ipBursts > 0 ? "bad" : traps > 0 ? "warn" : "ok";

  // ── 7. Emergency flags
  const cfg = cfgRes.data as { emergency_mode: boolean; read_only_mode: boolean | null } | null;
  const flagsOn = Boolean(cfg?.emergency_mode) || Boolean(cfg?.read_only_mode);

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <Link href="/admin" className="text-xs text-zinc-500 hover:text-emerald-400">← Admin</Link>
      <header className="mt-2 mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">✅ Daily checklist</p>
        <h1 className="mt-2 text-3xl font-bold">Run the platform in 5 minutes</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          Work top to bottom every morning. Each step shows its <em>live</em> status right now, the in-site
          tool to open, and what to do when it&apos;s not green. All green = you&apos;re done — go recruit an
          advocate. The <a href="#manual" className="text-emerald-400 underline">tool manual</a> is below.
        </p>
      </header>

      <ol className="space-y-3">
        <Check n={1} tone={cronTone} title="Are the pipelines flowing?"
          status={cron.silent.length > 0
            ? `${cron.silent.length} SILENT: ${cron.silent.slice(0, 4).join(", ")}`
            : cron.stale.length > 0
              ? `${cron.stale.length} running late: ${cron.stale.slice(0, 4).join(", ")}`
              : `${cron.tracked} tracked sources all on schedule`}
          tools={[["/admin/automation", "Automation health"], ["/admin/console", "Console → Run any pipeline"]]}
          ifRed='Open Automation health to see which source stopped. Re-run its pipeline one-click from the Console ("Run any pipeline"), or ask the AI Editor: "run the daily cron". If it stays silent after a re-run, it usually means an upstream site/API is down — it self-retries; note it and check tomorrow.' />

        <Check n={2} tone={errTone} title="Any failed automation runs in the last 24h?"
          status={errCount === 0 ? "No failures on record" : `${errCount} failed run${errCount === 1 ? "" : "s"}`}
          tools={[["/admin/ai-editor", 'AI Editor — ask "show recent errors"'], ["/admin/intel-health", "Intel health"]]}
          ifRed="Ask the AI Editor to show recent errors — it reads the actual error messages and tells you whether it's transient (external site down, rate limit) or needs action. One-off failures self-heal on the next run." />

        <Check n={3} tone={briefTone} title="Did the daily brief go out?"
          status={briefToday ? "Fired today (ET) ✓" : briefAt ? `Last fired ${etDate(briefAt)} — today's fires ~6:17am ET` : "Never fired"}
          tools={[["/admin/console", "Console → Run any pipeline → Daily cron"]]}
          ifRed="If it's past ~8am ET and the brief hasn't fired, run the Daily cron from the Console — the brief has a per-day guard, so a re-run can never double-buzz phones." />

        <Check n={4} tone={pendCampaigns > 0 ? "warn" : "ok"} title="Campaign review queue"
          status={pendCampaigns === 0 ? "Empty" : `${pendCampaigns} campaign${pendCampaigns === 1 ? "" : "s"} waiting`}
          tools={[["/admin/moderation", "Moderation hub — one-click Auto-resolve"], ["/admin/campaigns/pending", "Review by hand"]]}
          ifRed="Click Auto-resolve in the Moderation hub (dedup → supersede, junk → reject, verified-real → approve). A nightly janitor does the same automatically — a small morning queue is normal, a growing one isn't." />

        <Check n={5} tone={pendAlerts > 0 ? "warn" : "ok"} title="Intel alert queue"
          status={pendAlerts === 0 ? "Empty" : `${pendAlerts} alert${pendAlerts === 1 ? "" : "s"} pending`}
          tools={[["/admin/moderation", "Moderation hub"], ["/admin/intel-queue", "Review by hand"]]}
          ifRed="Same play as campaigns: Auto-resolve first, hand-review only what it leaves behind. Remember: approving an alert with action-required spawns a campaign — approve as news-only unless the fight is real." />

        <Check n={6} tone={otherTotal > 0 ? "warn" : "ok"} title="Community + data queues"
          status={otherTotal === 0 ? "All empty" : otherQueues.filter((q) => q.count > 0).map((q) => `${q.label}: ${q.count}`).join(" · ")}
          tools={otherQueues.filter((q) => q.count > 0).length > 0
            ? otherQueues.filter((q) => q.count > 0).map((q) => [q.href, q.label] as [string, string])
            : [["/admin/moderation", "Moderation hub"]]}
          ifRed="Each queue links straight to its review page. Forum/lounge/stories are judgment calls — apply the same standard regardless of stance; when in doubt, escalate to yourself tomorrow rather than deciding angry." />

        <Check n={7} tone={abuseTone} title="Abuse signals (24h)"
          status={ipBursts > 0
            ? `${ipBursts} IP${ipBursts === 1 ? "" : "s"} hammering logins (≥5 fails)`
            : traps > 0 ? `${traps} honeypot/timing-trap trigger${traps === 1 ? "" : "s"}` : "Quiet"}
          tools={[["/admin/abuse-signals", "Abuse signals"], ["/admin/emergency", "Emergency / read-only"]]}
          ifRed="Open Abuse signals to see the pattern. Isolated trap hits are bots bouncing off — fine. A concentrated wave (many IPs, signup rings) is when read-only mode earns its keep: flip it, triage, flip back." />

        <Check n={8} tone={flagsOn ? "bad" : "ok"} title="Emergency + read-only flags"
          status={flagsOn
            ? `${cfg?.emergency_mode ? "EMERGENCY banner ON" : ""}${cfg?.emergency_mode && cfg?.read_only_mode ? " · " : ""}${cfg?.read_only_mode ? "READ-ONLY mode ON" : ""}`
            : "Both off (normal)"}
          tools={[["/admin/emergency", "Emergency controls"]]}
          ifRed="These should be OFF on a normal day. If one is on and the incident is over, turn it off — read-only silently blocks every user action while it's engaged." />

        <Check n={9} tone="info" title="After any code merge: confirm the deploy"
          status="Manual check — Vercel's webhook has missed merges before"
          tools={[["https://vercel.com", "Vercel dashboard (external)"]]}
          ifRed="If you (or a coding session) merged something and the site doesn't show it, check Vercel for a Production deployment of that commit. No deployment = ask the next coding session to push a tiny nudge commit." />
      </ol>

      <section className="mt-8 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 text-sm text-zinc-400">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-300">📅 Weekly (any quiet morning)</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px]">
          <li><Link href="/admin/data-quality" className="text-emerald-400 hover:underline">Data quality</Link> — the issue count should trend toward zero; investigate anything that jumped.</li>
          <li><Link href="/admin/state-status" className="text-emerald-400 hover:underline">State status</Link> — confirm/override any states flagged <em>needs review</em> (these gate the public maps).</li>
          <li><Link href="/admin/ai-control" className="text-emerald-400 hover:underline">AI control</Link> — all free providers green? One limping is fine (the router falls through); all red means keys expired.</li>
          <li><Link href="/admin/audit" className="text-emerald-400 hover:underline">Audit log</Link> — skim for actions you don&apos;t recognize.</li>
          <li><Link href="/admin/diagnostics" className="text-emerald-400 hover:underline">Diagnostics</Link> — run the integration test screen after any provider/key change.</li>
        </ul>
      </section>

      {/* ───────────────────────── The manual ───────────────────────── */}
      <header id="manual" className="mt-12 mb-4 scroll-mt-8">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">📖 Operator manual</p>
        <h2 className="mt-2 text-2xl font-bold">Every in-site tool — what it does, when to reach for it</h2>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          Grouped by job. The out-of-site copy of this manual lives in <code className="rounded bg-zinc-900 px-1 text-xs">docs/RUNBOOK_owner_ops.md</code> in the repo.
        </p>
      </header>

      <ManualGroup title="🧰 Work the site — diagnose & fix" open>
        <Tool href="/admin/ops" name="Operator cockpit" what="Every critical signal on one screen: cron, abuse, queues, activity." when="First page every morning. If a banner is red, fix that before anything else." />
        <Tool href="/admin/ai-editor" name="AI Editor-in-Chief" what="Free conversational copilot. Looks up bills/campaigns/officials/queues/cron health itself, answers codebase questions (search_docs), proposes fixes + cron runs you confirm with one click." what2="Cannot edit code — it says so and routes those to a coding session." when="Your default 'something looks wrong' tool. Ask in plain English; confirm what it proposes." />
        <Tool href="/admin/console" name="Console" what="Run ANY cron pipeline one-click (GitHub Actions + Vercel), flush caches, and (owner-only) run raw SQL." when="When data is stale and you don't want to wait for the schedule, or when no other page can fix it. Prefer the pipelines panel; SQL is the last resort." />
        <Tool href="/admin/master-edit" name="Master edit" what="Spreadsheet editor over bills / campaigns / officials / alerts / states. Whitelisted fields, before→after diff, audited apply." when="A specific field is wrong (bill status, official's contact) and you want to fix it by hand." />
        <Tool href="/admin/moderation" name="Moderation hub" what="All review queues with one-click Auto-resolve for campaigns + intel." when="Steps 4–6 of the checklist. The nightly janitor runs the same logic; this is your manual override." />
        <Tool href="/admin/content" name="Edit site copy" what="In-site editor for page text (support intro, ethics, announcement bar) — no deploy needed." when="Wording changes. Live within a minute." />
      </ManualGroup>

      <ManualGroup title="📥 Review queues">
        <Tool href="/admin/campaigns/pending" name="Campaign review" what="Auto-generated campaigns held for approval." when="Step 4. Approving publishes + notifies matching users — be sure." />
        <Tool href="/admin/intel-queue" name="Intel queue" what="Advocate tips + scraper alerts pending moderation." when="Step 5. Action-required approvals spawn campaigns; news-only approvals just publish." />
        <Tool href="/admin/forum" name="Forum moderation" what="Flagged posts/threads." when="Step 6. Hide abuse, leave anger at policy alone, escalate hard calls." />
        <Tool href="/admin/lounge" name="Lounge moderation" what="Live-chat message deletion + mutes." when="Step 6." />
        <Tool href="/admin/stories" name="Story moderation" what="User-submitted advocacy stories." when="Step 6. These appear on the public homepage — read fully before approving." />
        <Tool href="/admin/calls" name="Call intel review" what="Advocate call summaries for the public board." when="Step 6." />
        <Tool href="/admin/sync-discrepancies" name="Sync discrepancies" what="Bills where the fact-check disagrees with our DB." when="Most self-resolve nightly; hand-check ones that persist 3+ days." />
        <Tool href="/admin/local-rep-requests" name="Local-rep requests" what="Areas users asked us to cover." when="The cloud resolver drains these every 6h; kick it from the Console if one is urgent." />
        <Tool href="/admin/user-errors" name="User error reports" what="User-side errors; an auto-classifier fixes most silently." when="Only when a pattern bubbles up — repeated identical reports = real bug for a coding session." />
        <Tool href="/admin/feedback" name="Feedback reports" what="The floating feedback widget's submissions, with screenshots." when="Weekly skim, or after shipping something user-facing." />
      </ManualGroup>

      <ManualGroup title="🩺 Observability">
        <Tool href="/admin/automation" name="Automation health" what="Every cron/scraper/DB trigger with freshness + the staleness registry." when="Step 1 drill-in. The push-alert system pages you from the same data." />
        <Tool href="/admin/intel-health" name="Intel health" what="Per-source pipeline freshness + recent failures." when="Step 2 drill-in — 'is the blood flowing.'" />
        <Tool href="/admin/abuse-signals" name="Abuse signals" what="Honeypots, timing traps, login concentrations, signup rings." when="Step 7 drill-in. Pair with Emergency controls during a wave." />
        <Tool href="/admin/data-quality" name="Data quality" what="Known integrity issues across bills/alerts/news, trending to zero." when="Weekly." />
        <Tool href="/admin/diagnostics" name="Diagnostics" what="One-screen integration tester: Supabase, Discord webhooks, AI providers, push-to-self, OAuth, env sanity." when="'Is iKratom broken or is the third-party down?' — run this first." />
        <Tool href="/admin/ai-control" name="AI command center" what="Free-provider status + quotas (Ollama/Gemini/Groq…)." when="Weekly, or when AI features feel slow/dead." />
        <Tool href="/admin/audit" name="Audit log" what="Every sensitive action — yours, admins', and the AI editor's confirmed actions." when="Weekly skim; always after something surprising." />
        <Tool href="/admin/oauth-config" name="OAuth config" what="The exact redirect URIs the app generates per provider." when="A user reports 'redirect_uri_mismatch' connecting Gmail/Discord." />
      </ManualGroup>

      <ManualGroup title="🗂 Data & content">
        <Tool href="/admin/campaigns" name="Campaigns" what="Create/edit/archive call-to-action campaigns." when="Authoring; slug is permanent once shared." />
        <Tool href="/admin/bills" name="Bills" what="Edit any bill (MFA-gated)." when="Prefer Master edit for single fields; this for deep edits." />
        <Tool href="/admin/bills/new" name="Add a bill" what="Manual entry for county/municipal bills the APIs don't track." when="A local ordinance surfaces that OpenStates/LegiScan won't have." />
        <Tool href="/admin/legislators" name="Legislator sync" what="Trigger per-state OpenStates/Congress roster refresh." when="A roster looks stale or an election just seated new members." />
        <Tool href="/admin/locals" name="Local officials" what="Add city/county officials for local campaigns." when="Only publicly-published contact info — never personal numbers." />
        <Tool href="/admin/state-status" name="State status" what="Canonical per-state legality map source; auto-derived, owner-confirmed." when="Weekly: clear the needs-review flags. This gates the public maps." />
        <Tool href="/admin/bop-monitor" name="BoP monitor" what="Board-of-Pharmacy surfaces — the administrative path to a ban." when="When a BoP alert fires, or monthly." />
        <Tool href="/admin/announcements" name="Announcements" what="Posts to every user's What's-new widget." when="Shipping something users should notice." />
        <Tool href="/admin/exports" name="Data exports" what="CSV downloads: campaigns, actions, advocates, bills." when="Reporting, backups, or sharing with allied orgs." />
      </ManualGroup>

      <ManualGroup title="👥 People & integrations">
        <Tool href="/admin/users" name="Users" what="Roles: admins, advocate leaders, ownership. Password-reset + magic links." when="Promotions/demotions; every change is audited." />
        <Tool href="/admin/partners" name="Partner shops" what="Shop records + printable QR counter-kits." when="Onboarding a shop." />
        <Tool href="/admin/communities" name="Forum communities" what="Topical community CRUD (Veterans, Shop owners…)." when="Rarely." />
        <Tool href="/admin/external-communities" name="External communities" what="The FB/Reddit/Discord/podcast directory on /communities." when="Adding a community hub you vetted." />
        <Tool href="/admin/discord-integrations" name="Discord integrations" what="Partner-server webhooks for bill alerts." when="A partner reports alerts stopped: re-enable here." />
        <Tool href="/admin/emergency" name="Emergency controls" what="Site-wide banner + read-only mode (also gates the automations)." when="FDA action, scheduling rumor, abuse wave. Turn OFF when done — step 8 checks this." />
      </ManualGroup>

      <footer className="mt-10 rounded-md border border-zinc-800 bg-zinc-950/40 p-4 text-[11px] text-zinc-500">
        Add a tool here when you ship one (<code className="rounded bg-zinc-900 px-1">src/app/admin/checklist/page.tsx</code>) and mirror it in{" "}
        <code className="rounded bg-zinc-900 px-1">docs/RUNBOOK_owner_ops.md</code>. The checklist rows read live data — if a row is wrong, that&apos;s a bug worth reporting.
      </footer>
    </div>
  );
}

// ── presentational helpers ──────────────────────────────────────────────

const TONE_STYLES: Record<Tone, { pill: string; label: string }> = {
  ok:   { pill: "bg-emerald-950/40 border-emerald-700/50 text-emerald-300", label: "OK" },
  warn: { pill: "bg-amber-950/40 border-amber-700/50 text-amber-300", label: "ATTENTION" },
  bad:  { pill: "bg-red-950/40 border-red-700/50 text-red-300", label: "ACTION NEEDED" },
  info: { pill: "bg-zinc-900 border-zinc-700 text-zinc-400", label: "MANUAL" },
};

function Check({ n, tone, title, status, tools, ifRed }: {
  n: number; tone: Tone; title: string; status: string;
  tools: [string, string][]; ifRed: string;
}) {
  const t = TONE_STYLES[tone];
  return (
    <li className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-zinc-800 text-xs font-bold text-zinc-300">{n}</span>
        <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
        <span className={`ml-auto rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${t.pill}`}>{t.label}</span>
      </div>
      <p className="mt-2 text-[13px] text-zinc-300">{status}</p>
      <p className="mt-2 text-[11px] text-zinc-500">
        <span className="font-semibold text-zinc-400">Tool:</span>{" "}
        {tools.map(([href, label], i) => (
          <span key={href}>
            {i > 0 && " · "}
            {href.startsWith("http")
              ? <a href={href} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">{label} ↗</a>
              : <Link href={href} className="text-emerald-400 hover:underline">{label}</Link>}
          </span>
        ))}
      </p>
      {tone !== "ok" && (
        <p className="mt-2 rounded border border-zinc-800 bg-zinc-950/60 p-2 text-[11px] leading-relaxed text-zinc-400">
          {ifRed}
        </p>
      )}
    </li>
  );
}

function ManualGroup({ title, open, children }: { title: string; open?: boolean; children: React.ReactNode }) {
  return (
    <details className="group mb-4 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4" open={open}>
      <summary className="cursor-pointer list-none text-sm font-semibold text-zinc-200 hover:text-emerald-300 [&::-webkit-details-marker]:hidden">
        <span className="mr-1 inline-block transition-transform group-open:rotate-90">▸</span> {title}
      </summary>
      <div className="mt-3 space-y-3">{children}</div>
    </details>
  );
}

function Tool({ href, name, what, what2, when }: {
  href: string; name: string; what: string; what2?: string; when: string;
}) {
  return (
    <div className="rounded border border-zinc-800/70 bg-zinc-950/60 p-3">
      <p className="text-[13px] font-semibold">
        <Link href={href} className="text-emerald-300 hover:underline">{name}</Link>
        <span className="ml-2 font-mono text-[10px] text-zinc-600">{href}</span>
      </p>
      <p className="mt-1 text-[12px] text-zinc-400">{what}{what2 && <> <span className="text-zinc-500">{what2}</span></>}</p>
      <p className="mt-1 text-[11px] text-zinc-500"><span className="font-semibold text-zinc-400">When:</span> {when}</p>
    </div>
  );
}
