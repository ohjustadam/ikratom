import { redirect } from "next/navigation";
import { getCreatorContext } from "@/modules/admin/actions";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Leader workshop" };
export const dynamic = "force-dynamic";

/**
 * /leader — dedicated panel for advocate-leaders.
 *
 * Mirrors /admin in structure: a single landing page that gates on
 * is_advocate_leader (or is_admin / is_owner), then shows tools
 * specific to the leader role.
 *
 * v1 surfaces: stubs for the field-work + recruit-management features
 * that are queued. Each "Coming soon" card describes the planned
 * feature with enough specificity that leaders know what's in flight.
 *
 * Privacy posture (per owner):
 *   - On-site signups via leader's phone use a magic-link flow:
 *     leader collects email + first name + zip ONLY; the new user
 *     completes profile via the link emailed to them.
 *   - Leaders see their own recruits' info; team/captain hierarchy
 *     comes later.
 *   - No sensitive data ever sits on a leader's device beyond what's
 *     needed to send the invite.
 */
export default async function LeaderPage() {
  const ctx = await getCreatorContext();
  if (!ctx.ok) redirect("/dashboard?need=leader");

  const supabase = await createClient();

  // Recruits — users who have this leader's id stamped as referrer.
  // Profile.referrer_id may not exist yet; the query falls back to
  // empty array if column missing, so the page renders even before
  // the schema piece lands.
  let recruitCount = 0;
  let recentRecruits: Array<{ id: string; created_at: string; full_name: string | null }> = [];
  try {
    const { count } = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("referrer_id", ctx.userId);
    recruitCount = count ?? 0;

    const { data: recent } = await supabase
      .from("profiles")
      .select("id, created_at, full_name")
      .eq("referrer_id", ctx.userId)
      .order("created_at", { ascending: false })
      .limit(5);
    recentRecruits = (recent ?? []) as typeof recentRecruits;
  } catch {
    // referrer_id column doesn't exist yet — silent skip
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          {ctx.isOwner ? "Owner" : ctx.isAdmin ? "Admin" : "Advocate Leader"}
        </p>
        <h1 className="mt-2 text-3xl font-bold">Leader workshop</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Tools built for the people doing the in-person, sleeves-rolled-up
          advocacy work — booth shifts, door-to-door, shop visits, hearing-room
          turnouts.
        </p>
      </header>

      {/* Recruit summary */}
      <section className="mb-8 rounded-lg border border-emerald-700/40 bg-emerald-950/10 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-emerald-300">
              📊 Your recruits
            </p>
            <p className="mt-1 text-3xl font-bold">{recruitCount.toLocaleString()}</p>
          </div>
          <span className="text-xs text-zinc-500">advocates you brought in</span>
        </div>
        {recentRecruits.length > 0 && (
          <ul className="mt-4 space-y-1 text-sm">
            {recentRecruits.map((r) => (
              <li key={r.id} className="flex items-center gap-3 text-zinc-300">
                <span className="font-mono text-[10px] text-zinc-500">
                  {new Date(r.created_at).toLocaleDateString()}
                </span>
                <span>{r.full_name ?? "(unnamed advocate)"}</span>
              </li>
            ))}
          </ul>
        )}
        {recruitCount === 0 && (
          <p className="mt-3 text-xs text-zinc-500">
            No recruits yet. Open Field signup below and onboard your first advocate —
            they&apos;ll show up here with stats on who&apos;s actively taking action.
          </p>
        )}
      </section>

      {/* ── Shipped tools — what you can do today ──────────────── */}
      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-400">
          What you can do today
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <a
            href="/leader/field-signup"
            className="rounded-lg border border-emerald-500 bg-emerald-950/20 p-5 transition hover:border-emerald-400 hover:bg-emerald-950/30 sm:col-span-2 lg:col-span-3"
          >
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-lg font-semibold">📍 Field signup</h3>
              <span className="rounded bg-emerald-500 px-1.5 py-0.5 text-[10px] font-bold uppercase text-zinc-950">
                Live
              </span>
            </div>
            <p className="mt-2 text-sm text-zinc-300">
              Onboard an advocate in 30 seconds. Collect email + first name + zip on
              your phone; magic-link email lets them finish their profile from their
              own device. Open this on your phone at events.
            </p>
            <p className="mt-2 text-xs font-semibold text-emerald-300">
              Onboard a recruit now →
            </p>
          </a>
          <ShippedCard
            href="/admin/campaigns"
            title="Author a campaign"
            body="Create call-to-action campaigns. They go through admin review before activation."
          />
          <ShippedCard
            href="/admin/locals"
            title="Add local officials"
            body="City or county officials your area's bills should target. Once added they appear on /bills, /pulse, and any local-scope campaigns auto-pick them up."
          />
        </div>
      </section>

      {/* ── Roadmap (collapsed) ────────────────────────────────── */}
      <details className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/40 p-5 group">
        <summary className="cursor-pointer list-none text-sm font-semibold text-zinc-300 hover:text-emerald-400 [&::-webkit-details-marker]:hidden">
          <span className="inline-block transition-transform group-open:rotate-90">▸</span>{" "}
          Coming soon for leaders (7 tools)
        </summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <ToolCard
            title="🏪 Business outreach"
            status="soon"
            body="Walk into a shop, log the visit (consent collected, materials left, follow-up scheduled). Real-time map of active vs. cold shops."
          />
          <ToolCard
            title="🚪 Door-to-door tracker"
            status="soon"
            body="Walking lists scoped to your campaign. Mark each door (interested, not home, refused, signed up). Auto-sync engagement stats."
          />
          <ToolCard
            title="🎤 Hearing turnout"
            status="soon"
            body="When a critical bill hits a hearing, organize turnout from your area. RSVP roster, ride-share coordination, talking points."
          />
          <ToolCard
            title="📋 QR recruitment kit"
            status="soon"
            body="Print/share a QR poster with your leader code. Anyone who scans signs up under you. Track which event converts best."
          />
          <ToolCard
            title="🏆 Achievements + ranks"
            status="planned"
            body="Recognition for advocates who show up. Earn ranks based on actions, recruits, hearings. Public leaderboard opt-in."
          />
          <ToolCard
            title="👥 Teams + captains"
            status="planned"
            body="Organize leaders into teams, designate captains, run regional campaigns with hierarchical roll-ups."
          />
          <ToolCard
            title="🎓 Leader playbook"
            status="planned"
            body="Library of proven scripts, talking points, objection handlers, and templates from the most effective leaders — opt-in shared."
          />
        </div>
      </details>

      <p className="mt-8 text-xs text-zinc-500">
        These tools light up as we ship them. Owner is shipping fastest on the
        bottlenecks first — field signup is next on the queue.
      </p>
    </div>
  );
}

function ToolCard({
  title,
  body,
  status,
}: {
  title: string;
  body: string;
  status: "soon" | "planned";
}) {
  return (
    <div
      className={`rounded-lg border p-5 ${
        status === "soon"
          ? "border-dashed border-emerald-700/40 bg-emerald-950/10"
          : "border-dashed border-zinc-700 bg-zinc-950/40"
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold">{title}</h3>
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
            status === "soon"
              ? "bg-emerald-500 text-zinc-950"
              : "bg-zinc-800 text-zinc-400"
          }`}
        >
          {status === "soon" ? "Coming soon" : "Planned"}
        </span>
      </div>
      <p className="mt-2 text-sm text-zinc-400">{body}</p>
    </div>
  );
}

function ShippedCard({
  href,
  title,
  body,
}: {
  href: string;
  title: string;
  body: string;
}) {
  return (
    <a
      href={href}
      className="block rounded-lg border border-zinc-800 bg-zinc-950/40 p-5 transition hover:border-emerald-500"
    >
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-zinc-400">{body}</p>
    </a>
  );
}
