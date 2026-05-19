import { redirect } from "next/navigation";
import { getCreatorContext, getAdminQueueCounts } from "@/modules/admin/actions";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Admin" };
// Owner directive 2026-05-14: 'the campaigns stats number is wrong, this
// should update realtime. same with all stats here.' Force dynamic so
// every request re-queries — no caching of stale stats.
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Admin/Owner control room. Reorganized per ROADMAP.md audit: items
 * are grouped into priority bands so the screen surfaces "needs me
 * now" cards (queue counts > 0) above the daily-ops grid, with
 * observability and static catalogs collapsible below.
 *
 * Bands:
 *   P0 — Inbox (only renders if there's a backlog anywhere). Queue-
 *        bearing cards bubble to the top, sorted by count desc.
 *        Emergency Mode is pinned to the right edge (always visible
 *        even when no queue cards qualify).
 *   P1 — Daily ops. The campaigns/bills/users/announcements stuff
 *        admins touch routinely.
 *   P2 — Observability + data infra. Collapsible.
 *   P3 — Static catalogs (communities, integrations, partner shops).
 *        Collapsible.
 */
export default async function AdminPage() {
  const ctx = await getCreatorContext();
  if (!ctx.ok) redirect("/dashboard");
  const adminOnly = ctx.isAdmin || ctx.isOwner;

  const supabase = await createClient();
  // Honest stats. The pre-fix single 'Campaigns' count returned the table
  // total (~2,000+ including superseded + rejected) which the admin
  // correctly identified as misleading. We now show active + pending
  // separately and call them what they are.
  const [
    { count: userCount },
    { count: activeCampaignCount },
    { count: pendingCampaignCount },
    { count: activeLegislatorCount },
    { count: activeBillCount },
    { count: actionCount },
    queues,
  ] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase.from("campaigns").select("id", { count: "exact", head: true })
      .eq("active", true),
    supabase.from("campaigns").select("id", { count: "exact", head: true })
      .eq("review_state", "pending_review"),
    supabase.from("legislators").select("id", { count: "exact", head: true })
      .eq("active", true),
    supabase.from("bills").select("id", { count: "exact", head: true })
      .eq("active", true),
    supabase.from("campaign_actions").select("id", { count: "exact", head: true }),
    getAdminQueueCounts(),
  ]);

  // Build the inbox row: queue cards that have a backlog, sorted desc.
  // Each entry is a card descriptor — we render via AdminCard below.
  type QueueEntry = { href: string; title: string; body: string; count: number };
  const inbox: QueueEntry[] = [];
  if (adminOnly) {
    if (queues.campaigns > 0) inbox.push({
      href: "/admin/campaigns/pending",
      title: `Campaign review (${queues.campaigns})`,
      body: "Approve or reject auto-generated campaigns flagged for human review.",
      count: queues.campaigns,
    });
    if (queues.forum > 0) inbox.push({
      href: "/admin/forum",
      title: `Forum moderation (${queues.forum})`,
      body: "Review flagged posts + threads.",
      count: queues.forum,
    });
    if (queues.loungeBanReview > 0) inbox.push({
      href: "/admin/lounge",
      title: `Lounge moderation (${queues.loungeBanReview})`,
      body: "Delete chat messages, mute users.",
      count: queues.loungeBanReview,
    });
    if (queues.intelTips > 0) inbox.push({
      href: "/admin/intel-queue",
      title: `Intel queue (${queues.intelTips})`,
      body: "Review advocate-submitted tips from /alerts/submit.",
      count: queues.intelTips,
    });
    if (queues.syncDiscrepancies > 0) inbox.push({
      href: "/admin/sync-discrepancies",
      title: `Sync discrepancies (${queues.syncDiscrepancies})`,
      body: "Bills where AI fact-check disagrees with our DB.",
      count: queues.syncDiscrepancies,
    });
    if (queues.localRepRequests > 0) inbox.push({
      href: "/admin/local-rep-requests",
      title: `Local rep requests (${queues.localRepRequests})`,
      body: "Areas where users have asked us to add their local reps.",
      count: queues.localRepRequests,
    });
    if (queues.vendorApplications > 0) inbox.push({
      href: "/admin/vendor-applications",
      title: `Vendor applications (${queues.vendorApplications})`,
      body: "Review users applying to be verified vendors.",
      count: queues.vendorApplications,
    });
    if (queues.stories > 0) inbox.push({
      href: "/admin/stories",
      title: `Story moderation (${queues.stories})`,
      body: "Review user-submitted advocacy stories.",
      count: queues.stories,
    });
    if (queues.inactiveDiscord > 0) inbox.push({
      href: "/admin/discord-integrations",
      title: `Discord integrations (${queues.inactiveDiscord} inactive)`,
      body: "Re-enable disabled webhooks.",
      count: queues.inactiveDiscord,
    });
  }
  inbox.sort((a, b) => b.count - a.count);

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          {ctx.isOwner ? "Owner" : ctx.isAdmin ? "Admin" : "Advocate Leader"}
        </p>
        <h1 className="mt-2 text-3xl font-bold">{adminOnly ? "Control room" : "Leader workshop"}</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Signed in as <span className="font-mono text-zinc-200">{ctx.email}</span>
        </p>
        {adminOnly && (
          <p className="mt-3">
            <a
              href="/admin/ops"
              className="inline-flex items-center gap-2 rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400"
            >
              ◉ Open daily operator cockpit
            </a>
            <span className="ml-2 text-[11px] text-zinc-500">
              One-screen morning view: cron / abuse / moderation / activity.
            </span>
          </p>
        )}
      </header>

      {/* ── P0 Inbox + Emergency mode ────────────────────────────── */}
      {adminOnly && (inbox.length > 0 || true) && (
        <section className="mb-10">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            {inbox.length > 0 ? `Needs you now — ${inbox.reduce((n, e) => n + e.count, 0)} items across ${inbox.length} queue${inbox.length === 1 ? "" : "s"}` : "Status"}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {inbox.map((q) => (
              <AdminCard key={q.href} href={q.href} title={q.title} body={q.body} accent />
            ))}
            <AdminCard
              href="/admin/emergency"
              title="🚨 Emergency mode"
              body="Site-wide red banner. Use for FDA action, hostile federal bills, scheduling rumors."
            />
          </div>
        </section>
      )}

      {/* ── Stats strip ─ honest counts, force-dynamic, no cache. ──── */}
      <section className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <Stat label="Users" value={userCount} />
        <Stat label="Active campaigns" value={activeCampaignCount} tone={(activeCampaignCount ?? 0) > 0 ? "emerald" : "neutral"} />
        <Stat label="Pending review" value={pendingCampaignCount} tone={(pendingCampaignCount ?? 0) > 0 ? "amber" : "neutral"} />
        <Stat label="Active legislators" value={activeLegislatorCount} />
        <Stat label="Active bills" value={activeBillCount} />
        <Stat label="Actions sent" value={actionCount} />
      </section>
      <p className="mb-10 text-[10px] uppercase tracking-wider text-zinc-600">
        Stats refresh on every page load · last query {new Date().toISOString().slice(0, 19).replace("T", " ")} UTC
      </p>

      {/* ── P1 Daily ops ──────────────────────────────────────────── */}
      <section className="mb-10">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">Daily ops</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <AdminCard
            href="/admin/campaigns"
            title="Campaigns"
            body="Create, edit, archive call-to-action campaigns."
            accent
          />
          {adminOnly && queues.campaigns === 0 && (
            <AdminCard
              href="/admin/campaigns/pending"
              title="Campaign review"
              body="No campaigns currently waiting."
            />
          )}
          <AdminCard
            href="/admin/locals"
            title="Local officials"
            body="Add city + county officials for local campaigns."
          />
          {adminOnly && (
            <AdminCard
              href="/admin/bills"
              title="Bills"
              body="Edit any bill. Sensitive (MFA-gated)."
            />
          )}
          {adminOnly && (
            <AdminCard
              href="/admin/bills/new"
              title="+ Add a bill (manual)"
              body="For county / municipal bills OpenStates doesn't track."
            />
          )}
          {adminOnly && (
            <AdminCard
              href="/admin/users"
              title="Users"
              body="Manage admins, advocate leaders, ownership."
            />
          )}
          {adminOnly && queues.forum === 0 && (
            <AdminCard
              href="/admin/forum"
              title="Forum moderation"
              body="Review flagged posts + threads. Empty right now."
            />
          )}
          {adminOnly && queues.loungeBanReview === 0 && (
            <AdminCard
              href="/admin/lounge"
              title="Lounge moderation"
              body="Chat moderation. Empty right now."
            />
          )}
          {adminOnly && queues.stories === 0 && (
            <AdminCard
              href="/admin/stories"
              title="Story moderation"
              body="User-submitted advocacy stories. Empty right now."
            />
          )}
          {adminOnly && (
            <AdminCard
              href="/admin/announcements"
              title="Announcements"
              body="Post platform updates that show up in every user's 'What's new' widget."
            />
          )}
          {adminOnly && (
            <AdminCard
              href="/admin/events/new"
              title="+ Town halls + hearings"
              body="Add upcoming public events where advocates can show up."
            />
          )}
        </div>
      </section>

      {/* ── P2 Observability & data infra ─────────────────────────── */}
      {adminOnly && (
        <CollapsibleSection title="System & observability">
          <AdminCard
            href="/admin/legislators"
            title="State + federal sync"
            body="Trigger OpenStates / Congress sync, see counts."
          />
          {queues.syncDiscrepancies === 0 && (
            <AdminCard
              href="/admin/sync-discrepancies"
              title="Sync discrepancies"
              body="Bills where AI fact-check disagrees with our DB. Empty right now."
            />
          )}
          <AdminCard
            href="/admin/content"
            title="✏ Edit site copy"
            body="In-site editor for page text. Edit /support intro, /ethics text, the global announcement bar, more — from any device, no deploy. Cache invalidates within a minute. Every edit is audit-logged."
            accent
          />
          <AdminCard
            href="/admin/console"
            title="🛢 Console (nuclear option)"
            body="Direct SQL + manual cron triggers + cache invalidation. Owner-only for writes. Every action audit-logged. Use when no other admin page can fix what's broken — typically from a phone at 2am."
            accent
          />
          <AdminCard
            href="/admin/diagnostics"
            title="🩺 Diagnostics"
            body="Test every integration from a single screen: Supabase reachability, each Discord webhook, AI providers, push notifications to self, OAuth callbacks, env-var sanity. Isolates 'is iKratom broken or is the third-party down?'"
          />
          <AdminCard
            href="/admin/automation"
            title="⚙ Automation health"
            body="Every cron + scraper + DB trigger in one view. Surfaces when GH Actions / Vercel / Postgres triggers stop firing. Catches silent outages before intel goes stale."
          />
          <AdminCard
            href="/admin/abuse-signals"
            title="🚨 Abuse signals"
            body="Adversarial-pattern dashboard: honeypot triggers, timing-trap triggers, failed-login concentrations per IP, signup-abuse rings, top error codes. Use to triage active waves before flipping read-only mode."
          />
          <AdminCard
            href="/admin/intel-health"
            title="Intel Health"
            body="Pipeline observability — per-source freshness, recent failures."
          />
          <AdminCard
            href="/admin/data-quality"
            title="Data quality audit"
            body="Known data integrity issues across bills + alerts + news. Trends toward zero as editorial + script refinements run."
          />
          <AdminCard
            href="/admin/oauth-config"
            title="OAuth config check"
            body="Every redirect URI the app sends to Google / Discord. Use to fix 'Error 400: redirect_uri_mismatch' when users can't connect Gmail."
          />
          <AdminCard
            href="/admin/user-errors"
            title="📮 User error reports"
            body="User-reported errors across the site. Auto-fix classifier handles user-side issues silently; escalated patterns + sustained outages bubble here."
          />
          <AdminCard
            href="/admin/ai-control"
            title="AI Command Center"
            body="Live status of Ollama / Gemini / Groq + provider quotas + cost tracking."
          />
          <AdminCard
            href="/admin/chat"
            title="🤖 Admin chatbot · alpha"
            body="RAG-grounded chat over the iKratom corpus. Cited answers, free-tier inference, 30 msgs/hour."
          />
          <AdminCard
            href="/admin/bop-monitor"
            title="BoP Monitor"
            body="State Board of Pharmacy + adjacent agency surfaces. Early warning for the administrative path to a ban."
          />
          <AdminCard
            href="/admin/audit"
            title="Audit log"
            body="Sensitive actions, role changes, sync history."
          />
          <AdminCard
            href="/admin/exports"
            title="Data exports"
            body="Download CSVs: campaigns, actions, advocates, bills."
          />
        </CollapsibleSection>
      )}

      {/* ── P3 Static catalogs & integrations ─────────────────────── */}
      {adminOnly && (
        <CollapsibleSection title="Content & integrations">
          <AdminCard
            href="/admin/partners"
            title="Partner shops"
            body="Add a shop, print a counter-kit (poster + card + window cling + stickers) with a QR code."
          />
          <AdminCard
            href="/admin/communities"
            title="Forum communities"
            body="Add, edit, archive topical communities (Veterans, Shop owners, etc.)."
          />
          <AdminCard
            href="/admin/external-communities"
            title="External communities"
            body="Manage the FB groups, subreddits, Discord servers, and podcasts shown on /communities."
          />
          {queues.inactiveDiscord === 0 && (
            <AdminCard
              href="/admin/discord-integrations"
              title="Discord integrations"
              body="Connect partner server webhooks. All currently active."
            />
          )}
        </CollapsibleSection>
      )}

      <p className="mt-8 text-xs text-zinc-500">
        Reorganized per ROADMAP.md audit (2026-05-12). Queue items float to the top
        automatically; static cards collapse out of the way.
      </p>
    </div>
  );
}

