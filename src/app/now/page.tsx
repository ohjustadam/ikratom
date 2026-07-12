import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Do this now — iKratom action panel",
  description:
    "One screen. One action. The single highest-leverage thing you can do for kratom advocacy in the next two minutes. Phone-first.",
};
export const dynamic = "force-dynamic";

/**
 * /now — the one-screen mobile action panel.
 *
 * Most advocates pull out a phone with a 30-second attention window.
 * /brief is dense and informational; /now is one big button + two
 * smaller follow-ups. The platform's "home screen of advocacy."
 *
 * Priority cascade for the primary CTA (top to bottom; first match wins):
 *   1. Watched bills with movement in last 7d → "Check your watched bills"
 *   2. State has critical/alert severity alert in last 7d → "Read alert"
 *   3. State has bill in an active operation → "Respond to [operation]"
 *   4. Federal rulemaking with open comment period → "Comment on rule"
 *   5. Default → "Pick a state" / "Subscribe to a bill"
 *
 * Secondary CTAs: always show the brief + the coalition list if user
 * has any.
 *
 * Designed for one-handed thumb use — vertical stack, large tap
 * targets (min 56px), high-contrast, ~3 visible at a fold.
 */

type PrimaryCTA = {
  href: string;
  emoji: string;
  title: string;
  subtitle: string;
  tone: "red" | "amber" | "emerald" | "sky" | "zinc";
};

const TONE_CLASSES: Record<PrimaryCTA["tone"], string> = {
  red: "border-red-500 bg-red-950/40 text-red-100",
  amber: "border-amber-500 bg-amber-950/40 text-amber-100",
  emerald: "border-emerald-500 bg-emerald-950/40 text-emerald-100",
  sky: "border-sky-500 bg-sky-950/40 text-sky-100",
  zinc: "border-zinc-700 bg-zinc-900 text-zinc-200",
};

