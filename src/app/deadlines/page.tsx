import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SignUpNudge } from "@/components/SignUpNudge";
import { EnablePushNudge } from "@/components/EnablePushNudge";

export const metadata = {
  title: "Comment deadline radar — every public-input window we know about",
  description: "Every state BoP rule, federal DEA scheduling proposal, and city ordinance currently accepting public comment, with countdown timers. The intel lobbyists already have.",
};
export const dynamic = "force-dynamic";

/**
 * /deadlines — public-comment deadline radar.
 *
 * Mission lever: regulatory-affairs lobbyists pay for subscriptions
 * that surface every state BoP rule, federal DEA proposal, and city
 * ordinance with its public-comment window + deadline. Advocates
 * typically find out 24 hours before close (or after).
 *
 * This page aggregates every alert with an occurs_at OR expires_at
 * AND every bill with local_meta.public_comment_deadline. Sorted by
 * urgency. Color-coded by remaining time.
 *
 * Three buckets:
 *   🔴 < 7 days  — act now
 *   🟡 7-30 days — calendar
 *   🟢 > 30 days — monitor
 *
 * Each row has a one-click 'Draft my response' link (signed-in users)
 * or 'Sign up to draft' (anonymous).
 */

type DeadlineItem = {
  id: string;
  kind: "alert" | "bill";
  title: string;
  locality: string | null;
  state: string | null;
  deadline: Date;
  deadlineSource: "occurs_at" | "expires_at" | "local_meta_comment_deadline";
  link: string;
  body?: string | null;
};

export default async function DeadlinesPage({
  searchParams,
}: {
  searchParams?: Promise<{ state?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const stateFilter = sp.state?.toUpperCase() ?? null;
  const supabase = await createClient();
  const now = new Date();
  const horizon90d = new Date(now.getTime() + 90 * 86_400_000);

  // Alerts with upcoming occurs_at or expires_at
  let alertQ = supabase
    .from("policy_alerts")
    .select("id, title, body, kind, locality, occurs_at, expires_at, bill_id")
    .eq("moderation_status", "approved")
    .in("severity", ["critical", "alert"]);
  if (stateFilter) {
    alertQ = alertQ.or(`locality.eq.${stateFilter},locality.ilike.%, ${stateFilter}`);
  }
  const { data: alertsRaw } = await alertQ.limit(200);

  // Bills with public-comment deadlines in local_meta
  let billQ = supabase
    .from("bills")
    .select("id, state, bill_number, title, locality, local_meta")
    .eq("active", true)
    .not("local_meta", "is", null);
  if (stateFilter) {
    billQ = billQ.eq("state", stateFilter);
  }
  const { data: billsRaw } = await billQ.limit(200);

  const items: DeadlineItem[] = [];

  // Surface alerts whose occurs_at is upcoming (these are event-windows
  // like 'BoP rule hearing on Date X' that have a comment deadline)
  for (const a of alertsRaw ?? []) {
    const occurs = a.occurs_at ? new Date(a.occurs_at) : null;
    const expires = a.expires_at ? new Date(a.expires_at) : null;
    // Prefer expires_at (explicit deadline); fall back to occurs_at
    if (expires && expires > now && expires < horizon90d) {
      items.push({
        id: `alert-${a.id}`,
        kind: "alert",
        title: a.title,
        locality: a.locality,
        state: /^[A-Z]{2}$/.test(a.locality ?? "") ? a.locality : null,
        deadline: expires,
        deadlineSource: "expires_at",
        link: `/alerts/${a.id}`,
        body: a.body,
      });
    } else if (occurs && occurs > now && occurs < horizon90d) {
      items.push({
        id: `alert-${a.id}`,
        kind: "alert",
        title: a.title,
        locality: a.locality,
        state: /^[A-Z]{2}$/.test(a.locality ?? "") ? a.locality : null,
        deadline: occurs,
        deadlineSource: "occurs_at",
        link: `/alerts/${a.id}`,
        body: a.body,
      });
    }
  }

  // Surface bills whose local_meta.public_comment_deadline is upcoming
  type BillRow = {
    id: string; state: string; bill_number: string; title: string | null;
    locality: string | null;
    local_meta: { public_comment_deadline?: string; meeting_at?: string } | null;
  };
  for (const b of (billsRaw ?? []) as BillRow[]) {
    const dlStr = b.local_meta?.public_comment_deadline;
    if (!dlStr) continue;
    const dl = new Date(dlStr);
    if (Number.isNaN(dl.getTime()) || dl < now || dl > horizon90d) continue;
    items.push({
      id: `bill-${b.id}`,
      kind: "bill",
      title: `${b.state} ${b.bill_number} · ${b.title?.slice(0, 80) ?? "(no title)"}`,
      locality: b.locality ?? b.state,
      state: b.state,
      deadline: dl,
      deadlineSource: "local_meta_comment_deadline",
      link: `/bills/${b.id}`,
    });
  }

  // Sort: closest deadline first
  items.sort((a, b) => a.deadline.getTime() - b.deadline.getTime());

  // Bucket
  const urgent = items.filter((i) => (i.deadline.getTime() - now.getTime()) < 7 * 86_400_000);
  const soon = items.filter((i) => {
    const d = i.deadline.getTime() - now.getTime();
    return d >= 7 * 86_400_000 && d < 30 * 86_400_000;
  });
  const later = items.filter((i) => (i.deadline.getTime() - now.getTime()) >= 30 * 86_400_000);

  const stateOptions = [...new Set(items.map((i) => i.state).filter(Boolean) as string[])].sort();

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          ⏰ Comment deadline radar
        </p>
        <h1 className="mt-2 text-3xl font-bold">Public-input windows closing soon</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          Every Board of Pharmacy rule, federal DEA proposal, and bill with a
          public-comment deadline we&apos;re tracking. Lobbyists pay $5,000/mo
          subscriptions for this intel. We give it free because every comment
          submitted moves the needle.
        </p>
        <p className="mt-2 text-xs text-zinc-500">
          {items.length} window{items.length === 1 ? "" : "s"} open
          {stateFilter ? ` in ${stateFilter}` : " across all jurisdictions"}.
          {urgent.length > 0 && (
            <span className="ml-2 rounded bg-red-950/50 px-1.5 py-0.5 text-red-300">
              {urgent.length} close in &lt; 7 days
            </span>
          )}
        </p>
      </header>

      {/* State filter pills */}
      {stateOptions.length > 0 && (
        <nav className="mb-6 flex flex-wrap gap-2 text-xs">
          <Link
            href="/deadlines"
            className={`rounded px-3 py-1.5 ${!stateFilter ? "bg-emerald-600 text-zinc-950" : "border border-zinc-800 bg-zinc-950/40 hover:border-emerald-500"}`}
          >
            All ({items.length})
          </Link>
          {stateOptions.map((s) => (
            <Link
              key={s}
              href={`/deadlines?state=${s}`}
              className={`rounded px-3 py-1.5 ${stateFilter === s ? "bg-emerald-600 text-zinc-950" : "border border-zinc-800 bg-zinc-950/40 hover:border-emerald-500"}`}
            >
              {s}
            </Link>
          ))}
        </nav>
      )}

      <SignUpNudge context="default" className="mb-6" />
      <EnablePushNudge context="default" className="mb-6" />

      {items.length === 0 && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-10 text-center">
          <p className="text-3xl">⏰</p>
          <p className="mt-2 text-sm text-zinc-400">
            No public-comment windows currently open
            {stateFilter ? ` in ${stateFilter}` : ""}.
          </p>
          <p className="mt-1 text-xs text-zinc-600">
            That&apos;s a good thing — quiet means no active threats. New windows
            surface here automatically.
          </p>
        </div>
      )}

      {urgent.length > 0 && (
        <Bucket
          title="🔴 Closing in less than 7 days — act now"
          items={urgent}
          tone="red"
        />
      )}
      {soon.length > 0 && (
        <Bucket
          title="🟡 7–30 days out — calendar it"
          items={soon}
          tone="amber"
        />
      )}
      {later.length > 0 && (
        <Bucket
          title="🟢 Over 30 days out — monitor"
          items={later}
          tone="emerald"
        />
      )}

      <footer className="mt-10 rounded-md border border-zinc-800 bg-zinc-950/40 p-4 text-xs text-zinc-400">
        <p className="font-semibold text-zinc-200">How this radar works</p>
        <p className="mt-1">
          Pipeline pulls from: state Board of Pharmacy rule announcements (50
          scrapers), federal DEA proposals (Federal Register), bill texts with
          explicit deadline language (parsed by AI), and admin-curated alerts.
          Each row links to a full alert/bill detail page where signed-in users
          can one-click draft + send a personalized response letter.
        </p>
      </footer>
    </div>
  );
}

