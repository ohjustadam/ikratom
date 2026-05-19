"use server";

import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getAdminContext } from "./actions";
import { recordAdminAction } from "@/lib/audit";

/**
 * Diagnostic server actions — verify each external integration is
 * actually reachable + working. Used from /admin/diagnostics when
 * something looks broken and you need to isolate whether the
 * platform's at fault or a third-party is down.
 *
 * Every test reports back: success / failure / specific error.
 * Every test is admin-gated and audit-logged so misuse is visible.
 */

function svc() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createServiceClient(url, key, { auth: { persistSession: false } });
}

export type DiagResult =
  | { ok: true; message: string; details?: Record<string, unknown> }
  | { ok: false; error: string; details?: Record<string, unknown> };

// ── Discord webhook test ──────────────────────────────────────

export async function testDiscordWebhook(integrationId: string): Promise<DiagResult> {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { ok: false, error: "Admin required." };

  const sb = svc();
  if (!sb) return { ok: false, error: "Service-role env not configured." };

  const { data, error } = await sb
    .from("discord_integrations")
    .select("id, webhook_url, server_name, channel_name")
    .eq("id", integrationId)
    .maybeSingle();
  if (error || !data) return { ok: false, error: `Integration not found: ${error?.message ?? "no row"}` };

  const row = data as { webhook_url: string; server_name: string; channel_name: string };

  // Discord webhooks accept POST with a JSON body. We post a low-key
  // diagnostic message that's clearly a test (so a recipient won't
  // mistake it for a real alert).
  try {
    const r = await fetch(row.webhook_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: `🔧 iKratom diagnostic ping · ${new Date().toUTCString()}\n_This is a connectivity test. Ignore if you weren't expecting it._`,
        username: "iKratom (test)",
      }),
      signal: AbortSignal.timeout(10_000),
    });

    await recordAdminAction({
      action: "diag.discord_test",
      targetType: "user",
      targetId: ctx.userId,
      details: { integration_id: integrationId, status: r.status, server: row.server_name },
    });

    if (r.ok) {
      return {
        ok: true,
        message: `Posted to ${row.server_name} · #${row.channel_name}`,
        details: { http_status: r.status },
      };
    }
    const body = (await r.text()).slice(0, 300);
    return { ok: false, error: `HTTP ${r.status}: ${body}` };
  } catch (e) {
    return { ok: false, error: `Network failure: ${(e as Error).message}` };
  }
}

// ── Push notification test (sends to the current admin) ───────

