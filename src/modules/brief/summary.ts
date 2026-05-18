/**
 * Daily brief AI-summary helper.
 *
 * Generates the 1-paragraph synthesis that sits at the top of /brief:
 * "Yesterday in OK, HB 3318 moved out of committee with a 7-3 vote.
 * Two new BoP findings posted. KCPA operation now has bills in 19
 * states." Pulls together the day's signals (state alerts, bill
 * movements, active operations) and lets the LLM write a tight
 * advocate-facing paragraph.
 *
 * Cached per (scope, date) via the daily_brief_summaries table — so
 * even at scale, max ~51 LLM calls per day across all users.
 *
 * Uses the existing AI router (Ollama → Groq → Gemini). No paid API.
 */

import { createClient as createServiceClient } from "@supabase/supabase-js";
import { complete } from "@/lib/ai";

export type BriefSignals = {
  scope: string;                   // 'national' or 2-letter state abbr
  state_label?: string | null;     // e.g. 'Oklahoma' if scope is OK
  alerts_critical: number;
  alerts_warn: number;
  recent_alert_titles: string[];   // up to 5
  bills_moved: number;             // last 7 days
  recent_bill_lines: string[];     // formatted "OK HB 3318 — [status]"
  active_ops: number;
  active_op_names: string[];       // top operation names
};

const PROMPT = `You are writing the daily intel-paragraph for a kratom-policy advocacy platform. Audience: advocates, shop owners, veterans, and curious citizens.

Write ONE concise paragraph (max ~80 words) summarizing the day's signals. Tone: factual, slightly urgent when there's real movement, calm when quiet. NEVER editorialize or take a political side. Mention specific bill numbers, state names, and operation names verbatim. End with a brief implication ("watch the X committee this week") only if warranted by the signals.

If there are no signals, say so plainly — "Quiet day across [scope]. No new alerts, no bill movement." Don't fabricate urgency.

Input data (literal, do not embellish):
{{INPUT}}

Output only the paragraph itself. No headers, no markdown. No emojis. No quotes around the paragraph.`;

function renderInput(s: BriefSignals): string {
  const lines: string[] = [];
  lines.push(`Scope: ${s.state_label ?? s.scope}`);
  lines.push(`Alerts last 7 days: ${s.alerts_critical} critical · ${s.alerts_warn} warn`);
  if (s.recent_alert_titles.length > 0) {
    lines.push(`Recent alert titles:`);
    for (const t of s.recent_alert_titles) lines.push(`  - ${t}`);
  }
  lines.push(`Bills moved last 7 days: ${s.bills_moved}`);
  if (s.recent_bill_lines.length > 0) {
    lines.push(`Bill movement detail:`);
    for (const b of s.recent_bill_lines) lines.push(`  - ${b}`);
  }
  lines.push(`Active operations: ${s.active_ops}`);
  if (s.active_op_names.length > 0) {
    lines.push(`Top operations: ${s.active_op_names.join(", ")}`);
  }
  return lines.join("\n");
}

/**
 * Get or generate the day's summary for a scope. Service-role client
 * so writes succeed regardless of viewer auth state. Reads use the
 * public RLS policy from migration 0155.
 */
export async function getOrGenerateBriefSummary(
  signals: BriefSignals,
): Promise<{ summary: string; cached: boolean; provider?: string } | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  const sb = createServiceClient(url, serviceKey);

  const today = new Date().toISOString().slice(0, 10);

  // 1. Cache lookup
  const { data: cached } = await sb
    .from("daily_brief_summaries")
    .select("summary_md, provider")
    .eq("scope", signals.scope)
    .eq("brief_date", today)
    .maybeSingle();
  if (cached) {
    return { summary: (cached as { summary_md: string }).summary_md, cached: true, provider: (cached as { provider: string | null }).provider ?? undefined };
  }

  // 2. Avoid wasting an LLM call on completely empty days — generate
  //    a static "quiet" line instead.
  const isQuiet =
    signals.alerts_critical === 0 &&
    signals.alerts_warn === 0 &&
    signals.bills_moved === 0 &&
    signals.active_ops === 0;
  if (isQuiet) {
    const quietSummary = `Quiet day across ${signals.state_label ?? signals.scope}. No new alerts, no tracked-bill movement, no active operation cycles. Good time to read up on the long-running operations or to onboard a new advocate.`;
    await sb.from("daily_brief_summaries").upsert({
      scope: signals.scope,
      brief_date: today,
      summary_md: quietSummary,
      signals_used: signals,
      provider: "static",
    });
    return { summary: quietSummary, cached: false, provider: "static" };
  }

  // 3. Generate via the AI router. Bounded budget — fall back silently
  //    if every provider fails (the brief is still useful without it).
  try {
    const prompt = PROMPT.replace("{{INPUT}}", renderInput(signals));
    const result = await complete("general", prompt, {}, { maxTokens: 220, temperature: 0.3 });
    const summary = result.text.trim();
    if (!summary || summary.length < 20) return null;

    await sb.from("daily_brief_summaries").upsert({
      scope: signals.scope,
      brief_date: today,
      summary_md: summary,
      signals_used: signals,
      provider: result.provider,
    });
    return { summary, cached: false, provider: result.provider };
  } catch {
    return null;
  }
}