function Stat({ label, value, tone }: {
  label: string; value: number | null | undefined; tone?: "emerald" | "amber" | "neutral";
}) {
  const cls =
    tone === "emerald" ? "border-emerald-700/40 bg-emerald-950/15" :
    tone === "amber"   ? "border-amber-700/40 bg-amber-950/15" :
                         "border-zinc-800 bg-zinc-950/40";
  const valCls =
    tone === "emerald" ? "text-emerald-200" :
    tone === "amber"   ? "text-amber-200" :
                         "text-zinc-100";
  return (
    <div className={`rounded-lg border p-4 ${cls}`}>
      <div className="text-xs uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${valCls}`}>
        {value == null ? "—" : value.toLocaleString()}
      </div>
    </div>
  );
}

function CollapsibleSection({ title, children }: { title: string; children: React.ReactNode }) {
  // Uses <details> for SSR-friendly progressive disclosure — no client JS
  // needed, accessible by default, browser-native open/close.
  return (
    <details className="mb-8 group">
      <summary className="mb-3 cursor-pointer list-none text-xs font-semibold uppercase tracking-wider text-zinc-500 hover:text-emerald-400 [&::-webkit-details-marker]:hidden">
        <span className="inline-block transition-transform group-open:rotate-90">▸</span>{" "}
        {title}
      </summary>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </details>
  );
}

function AdminCard({
  href, title, body, disabled, accent,
}: { href: string; title: string; body: string; disabled?: boolean; accent?: boolean }) {
  const cls = disabled
    ? "border-zinc-900 bg-zinc-950/40 opacity-50 cursor-not-allowed"
    : accent
    ? "border-emerald-700/50 bg-emerald-950/20 hover:border-emerald-500"
    : "border-zinc-800 bg-zinc-950/40 hover:border-emerald-500";
  const content = (
    <>
      <h3 className={`text-base font-semibold ${accent ? "text-emerald-300" : ""}`}>{title}</h3>
      <p className="mt-1 text-sm text-zinc-400">{body}</p>
      {disabled && <p className="mt-2 text-xs text-zinc-600">Coming soon</p>}
    </>
  );
  if (disabled) return <div className={`block rounded-lg border p-5 transition ${cls}`}>{content}</div>;
  return <a href={href} className={`block rounded-lg border p-5 transition ${cls}`}>{content}</a>;
}
