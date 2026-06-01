import { redirect } from "next/navigation";
import { getAdminContext } from "@/modules/admin/actions";
import {
  listRecentAiJobs,
  getAiStats24h,
  getProviderAvailability,
  getEmailQuotaStatus,
  getGroundingQuotaStatus,
  getEnvPresence,
  type AiJobRow,
  type AiStatRow,
  type EnvPresenceGroup,
} from "@/modules/admin/ai-control-actions";
import { TestPromptPanel } from "./TestPromptPanel";

/**
 * /admin/ai-control — the AI Command Center.
 *
 * Shows at a glance:
 *   - Which AI providers are reachable right now
 *   - Today's email quota usage per provider (with cap progress bars)
 *   - 24-hour aggregate AI activity (jobs by provider × task_kind)
 *   - Recent job log (last 100), success vs failure
 *   - Total estimated 24-hour AI spend
 *
 * Cockpit aesthetic per docs/VALUES.md: information-dense, status-at-a-glance.
 */
export const metadata = { title: "AI Command Center" };
export const dynamic = "force-dynamic";

export default async function AiControlPage() {
  const ctx = await getAdminContext();
  if (!ctx.ok) redirect("/dashboard");

  const [jobsResp, statsResp, providerResp, emailQuotaResp, groundingResp, envResp] = await Promise.all([
    listRecentAiJobs(100),
    getAiStats24h(),
    getProviderAvailability(),
    getEmailQuotaStatus(),
    getGroundingQuotaStatus(),
    getEnvPresence(),
  ]);

  const jobs: AiJobRow[] = "rows" in jobsResp ? jobsResp.rows ?? [] : [];
  const stats: AiStatRow[] = "rows" in statsResp ? statsResp.rows ?? [] : [];
  const aiAvailable = "available" in providerResp ? providerResp.available ?? [] : [];
  const emailQuota = "status" in emailQuotaResp ? emailQuotaResp.status : null;
  const groundingQuota = "status" in groundingResp ? groundingResp.status : null;
  const envGroups: EnvPresenceGroup[] = "groups" in envResp ? envResp.groups : [];

  // Aggregate cost across all 24h
  const totalCost24h = stats.reduce((sum, s) => sum + Number(s.total_cost_usd ?? 0), 0);
  const totalSuccess24h = stats.reduce((sum, s) => sum + s.successes, 0);
  const totalFail24h = stats.reduce((sum, s) => sum + s.failures, 0);
  const totalAttempts24h = totalSuccess24h + totalFail24h;
  const successRate = totalAttempts24h > 0 ? (totalSuccess24h / totalAttempts24h) * 100 : null;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <a href="/admin" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Admin
      </a>
      <header className="mt-2 mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold">AI Command Center</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Multi-provider AI + email orchestration. Live status, last 24h activity, recent job log.
          </p>
        </div>
        <span className="text-xs font-mono text-zinc-500">
          updated {new Date().toISOString().slice(0, 19).replace("T", " ")} UTC
        </span>
      </header>

      {/* Runtime env-var diagnostic — booleans only, never values.
          Lets the admin confirm which keys made it from Vercel into the
          live deploy. The #1 cause of "I added the env var but the
          provider still shows down" is that Vercel's "Redeploy" reused
          the build cache; a fresh build is needed to pick up new vars.
          When this panel says "missing" but Vercel UI says it's set,
          trigger a NEW deployment (commit, or "Redeploy" with build
          cache UNCHECKED). */}
      <section className="mb-6">
        <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          <span>Runtime environment</span>
          <span className="font-normal normal-case tracking-normal text-zinc-600">
            — what this deploy can see (booleans only, no values)
          </span>
        </h2>
        <div className="grid gap-3 lg:grid-cols-2">
          {envGroups.map((g) => (
            <div key={g.group} className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                {g.group}
              </div>
              <ul className="space-y-1 font-mono text-[11px]">
                {g.vars.map((v) => {
                  const ok = v.present;
                  const broken = !ok && v.required;
                  return (
                    <li key={v.key} className="flex items-center gap-2">
                      <span
                        className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                          ok ? "bg-emerald-400" : broken ? "bg-red-400" : "bg-zinc-700"
                        }`}
                      />
                      <span className={ok ? "text-zinc-300" : broken ? "text-red-300" : "text-zinc-500"}>
                        {v.key}
                      </span>
                      <span className={`ml-auto text-[10px] ${ok ? "text-emerald-400" : broken ? "text-red-400" : "text-zinc-600"}`}>
                        {ok ? "set" : broken ? "MISSING" : "—"}
                      </span>
                      {v.note && (
                        <span className="hidden text-[10px] text-zinc-600 sm:inline">{v.note}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[10px] text-zinc-600">
          Red dot = required-and-missing. Empty dot = optional, not configured. If a var
          was just added in Vercel and shows missing here, the running deploy was built
          before the var was set — trigger a NEW deployment (commit, or Redeploy with
          build cache UNCHECKED).
        </p>
      </section>

      {/* Top row: provider status pills */}
      <section className="mb-6">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          AI providers (live availability)
        </h2>
        <div className="flex flex-wrap gap-2">
          {(["ollama", "gemini", "groq"] as const).map((p) => {
            const up = aiAvailable.includes(p);
            return (
              <span
                key={p}
                className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-mono ${
                  up
                    ? "border-emerald-700/50 bg-emerald-950/30 text-emerald-300"
                    : "border-zinc-800 bg-zinc-950/40 text-zinc-500"
                }`}
              >
                <span className={`h-2 w-2 rounded-full ${up ? "bg-emerald-400 animate-pulse" : "bg-zinc-700"}`} />
                {p}
                {up ? " · UP" : " · DOWN"}
              </span>
            );
          })}
        </div>
      </section>

      {/* 24h aggregate stats strip */}
      <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="24h calls" value={totalAttempts24h.toLocaleString()} />
        <Stat
          label="Success rate"
          value={successRate !== null ? `${successRate.toFixed(1)}%` : "—"}
          tone={successRate === null ? "neutral" : successRate > 95 ? "good" : successRate > 80 ? "warn" : "bad"}
        />
        <Stat label="Failures" value={totalFail24h.toString()} tone={totalFail24h > 0 ? "warn" : "good"} />
        <Stat label="24h cost (est)" value={`$${totalCost24h.toFixed(4)}`} />
      </section>

      {/* Gemini grounding quota — the only AI sub-budget we can run out
          of mid-day. Local-officials seeding (extract-news-officials,
          seed-bill-officials, /admin/local-rep-requests, reverify cron)
          all share this single ~500/day free-tier pool. The cap below is
          a soft ceiling (site_config.gemini_grounded_daily_cap, default
          400) that leaves headroom for ad-hoc admin clicks. When the
          bar turns red, the cron will retry tomorrow — no action needed. */}
      {groundingQuota && (
        <section className="mb-6">
          <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            <span>Gemini grounding quota — today (UTC)</span>
            <span className="font-normal normal-case tracking-normal text-zinc-600">
              — local-officials seeding pool
            </span>
          </h2>
          <GroundingQuotaPanel status={groundingQuota} />
        </section>
      )}

      {/* Email quota gauges */}
      {emailQuota && (
        <section className="mb-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Email quota — today (UTC)
          </h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {(Object.entries(emailQuota) as [string, { sent: number; failed: number; cap: number; configured: boolean; lastAt: string | null }][]).map(([provider, q]) => {
              const pct = q.cap > 0 ? Math.min(100, (q.sent / q.cap) * 100) : 0;
              return (
                <div
                  key={provider}
                  className={`rounded-md border p-3 text-xs ${
                    q.configured
                      ? "border-zinc-800 bg-zinc-950/40"
                      : "border-zinc-900 bg-zinc-950/20 opacity-50"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-semibold text-zinc-200">{provider}</span>
                    <span className="text-zinc-500">
                      {q.configured ? `${q.sent} / ${q.cap}` : "not configured"}
                    </span>
                  </div>
                  {q.configured && (
                    <>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-900">
                        <div
                          className={`h-full transition-all ${
                            pct > 90
                              ? "bg-red-500"
                              : pct > 60
                              ? "bg-amber-500"
                              : "bg-emerald-500"
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="mt-1 flex justify-between text-[10px] text-zinc-600">
                        <span>{q.failed} failed today</span>
                        <span>{q.lastAt ? `last: ${new Date(q.lastAt).toLocaleTimeString()}` : "no sends today"}</span>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* AI activity by provider × task */}
      {stats.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            AI activity — last 24h
          </h2>
          <div className="overflow-x-auto rounded-md border border-zinc-800 bg-zinc-950/40">
            <table className="w-full text-xs">
              <thead className="border-b border-zinc-800 text-zinc-500">
                <tr>
                  <th className="px-3 py-2 text-left">Provider</th>
                  <th className="px-3 py-2 text-left">Task</th>
                  <th className="px-3 py-2 text-right">OK</th>
                  <th className="px-3 py-2 text-right">Failed</th>
                  <th className="px-3 py-2 text-right">In tokens</th>
                  <th className="px-3 py-2 text-right">Out tokens</th>
                  <th className="px-3 py-2 text-right">$ est.</th>
                  <th className="px-3 py-2 text-right">Avg ms</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {stats.map((s, i) => (
                  <tr key={i} className="border-b border-zinc-900/60 last:border-b-0">
                    <td className="px-3 py-1.5 text-zinc-200">{s.provider_used}</td>
                    <td className="px-3 py-1.5 text-zinc-400">{s.task_kind}</td>
                    <td className="px-3 py-1.5 text-right text-emerald-400">{s.successes.toLocaleString()}</td>
                    <td className={`px-3 py-1.5 text-right ${s.failures > 0 ? "text-red-400" : "text-zinc-600"}`}>
                      {s.failures.toLocaleString()}
                    </td>
                    <td className="px-3 py-1.5 text-right text-zinc-500">{s.total_input_tokens.toLocaleString()}</td>
                    <td className="px-3 py-1.5 text-right text-zinc-500">{s.total_output_tokens.toLocaleString()}</td>
                    <td className="px-3 py-1.5 text-right text-zinc-500">${Number(s.total_cost_usd).toFixed(4)}</td>
                    <td className="px-3 py-1.5 text-right text-zinc-500">{s.avg_elapsed_ms.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Recent jobs log */}
      <section className="mb-6">
        <h2 className="mb-2 flex items-end justify-between text-xs font-semibold uppercase tracking-wider text-zinc-500">
          <span>Job log — last {jobs.length}</span>
          <span className="font-normal text-zinc-600">newest first</span>
        </h2>
        {jobs.length === 0 ? (
          <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-12 text-center text-sm text-zinc-500">
            No AI jobs logged yet. Calls flow through here as scripts/routes use the router.
          </div>
        ) : (
          <ul className="space-y-1.5">
            {jobs.map((j) => {
              const isFail = j.status === "failure";
              return (
                <li
                  key={j.id}
                  className={`rounded border p-2.5 text-xs ${
                    isFail
                      ? "border-red-900/40 bg-red-950/10"
                      : "border-zinc-800 bg-zinc-950/40"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 font-mono text-[10px] uppercase ${
                        isFail ? "bg-red-950/60 text-red-300" : "bg-emerald-950/40 text-emerald-300"
                      }`}
                    >
                      {j.status}
                    </span>
                    <span className="font-mono text-zinc-300">{j.task_kind}</span>
                    {j.provider_used && (
                      <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                        {j.provider_used}
                      </span>
                    )}
                    {j.model_used && (
                      <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
                        {j.model_used}
                      </span>
                    )}
                    {j.elapsed_ms != null && (
                      <span className="font-mono text-zinc-500">{j.elapsed_ms}ms</span>
                    )}
                    {j.tokens_input != null && j.tokens_output != null && (
                      <span className="font-mono text-zinc-500">
                        {j.tokens_input.toLocaleString()}→{j.tokens_output.toLocaleString()} tok
                      </span>
                    )}
                    {j.caller && (
                      <span className="font-mono text-[10px] text-zinc-600">{j.caller}</span>
                    )}
                    <span className="ml-auto font-mono text-[10px] text-zinc-700">
                      {new Date(j.created_at).toLocaleTimeString()}
                    </span>
                  </div>
                  {j.error && (
                    <p className="mt-1 truncate font-mono text-[11px] text-red-400">
                      ERR: {j.error}
                    </p>
                  )}
                  {j.prompt_preview && !isFail && (
                    <p className="mt-1 truncate text-[11px] text-zinc-500">
                      <span className="text-zinc-600">↳ </span>
                      {j.prompt_preview}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <TestPromptPanel />

      <p className="mt-8 text-xs text-zinc-600">
        Routing rules: <code className="text-zinc-500">docs/AI_TOOLKIT.md</code> ·
        Provider wrappers: <code className="text-zinc-500">src/lib/ai/providers/</code> ·
        Email scaling: <code className="text-zinc-500">docs/EMAIL_SCALING.md</code> ·
        Prompt library: <code className="text-zinc-500">docs/PROMPTS/</code>
      </p>
    </div>
  );
}

function GroundingQuotaPanel({
  status,
}: {
  status: { usedToday: number; cap: number; remaining: number; exhausted: boolean };
}) {
  const pct = status.cap > 0 ? Math.min(100, (status.usedToday / status.cap) * 100) : 0;
  const tone =
    status.exhausted ? "bg-red-500" : pct > 80 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3 text-xs">
      <div className="flex items-center justify-between">
        <span className="font-mono font-semibold text-zinc-200">gemini-2.5-flash · google_search</span>
        <span className={status.exhausted ? "text-red-400" : "text-zinc-500"}>
          {status.usedToday} / {status.cap}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-900">
        <div className={`h-full transition-all ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-zinc-600">
        <span>{status.remaining} remaining today</span>
        <span>
          {status.exhausted
            ? "exhausted — cron will retry tomorrow (UTC)"
            : "free-tier ceiling ≈ 500/project/day"}
        </span>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "good" | "warn" | "bad" | "neutral";
}) {
  const valueColor =
    tone === "good"
      ? "text-emerald-300"
      : tone === "warn"
      ? "text-amber-300"
      : tone === "bad"
      ? "text-red-300"
      : "text-zinc-100";
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`mt-1 font-mono text-2xl font-bold ${valueColor}`}>{value}</div>
    </div>
  );
}
