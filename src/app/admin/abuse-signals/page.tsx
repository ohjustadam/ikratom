import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getAdminContext } from "@/modules/admin/actions";

export const metadata = { title: "Abuse signals" };
export const dynamic = "force-dynamic";

/**
 * /admin/abuse-signals — observability for adversarial signals.
 *
 * Surfaces patterns that suggest automated abuse:
 *   1. Honeypot triggers in last 7 days (signup form's hidden field)
 *   2. Timing-trap triggers (signups submitted faster than humanly possible)
 *   3. Failed-login spikes per IP (potential credential-stuffing)
 *   4. Failed-signup spikes per IP (account-creation abuse)
 *   5. Top error codes across all auth events
 *
 * All data lives in `auth_events`. Service-role client used because
 * the RLS policy on auth_events is admin-only — keeps the data
 * available to admins without exposing it to other roles.
 *
 * Read-only page. No mutations. Action paths from here:
 *   - Read-only mode toggle on /admin/emergency to triage active waves
 *   - Per-user ban via /admin/users for individual abusers
 */

type EventRow = {
  kind: string;
  status: string;
  error_code: string | null;
  email: string | null;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
};

export default async function AbuseSignalsPage() {
  const ctx = await getAdminContext();
  if (!ctx.ok) redirect("/dashboard");

  // Service-role for auth_events (admin-only RLS).
  const sb = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const now = Date.now();
  const cutoff7 = new Date(now - 7 * 86400 * 1000).toISOString();
  const cutoff24 = new Date(now - 24 * 3600 * 1000).toISOString();

  // Pull last 7d of events — small dataset, in-memory aggregation
  // is cheaper than N round-trips for each signal.
  const { data: rows7d } = await sb
    .from("auth_events")
    .select("kind, status, error_code, email, ip, user_agent, created_at")
    .gte("created_at", cutoff7)
    .order("created_at", { ascending: false })
    .limit(5000);
  const events = (rows7d ?? []) as EventRow[];

  // ── Signal 1+2: honeypot + timing-trap triggers
  const honeypotEvents = events.filter((e) => e.error_code === "honeypot_triggered");
  const timingTrapEvents = events.filter((e) => e.error_code === "timing_trap_triggered");

  // ── Signal 3: failed-login concentrations per IP (last 24h)
  const last24 = events.filter((e) => e.created_at >= cutoff24);
  const failsByIp = new Map<string, { count: number; emails: Set<string>; last: string }>();
  for (const e of last24) {
    if (e.kind !== "login" || e.status !== "fail") continue;
    const ip = e.ip ?? "(no-ip)";
    const cur = failsByIp.get(ip) ?? { count: 0, emails: new Set<string>(), last: e.created_at };
    cur.count += 1;
    if (e.email) cur.emails.add(e.email);
    if (e.created_at > cur.last) cur.last = e.created_at;
    failsByIp.set(ip, cur);
  }
  const ipLoginConcentrations = [...failsByIp.entries()]
    .filter(([, v]) => v.count >= 5)
    .map(([ip, v]) => ({ ip, count: v.count, distinct_emails: v.emails.size, last: v.last }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  // ── Signal 4: failed/cancelled signup concentrations per IP
  const signupFailsByIp = new Map<string, { count: number; codes: Map<string, number>; last: string }>();
  for (const e of events) {
    if (e.kind !== "signup" || e.status === "ok") continue;
    const ip = e.ip ?? "(no-ip)";
    const cur = signupFailsByIp.get(ip) ?? { count: 0, codes: new Map<string, number>(), last: e.created_at };
    cur.count += 1;
    const code = e.error_code ?? "unknown";
    cur.codes.set(code, (cur.codes.get(code) ?? 0) + 1);
    if (e.created_at > cur.last) cur.last = e.created_at;
    signupFailsByIp.set(ip, cur);
  }
  const ipSignupConcentrations = [...signupFailsByIp.entries()]
    .filter(([, v]) => v.count >= 3)
    .map(([ip, v]) => ({
      ip, count: v.count,
      top_codes: [...v.codes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, n]) => `${c}(${n})`).join(", "),
      last: v.last,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  // ── Signal 5: top error codes across all auth_events (7d)
  const codeCounts = new Map<string, number>();
  for (const e of events) {
    if (e.status === "ok") continue;
    const c = e.error_code ?? `${e.kind}_${e.status}`;
    codeCounts.set(c, (codeCounts.get(c) ?? 0) + 1);
  }
  const topCodes = [...codeCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);

  // Topline counts
  const signupOk = events.filter((e) => e.kind === "signup" && e.status === "ok").length;
  const signupFail = events.filter((e) => e.kind === "signup" && e.status !== "ok").length;
  const loginOk = events.filter((e) => e.kind === "login" && e.status === "ok").length;
  const loginFail = events.filter((e) => e.kind === "login" && e.status === "fail").length;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <Link href="/admin" className="text-xs text-zinc-500 hover:text-emerald-400">← Admin</Link>
      <header className="mt-2 mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-amber-400">
          ◉ Abuse signals
        </p>
        <h1 className="mt-2 text-3xl font-bold sm:text-4xl">Adversarial pattern surface</h1>
        <p className="mt-2 max-w-3xl text-sm text-zinc-400">
          What automated abuse is hitting the platform right now. All data from{" "}
          <code className="rounded bg-zinc-900 px-1">auth_events</code>, last 7 days. When concentrations look serious, flip{" "}
          <Link href="/admin/emergency" className="text-amber-400 underline hover:text-amber-300">read-only mode</Link>{" "}
          while you triage, then ban individual abusers from{" "}
          <Link href="/admin/users" className="text-amber-400 underline hover:text-amber-300">users admin</Link>.
        </p>
      </header>

      {/* Topline counts */}
      <section className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Signups (7d)" ok={signupOk} fail={signupFail} />
        <Stat label="Logins (7d)" ok={loginOk} fail={loginFail} />
        <Stat label="🍯 Honeypot triggers" ok={null} fail={honeypotEvents.length} />
        <Stat label="⏱ Timing-trap triggers" ok={null} fail={timingTrapEvents.length} />
      </section>

      {/* Failed-login concentrations */}
      <Panel
        title={`🔓 Failed-login concentrations (≥5 in 24h)`}
        tone={ipLoginConcentrations.length > 0 ? "red" : "zinc"}
        emptyMsg="No IPs with concentrated failed-login attempts. Quiet."
      >
        {ipLoginConcentrations.length > 0 && (
          <table className="w-full text-[11px]">
            <thead className="text-[10px] uppercase tracking-wider text-zinc-500">
              <tr><th className="py-1 text-left">IP</th><th className="py-1 text-right">Fails</th><th className="py-1 text-right">Distinct emails</th><th className="py-1 text-left">Last seen</th></tr>
            </thead>
            <tbody>
              {ipLoginConcentrations.map((r) => (
                <tr key={r.ip} className="border-t border-zinc-900">
                  <td className="py-1 font-mono">{r.ip}</td>
                  <td className="py-1 text-right font-mono text-red-300">{r.count}</td>
                  <td className="py-1 text-right font-mono">{r.distinct_emails}</td>
                  <td className="py-1 text-zinc-500">{r.last.slice(0, 16)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-2 text-[10px] text-zinc-500">
          High distinct-emails-per-IP suggests credential stuffing. Single-email + many fails suggests targeted attempt.
        </p>
      </Panel>

      {/* Failed-signup concentrations */}
      <Panel
        title={`🚨 Signup-abuse concentrations (≥3 fails in 7d)`}
        tone={ipSignupConcentrations.length > 0 ? "amber" : "zinc"}
        emptyMsg="No IPs with concentrated signup-failure attempts."
      >
        {ipSignupConcentrations.length > 0 && (
          <table className="w-full text-[11px]">
            <thead className="text-[10px] uppercase tracking-wider text-zinc-500">
              <tr><th className="py-1 text-left">IP</th><th className="py-1 text-right">Attempts</th><th className="py-1 text-left">Top error codes</th><th className="py-1 text-left">Last seen</th></tr>
            </thead>
            <tbody>
              {ipSignupConcentrations.map((r) => (
                <tr key={r.ip} className="border-t border-zinc-900">
                  <td className="py-1 font-mono">{r.ip}</td>
                  <td className="py-1 text-right font-mono text-amber-300">{r.count}</td>
                  <td className="py-1 text-[10px]">{r.top_codes}</td>
                  <td className="py-1 text-zinc-500">{r.last.slice(0, 16)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      {/* Top error codes */}
      <Panel title="Top error codes (7d)" tone="zinc" emptyMsg="No errors recorded.">
        {topCodes.length > 0 && (
          <ul className="grid gap-1 text-[11px] sm:grid-cols-2">
            {topCodes.map(([code, count]) => (
              <li key={code} className="flex items-baseline justify-between rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1">
                <span className="font-mono">{code}</span>
                <span className="font-mono text-amber-300">{count}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <footer className="mt-8 rounded-md border border-zinc-800 bg-zinc-950/40 p-4 text-[10px] text-zinc-500">
        <p>
          Reading this dashboard: <strong className="text-zinc-300">red</strong> tone = credential stuffing risk;{" "}
          <strong className="text-zinc-300">amber</strong> = signup-form abuse (often bot rings); honeypot/timing-trap counts ≠ 0 means the soft-defense layer is doing its job.
        </p>
        <p className="mt-2">
          Related: <Link href="/admin/automation" className="text-emerald-400 hover:underline">/admin/automation</Link> (cron health) ·{" "}
          <Link href="/admin/audit" className="text-emerald-400 hover:underline">/admin/audit</Link> (admin action log)
        </p>
      </footer>
    </div>
  );
}

function Stat({ label, ok, fail }: { label: string; ok: number | null; fail: number }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/40 p-3 text-center">
      <p className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</p>
      {ok !== null && (
        <p className="text-lg font-bold text-emerald-300">
          {ok} <span className="text-[10px] font-normal text-zinc-500">ok</span>
        </p>
      )}
      <p className={`${ok !== null ? "text-sm" : "text-2xl"} font-bold ${fail > 0 ? "text-red-300" : "text-zinc-500"}`}>
        {fail} <span className="text-[10px] font-normal text-zinc-500">{ok !== null ? "fail" : "events"}</span>
      </p>
    </div>
  );
}

function Panel({
  title, tone, emptyMsg, children,
}: {
  title: string;
  tone: "red" | "amber" | "emerald" | "zinc";
  emptyMsg: string;
  children: React.ReactNode;
}) {
  const toneCls = {
    red: "border-red-700/40 bg-red-950/10",
    amber: "border-amber-700/40 bg-amber-950/10",
    emerald: "border-emerald-700/40 bg-emerald-950/10",
    zinc: "border-zinc-800 bg-zinc-950/40",
  }[tone];
  const empty = !children || (Array.isArray(children) && children.length === 0);
  return (
    <section className={`mb-6 rounded-lg border ${toneCls} p-4`}>
      <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-300">{title}</h2>
      <div className="mt-2">
        {empty ? (
          <p className="text-[11px] text-zinc-500">{emptyMsg}</p>
        ) : (
          children
        )}
      </div>
    </section>
  );
}
