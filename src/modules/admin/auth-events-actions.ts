"use server";

/**
 * Admin server actions for auth_events surface.
 *
 * Origin: owner directive 2026-05-15 — "can we add a button to 'send
 * error to devs' so we know right away in the admin panel that something
 * needs to be addressed?"
 *
 * Two flows:
 *   1. escalateAuthFailureToDevs — files a GitHub issue against
 *      ${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME} (defaults to this repo)
 *      using a GITHUB_TOKEN with `issues:write` scope. Returns the issue
 *      URL and writes it back onto every matching auth_events row so the
 *      same cluster isn't re-filed.
 *
 *   2. dismissAuthFailureCluster — admin manually marks a cluster as
 *      acknowledged. Useful when the fix happens out-of-band (e.g. admin
 *      adds the redirect URI to Google Console without filing an issue).
 *
 * Both require admin auth (re-checked server-side, RLS-protected reads,
 * audit log on mutation).
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

/**
 * File a GitHub issue for an auth-failure cluster and stamp the URL
 * back onto every matching row so we don't double-file.
 */
export async function escalateAuthFailureToDevs(input: {
  kind: string;
  provider: string | null;
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

  // Has anyone in this cluster already been filed? If so, return that URL.
  const { data: existing } = await db
    .from("auth_events")
    .select("dev_issue_url, count")
    .eq("kind", input.kind)
    .eq("provider", input.provider)
    .eq("error_code", input.errorCode)
    .not("dev_issue_url", "is", null)
    .order("dev_issue_filed_at", { ascending: false })
    .limit(1);
  if (existing && existing.length > 0 && existing[0].dev_issue_url) {
    return { ok: true, issueUrl: existing[0].dev_issue_url, alreadyFiled: true };
  }

  // Pull a sample of recent rows for the cluster to embed in the issue body.
  const since24h = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { data: rows, count } = await db
    .from("auth_events")
    .select("created_at, error_message, ip, user_agent, context, auto_fix_notes", { count: "exact" })
    .eq("status", "fail")
    .eq("kind", input.kind)
    .eq("provider", input.provider)
    .eq("error_code", input.errorCode)
    .gte("created_at", since24h)
    .order("created_at", { ascending: false })
    .limit(10);

  const total = count ?? rows?.length ?? 0;
  const fix = input.errorCode ? suggestedFixForErrorCode(input.errorCode) : null;

  const title = `[auth-events] ${total}× ${input.kind}${input.provider ? ` / ${input.provider}` : ""}${input.errorCode ? ` — ${input.errorCode}` : ""} (24h)`;

  const body = [
    `**Cluster**: \`${input.kind}\` · provider \`${input.provider ?? "—"}\` · code \`${input.errorCode ?? "—"}\``,
    `**Volume (last 24h)**: ${total}`,
    `**Escalated by**: ${ctx.email ?? ctx.userId} via /admin/oauth-config`,
    "",
    fix ? `**Suggested fix**:\n> ${fix}` : "**No pre-canned fix mapped for this error_code yet.**",
    "",
    "## Recent sample (up to 10)",
    "",
    "| When | error_message | ip | UA snippet |",
    "|---|---|---|---|",
    ...(rows ?? []).slice(0, 10).map((r) => {
      const msg = (r.error_message ?? "").slice(0, 100).replace(/\|/g, "\\|").replace(/\n/g, " ");
      const ip = (r.ip ?? "").slice(0, 30);
      const ua = (r.user_agent ?? "").slice(0, 50).replace(/\|/g, "\\|");
      return `| ${new Date(r.created_at).toISOString().slice(0, 19)}Z | \`${msg}\` | \`${ip}\` | \`${ua}\` |`;
    }),
    "",
    "## Classifier notes (most recent)",
    "",
    `> ${(rows?.[0]?.auto_fix_notes ?? "(none)").slice(0, 400)}`,
    "",
    "---",
    "_Filed automatically by /admin/oauth-config self-healing surface. See `src/lib/auth-events-auto-fix.ts` for the classifier rules._",
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
        labels: ["auth-failure", "auto-filed"],
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

  // Stamp the URL onto every matching row in the last 24h so the admin
  // panel knows this cluster is already filed.
  const now = new Date().toISOString();
  await db
    .from("auth_events")
    .update({ dev_issue_url: issueUrl, dev_issue_filed_at: now })
    .eq("status", "fail")
    .eq("kind", input.kind)
    .eq("provider", input.provider)
    .eq("error_code", input.errorCode)
    .gte("created_at", since24h);

  try {
    await recordAdminAction({
      action: "auth_events.escalate_to_devs",
      details: {
        kind: input.kind,
        provider: input.provider,
        error_code: input.errorCode,
        count: total,
        issue_url: issueUrl,
      },
    });
  } catch { /* non-fatal */ }

  return { ok: true, issueUrl, alreadyFiled: false };
}

/**
 * Admin manually marks a cluster as resolved (e.g. they fixed it in the
 * Google Cloud Console). Future failures in the same cluster will
 * re-escalate on a new row, so this doesn't permanently silence the alert.
 */
export async function dismissAuthFailureCluster(input: {
  kind: string;
  provider: string | null;
  errorCode: string | null;
  note?: string;
}): Promise<{ ok: true; updated: number } | { ok: false; error: string }> {
  const ctx = await getAdminContext({ require: "view_security_signals" });
  if (!ctx.ok) return { ok: false, error: "Admin required." };

  const since24h = new Date(Date.now() - 24 * 3600_000).toISOString();
  const db = admin();
  const note = (input.note ?? "Manually dismissed by admin").slice(0, 200);

  const { error, count } = await db
    .from("auth_events")
    .update({
      escalated_to_admin: false,
      auto_fix_outcome: "resolved_dismissed",
      auto_fix_notes: `[manual dismiss by ${ctx.email ?? ctx.userId}] ${note}`,
    }, { count: "exact" })
    .eq("status", "fail")
    .eq("kind", input.kind)
    .eq("provider", input.provider)
    .eq("error_code", input.errorCode)
    .gte("created_at", since24h)
    .eq("escalated_to_admin", true);
  if (error) return { ok: false, error: error.message };

  try {
    await recordAdminAction({
      action: "auth_events.dismiss_cluster",
      details: {
        kind: input.kind,
        provider: input.provider,
        error_code: input.errorCode,
        note,
      },
    });
  } catch { /* non-fatal */ }

  return { ok: true, updated: count ?? 0 };
}