function Bucket({
  title,
  items,
  tone,
}: {
  title: string;
  items: DeadlineItem[];
  tone: "red" | "amber" | "emerald";
}) {
  const headTone =
    tone === "red" ? "text-red-300"
      : tone === "amber" ? "text-amber-300"
      : "text-emerald-300";
  return (
    <section className="mb-8">
      <h2 className={`mb-3 text-sm font-semibold uppercase tracking-wider ${headTone}`}>{title}</h2>
      <ul className="space-y-2">
        {items.map((i) => {
          const now = Date.now();
          const daysLeft = Math.ceil((i.deadline.getTime() - now) / 86_400_000);
          const hoursLeft = Math.ceil((i.deadline.getTime() - now) / 3_600_000);
          const dotCls =
            tone === "red" ? "bg-red-500 animate-pulse"
              : tone === "amber" ? "bg-amber-400"
              : "bg-emerald-400";
          return (
            <li
              key={i.id}
              className={`rounded-md border p-4 ${
                tone === "red" ? "border-red-700/50 bg-red-950/15"
                  : tone === "amber" ? "border-amber-700/40 bg-amber-950/10"
                  : "border-zinc-800 bg-zinc-950/40"
              }`}
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <span className={`inline-block h-2 w-2 rounded-full ${dotCls}`} />
                <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] uppercase text-zinc-400">
                  {i.locality ?? "FED"}
                </span>
                <span className={`text-[11px] font-bold ${headTone}`}>
                  {daysLeft <= 1 ? `${hoursLeft}h left` : `${daysLeft}d left`}
                </span>
                <span className="ml-auto text-[10px] text-zinc-500">
                  deadline {i.deadline.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                </span>
              </div>
              <h3 className="mt-2 text-sm font-semibold leading-snug text-zinc-100">
                <Link href={i.link} className="hover:text-emerald-400 hover:underline">
                  {i.title}
                </Link>
              </h3>
              {i.body && (
                <p className="mt-1 line-clamp-2 text-xs text-zinc-400">
                  {i.body.split(/\n+/).find((p) => p.trim().length > 0)?.replace(/^\*\*[^*]+\*\*:?\s*/, "")}
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <Link
                  href={i.link}
                  className={`rounded px-2.5 py-1 font-semibold ${
                    tone === "red" ? "bg-red-600 text-white hover:bg-red-500"
                      : "bg-emerald-500 text-zinc-950 hover:bg-emerald-400"
                  }`}
                >
                  ✍ Draft response →
                </Link>
                {i.state && (
                  <Link
                    href={`/states/${i.state}`}
                    className="rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1 hover:border-emerald-500"
                  >
                    📍 {i.state} hub
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
