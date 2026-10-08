import { createClient } from "@/lib/supabase/server";

/**
 * Today's briefing — top-pinned mission-control widget.
 *
 * Single-glance summary of "what needs my attention right now":
 *   - Hostile bills active in user's state (or federal if they haven't set one)
 *   - Live campaigns matching their state + federal
 *   - Unread notifications count
 *   - Upcoming wave fires they joined (next 24h)
 *
 * Each line is one sentence. Empty state shows a friendly "all clear"
 * message — never an empty box. The section is the most-glanced UI on
 * the dashboard, so density + speed matter more than anything fancy.
 *
 * Cockpit aesthetic: monospace counts, color-coded urgency, no marketing copy.
 */
export async function BriefingWidget({
  userId,
  userState,
}: {
  userId: string;
  userState: string | null;
}) {
  const supabase = await createClient();

  const [hostileBillsRes, campaignsRes, unreadRes, wavesRes] = await Promise.all([
    // Hostile bills active in user's state, plus federal
    supabase
      .from("bills")
      .select("id, state, bill_number, title, status", { count: "exact" })
      .eq("active", true)
      .eq("kratom_relevance", "anti")
      .not("status", "in", "(enacted,dead)")
      .or(userState ? `state.eq.${userState},state.eq.US,scope.eq.federal` : `state.eq.US,scope.eq.federal`)
      .order("last_action_at", { ascending: false })
      .limit(3),
    // Live campaigns in scope
    supabase
      .from("campaigns")
      .select("id, slug, title, state", { count: "exact" })
      .eq("active", true)
      .or(userState ? `state.eq.${userState},state.is.null` : `state.is.null`)
      .order("created_at", { ascending: false })
      .limit(3),
    // Unread notifications count
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("read_at", null),
    // Upcoming wave fires the user joined in next 24h
    supabase
      .from("campaign_wave_signups")
      .select("wave_id, campaign_waves!inner(id, scheduled_at, campaign_id, campaigns:campaign_id(title))")
      .eq("user_id", userId)
      .eq("send_status", "pending")
      .gte("campaign_waves.scheduled_at", new Date().toISOString())
      .lte("campaign_waves.scheduled_at", new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString())
      .limit(3),
  ]);

  const hostileCount = hostileBillsRes.count ?? 0;
  const hostileBills = hostileBillsRes.data ?? [];
  const campaignCount = campaignsRes.count ?? 0;
  const campaigns = campaignsRes.data ?? [];
  const unreadCount = unreadRes.count ?? 0;
  const wavesData = (wavesRes.data ?? []) as unknown as Array<{
    wave_id: string;
    campaign_waves: { id: string; scheduled_at: string; campaign_id: string; campaigns: { title: string } | null };
  }>;
  const wavesCount = wavesData.length;

  // "All clear" branch
  if (hostileCount === 0 && campaignCount === 0 && unreadCount === 0 && wavesCount === 0) {
    return (
      <Card>
        <Header title="Today's briefing" />
        <p className="px-4 pb-4 text-sm text-zinc-400">
          ✓ All clear. No hostile bills active in your scope, no live campaigns, no unread alerts.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <Header title="Today's briefing" subtitle={`Status as of ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`} />
      <ul className="divide-y divide-zinc-900">
        {hostileCount > 0 && (
          <Row
            tone="bad"
            label={`${hostileCount} hostile bill${hostileCount === 1 ? "" : "s"} in scope`}
            detail={hostileBills.map((b) => `${b.state} ${b.bill_number}`).join(" · ")}
            href={userState ? `/bills?state=${userState}&relevance=anti` : "/bills?relevance=anti"}
          />
        )}
        {campaignCount > 0 && (
          <Row
            tone="warn"
            label={`${campaignCount} active campaign${campaignCount === 1 ? "" : "s"}`}
            detail={campaigns.map((c) => c.title).join(" · ").slice(0, 80)}
            href="/campaigns"
          />
        )}
        {wavesCount > 0 && (
          <Row
            tone="info"
            label={`${wavesCount} wave${wavesCount === 1 ? "" : "s"} firing in 24h`}
            detail={wavesData
              .map((w) => `${w.campaign_waves?.campaigns?.title ?? "Campaign"} @ ${new Date(w.campaign_waves?.scheduled_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`)
              .join(" · ")
              .slice(0, 100)}
            href="/dashboard"
          />
        )}
        {unreadCount > 0 && (
          <Row
            tone="info"
            label={`${unreadCount} unread alert${unreadCount === 1 ? "" : "s"}`}
            detail="View in /notifications"
            href="/notifications"
          />
        )}
      </ul>
    </Card>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-emerald-700/30 bg-emerald-950/10">
      {children}
    </div>
  );
}

function Header({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex items-end justify-between border-b border-emerald-900/40 px-4 py-2.5">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-400">briefing</p>
        <h2 className="text-sm font-bold text-zinc-100">{title}</h2>
      </div>
      {subtitle && <span className="font-mono text-[10px] text-zinc-500">{subtitle}</span>}
    </div>
  );
}

function Row({
  tone,
  label,
  detail,
  href,
}: {
  tone: "bad" | "warn" | "info";
  label: string;
  detail: string;
  href: string;
}) {
  const dot =
    tone === "bad"
      ? "bg-red-400"
      : tone === "warn"
      ? "bg-amber-400"
      : "bg-blue-400";
  const labelColor =
    tone === "bad"
      ? "text-red-300"
      : tone === "warn"
      ? "text-amber-300"
      : "text-blue-300";
  return (
    <li>
      <a
        href={href}
        className="flex items-start gap-3 px-4 py-2.5 text-sm hover:bg-zinc-950/60"
      >
        <span className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${dot} animate-pulse`} />
        <span className="min-w-0 flex-1">
          <span className={`font-semibold ${labelColor}`}>{label}</span>
          {detail && <span className="ml-2 truncate text-zinc-500">{detail}</span>}
        </span>
        <span className="shrink-0 text-zinc-600">→</span>
      </a>
    </li>
  );
}
