import Link from "next/link";
import { MermaidLoader } from "../MermaidLoader";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const metadata = {
  title: "iKratom · AI router efficiency & free-tier stack",
  description: "Live breakdown of the AI router: which providers do what work, how many ops they served, and the honest token-priced cost of doing the same on Claude alone. Refreshed each request.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * /pitch/efficiency — shareable, LIVE breakdown of the AI router + free-tier
 * stack. Designed to survive technical diligence: every headline number is a
 * database read at request time, and the AI counterfactual is computed from
 * real token data (where logged) + transparent per-task estimates, priced at
 * actual Claude API rates.
 *
 * Honesty rules baked in (after an adversarial audit, 2026-06-16):
 *   - Count SUCCESSFUL ops, not attempts. Failures are shown separately and
 *     framed as deferral (retry next tick), not "savings" or "absorbed load."
 *   - "Providers" is split into fired / keyed / wired — only ~4 actually
 *     serve traffic; the 10-wide roster is failover headroom, not live use.
 *   - The Claude counterfactual is single-digit dollars at today's volume.
 *     We say so. The pitch is vendor-independence + $0 runtime, not the dollar.
 *   - Claude served 0 runtime calls — verifiable in code (router REGISTRY.claude
 *     = null). This is the strongest, fully-defensible line.
 */

// ── AI provider roster ────────────────────────────────────────────────────
// `key` matches the lowercased provider_used logged to ai_jobs, so we can flag
// which providers have actually served traffic vs. which are merely keyed/wired.
const AI_PROVIDERS: Array<{
  name: string;
  key: string;
  env: string | null;
  model: string;
  limit: string;
  role: string;
}> = [
  { name: "Groq", key: "groq", env: "GROQ_API_KEY", model: "llama-3.3-70b / gpt-oss-120b", limit: "free · ~14.4K tok/min", role: "primary workhorse" },
  { name: "Gemini Flash 2.5", key: "gemini", env: "GEMINI_API_KEY", model: "+ Google Search grounding", limit: "free · ~1,500 req/day", role: "grounded fallback" },
  { name: "Ollama (local)", key: "ollama", env: null, model: "llama3.1:8b", limit: "$0 · owner hardware", role: "privacy / local-only" },
  { name: "Mistral Small", key: "mistral", env: "MISTRAL_API_KEY", model: "mistral-small-latest", limit: "free tier", role: "box-side rotation" },
  { name: "Cerebras", key: "cerebras", env: "CEREBRAS_API_KEY", model: "llama-3.1-8b", limit: "free · ~50K tok/day", role: "wired fallback" },
  { name: "Cloudflare Workers AI", key: "cloudflare", env: "CLOUDFLARE_AI_TOKEN", model: "llama-3.3-70b-fp8", limit: "free · ~10K/day", role: "wired fallback" },
  { name: "GitHub Models", key: "github", env: "GITHUB_MODELS_TOKEN", model: "GPT-4o-mini / Llama", limit: "free PAT", role: "wired fallback" },
  { name: "SambaNova", key: "sambanova", env: "SAMBANOVA_API_KEY", model: "llama-3.3-70b", limit: "free tier", role: "wired fallback" },
  { name: "OpenRouter", key: "openrouter", env: "OPENROUTER_API_KEY", model: ":free models", limit: "free tier", role: "wired fallback" },
  { name: "NVIDIA NIM", key: "nvidia", env: "NVIDIA_API_KEY", model: "Llama / Nemotron", limit: "free credits", role: "wired fallback" },
];

// Claude API list pricing, per token (from the model catalog). This is the
// "what would it have cost on Claude alone" baseline. Bulk extract/classify/
// translate work would realistically run on Haiku 4.5 — so Haiku is the honest
// comparison; Sonnet/Opus are shown as higher reference tiers, not the
// realistic substitute. Citing only Opus would overstate "savings" ~5×.
const CLAUDE_RATES: Array<{ id: string; label: string; in: number; out: number; note: string }> = [
  { id: "haiku", label: "Claude Haiku 4.5", in: 1 / 1e6, out: 5 / 1e6, note: "realistic substitute for bulk extract/classify/translate" },
  { id: "sonnet", label: "Claude Sonnet 4.6", in: 3 / 1e6, out: 15 / 1e6, note: "mid tier" },
  { id: "opus", label: "Claude Opus 4.8", in: 5 / 1e6, out: 25 / 1e6, note: "upper bound — nobody runs bulk jobs here" },
];

// Per-SUCCESSFUL-call token model. `translate` is REAL (Groq-logged: 167 calls
// = 33,588 in / 9,032 out). Everything else logs 0 tokens to ai_jobs, so these
// are conservative estimates read off the prompt-building code — deliberately
// the low end of plausible ranges so the counterfactual is defensible, not
// inflated. ban_verify/officials_extract feed full fetched page text (capped
// 24K chars) so their input is a floor; a worst-case 24K-char page is ~6–7K
// input tokens. gemini_grounded UNDERstates Claude cost (Gemini retrieves
// sources server-side; on Claude you'd pay to feed them in).
const TASK_MODEL: Record<
  string,
  { in: number; out: number; powers: string; served: string; confidence: "measured" | "high" | "estimated" | "retired" }
> = {
  translate: { in: 201, out: 54, powers: "6-language content localization (bill summaries → en/id/th/ms/vi/tl)", served: "Groq", confidence: "measured" },
  bill_summary: { in: 430, out: 110, powers: "Plain-English bill summary + advocacy callout + stance, on /bills", served: "Groq (Gemini fallback)", confidence: "high" },
  ban_verify: { in: 3500, out: 120, powers: "Two-source local kratom-ban confirmation (full .gov page → verdict)", served: "Ollama / Mistral (local-first)", confidence: "estimated" },
  officials_extract: { in: 3800, out: 300, powers: "Local officials roster extraction → one-click campaign targets", served: "Mistral / Ollama", confidence: "estimated" },
  gemini_grounded: { in: 450, out: 200, powers: "Grounded officials/bill-status lookup", served: "Gemini (retired 2026-06-08)", confidence: "retired" },
  general: { in: 800, out: 200, powers: "Admin tools, rebuttal drafts, brief summaries", served: "Groq / Ollama", confidence: "estimated" },
  news_enrich: { in: 1200, out: 300, powers: "News summaries / research abstracts", served: "Groq", confidence: "estimated" },
};

const FALLBACK_TOKENS = { in: 800, out: 200 };

// Public cron allowlist — matches /status so the two pages tell the same story.
const PUBLIC_PIPELINES = [
  "sync_news_rss",
  "classify_news_policy",
  "push_critical_alerts",
  "push_state_news",
  "push_bill_actions_to_actors",
  "sync_bills_legiscan_priority",
  "fire_meeting_reminders",
  "discover_municipal_meetings",
  "scan_granicus_tenants",
  "scan_legistar_tenants",
  "generate_state_briefing",
  "sync_research_pubmed",
  "sync_committees_openstates",
  "draft_legislator_stance",
  "auto_resolve_sync_discrepancies",
  "verify_bill_status_ai",
  "classify_bill_substance",
];

export default async function EfficiencyPage() {
  const supabase = await createClient();
  const now = Date.now();

  const keyedProviders = AI_PROVIDERS.filter((p) => p.env === null || !!process.env[p.env]);
  const wiredCount = AI_PROVIDERS.length;
  const keyedCount = keyedProviders.length;

  // ai_jobs_stats() is SECURITY DEFINER + anon-callable, so these aggregates
  // come back even for a logged-out partner viewing the page.
  //
  // The pipeline freshness read uses the service-role client: mig 0233 made
  // scraper_runs_latest respect the admin-only scraper_runs RLS (anon could
  // previously read raw error_message). This page deliberately shows a
  // CURATED public subset (PUBLIC_PIPELINES, safe columns only) — the same
  // radical-transparency choice /status makes, via the same mechanism.
  const telemetry = createServiceRoleClient();
  const [u30, u24, uAll, cronRuns] = await Promise.all([
    aiUsage(supabase, 720), // 30d
    aiUsage(supabase, 24),
    aiUsage(supabase, 24 * 3650), // all-time
    telemetry
      .from("scraper_runs_latest")
      .select("source, started_at, status")
      .in("source", PUBLIC_PIPELINES),
  ]);

  // Providers that have ACTUALLY served traffic (exclude null/idempotent skips).
  const firedKeys = new Set(
    uAll.byProvider
      .filter((p) => p.successes > 0 && p.provider !== "unknown" && p.provider !== "none")
      .map((p) => p.provider),
  );
  const firedCount = firedKeys.size;

  // Pipeline health — same shape as /status.
  const cronByName = new Map<string, { started_at: string; status: string }>();
  for (const r of cronRuns.data ?? []) cronByName.set(r.source, { started_at: r.started_at, status: r.status });
  let healthyPipelines = 0;
  for (const src of PUBLIC_PIPELINES) {
    const last = cronByName.get(src);
    if (!last) continue;
    const ageH = (now - new Date(last.started_at).getTime()) / 3_600_000;
    if (ageH <= 36 && last.status !== "error") healthyPipelines += 1;
  }
  const totalPipelines = PUBLIC_PIPELINES.length;

  const cf30 = counterfactual(u30.byTask);
  const tierFor = (id: string) => cf30.tiers.find((t) => t.id === id)?.usd ?? 0;

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 text-zinc-100 sm:px-6 lg:px-8">
      <MermaidLoader />

      <Link href="/pitch" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Pitch overview
      </Link>

      <header className="mt-2 mb-10">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">
          ⚙ AI router · free-tier-only · live
        </p>
        <h1 className="mt-3 text-4xl font-bold sm:text-5xl">
          Every AI call runs at $0 — and Claude is hard-disabled at runtime
        </h1>
        <p className="mt-4 max-w-3xl text-base text-zinc-400">
          iKratom runs all production AI — bill summaries, 6-language translation,
          local-ban verification, official extraction — entirely on free-tier and
          local models. Anthropic Claude is what we use to <em>build</em> the
          platform; it is <strong className="text-zinc-200">never a runtime
          dependency</strong> (verifiable in code: the router&apos;s provider
          registry hard-sets <code className="rounded bg-zinc-900 px-1 text-emerald-300">claude = null</code>).
          The real bet isn&apos;t a dollar figure — it&apos;s that AI is wired as a
          hot-swappable commodity behind a failover router, so the platform is
          never locked to one vendor&apos;s pricing. Every number below is read
          from the database <em>at the moment you loaded this page</em>.
        </p>
        <p className="mt-2 text-[10px] font-mono text-zinc-600">
          generated {new Date(now).toISOString().slice(0, 19).replace("T", " ")} UTC · window: trailing 30 days
        </p>
      </header>

      {/* LIVE top-line metrics */}
      <section className="mb-12 grid gap-3 sm:grid-cols-4">
        <Metric value="$0" label="Runtime AI spend" sub="Claude disabled in the router; every call is free-tier or local" tone="emerald" />
        <Metric
          value={u30.successes.toLocaleString()}
          label="Successful AI ops · 30d"
          sub={`${u30.attempts.toLocaleString()} attempts · failed items retry next cron tick (deferral, not outage)`}
        />
        <Metric value={`${firedCount} / ${keyedCount} / ${wiredCount}`} label="Providers fired / keyed / wired" sub="only the first set serves traffic; the rest is failover headroom" />
        <Metric
          value={`≈ ${fmtUsd(tierFor("sonnet"))}`}
          label="Claude-equivalent · 30d"
          sub={`logged ops priced at Sonnet 4.6 (${fmtUsd(tierFor("haiku"))} Haiku · ${fmtUsd(tierFor("opus"))} Opus) — actual spend $0`}
          tone="emerald"
        />
      </section>

      {/* ───────── 0. The counterfactual: free stack vs Claude ───────── */}
      <Section title="0. Free stack vs. Claude — the honest number">
        <p className="mb-5 text-sm text-zinc-400">
          Over the last 30 days the router served{" "}
          <span className="font-mono text-zinc-100">{u30.successes.toLocaleString()}</span>{" "}
          successful AI operations. We priced the <em>same</em> work against live
          Claude API token rates — using <strong className="text-zinc-200">real
          measured tokens</strong> where the provider logs them (Groq translation)
          and conservative, code-derived estimates elsewhere. The result is small
          on purpose: at this volume the absolute dollar gap is single digits.
          That is the point. <strong className="text-zinc-200">We are not pitching
          a dollar figure</strong> — we&apos;re pitching that the cost line is
          decoupled from any one vendor.
        </p>

        {/* A — where the successful work ran */}
        <div className="mb-8 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
          <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Successful AI ops by provider · last 30 days
          </p>
          {u30.byProvider.filter((p) => p.successes > 0).length === 0 ? (
            <p className="text-sm text-zinc-500">No successful AI ops recorded in the window.</p>
          ) : (
            <div className="space-y-2.5">
              {u30.byProvider
                .filter((p) => p.successes > 0)
                .sort((a, b) => b.successes - a.successes)
                .map((p) => (
                  <UsageBar
                    key={p.provider}
                    label={PROVIDER_LABELS[p.provider] ?? p.provider}
                    count={p.successes}
                    pct={u30.successes > 0 ? Math.round((p.successes / u30.successes) * 100) : 0}
                    tone="emerald"
                  />
                ))}
              <UsageBar label="Anthropic Claude (paid)" count={0} pct={0} tone="zinc" note="never called by the platform at runtime" />
            </div>
          )}
        </div>

        {/* B — what those ops would cost on Claude */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Cost for the same {u30.successes.toLocaleString()} ops · last 30 days
          </p>
          <p className="mb-4 text-[11px] text-zinc-500">
            {cf30.totalIn.toLocaleString()} input + {cf30.totalOut.toLocaleString()} output tokens
            {" "}(measured for translation, estimated elsewhere — see method note).
          </p>
          {CLAUDE_RATES.map((r) => (
            <CostBar
              key={r.id}
              label={`If routed to ${r.label} — ${r.note}`}
              usd={tierFor(r.id)}
              max={tierFor("opus")}
              tone="red"
            />
          ))}
          <CostBar label="iKratom actual (free-tier + local)" usd={0} max={tierFor("opus")} tone="emerald" />
          <p className="mt-4 text-[11px] text-zinc-500">
            <strong className="text-zinc-400">Method:</strong> translation tokens are
            real (Groq logs them: ~201 in / 54 out per call). bill_summary is
            high-confidence from the prompt code. ban_verify and officials_extract
            are <strong className="text-zinc-400">estimates</strong> — those local-box
            paths don&apos;t log tokens, and they feed full fetched web-page text
            (capped 24K chars), so their input is a floor (a worst-case page is ~6–7K
            tokens). <strong className="text-zinc-400">This is the logged subset only.</strong>{" "}
            The hourly news engine (article summaries, AI digests, policy
            classification, news→bill correlation) and bill/legislator analysis run
            through the same free-tier routers but log to <code className="rounded bg-zinc-900 px-1">scraper_runs</code>,
            not <code className="rounded bg-zinc-900 px-1">ai_jobs</code> — so the true
            AI footprint, and the true Claude-equivalent bill, are materially higher.
            Still $0 either way.
          </p>
        </div>
      </Section>

      {/* ───────── 1. What uses what ───────── */}
      <Section title="1. What uses what — the routing map">
        <p className="mb-4 text-sm text-zinc-400">
          The router picks a provider by <strong className="text-zinc-200">need, not
          just cost</strong>: grounding → Gemini, privacy → local Ollama, speed →
          Groq, chain-of-thought → GPT-OSS-120B on Groq. Each task gets a
          fit-for-purpose model at $0. (These are free open-weight / Flash models —
          good, not frontier; we&apos;ve deliberately opted out of frontier AI at
          runtime by policy.) Counts below are successful ops in the trailing 30 days.
        </p>

        <div className="mb-4 overflow-x-auto rounded-lg border border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-950/60 text-left text-[10px] uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-3 py-2">Task</th>
                <th className="px-3 py-2">What it powers</th>
                <th className="px-3 py-2">Served by</th>
                <th className="px-3 py-2 text-right">Ops · 30d</th>
                <th className="px-3 py-2 text-right">~tokens/call</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900">
              {u30.byTask
                .filter((t) => t.successes > 0)
                .sort((a, b) => b.successes - a.successes)
                .map((t) => {
                  const m = TASK_MODEL[t.task];
                  return (
                    <tr key={t.task} className="hover:bg-zinc-950/40">
                      <td className="px-3 py-2 font-mono text-[11px] text-zinc-100">{t.task}</td>
                      <td className="px-3 py-2 text-zinc-400">{m?.powers ?? "—"}</td>
                      <td className="px-3 py-2 text-emerald-300">
                        {m?.served ?? "—"}
                        {m?.confidence === "measured" ? <span className="ml-1 text-[9px] text-emerald-500">measured</span> : null}
                        {m?.confidence === "estimated" ? <span className="ml-1 text-[9px] text-amber-500/70">est.</span> : null}
                        {m?.confidence === "retired" ? <span className="ml-1 text-[9px] text-zinc-600">retired</span> : null}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-zinc-100">{t.successes.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right font-mono text-[11px] text-zinc-500">
                        {m ? `${m.in}↓ ${m.out}↑` : "—"}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-zinc-500">
          <code className="rounded bg-zinc-900 px-1">ban_verify</code> logs one row per
          locality at completion (per-page extraction failures are swallowed and
          retried), so its op count is locality-granularity, not raw model calls.
          The reasoning path (GPT-OSS-120B for the admin assistant) is wired but
          has not yet fired at volume. <code className="rounded bg-zinc-900 px-1">gemini_grounded</code>{" "}
          is a <strong className="text-zinc-400">retired</strong> path — local-officials
          lookup moved to deterministic Legistar on 2026-06-08, so any grounded rows
          predate that change.
        </p>
      </Section>

      {/* ───────── 2. Provider roster ───────── */}
      <Section title="2. The router — 10 providers wired, 4 carrying traffic">
        <p className="mb-4 text-sm text-zinc-400">
          Every AI call routes through{" "}
          <code className="rounded bg-zinc-900 px-1 text-emerald-300">scripts/lib/ai-router.mjs</code>{" "}
          (batch / cron) or{" "}
          <code className="rounded bg-zinc-900 px-1 text-emerald-300">src/lib/ai/router.ts</code>{" "}
          (app). Cooldown-aware: a 429 parks a provider for ~60s and the next one
          takes over. <strong className="text-zinc-200">{wiredCount} providers are
          wired</strong> for failover headroom, <strong className="text-zinc-200">{keyedCount}
          {" "}are keyed</strong> in this environment, and{" "}
          <strong className="text-emerald-300">{firedCount} have actually served
          production traffic</strong> — Groq does the bulk. The 10-wide roster isn&apos;t
          a claim of 10 live models; it&apos;s how many vendors we can spill to before
          anything pays.
        </p>

        <div className="mb-6 overflow-x-auto rounded-lg border border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-950/60 text-left text-[10px] uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-3 py-2">Provider</th>
                <th className="px-3 py-2">Model</th>
                <th className="px-3 py-2">Free-tier limit</th>
                <th className="px-3 py-2">Role</th>
                <th className="px-3 py-2 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900">
              {AI_PROVIDERS.map((p) => {
                const fired = firedKeys.has(p.key);
                const keyed = p.env === null || !!process.env[p.env];
                const state = fired ? "serving" : keyed ? "keyed · idle" : "wired · no key";
                const dot = fired ? "bg-emerald-500" : keyed ? "bg-amber-500" : "bg-zinc-700";
                const txt = fired ? "text-emerald-300" : keyed ? "text-amber-300" : "text-zinc-600";
                return (
                  <tr key={p.name}>
                    <td className="px-3 py-2 font-medium text-zinc-100">{p.name}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-zinc-400">{p.model}</td>
                    <td className="px-3 py-2 text-emerald-300/90">{p.limit}</td>
                    <td className="px-3 py-2 text-zinc-400">{p.role}</td>
                    <td className="px-3 py-2 text-right">
                      <span className={`inline-flex items-center gap-1.5 text-[11px] ${txt}`}>
                        <span className={`inline-block h-2 w-2 rounded-full ${dot}`} />
                        {state}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <pre className="mermaid mx-auto max-w-full overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950 p-4">
{`flowchart LR
  REQ(["AI request"]) --> R{"AI router<br/>(need-aware + cooldown)"}
  R -->|"privacy"| OLL["Ollama local · $0"]
  R -->|"primary / speed"| GROQ["Groq · llama-3.3-70b"]
  R -->|"grounding"| GEM["Gemini Flash 2.5"]
  R -->|"box rotation"| MIS["Mistral"]
  R -.->|"wired, not yet fired"| REST["Cerebras · Cloudflare · GitHub<br/>SambaNova · OpenRouter · NVIDIA"]
  R -.->|"hard-disabled (claude = null)"| ANT["Anthropic Claude"]

  style OLL fill:#10b98120,stroke:#10b981
  style GROQ fill:#10b98120,stroke:#10b981
  style GEM fill:#10b98120,stroke:#10b981
  style MIS fill:#10b98120,stroke:#10b981
  style REST fill:#27272a,stroke:#3f3f46
  style ANT fill:#7f1d1d20,stroke:#dc2626`}
        </pre>
      </Section>

      {/* ───────── 3. Failure telemetry — what the 65% means ───────── */}
      <Section title="3. The failure column — read honestly">
        <p className="mb-4 text-sm text-zinc-400">
          The same table that proves $0 also shows a high failure rate, and we&apos;d
          rather explain it than hide it. Most failures are{" "}
          <code className="rounded bg-zinc-900 px-1">NoProviderError</code> — the whole
          chain was momentarily exhausted (the owner&apos;s local Ollama is unreachable
          from a cloud cron, and Groq&apos;s free tier was rate-limited that second), or
          a Gemini free-tier 429. Critically:
        </p>
        <ul className="mb-4 space-y-2 text-sm text-zinc-300">
          <li className="flex items-start gap-2">
            <span aria-hidden className="text-emerald-400">✓</span>
            <span>No failure ever cost a dollar — every provider in the chain is free or local.</span>
          </li>
          <li className="flex items-start gap-2">
            <span aria-hidden className="text-emerald-400">✓</span>
            <span>No failure showed a user an error — the work item simply <strong className="text-zinc-100">retries idempotently on the next cron tick</strong>.</span>
          </li>
          <li className="flex items-start gap-2">
            <span aria-hidden>⚠</span>
            <span>
              But a failed item was <strong className="text-zinc-100">deferred, not served</strong>.
              The tradeoff a free-tier stack makes is <strong className="text-zinc-100">freshness
              latency, not outage</strong> — and the free-tier rate limits visible in
              this very telemetry are the real scaling constraint (see §6), not price.
            </span>
          </li>
        </ul>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat n={u30.successes} label="served (30d)" tone="emerald" />
            <Stat n={u30.attempts - u30.successes} label="deferred & retried (30d)" tone="amber" />
            <Stat n={0} label="paid-AI failures" tone="emerald" prefix="$" />
          </div>
        </div>
      </Section>

      {/* ───────── 4. Data ingestion ───────── */}
      <Section title="4. Data ingestion — 14+ free APIs">
        <p className="mb-6 text-sm text-zinc-400">
          Every layer of the kratom-policy pipeline (bills, news, meetings,
          legislators, research, federal lobbying, donor profiles) draws from a
          free upstream. All flow into a single Supabase Postgres and out via free
          distribution (Web Push, Facebook Graph OG, native share).
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <SourceGroup emoji="🏛" title="Legislative tracking" sources={[
            { name: "LegiScan", limit: "30K req/mo FREE" },
            { name: "OpenStates v3", limit: "FREE w/ key" },
            { name: "State BoP sites", limit: "direct HTML scrape" },
            { name: "Senate LDA", limit: "federal lobbying · FREE" },
          ]} />
          <SourceGroup emoji="📰" title="News + verification" sources={[
            { name: "Google News RSS", limit: "FREE, no key" },
            { name: "Playwright", limit: "OSS · resolve redirects" },
          ]} />
          <SourceGroup emoji="🗳" title="Civic + donor data" sources={[
            { name: "Google Civic Info", limit: "FREE" },
            { name: "OpenFEC", limit: "FREE" },
            { name: "unitedstates.io", limit: "OSS dataset" },
            { name: "ProPublica 990s", limit: "FREE" },
          ]} />
          <SourceGroup emoji="🏙" title="Municipal meetings" sources={[
            { name: "CivicPlus", limit: "~3,000 cities" },
            { name: "Granicus", limit: "~5,000 cities" },
            { name: "Legistar", limit: "~500 cities" },
            { name: "BoardDocs", limit: "~1,500 districts" },
          ]} />
          <SourceGroup emoji="🔬" title="Research" sources={[{ name: "PubMed E-utils", limit: "FREE, no key" }]} />
          <SourceGroup emoji="📡" title="Distribution out" sources={[
            { name: "Web Push (VAPID)", limit: "FREE — no Pusher/OneSignal" },
            { name: "Facebook Graph", limit: "FREE OG cache flush" },
            { name: "mailto: + sms:", limit: "native, $0" },
          ]} />
        </div>
        <p className="mt-4 text-[11px] text-zinc-500">
          All sources land in Supabase Postgres (free tier). The platform never pays
          a per-row, per-call, or per-record cost for any of the above.
        </p>
      </Section>

      {/* ───────── 5. Pipeline health ───────── */}
      <Section title="5. Pipeline health — right now">
        <p className="mb-4 text-sm text-zinc-400">
          The {totalPipelines} public-facing pipelines below ingest, classify, and
          distribute every data point on the platform. Healthy = ran within the last
          36 hours <em>and</em> last run did not error. Per-source freshness lives at{" "}
          <Link href="/status" className="text-emerald-400 hover:underline">/status →</Link>
        </p>
        <div className="rounded-lg border border-emerald-700/30 bg-emerald-950/10 p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <p className="text-5xl font-bold tabular-nums text-emerald-200">
                {healthyPipelines}
                <span className="text-2xl text-zinc-500">/{totalPipelines}</span>
              </p>
              <p className="mt-1 text-[11px] uppercase tracking-wider text-zinc-400">pipelines healthy</p>
            </div>
            <div className="text-right text-xs text-zinc-400">
              <p>Successful AI ops · 24h: <span className="font-mono text-zinc-100">{u24.successes.toLocaleString()}</span></p>
              <p>Successful AI ops · 30d: <span className="font-mono text-zinc-100">{u30.successes.toLocaleString()}</span></p>
              <p>Runtime AI spend: <span className="font-mono text-emerald-300">$0</span></p>
            </div>
          </div>
        </div>
      </Section>

      {/* ───────── 6. Commercial replacement cost ───────── */}
      <Section title="6. What a 'normal' commercial stack would cost">
        <p className="mb-4 text-sm text-zinc-400">
          This is a <strong className="text-zinc-200">replacement-cost</strong> catalog —
          the paid SaaS we&apos;d otherwise need — and is a separate argument from the
          live AI counterfactual in §0. <strong className="text-zinc-200">For the AI
          inference rows specifically, today&apos;s actual equivalent is single-digit
          dollars/mo</strong> (see §0); the high ends here are at-scale estimates, not
          current spend. The non-AI rows (legislative data, civic, push, etc.) are the
          bulk of the figure and the most defensible.
        </p>
        <div className="overflow-x-auto rounded-lg border border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-950/60 text-left text-xs uppercase tracking-wider text-zinc-400">
              <tr>
                <th className="px-3 py-2 font-semibold">Capability</th>
                <th className="px-3 py-2 font-semibold">iKratom uses</th>
                <th className="px-3 py-2 font-semibold">Commercial alt</th>
                <th className="px-3 py-2 font-semibold text-right">Replacement /mo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900">
              <Row cap="AI inference (all tasks)" us="Free-tier router — Groq / Ollama / Gemini / Mistral" alt="Claude / GPT primary" saved="$0 today → scale-dependent" />
              <Row cap="State bill tracking" us="LegiScan (free 30K/mo)" alt="LegiScan Pro / Politico Pro" saved="$300-2,500" />
              <Row cap="Per-state legislators" us="OpenStates v3 (free w/ key)" alt="ProPublica Congress API + paid scraping" saved="$0-100" />
              <Row cap="Research papers" us="PubMed E-utils (free, no key)" alt="Semantic Scholar API paid tier" saved="$50-200" />
              <Row cap="Civic / district lookup" us="Google Civic Info (free)" alt="Cicero / GeoCivic" saved="$200-500" />
              <Row cap="Push notifications" us="Web Push (VAPID, open source)" alt="OneSignal / Pusher" saved="$50-200" />
              <Row cap="Email to legislators" us="mailto: links (free, native)" alt="Resend / SendGrid transactional" saved="$50-300" />
              <Row cap="SMS invites" us="sms: links + Contact Picker API" alt="Twilio SMS" saved="$50-500" />
              <Row cap="Headless browser" us="Playwright (open source)" alt="Browserbase / Browserless cloud" saved="$50-200" />
              <Row cap="PDF text extraction" us="pdf-parse (open source)" alt="AWS Textract / GPT-4 Vision" saved="$20-150" />
              <Row cap="Realtime updates" us="Supabase Realtime (free tier)" alt="Pusher Channels / Ably" saved="$30-200" />
              <Row cap="Per-state OG images" us="next/og ImageResponse (open source)" alt="Cloudinary / Imgix" saved="$30-100" />
              <Row cap="Municipal meeting agendas" us="Direct scrape of CivicPlus/Granicus/Legistar/BoardDocs" alt="CivicPlus Pro Connect / paid procurement data" saved="$300-1,500" />
              <Row cap="Hosting + cron" us="Vercel Hobby + GitHub Actions" alt="Vercel Pro + dedicated cron infra" saved="$20-100" />
              <Row cap="Database + auth" us="Supabase Free" alt="Supabase Pro / Firebase Blaze" saved="$25-200" />
              <Row cap="E2E encrypted DMs" us="libsodium (open source)" alt="Stream Chat / SendBird" saved="$300-1,000" />
              <Row cap="Federal lobbying data" us="Senate LDA REST API (no auth, free)" alt="LegiStorm ($500+/mo), Quorum ($2K+/mo)" saved="$500-2,000" />
              <Row cap="Federal donor profiles" us="OpenFEC direct + employer categorization" alt="OpenSecrets API (discontinued) / paid CRP contract" saved="$200-1,000" />
            </tbody>
            <tfoot className="bg-zinc-950/60 text-sm">
              <tr>
                <td colSpan={3} className="px-3 py-2 font-bold text-emerald-300">Replacement cost at scale (non-AI dominated)</td>
                <td className="px-3 py-2 text-right font-mono font-bold text-emerald-300">~$2,000 – $10,000+</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="mt-3 text-[11px] text-zinc-500">
          The point isn&apos;t the dollar figure — it&apos;s that every capability had a
          free-tier substitute chosen <em>before</em> the platform was built. The AI row
          is honest about today: ~$0. The legislative/civic/lobbying rows are where the
          real avoided cost lives.
        </p>
      </Section>

      {/* ───────── 7. Honest disclosures ───────── */}
      <Section title="7. Honest disclosures — where the seams are">
        <ul className="space-y-3 text-sm text-zinc-300">
          <li className="flex items-start gap-2">
            <span aria-hidden>⚠</span>
            <span>
              <strong className="text-zinc-100">Free-tier rate limits are the real ceiling.</strong>{" "}
              The failure column above is mostly the chain hitting Groq/Gemini free-tier
              caps. At higher volume the honest answer isn&apos;t &ldquo;$0 forever&rdquo; — it&apos;s
              that work spreads across many free + local tiers and only <em>marginal
              overflow</em> spills to paid inference. Cost rises far slower than a
              single-vendor design, but it isn&apos;t flat to infinity.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span aria-hidden>⚠</span>
            <span>
              <strong className="text-zinc-100">Claude is the build tool, not the platform.</strong>{" "}
              Claude is what the operator uses to <em>build</em> iKratom; it does not run
              inside the data pipeline. The runtime router&apos;s registry sets{" "}
              <code className="rounded bg-zinc-900 px-1">claude = null</code> and the type
              system bans the <code className="rounded bg-zinc-900 px-1">deepseek</code> provider.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span aria-hidden>⚠</span>
            <span>
              <strong className="text-zinc-100">ai_jobs under-counts real AI usage.</strong>{" "}
              Only the cron bill/translate paths and box-side ban/officials scripts log
              here. The news engine and most app-side AI calls log to{" "}
              <code className="rounded bg-zinc-900 px-1">scraper_runs</code> instead, so the
              numbers on this page are a <em>floor</em> on the true footprint — and on the
              true Claude-equivalent bill.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span aria-hidden>⚠</span>
            <span>
              <strong className="text-zinc-100">Token estimates are estimates.</strong>{" "}
              Only Groq logs real token counts. ban_verify / officials_extract figures are
              read off the prompt code, deliberately at the low end — defensible, not exact.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span aria-hidden>⚠</span>
            <span>
              <strong className="text-zinc-100">Vercel Hobby caps daily cron at 1 run.</strong>{" "}
              Hourly + sub-daily jobs run on GitHub Actions. At scale we&apos;d move to Vercel
              Pro ($20/mo) for the cleaner DX.
            </span>
          </li>
        </ul>
      </Section>

      {/* ───────── 8. At scale ───────── */}
      <Section title="8. What we'd switch to at 100K+ users">
        <p className="text-sm text-zinc-400">
          Because every call is router-shaped, the swap-outs are clean drop-ins:
        </p>
        <ul className="mt-3 space-y-2 text-sm text-zinc-300">
          <li>→ Promote one or two free AI providers to a paid tier <em>only</em> for the marginal overflow that free tiers reject — primary stays free-tier-first</li>
          <li>→ Vercel Pro ($20/mo) for unlimited cron + bandwidth headroom</li>
          <li>→ Supabase Pro ($25/mo) for daily backups + dedicated CPU</li>
          <li>→ LegiScan Premium ($79/mo) only if we exceed the 30K req/mo free tier</li>
        </ul>
        <p className="mt-3 text-sm text-zinc-400">
          Estimated cost at 100K-user scale: low hundreds/mo — versus a single-vendor
          stack (Claude primary + Twilio + Pusher + Resend + paid LegiScan + Cloudinary)
          in the low thousands/mo. The architecture makes that a tunable line, not a rebuild.
        </p>
      </Section>

      <div className="mt-12 rounded-lg border border-emerald-700/40 bg-emerald-950/15 p-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-emerald-300">Share this page</p>
        <p className="mt-2 text-sm text-zinc-300">
          Permalink: <code className="rounded bg-zinc-900 px-2 py-0.5 text-emerald-300">https://www.ikratom.org/pitch/efficiency</code>
        </p>
        <p className="mt-2 text-xs text-zinc-500">Reload to recompute. Every number above is a live database read.</p>
        <p className="mt-3 text-xs text-zinc-400">
          The case for keeping the build moving →{" "}
          <Link href="/pitch/partnership" className="font-semibold text-emerald-400 hover:underline">/pitch/partnership</Link>
        </p>
      </div>
    </div>
  );
}

// ───────────────────────── data layer ─────────────────────────

type TaskAgg = { task: string; successes: number; failures: number; inTok: number; outTok: number };
type ProvAgg = { provider: string; successes: number; failures: number };

async function aiUsage(
  supabase: Awaited<ReturnType<typeof createClient>>,
  hours: number,
): Promise<{ successes: number; attempts: number; byTask: TaskAgg[]; byProvider: ProvAgg[] }> {
  const { data } = await supabase.rpc("ai_jobs_stats", { p_hours: hours });
  const rows = (data ?? []) as Array<{
    provider_used: string | null;
    task_kind: string | null;
    successes: number | null;
    failures: number | null;
    total_input_tokens: number | null;
    total_output_tokens: number | null;
  }>;
  const byTask = new Map<string, TaskAgg>();
  const byProvider = new Map<string, ProvAgg>();
  let successes = 0;
  let attempts = 0;
  for (const r of rows) {
    const ok = Number(r.successes ?? 0);
    const fail = Number(r.failures ?? 0);
    successes += ok;
    attempts += ok + fail;
    const t = r.task_kind || "unknown";
    const ta = byTask.get(t) ?? { task: t, successes: 0, failures: 0, inTok: 0, outTok: 0 };
    ta.successes += ok;
    ta.failures += fail;
    ta.inTok += Number(r.total_input_tokens ?? 0);
    ta.outTok += Number(r.total_output_tokens ?? 0);
    byTask.set(t, ta);
    const p = (r.provider_used || "unknown").toLowerCase();
    const pa = byProvider.get(p) ?? { provider: p, successes: 0, failures: 0 };
    pa.successes += ok;
    pa.failures += fail;
    byProvider.set(p, pa);
  }
  return { successes, attempts, byTask: [...byTask.values()], byProvider: [...byProvider.values()] };
}

// Price the successful ops against each Claude tier using real tokens where
// logged, per-task estimates otherwise.
function counterfactual(byTask: TaskAgg[]): {
  totalIn: number;
  totalOut: number;
  tiers: Array<{ id: string; usd: number }>;
} {
  let totalIn = 0;
  let totalOut = 0;
  for (const t of byTask) {
    if (t.successes <= 0) continue;
    const m = TASK_MODEL[t.task] ?? FALLBACK_TOKENS;
    totalIn += t.inTok > 0 ? t.inTok : t.successes * m.in;
    totalOut += t.outTok > 0 ? t.outTok : t.successes * m.out;
  }
  const tiers = CLAUDE_RATES.map((r) => ({ id: r.id, usd: totalIn * r.in + totalOut * r.out }));
  return { totalIn, totalOut, tiers };
}

function fmtUsd(n: number): string {
  if (n >= 1000) return `$${Math.round(n).toLocaleString()}`;
  if (n >= 100) return `$${n.toFixed(0)}`;
  return `$${n.toFixed(2)}`;
}

const PROVIDER_LABELS: Record<string, string> = {
  groq: "Groq · llama-3.3-70b",
  gemini: "Gemini Flash 2.5 + Search",
  ollama: "Ollama (local · $0)",
  mistral: "Mistral Small",
  cerebras: "Cerebras",
  cloudflare: "Cloudflare Workers AI",
  github: "GitHub Models",
  sambanova: "SambaNova",
  openrouter: "OpenRouter",
  nvidia: "NVIDIA NIM",
  none: "Deterministic (no model needed)",
  unknown: "Chain exhausted (deferred)",
};

// ───────────────────────── presentational ─────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-12">
      <h2 className="mb-4 text-2xl font-bold text-zinc-100">{title}</h2>
      {children}
    </section>
  );
}

function Metric({ value, label, sub, tone = "zinc" }: { value: string; label: string; sub: string; tone?: "zinc" | "emerald" | "amber" }) {
  const toneCls = tone === "emerald" ? "border-emerald-700/40 bg-emerald-950/15" : tone === "amber" ? "border-amber-700/40 bg-amber-950/15" : "border-zinc-800 bg-zinc-950/40";
  const valueCls = tone === "emerald" ? "text-emerald-300" : tone === "amber" ? "text-amber-300" : "text-zinc-100";
  return (
    <div className={`rounded-lg border p-5 ${toneCls}`}>
      <p className={`text-3xl font-bold tabular-nums ${valueCls}`}>{value}</p>
      <p className="mt-1 text-sm font-semibold uppercase tracking-wider text-zinc-400">{label}</p>
      <p className="mt-1 text-xs text-zinc-500">{sub}</p>
    </div>
  );
}

function Stat({ n, label, tone, prefix = "" }: { n: number; label: string; tone: "emerald" | "amber"; prefix?: string }) {
  const cls = tone === "emerald" ? "text-emerald-300" : "text-amber-300";
  return (
    <div>
      <p className={`text-3xl font-bold tabular-nums ${cls}`}>{prefix}{n.toLocaleString()}</p>
      <p className="mt-1 text-[11px] uppercase tracking-wider text-zinc-500">{label}</p>
    </div>
  );
}

function SourceGroup({ emoji, title, sources }: { emoji: string; title: string; sources: Array<{ name: string; limit: string }> }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
      <div className="flex items-baseline gap-2">
        <span aria-hidden className="text-lg">{emoji}</span>
        <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-200">{title}</h3>
      </div>
      <ul className="mt-3 space-y-2">
        {sources.map((s) => (
          <li key={s.name} className="flex flex-col gap-0.5 border-t border-zinc-900 pt-2 first:border-t-0 first:pt-0">
            <span className="text-sm font-medium text-zinc-100">{s.name}</span>
            <span className="text-[11px] text-emerald-300">{s.limit}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Row({ cap, us, alt, saved }: { cap: string; us: string; alt: string; saved: string }) {
  return (
    <tr className="hover:bg-zinc-950/40">
      <td className="px-3 py-2 font-medium text-zinc-100">{cap}</td>
      <td className="px-3 py-2 text-emerald-300">{us}</td>
      <td className="px-3 py-2 text-zinc-500">{alt}</td>
      <td className="px-3 py-2 text-right font-mono text-emerald-300">{saved}</td>
    </tr>
  );
}

function UsageBar({ label, count, pct, tone, note }: { label: string; count: number; pct: number; tone: "emerald" | "zinc"; note?: string }) {
  const barCls = tone === "emerald" ? "bg-emerald-500" : "bg-zinc-700";
  const txtCls = tone === "emerald" ? "text-emerald-300" : "text-zinc-500";
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="text-zinc-300">
          {label}
          {note ? <span className="ml-2 text-[10px] text-zinc-600">— {note}</span> : null}
        </span>
        <span className={`font-mono tabular-nums ${txtCls}`}>
          {count.toLocaleString()}{pct > 0 ? ` · ${pct}%` : ""}
        </span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-zinc-900">
        <div className={`h-full ${barCls}`} style={{ width: `${Math.max(pct, count > 0 ? 2 : 0)}%` }} />
      </div>
    </div>
  );
}

function CostBar({ label, usd, max, tone }: { label: string; usd: number; max: number; tone: "red" | "emerald" }) {
  const pct = max > 0 ? Math.round((usd / max) * 100) : 0;
  const barCls = tone === "red" ? "bg-red-600" : "bg-emerald-500";
  const txtCls = tone === "red" ? "text-red-300" : "text-emerald-300";
  return (
    <div className="mb-3 last:mb-0">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="text-zinc-300">{label}</span>
        <span className={`font-mono tabular-nums ${txtCls}`}>≈ {fmtUsd(usd)}</span>
      </div>
      <div className="mt-1 h-3 overflow-hidden rounded-full bg-zinc-900">
        <div className={`h-full ${barCls}`} style={{ width: `${Math.max(pct, usd > 0 ? 2 : 1)}%` }} />
      </div>
    </div>
  );
}
