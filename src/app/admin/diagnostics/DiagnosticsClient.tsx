"use client";

import { useState, useTransition } from "react";
import {
  testDiscordWebhook,
  testPushToSelf,
  testAiProvider,
  testSupabaseHealth,
  listOauthCallbacks,
  checkEnvVars,
  type DiagResult,
  type EnvCheckResult,
} from "@/modules/admin/diagnostics-actions";

type DiscordRow = { id: string; server_name: string; channel_name: string; active: boolean; state_filter: string | null };

export function DiagnosticsClient({
  discordRows,
  isOwner,
}: {
  discordRows: DiscordRow[];
  isOwner: boolean;
}) {
  const [results, setResults] = useState<Record<string, DiagResult | EnvCheckResult>>({});
  const [running, setRunning] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function run(key: string, fn: () => Promise<DiagResult | EnvCheckResult>) {
    setRunning(key);
    startTransition(async () => {
      const r = await fn();
      setResults((s) => ({ ...s, [key]: r }));
      setRunning(null);
    });
  }

  return (
    <div className="space-y-6">
      <TestSection
        title="🗄 Supabase"
        description="Database reachability + read latency."
      >
        <TestButton
          label="Test Supabase"
          running={running === "sb"}
          onClick={() => run("sb", testSupabaseHealth)}
          result={results["sb"] as DiagResult | undefined}
        />
      </TestSection>

      <TestSection
        title="💬 Discord webhooks"
        description={
          discordRows.length === 0
            ? "No Discord integrations configured. Add one at /admin/discord-integrations/new."
            : `${discordRows.length} integration${discordRows.length === 1 ? "" : "s"} configured. Each test posts a literal diagnostic message to the channel.`
        }
      >
        {discordRows.length > 0 && (
          <ul className="space-y-2">
            {discordRows.map((d) => {
              const key = `discord-${d.id}`;
              return (
                <li key={d.id} className="rounded border border-zinc-800 bg-zinc-950/60 p-2">
                  <div className="flex flex-wrap items-baseline gap-x-2 text-[11px]">
                    <span className="font-semibold text-zinc-200">{d.server_name}</span>
                    <span className="text-zinc-500">#{d.channel_name}</span>
                    {d.state_filter && (
                      <span className="rounded bg-zinc-900 px-1 py-0.5 font-mono text-[9px] uppercase text-zinc-400">
                        {d.state_filter}
                      </span>
                    )}
                    {!d.active && <span className="text-amber-400">(inactive)</span>}
                  </div>
                  <TestButton
                    label="Send test post"
                    running={running === key}
                    onClick={() => run(key, () => testDiscordWebhook(d.id))}
                    result={results[key] as DiagResult | undefined}
                    small
                  />
                </li>
              );
            })}
          </ul>
        )}
      </TestSection>

      <TestSection
        title="📲 Push notifications"
        description="Sends a test push to your current push subscriptions. Requires you accepted the prompt on this device."
      >
        <TestButton
          label="Send test push to self"
          running={running === "push"}
          onClick={() => run("push", testPushToSelf)}
          result={results["push"] as DiagResult | undefined}
        />
      </TestSection>

      <TestSection
        title="🧠 AI providers"
        description="Pings each AI router target. Each provider responds in <1s when healthy."
      >
        <div className="grid gap-2 sm:grid-cols-3">
          {(["groq", "gemini", "ollama"] as const).map((p) => {
            const key = `ai-${p}`;
            return (
              <div key={p} className="rounded border border-zinc-800 bg-zinc-950/60 p-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-300">{p}</p>
                <TestButton
                  label="Ping"
                  running={running === key}
                  onClick={() => run(key, () => testAiProvider(p))}
                  result={results[key] as DiagResult | undefined}
                  small
                />
              </div>
            );
          })}
        </div>
      </TestSection>

      <TestSection
        title="🔑 OAuth callbacks"
        description="Verifies each OAuth callback URL is reachable. Doesn't actually authenticate — just confirms the route exists + responds."
      >
        <TestButton
          label="Check OAuth callbacks"
          running={running === "oauth"}
          onClick={() => run("oauth", listOauthCallbacks)}
          result={results["oauth"] as DiagResult | undefined}
        />
        {results["oauth"]?.ok && "details" in results["oauth"] && (results["oauth"].details as { results?: Array<{ provider: string; url: string; status: number; reachable: boolean }> }).results && (
          <ul className="mt-2 space-y-1 text-[10px]">
            {((results["oauth"].details as { results: Array<{ provider: string; url: string; status: number; reachable: boolean }> }).results).map((r) => (
              <li key={r.url} className={`rounded border px-2 py-1 ${r.reachable ? "border-emerald-700/40 bg-emerald-950/10" : "border-red-700/40 bg-red-950/15"}`}>
                <span className="font-semibold">{r.provider}</span>
                <span className="ml-2 font-mono text-zinc-500">{r.url}</span>
                <span className={`ml-2 ${r.reachable ? "text-emerald-300" : "text-red-300"}`}>
                  HTTP {r.status || "—"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </TestSection>

      <TestSection
        title="🔐 Env-var sanity"
        description={
          isOwner
            ? "Lists which env vars are set on the server (names only, NEVER values)."
            : "Owner-only. Hidden from admins to avoid leaking the shape of secret config."
        }
      >
        {isOwner && (
          <>
            <TestButton
              label="Check env vars"
              running={running === "env"}
              onClick={() => run("env", checkEnvVars)}
              result={undefined}
            />
            {results["env"]?.ok && "rows" in results["env"] && (
              <table className="mt-2 w-full text-[10px]">
                <thead className="text-[9px] uppercase tracking-wider text-zinc-500">
                  <tr>
                    <th className="text-left">Variable</th>
                    <th className="text-left">Set?</th>
                    <th className="text-right">Length</th>
                    <th className="text-left">Required</th>
                  </tr>
                </thead>
                <tbody>
                  {(results["env"] as { ok: true; rows: Array<{ name: string; set: boolean; length: number; required: boolean }> }).rows.map((row) => (
                    <tr key={row.name} className="border-t border-zinc-900">
                      <td className="py-1 font-mono text-zinc-300">{row.name}</td>
                      <td className={`py-1 ${row.set ? "text-emerald-400" : row.required ? "text-red-400" : "text-zinc-500"}`}>
                        {row.set ? "✓" : "✗"}
                      </td>
                      <td className="py-1 text-right font-mono text-zinc-500">{row.length}</td>
                      <td className="py-1 text-[9px] text-zinc-500">{row.required ? "required" : "optional"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </TestSection>
    </div>
  );
}

function TestSection({
  title, description, children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
      <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-300">{title}</h2>
      <p className="mt-1 text-[11px] text-zinc-400">{description}</p>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function TestButton({
  label, running, onClick, result, small,
}: {
  label: string;
  running: boolean;
  onClick: () => void;
  result: DiagResult | undefined;
  small?: boolean;
}) {
  return (
    <>
      <button
        type="button"
        onClick={onClick}
        disabled={running}
        className={`min-h-[40px] rounded-md bg-emerald-500 px-4 ${small ? "py-1 text-[11px]" : "py-1.5 text-[12px]"} font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-40`}
      >
        {running ? "Testing…" : label}
      </button>
      {result && !result.ok && (
        <p className="mt-2 rounded border border-red-700/40 bg-red-950/15 px-2 py-1 text-[10px] text-red-200">
          ✗ {result.error}
        </p>
      )}
      {result && result.ok && "message" in result && (
        <p className="mt-2 rounded border border-emerald-700/40 bg-emerald-950/15 px-2 py-1 text-[10px] text-emerald-200">
          ✓ {result.message}
        </p>
      )}
    </>
  );
}
