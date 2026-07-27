"use server";

/**
 * Admin server actions for the user_error_reports triage surface.
 *
 * Mirrors src/modules/admin/auth-events-actions.ts — same flow, different
 * table. Filing one GitHub issue per cluster, then stamping the URL back
 * onto every matching row so the cluster isn't re-filed.
 */

import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getAdminContext } from "@/modules/admin/actions";
import { recordAdminAction } from "@/lib/audit";
import { suggestedFixForErrorCode } from "@/lib/auth-events";

const GH_OWNER = process.env.GITHUB_REPO_OWNER ?? "ohjustadam";
const GH_REPO = process.env.GITHUB_REPO_NAME ?? "ikratom";

function admin() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

export type EscalateResult =
  | { ok: true; issueUrl: string; alreadyFiled: boolean }
  | { ok: false; error: string };

export async function escalateUserErrorToDevs(input: {
  kind: string;
  errorCode: string | null;
}): Promise<EscalateResult> {
  const ctx = await getAdminContext({ require: "view_security_signals" });
  if (!ctx.ok) return { ok: false, error: "Admin required." };

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return {
      ok: false,
      error: "GITHUB_TOKEN env var not set. Add a fine-grained PAT with 'issues:write' scope to enable dev-issue filing.",
    };
  }

  const db = admin();

  const { data: existing } = await db
    .from("user_error_reports")
    .select("dev_issue_url")
    .eq("kind", input.kind)
    .eq("error_code", input.errorCode)
    .not("dev_issue_url", "is", null)
    .order("dev_issue_filed_at", { ascending: false })
    .limit(1);
  if (existing && existing.length > 0 && existing[0].dev_issue_url) {
    return { ok: true, issueUrl: existing[0].dev_issue_url, alreadyFiled: true };
  }

  const since24h = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { data: rows, count } = await db
    .from("user_error_reports")
    .select("created_at, error_message, user_description, ip, user_agent, context, auto_fix_notes", { count: "exact" })
    .eq("kind", input.kind)
    .eq("error_code", input.errorCode)
    .gte("created_at", since24h)
    .order("created_at", { ascending: false })
    .limit(10);

  const total = count ?? rows?.length ?? 0;
  const fix = input.errorCode ? suggestedFixForErrorCode(input.errorCode) : null;

  const title = `[user-error] ${total}× ${input.kind}${input.errorCode ? ` — ${input.errorCode}` : ""} (24h)`;

  const body = [
    `**Cluster**: \`${input.kind}\` · code \`${input.errorCode ?? "—"}\``,
    `**Volume (last 24h)**: ${total}`,
    `**Escalated by**: ${ctx.email ?? ctx.userId} via /admin/user-errors`,
    "",
    fix ? `**Suggested fix**:\n> ${fix}` : "**No pre-canned fix mapped for this error_code yet.**",
    "",
    "## Recent sample (up to 10)",
    "",
    "| When | error_message | user said | page URL |",
    "|---|---|---|---|",
    ...(rows ?? []).slice(0, 10).map((r) => {
      const msg = (r.error_message ?? "").slice(0, 80).replace(/\|/g, "\\|").replace(/\n/g, " ");
      const desc = (r.user_description ?? "").slice(0, 100).replace(/\|/g, "\\|").replace(/\n/g, " ");
      const pageUrl = ((r.context as { page_url?: string } | null)?.page_url ?? "").slice(0, 80).replace(/\|/g, "\\|");
      return `| ${new Date(r.created_at).toISOString().slice(0, 19)}Z | \`${msg}\` | \`${desc}\` | \`${pageUrl}\` |`;
    }),
    "",
    "## Classifier notes (most recent)",
    "",
    `> ${(rows?.[0]?.auto_fix_notes ?? "(none)").slice(0, 400)}`,
    "",
    "---",
    "_Filed automatically by /admin/user-errors self-healing surface. Source table: `user_error_reports` (migration 0147)._",
  ].join("\n");

  let issueUrl: string;
  try {
    const res = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/issues`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        "User-Agent": "iKratom self-healing",
      },
      body: JSON.stringify({
        title: title.slice(0, 200),
        body,
        labels: ["user-error", "auto-filed"],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return { ok: false, error: `GitHub API ${res.status}: ${t.slice(0, 200)}` };
    }
    const j = (await res.json()) as { html_url?: string };
    if (!j.html_url) return { ok: false, error: "GitHub API returned no html_url." };
    issueUrl = j.html_url;
  } catch (e) {
    return { ok: false, error: `GitHub API request failed: ${(e as Error).message}` };
  }

  const now = new Date().toISOString();
  await db
    .from("user_error_reports")
    .update({ dev_issue_url: issueUrl, dev_issue_filed_at: now })
    .eq("kind", input.kind)
    .eq("error_code", input.errorCode)
    .gte("created_at", since24h);

  try {
    await recordAdminAction({
      action: "user_errors.escalate_to_devs",
      details: { kind: input.kind, error_code: input.errorCode, count: total, issue_url: issueUrl },
    });
  } catch { /* non-fatal */ }

  return { ok: true, issueUrl, alreadyFiled: false };
}

export async function dismissUserErrorCluster(input: {
  kind: string;
  errorCode: string | null;
  note?: string;
}): Promise<{ ok: true; updated: number } | { ok: false; error: string }> {
  const ctx = await getAdminContext({ require: "view_security_signals" });
  if (!ctx.ok) return { ok: false, error: "Admin required." };

  const since24h = new Date(Date.now() - 24 * 3600_000).toISOString();
  const db = admin();
  const note = (input.note ?? "Manually dismissed by admin").slice(0, 200);

  const { error, count } = await db
    .from("user_error_reports")
    .update({
      escalated_to_admin: false,
      auto_fix_outcome: "resolved_dismissed",
      auto_fix_notes: `[manual dismiss by ${ctx.email ?? ctx.userId}] ${note}`,
    }, { count: "exact" })
    .eq("kind", input.kind)
    .eq("error_code", input.errorCode)
    .gte("created_at", since24h)
    .eq("escalated_to_admin", true);
  if (error) return { ok: false, error: error.message };

  try {
    await recordAdminAction({
      action: "user_errors.dismiss_cluster",
      details: { kind: input.kind, error_code: input.errorCode, note },
    });
  } catch { /* non-fatal */ }

  return { ok: true, updated: count ?? 0 };
}