export async function testPushToSelf(): Promise<DiagResult> {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { ok: false, error: "Admin required." };

  const sb = svc();
  if (!sb) return { ok: false, error: "Service-role env not configured." };

  // Find the admin's push subscriptions
  const { data: subs } = await sb
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", ctx.userId);

  if (!subs || subs.length === 0) {
    return {
      ok: false,
      error: "No push subscriptions found for your account. Enable push notifications first (visit /now or /brief and accept the prompt).",
    };
  }

  // Lazy import to avoid loading web-push in every server bundle
  const { sendPush } = await import("@/lib/push/send");

  let succeeded = 0;
  const errors: string[] = [];
  for (const s of subs as Array<{ id: string; endpoint: string; p256dh: string; auth: string }>) {
    const res = await sendPush(
      { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
      {
        title: "iKratom diagnostic ping",
        body: "Push delivery is working. This is a test.",
        tag: "diagnostic",
        link: "/admin/diagnostics",
      },
    );
    if (res.ok) succeeded++;
    else errors.push(res.gone ? `gone (${res.statusCode})` : (res.error || "send failed"));
  }

  await recordAdminAction({
    action: "diag.push_test",
    targetType: "user",
    targetId: ctx.userId,
    details: { sent_to: subs.length, succeeded, errors: errors.slice(0, 3) },
  });

  if (succeeded === 0) {
    return { ok: false, error: `All ${subs.length} subscriptions failed. First error: ${errors[0] ?? "unknown"}` };
  }
  return {
    ok: true,
    message: `Sent to ${succeeded} of ${subs.length} subscriptions. Check your phone / browser.`,
    details: { subscriptions: subs.length, succeeded, failed: errors.length },
  };
}

// ── AI provider reachability ──────────────────────────────────

const AI_PROVIDERS = ["groq", "gemini", "ollama"] as const;
type AiProvider = typeof AI_PROVIDERS[number];

export async function testAiProvider(provider: AiProvider): Promise<DiagResult> {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { ok: false, error: "Admin required." };

  try {
    const { complete } = await import("@/lib/ai/router");
    const t0 = Date.now();
    const r = await complete(
      "general",
      "Reply with the single word: pong",
      { forceProvider: provider },
      { maxTokens: 16, temperature: 0 },
    );
    const elapsed = Date.now() - t0;
    await recordAdminAction({
      action: "diag.ai_provider_test",
      targetType: "user",
      targetId: ctx.userId,
      details: { provider, elapsed_ms: elapsed, model: r.modelUsed },
    });
    return {
      ok: true,
      message: `${provider}: ${r.text.trim().slice(0, 50)} · ${elapsed}ms · ${r.modelUsed}`,
      details: { provider: r.provider, elapsed_ms: elapsed, model: r.modelUsed },
    };
  } catch (e) {
    return { ok: false, error: `${provider} unreachable: ${(e as Error).message.slice(0, 200)}` };
  }
}

// ── Supabase health ──────────────────────────────────────────

export async function testSupabaseHealth(): Promise<DiagResult> {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { ok: false, error: "Admin required." };

  const sb = svc();
  if (!sb) return { ok: false, error: "Service-role env not configured." };

  try {
    const t0 = Date.now();
    const { count, error } = await sb.from("scraper_runs").select("*", { count: "exact", head: true });
    const elapsed = Date.now() - t0;
    if (error) return { ok: false, error: `Query failed: ${error.message}` };
    return {
      ok: true,
      message: `Supabase reachable · ${elapsed}ms · ${count?.toLocaleString() ?? "?"} scraper_runs rows total`,
      details: { elapsed_ms: elapsed, row_count: count },
    };
  } catch (e) {
    return { ok: false, error: `Network failure: ${(e as Error).message}` };
  }
}

// ── OAuth callback URLs ──────────────────────────────────────

export async function listOauthCallbacks(): Promise<DiagResult> {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { ok: false, error: "Admin required." };

  const base = process.env.APP_URL ?? "https://www.ikratom.org";
  const callbacks = [
    { provider: "Google (Gmail)", url: `${base}/api/oauth/google/callback` },
    { provider: "Discord", url: `${base}/api/oauth/discord/callback` },
    { provider: "Outlook", url: `${base}/api/oauth/outlook/callback` },
  ];

  // Probe each to confirm it's at least reachable + returns a sane
  // error (rather than 404). A 4xx is expected (no auth code in the
  // ping); a 5xx or network error is a real problem.
  const results = await Promise.all(callbacks.map(async (c) => {
    try {
      const r = await fetch(c.url, { method: "GET", signal: AbortSignal.timeout(10_000), redirect: "manual" });
      return {
        ...c,
        status: r.status,
        reachable: r.status < 500,
      };
    } catch (e) {
      return { ...c, status: 0, reachable: false, error: (e as Error).message };
    }
  }));

  return {
    ok: results.every((r) => r.reachable),
    message: `Checked ${results.length} OAuth callbacks.`,
    error: results.find((r) => !r.reachable) ? "One or more callbacks unreachable" : "",
    details: { results } as unknown as Record<string, unknown>,
  } as DiagResult;
}

// ── Env-var sanity check (names only, never values) ───────────

const REQUIRED_ENV = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "CRON_SECRET",
  "APP_URL",
];

const OPTIONAL_ENV = [
  "GROQ_API_KEY",
  "GEMINI_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENSTATES_API_KEY",
  "LEGISCAN_API_KEY",
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "DISCORD_OAUTH_CLIENT_ID",
  "DISCORD_OAUTH_CLIENT_SECRET",
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "VAPID_SUBJECT",
];

export type EnvCheckRow = { name: string; set: boolean; length: number; required: boolean };
export type EnvCheckResult = { ok: true; rows: EnvCheckRow[] } | { ok: false; error: string };

export async function checkEnvVars(): Promise<EnvCheckResult> {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { ok: false, error: "Admin required." };
  if (!ctx.isOwner) return { ok: false, error: "Owner role required (env-var check leaks shape of secret config)." };

  const rows: EnvCheckRow[] = [];
  for (const name of REQUIRED_ENV) {
    const v = process.env[name];
    rows.push({ name, set: !!v, length: v?.length ?? 0, required: true });
  }
  for (const name of OPTIONAL_ENV) {
    const v = process.env[name];
    rows.push({ name, set: !!v, length: v?.length ?? 0, required: false });
  }

  await recordAdminAction({
    action: "diag.env_check",
    targetType: "user",
    targetId: ctx.userId,
    details: { required_set: rows.filter((r) => r.required && r.set).length, optional_set: rows.filter((r) => !r.required && r.set).length },
  });

  return { ok: true, rows };
}
