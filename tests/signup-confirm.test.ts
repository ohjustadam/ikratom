/**
 * Signup confirmation links must work from any browser or mail app, and a
 * repeat signup must say what to do instead of dead-ending.
 *
 * Member report 2026-11-09: the confirm link "doesn't do anything", and
 * signing up again showed "For security purposes, you can only request this
 * after 26 seconds". The link had confirmed the address, then dropped the
 * person on the homepage, signed out. See src/modules/auth/signup-outcome.ts.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FRESH_ACCOUNT_MS,
  SIGNUP_SENT_HINT,
  SIGNUP_SENT_MESSAGE,
  authLinkFailurePath,
  classifySignUp,
  parseAuthNotice,
} from "@/modules/auth/signup-outcome";
import {
  CONFIRM_LINK,
  DESIRED,
  RECOVERY_LINK,
  SUPABASE_DEFAULTS,
  templateDrift,
} from "../scripts/lib/auth-email-templates.mjs";

const NOW = Date.parse("2026-11-10T12:00:00Z");
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

describe("classifySignUp", () => {
  it("a fresh account is 'created'", () => {
    expect(classifySignUp({ error: null, user: { id: "u", created_at: iso(3_000), identities: [{}] }, now: NOW })).toBe("created");
  });

  it("an old unconfirmed account that Supabase re-sent to is 'resent', not created", () => {
    // The member's case: account made 2026-11-05, signup tried again on 11-09.
    expect(classifySignUp({ error: null, user: { id: "u", created_at: iso(4 * 86_400_000), identities: [{}] }, now: NOW })).toBe("resent");
    expect(classifySignUp({ error: null, user: { id: "u", created_at: iso(FRESH_ACCOUNT_MS + 1), identities: [{}] }, now: NOW })).toBe("resent");
  });

  it("Supabase's stand-in for a confirmed address (no identities) is 'existing_confirmed'", () => {
    expect(classifySignUp({ error: null, user: { id: "fake", created_at: iso(0), identities: [] }, now: NOW })).toBe("existing_confirmed");
  });

  it("the under-a-minute resend refusal is 'wait', by code or by message", () => {
    expect(classifySignUp({ error: { code: "over_email_send_rate_limit", message: "x" }, user: null })).toBe("wait");
    expect(
      classifySignUp({ error: { message: "For security purposes, you can only request this after 26 seconds." }, user: null }),
    ).toBe("wait");
  });

  it("'User already registered' (autoconfirm projects) is 'existing_confirmed'", () => {
    expect(classifySignUp({ error: { code: "user_already_exists", message: "User already registered" }, user: null })).toBe("existing_confirmed");
    expect(classifySignUp({ error: { message: "A user with this email address has already been registered" }, user: null })).toBe("existing_confirmed");
  });

  it("anything else is an error the form shows", () => {
    expect(classifySignUp({ error: { code: "weak_password", message: "Password is too weak" }, user: null })).toBe("error");
    expect(classifySignUp({ error: null, user: null })).toBe("error");
  });
});

describe("what a repeat signup is told", () => {
  it("is one message for every outcome, and points at the newest email, not at signing up again", () => {
    expect(SIGNUP_SENT_MESSAGE).toMatch(/newest/);
    expect(SIGNUP_SENT_MESSAGE).toMatch(/No need to sign up again/);
    expect(SIGNUP_SENT_MESSAGE).not.toMatch(/already|registered|exists/i);
  });

  it("warns that a second signup keeps the FIRST password", () => {
    expect(SIGNUP_SENT_HINT).toMatch(/first time/);
  });
});

describe("authLinkFailurePath", () => {
  it("sends a failed password reset to /forgot, which can re-send", () => {
    expect(authLinkFailurePath({ isRecovery: true, hadCode: true })).toBe("/forgot?expired=1");
    expect(authLinkFailurePath({ isRecovery: true, hadCode: false })).toBe("/forgot?expired=1");
  });

  it("tells someone holding a ?code= that the address is confirmed", () => {
    expect(authLinkFailurePath({ isRecovery: false, hadCode: true })).toBe("/login?notice=confirmed");
  });

  it("offers a new link for an expired or replaced one", () => {
    expect(authLinkFailurePath({ isRecovery: false, hadCode: false })).toBe("/login?notice=link_expired");
  });

  it("only produces notices the login page understands", () => {
    for (const isRecovery of [false]) {
      for (const hadCode of [true, false]) {
        const notice = new URL(authLinkFailurePath({ isRecovery, hadCode }), "https://x").searchParams.get("notice");
        expect(parseAuthNotice(notice)).not.toBeNull();
      }
    }
    expect(parseAuthNotice("<script>")).toBeNull();
    expect(parseAuthNotice(null)).toBeNull();
  });
});

describe("auth email templates", () => {
  const bodies = Object.entries(DESIRED).filter(([k]) => k.includes("_templates_"));

  it("covers signup, reset and magic link", () => {
    expect(bodies.map(([k]) => k).sort()).toEqual([
      "mailer_templates_confirmation_content",
      "mailer_templates_magic_link_content",
      "mailer_templates_recovery_content",
    ]);
  });

  it("every link goes to /auth/confirm with a token_hash, never Supabase's own verify URL", () => {
    for (const [, html] of bodies) {
      expect(html).toContain("{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=");
      expect(html).not.toContain("ConfirmationURL");
    }
  });

  it("the signup link confirms by type=email and the reset link lands on /reset-password", () => {
    expect(DESIRED.mailer_templates_confirmation_content).toContain(CONFIRM_LINK);
    expect(CONFIRM_LINK).toMatch(/&type=email$/);
    expect(DESIRED.mailer_templates_recovery_content).toContain(RECOVERY_LINK);
    expect(RECOVERY_LINK).toMatch(/&type=recovery&next=\/reset-password$/);
  });

  it("templateDrift sees a reset to the defaults, and ignores whitespace", () => {
    expect(templateDrift(SUPABASE_DEFAULTS)).toHaveLength(Object.keys(DESIRED).length);
    const spaced = Object.fromEntries(Object.entries(DESIRED).map(([k, v]) => [k, `  ${v.replace(/\n/g, "\n\n")} `]));
    expect(templateDrift(spaced)).toEqual([]);
  });
});

describe("the code paths the links depend on", () => {
  const src = (p: string) => readFileSync(p, "utf8");

  it("/auth/confirm redeems the token_hash server-side", () => {
    const route = src("src/app/auth/confirm/route.ts");
    expect(route).toMatch(/verifyOtp\(\{\s*type,\s*token_hash: tokenHash\s*\}\)/);
    expect(route).toContain("authLinkFailurePath");
  });

  it("signUp and the resend send links to /auth/callback, not the homepage", () => {
    const actions = src("src/modules/auth/actions.ts");
    const redirects = actions.match(/emailRedirectTo: `\$\{appUrl\}\/auth\/callback`/g) ?? [];
    expect(redirects.length).toBeGreaterThanOrEqual(2);
  });

  it("old links that land on /?code= are handed to the callback", () => {
    const cfg = src("next.config.ts");
    expect(cfg).toMatch(/source: "\/", has: \[\{ type: "query", key: "code" \}\], destination: "\/auth\/callback"/);
    expect(cfg).toMatch(/source: "\/", has: \[\{ type: "query", key: "error_code" \}\], destination: "\/auth\/callback"/);
  });

  it("anon never evaluates the profiles owner policies (0319), so its queries can't error", () => {
    const sql = src("supabase/migrations/0319_profiles_owner_policies_authenticated.sql");
    expect(sql).toMatch(/create policy profiles_owner_read_all on public\.profiles\s+for select to authenticated/);
    expect(sql).toMatch(/create policy profiles_owner_update_all on public\.profiles\s+for update to authenticated/);
  });

  it("the username is checked and stamped with the service role, since a new signup has no session", () => {
    const actions = src("src/modules/auth/actions.ts");
    const body = actions.slice(actions.indexOf("export async function signUp"), actions.indexOf("async function sendExistingAccountNotice"));
    expect(body).toMatch(/await sr\s*\.from\("profiles"\)\s*\.select\("id"\)\s*\.eq\("username"/);
    expect(body).toMatch(/await sr\s*\.from\("profiles"\)\s*\.update\(\{ username: usernameRaw \}\)/);
    expect(body).not.toMatch(/supabase\s*\.from\("profiles"\)/);
  });
});
