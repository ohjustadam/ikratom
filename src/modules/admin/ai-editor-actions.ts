"use server";

/**
 * AI Editor-in-Chief — a conversational OPS COPILOT for the owner/admins
 * (owner ask 2026-07-03: "an AI I can work with inside the admin panel").
 *
 * What it IS: a free-tier (Groq → Gemini → Ollama) chat assistant that (a) knows
 * the live site status injected each turn, so it can answer "what's broken /
 * what's pending / what should I do", and (b) can PROPOSE a small set of safe,
 * reversible, already-audited operations. It NEVER executes on its own — the
 * model only emits a proposal; the human clicks Confirm, and the UI calls the
 * real audited server action directly. So a hallucinated tool call can't mutate
 * anything, and every real change goes through getAdminContext + recordAdminAction.
 *
 * What it is NOT: a code editor. Free-tier models can't safely write/deploy the
 * app's TypeScript/migrations. For code changes it tells the owner to open a
 * coding session. This is operations, not engineering.
 *
 * Reuses the proven askAdminChatbot pattern (free router, stateless server,
 * client owns history, rate-limited).
 */

import { getAdminContext } from "./actions";
import { checkRateLimit } from "@/lib/rate-limit";
import { recordAdminAction } from "@/lib/audit";
import { complete } from "@/lib/ai/router";
import type { PromptInput } from "@/lib/ai/types";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { triggerCron } from "./console-actions";
import { syncOneStateLegislators } from "./sync-actions";

export type EditorProposal = { tool: string; args: Record<string, unknown>; summary: string };
export type EditorTurn =
  | { ok: true; answer: string; provider: string; proposal: EditorProposal | null }
  | { ok: false; error: string };
export type EditorMessage = { role: "user" | "assistant"; content: string };

// ── Whitelisted tools (v1: entity-free + reversible only) ───────────────────
// Each tool validates its own args and returns { ok, message }. Deliberately
// small: no UUID-resolving edits, no role changes, no SQL, no mass-notify yet.
const TOOLS: Record<
  string,
  {
    describe: string;
    argsHint: string;
    run: (args: Record<string, unknown>) => Promise<{ ok: boolean; message: string }>;
  }
> = {
  trigger_cron: {
    describe: "Run a maintenance cron now (catch up syncs / fire scheduled work).",
    argsHint: `{"endpoint":"daily-sync"|"fire-waves"|"reverify-local-officials"}`,
    run: async (args) => {
      const ep = String(args.endpoint ?? "");
      if (!["daily-sync", "fire-waves", "reverify-local-officials"].includes(ep)) {
        return { ok: false, message: `Unknown endpoint "${ep}".` };
      }
      const r = await triggerCron(ep as "daily-sync" | "fire-waves" | "reverify-local-officials");
      return r.ok
        ? { ok: true, message: `Ran /api/cron/${ep} → HTTP ${r.status} in ${r.elapsedMs}ms.` }
        : { ok: false, message: r.error };
    },
  },
  sync_state_legislators: {
    describe: "Re-sync one state's legislators from OpenStates (refresh a roster).",
    argsHint: `{"state":"OK"}`,
    run: async (args) => {
      const st = String(args.state ?? "").toUpperCase();
      if (!/^[A-Z]{2}$/.test(st)) return { ok: false, message: `"${st}" is not a 2-letter state code.` };
      const r = (await syncOneStateLegislators(st)) as { ok?: boolean; error?: string; count?: number } | undefined;
      if (r && r.error) return { ok: false, message: r.error };
      return { ok: true, message: `Synced ${st} legislators${r && typeof r.count === "number" ? ` (${r.count})` : ""}.` };
    },
  },
};

/** Compact live status the model reasons over each turn. Read-only. */
async function getOpsSnapshot(): Promise<string> {
  const sb = createServiceRoleClient();
  const nowMs = Date.now();
  const [pendCampaigns, pendAlerts, runs] = await Promise.all([
    sb.from("campaigns").select("id", { count: "exact", head: true }).eq("review_state", "pending_review").eq("active", false),
    sb.from("policy_alerts").select("id", { count: "exact", head: true }).eq("moderation_status", "pending"),
    sb.from("scraper_runs").select("source, status, started_at").order("started_at", { ascending: false }).limit(1500),
  ]);
  // Latest run per source → flag errors + staleness.
  const latest: Record<string, { status: string; ageH: number }> = {};
  for (const r of (runs.data ?? []) as { source: string; status: string; started_at: string }[]) {
    if (!latest[r.source]) latest[r.source] = { status: r.status, ageH: (nowMs - new Date(r.started_at).getTime()) / 3_600_000 };
  }
  const errs = Object.entries(latest).filter(([, v]) => v.status === "error").map(([s]) => s);
  const stale = Object.entries(latest).filter(([, v]) => v.ageH > 48).map(([s, v]) => `${s} (${v.ageH.toFixed(0)}h)`);
  return [
    `Pending campaigns awaiting review: ${pendCampaigns.count ?? "?"}`,
    `Pending intel alerts awaiting review: ${pendAlerts.count ?? "?"}`,
    `Cron sources tracked: ${Object.keys(latest).length}. Latest-run ERROR: ${errs.length ? errs.join(", ") : "none"}. Stale >48h: ${stale.length ? stale.join(", ") : "none"}.`,
  ].join("\n");
}