export default async function NowPage() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();

  let viewerState: string | null = null;
  if (user) {
    const { data } = await sb.from("profiles").select("state").eq("id", user.id).maybeSingle();
    viewerState = (data as { state: string | null } | null)?.state ?? null;
  }

  const cutoff7Date = new Date(Date.now() - 7 * 86400 * 1000).toISOString().slice(0, 10);
  const cutoff7Iso = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
  const cutoff30Date = new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 10);

  // 1. Watched bills with recent movement
  let watchedMovementCount = 0;
  // Pull the single top-mover so we can name it in the CTA — more
  // visceral than a bare count.
  type WatchedTop = {
    id: string; state: string; bill_number: string; status: string | null;
    last_action_at: string | null; current_committee_name: string | null;
    active: boolean | null;
  };
  let topWatched: WatchedTop | null = null;
  if (user) {
    try {
      const { data: subs } = await sb.from("bill_subscriptions").select("bill_id").eq("user_id", user.id);
      const billIds = (subs ?? []).map((s: { bill_id: string }) => s.bill_id);
      if (billIds.length > 0) {
        const { data, count } = await sb
          .from("bills")
          .select("id, state, bill_number, status, last_action_at, current_committee_name, active", { count: "exact" })
          .in("id", billIds)
          .gte("last_action_at", cutoff7Date)
          .order("last_action_at", { ascending: false })
          .limit(1);
        watchedMovementCount = count ?? 0;
        const row = (data ?? [])[0] as WatchedTop | undefined;
        topWatched = row ?? null;
      }
    } catch { /* defensive */ }
  }

  // 2. Critical / alert severity policy_alerts in state (or national)
  type TopAlert = { id: string; title: string; severity: string; locality: string };
  let topAlert: TopAlert | null = null;
  try {
    let q = sb.from("policy_alerts")
      .select("id, title, severity, locality")
      .in("severity", ["critical", "alert"])
      .eq("moderation_status", "approved")
      .gte("created_at", cutoff7Iso)
      .order("created_at", { ascending: false })
      .limit(1);
    if (viewerState) q = q.eq("locality", viewerState);
    const { data } = await q;
    const row = (data ?? [])[0] as TopAlert | undefined;
    topAlert = row ?? null;
  } catch { /* defensive */ }

  // 3. Active operation in state — find the cluster with the most
  //    recent activity in this state
  let topOp: { slug: string; name: string; bills_recent: number } | null = null;
  try {
    let q = sb.from("bill_cluster_members")
      .select("bill_clusters!inner(slug, name), bills!inner(state, last_action_at, active)")
      .eq("bills.active", true)
      .gte("bills.last_action_at", cutoff30Date);
    if (viewerState) q = q.eq("bills.state", viewerState);
    const { data } = await q;
    type Row = {
      bill_clusters: { slug: string; name: string } | Array<{ slug: string; name: string }> | null;
      bills: { state: string } | Array<{ state: string }> | null;
    };
    const norm = <T,>(x: T | T[] | null): T | null => Array.isArray(x) ? x[0] ?? null : x;
    const counts = new Map<string, { slug: string; name: string; bills_recent: number }>();
    for (const r of (data ?? []) as Row[]) {
      const cl = norm(r.bill_clusters);
      if (!cl) continue;
      const cur = counts.get(cl.slug) ?? { slug: cl.slug, name: cl.name, bills_recent: 0 };
      cur.bills_recent += 1;
      counts.set(cl.slug, cur);
    }
    const top = [...counts.values()].sort((a, b) => b.bills_recent - a.bills_recent)[0];
    if (top) topOp = top;
  } catch { /* defensive */ }

  // 4. Open federal rulemaking comment period
  type OpenRule = { id: string; title: string; agency: string | null };
  let openRulemaking: OpenRule | null = null;
  try {
    const { data } = await sb
      .from("federal_rulemaking")
      .select("id, title, agency")
      .eq("open_for_comment", true)
      .order("created_at", { ascending: false })
      .limit(1);
    const row = (data ?? [])[0] as OpenRule | undefined;
    openRulemaking = row ?? null;
  } catch { /* defensive */ }

  // Decision cascade — first match becomes the primary CTA
  let primary: PrimaryCTA;
  if (watchedMovementCount > 0) {
    // Name the top mover + its momentum if we have one — gives the
    // CTA real specificity ("HB 1234 is advancing fast" vs "3 bills moved").
    let subtitle = "Open your brief to see what changed";
    let href: string = "/brief";
    if (topWatched) {
      const { computeBillMomentum, MOMENTUM_LABEL } = await import("@/lib/bill-momentum");
      const m = computeBillMomentum({
        last_action_at: topWatched.last_action_at,
        status: topWatched.status,
        current_committee_name: topWatched.current_committee_name,
        sponsor_count: 0,
        cluster_count: 0,
        recent_news_mentions: 0,
        active: topWatched.active !== false,
      });
      subtitle = `${topWatched.state} ${topWatched.bill_number} · ${MOMENTUM_LABEL[m.label]}`;
      href = `/bills/${topWatched.id}`;
    }
    primary = {
      href,
      emoji: "📋",
      title: `${watchedMovementCount} of your watched bill${watchedMovementCount === 1 ? "" : "s"} just moved`,
      subtitle,
      tone: "emerald",
    };
  } else if (topAlert) {
    primary = {
      href: "/pulse",
      emoji: topAlert.severity === "critical" ? "🚨" : "⚠️",
      title: topAlert.title.slice(0, 80),
      subtitle: `${topAlert.severity.toUpperCase()} · ${topAlert.locality} · last 7 days`,
      tone: topAlert.severity === "critical" ? "red" : "amber",
    };
  } else if (topOp) {
    primary = {
      href: `/campaigns/operation/${topOp.slug}`,
      emoji: "🕸",
      title: `Respond to ${topOp.name.split("—")[0].trim()}`,
      subtitle: `${topOp.bills_recent} bills moved in last 30 days${viewerState ? ` in ${viewerState}` : ""}`,
      tone: "red",
    };
  } else if (openRulemaking) {
    primary = {
      href: `/intel/rulemaking`,
      emoji: "🏛️",
      title: `Federal comment period open: ${openRulemaking.title.slice(0, 70)}`,
      subtitle: `${openRulemaking.agency ?? "FDA/DEA/HHS"} · your written comment becomes part of the official rule record`,
      tone: "sky",
    };
  } else if (!user) {
    primary = {
      href: "/login",
      emoji: "✨",
      title: "Sign up to make your action count",
      subtitle: "We'll match you with bills + legislators in your state",
      tone: "emerald",
    };
  } else if (!viewerState) {
    primary = {
      href: "/account",
      emoji: "📍",
      title: "Add your state to your profile",
      subtitle: "We'll surface the most relevant bills + alerts for you",
      tone: "emerald",
    };
  } else {
    primary = {
      href: "/bills",
      emoji: "🌿",
      title: `Browse ${viewerState} bills`,
      subtitle: "Subscribe to one — we'll notify you when it moves",
      tone: "zinc",
    };
  }

  return (
    <div className="mx-auto max-w-md px-4 py-8 sm:py-12">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">
          ◉ Do this now
        </p>
        <h1 className="mt-2 text-2xl font-bold sm:text-3xl">
          The one thing today.
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          We picked the highest-leverage action available to you right now. Tap it.
        </p>
      </header>

      {/* PRIMARY CTA — big, vertical, thumb-friendly */}
      <Link
        href={primary.href}
        className={`block rounded-2xl border-2 ${TONE_CLASSES[primary.tone]} p-6 transition hover:brightness-110 active:scale-[0.98]`}
        aria-label={primary.title}
      >
        <div className="text-4xl">{primary.emoji}</div>
        <div className="mt-3 text-lg font-bold leading-tight">{primary.title}</div>
        <div className="mt-2 text-sm opacity-90">{primary.subtitle}</div>
        <div className="mt-4 inline-block rounded-full bg-zinc-950/60 px-3 py-1 text-xs">
          Tap to open →
        </div>
      </Link>

      {/* Quick secondary actions */}
      <section className="mt-6 space-y-2">
        <Link
          href="/brief"
          className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 transition hover:border-zinc-600 active:scale-[0.98]"
        >
          <span className="text-2xl">☕</span>
          <span className="flex-1">
            <span className="block text-sm font-semibold text-zinc-100">Today&apos;s full brief</span>
            <span className="block text-xs text-zinc-500">Alerts, watched bills, active operations</span>
          </span>
          <span className="text-zinc-500">→</span>
        </Link>

        <Link
          href="/pulse"
          className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 transition hover:border-zinc-600 active:scale-[0.98]"
        >
          <span className="text-2xl">⚡</span>
          <span className="flex-1">
            <span className="block text-sm font-semibold text-zinc-100">Live pulse feed</span>
            <span className="block text-xs text-zinc-500">Every alert across every state</span>
          </span>
          <span className="text-zinc-500">→</span>
        </Link>

        {user && (
          <Link
            href="/coalitions"
            className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 transition hover:border-zinc-600 active:scale-[0.98]"
          >
            <span className="text-2xl">🤝</span>
            <span className="flex-1">
              <span className="block text-sm font-semibold text-zinc-100">Your coalitions</span>
              <span className="block text-xs text-zinc-500">Coordinate with your team</span>
            </span>
            <span className="text-zinc-500">→</span>
          </Link>
        )}

        <Link
          href="/support"
          className="flex items-center gap-3 rounded-xl border border-emerald-700/40 bg-emerald-950/15 p-4 transition hover:border-emerald-500 active:scale-[0.98]"
        >
          <span className="text-2xl">♥</span>
          <span className="flex-1">
            <span className="block text-sm font-semibold text-emerald-200">Keep the platform free</span>
            <span className="block text-xs text-emerald-300/80">Support the maintainer · no industry money</span>
          </span>
          <span className="text-zinc-500">→</span>
        </Link>
      </section>

      <footer className="mt-8 text-center text-[10px] text-zinc-600">
        Optimized for phone. Same data as <Link href="/brief" className="text-emerald-400 hover:underline">/brief</Link> with one CTA on top.
      </footer>
    </div>
  );
}