function buildSystem(snapshot: string): string {
  const tools = Object.entries(TOOLS).map(([n, t]) => `- ${n}: ${t.describe} args=${t.argsHint}`).join("\n");
  return `You are iKratom's "AI Editor-in-Chief" — an operations copilot for the site owner (a non-developer) inside the admin panel. Be concise, direct, and practical.

LIVE SITE STATUS (right now):
${snapshot}

You can PROPOSE these operations (you never run them yourself — the owner clicks Confirm):
${tools}

When the owner asks you to DO one of those things, explain what you'll do in one or two sentences, then append EXACTLY ONE line at the very end of your reply, formatted:
PROPOSE: {"tool":"<name>","args":{...},"summary":"<one-line plain-English summary>"}
Only propose a tool that is in the list above, with valid args. If no tool applies, do NOT append a PROPOSE line — just answer.

IMPORTANT LIMITS (be honest about these):
- You CANNOT edit the site's code, write database migrations, build new features, or deploy. Those need a developer/coding session. If the owner asks for a code change or a new feature, say so plainly and suggest they open a coding session — but you CAN help by describing the change precisely and diagnosing the problem.
- For moderation decisions (approving/rejecting pending campaigns or alerts), point the owner to the right admin page (/admin/campaigns/pending, /admin/intel-queue) rather than proposing a tool — approvals can notify users and are the owner's call.
- Answer questions about site status from the LIVE STATUS above and general knowledge of the platform. If you don't know, say so.`;
}

const PROPOSE_RE = /PROPOSE:\s*(\{[\s\S]*\})\s*$/;

/** One conversational turn. Stateless: the client passes prior history. */
export async function askAdminEditor(message: string, history: EditorMessage[] = []): Promise<EditorTurn> {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { ok: false, error: "Admins only." };

  const msg = (message ?? "").trim();
  if (!msg) return { ok: false, error: "Empty message." };
  if (msg.length > 2000) return { ok: false, error: "Message too long (2000 char max)." };
  if (!(await checkRateLimit(`ai_editor:${ctx.userId}`, 40, 3600))) {
    return { ok: false, error: "Slow down — 40 messages an hour." };
  }

  const snapshot = await getOpsSnapshot();
  const messages: PromptInput = [
    { role: "system", content: buildSystem(snapshot) },
    ...history.slice(-12).map((m) => ({ role: m.role, content: String(m.content).slice(0, 2000) })),
    { role: "user", content: msg },
  ];

  let text = "";
  let provider = "unknown";
  try {
    const r = await complete("reasoning", messages, {}, { maxTokens: 900, temperature: 0.2 });
    text = r.text ?? "";
    provider = r.provider;
  } catch (e) {
    return { ok: false, error: `AI unavailable right now (${(e as Error).message?.slice(0, 80)}). Try again shortly.` };
  }

  // Parse an optional trailing PROPOSE line; strip it from the shown answer.
  let proposal: EditorProposal | null = null;
  const m = text.match(PROPOSE_RE);
  if (m) {
    try {
      const p = JSON.parse(m[1]) as EditorProposal;
      if (p && typeof p.tool === "string" && TOOLS[p.tool] && p.args && typeof p.args === "object") {
        proposal = { tool: p.tool, args: p.args, summary: String(p.summary ?? p.tool).slice(0, 200) };
      }
    } catch { /* malformed proposal → ignore, treat as plain answer */ }
    text = text.replace(PROPOSE_RE, "").trim();
  }

  return { ok: true, answer: text || "(no response)", provider, proposal };
}

/** Confirm handler — the UI calls this when the owner clicks "Do it". The model
 *  never reaches here; only a whitelisted tool with validated args runs. */
export async function executeEditorTool(tool: string, argsJson: string): Promise<{ ok: boolean; message: string }> {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { ok: false, message: "Admins only." };
  const def = TOOLS[tool];
  if (!def) return { ok: false, message: `Tool "${tool}" is not allowed.` };
  if (!(await checkRateLimit(`ai_editor_exec:${ctx.userId}`, 30, 3600))) {
    return { ok: false, message: "Too many actions this hour — slow down." };
  }
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(argsJson || "{}");
  } catch {
    return { ok: false, message: "Invalid arguments." };
  }
  let result: { ok: boolean; message: string };
  try {
    result = await def.run(args);
  } catch (e) {
    result = { ok: false, message: `Failed: ${(e as Error).message?.slice(0, 150)}` };
  }
  await recordAdminAction({ action: `ai_editor.${tool}`, details: { args, ok: result.ok, message: result.message.slice(0, 200) } });
  return result;
}
