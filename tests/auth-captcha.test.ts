import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Every Supabase Auth call that accepts a captcha forwards the Turnstile token
 * the form sent (src/lib/captcha.ts), and a failed check reads as one clear
 * message. Supabase verifies the token itself once its captcha setting is on.
 */

const auth = {
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  resend: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  getUser: vi.fn(),
  updateUser: vi.fn(),
  mfa: { getAuthenticatorAssuranceLevel: vi.fn(async () => ({ data: { currentLevel: "aal1", nextLevel: "aal1" } })) },
};

/** Chainable query stub: every builder method returns itself, terminals resolve `result`. */
function query(result: unknown) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "update", "insert", "order", "limit", "is"]) q[m] = () => q;
  q.maybeSingle = async () => result;
  q.single = async () => result;
  return q;
}
const userClient = { auth, rpc: vi.fn(async () => ({ data: false })), from: () => query({ data: null }) };

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => userClient, getCachedUser: async () => null }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ from: () => query({ data: null }), rpc: async () => ({}) }) }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth }) }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => true, getClientIp: async () => "203.0.113.9" }));
vi.mock("@/lib/pwned-passwords", () => ({ isPasswordPwned: async () => false }));
vi.mock("@/lib/auth-events", () => ({ recordAuthEvent: async () => {} }));
vi.mock("@/lib/audit", () => ({ recordAdminAction: async () => {} }));
vi.mock("@/lib/email/transactional", () => ({ sendTransactionalEmail: async () => {}, brandedHtml: () => "" }));
vi.mock("@/lib/civic", () => ({ getDistrictsForAddress: async () => null }));
vi.mock("@/lib/local-reps-auto-request", () => ({ autoRequestLocalCoverageIfMissing: async () => {} }));
vi.mock("@/modules/auth/actions-devices", () => ({ recordSignIn: async () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));

const { signIn, signInInline, signUp, resendSignupLink, requestPasswordReset } = await import("@/modules/auth/actions");
const { changePassword } = await import("@/modules/auth/actions-password");
const { deleteMyAccount } = await import("@/modules/auth/data-actions");
const { CAPTCHA_FIELD, CAPTCHA_FAILED_MESSAGE, captchaTokenFrom, isCaptchaError } = await import("@/lib/captcha");
const { buildCsp } = await import("@/lib/csp");

const TOKEN = "0.turnstile-token-from-the-widget";
const CAPTCHA_ERR = { message: "captcha protection: request disallowed (invalid-input-response)", code: "captcha_failed" };

function form(fields: Record<string, string>, token: string | null = TOKEN) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  if (token) fd.set(CAPTCHA_FIELD, token);
  return fd;
}
const login = { email: "member@example.com", password: "correct horse battery" };

beforeEach(() => {
  for (const fn of [auth.signInWithPassword, auth.signUp, auth.resend, auth.resetPasswordForEmail]) fn.mockReset();
});

describe("captcha helpers", () => {
  it("reads the token from a form or a string, trimmed, and drops junk", () => {
    expect(captchaTokenFrom(form({}))).toBe(TOKEN);
    expect(captchaTokenFrom(`  ${TOKEN}  `)).toBe(TOKEN);
    expect(captchaTokenFrom(form({}, null))).toBeUndefined();
    expect(captchaTokenFrom("   ")).toBeUndefined();
    expect(captchaTokenFrom("x".repeat(2049))).toBeUndefined();
    expect(captchaTokenFrom(null)).toBeUndefined();
  });

  it("recognizes Supabase's captcha errors only", () => {
    expect(isCaptchaError(CAPTCHA_ERR.message)).toBe(true);
    expect(isCaptchaError("Invalid login credentials")).toBe(false);
    expect(isCaptchaError(undefined)).toBe(false);
  });

  it("lets the Turnstile script and iframe through the CSP", () => {
    const csp = buildCsp({ supabaseHost: "x.supabase.co", scriptEval: "'wasm-unsafe-eval'" });
    for (const directive of ["script-src ", "script-src-elem ", "frame-src "]) {
      const line = csp.split("; ").find((d) => d.startsWith(directive));
      expect(line, directive).toContain("https://challenges.cloudflare.com");
    }
  });
});

describe("auth calls forward the Turnstile token", () => {
  it("password sign-in", async () => {
    auth.signInWithPassword.mockResolvedValue({ data: {}, error: { message: "Invalid login credentials" } });
    await signIn(form(login));
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ ...login, options: { captchaToken: TOKEN } });
  });

  it("inline (modal) sign-in", async () => {
    auth.signInWithPassword.mockResolvedValue({ data: {}, error: { message: "Invalid login credentials" } });
    await signInInline(form(login));
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ ...login, options: { captchaToken: TOKEN } });
  });

  it("sign-up", async () => {
    auth.signUp.mockResolvedValue({ data: {}, error: CAPTCHA_ERR });
    await signUp(form({ ...login, username: "new_member", form_elapsed_ms: "5000" }));
    expect(auth.signUp.mock.calls[0][0].options.captchaToken).toBe(TOKEN);
  });

  it("resend the confirmation link", async () => {
    auth.resend.mockResolvedValue({ error: null });
    await resendSignupLink(form({ email: login.email }));
    expect(auth.resend.mock.calls[0][0].options.captchaToken).toBe(TOKEN);
  });

  it("password reset", async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ error: null });
    await requestPasswordReset(form({ email: login.email }));
    expect(auth.resetPasswordForEmail.mock.calls[0][1].captchaToken).toBe(TOKEN);
  });

  it("password change re-checks the current password with the token", async () => {
    auth.getUser.mockResolvedValue({ data: { user: { id: "u1", email: login.email } } });
    auth.signInWithPassword.mockResolvedValue({ data: {}, error: { message: "Invalid login credentials" } });
    const r = await changePassword(form({ current: "old password!!", next: "brand new password", confirm: "brand new password" }));
    expect(r).toEqual({ error: "Current password is incorrect." });
    expect(auth.signInWithPassword.mock.calls[0][0].options.captchaToken).toBe(TOKEN);
  });

  it("account deletion re-checks the password with the token", async () => {
    auth.getUser.mockResolvedValue({ data: { user: { id: "u1", email: login.email } } });
    auth.signInWithPassword.mockResolvedValue({ data: {}, error: { message: "Invalid login credentials" } });
    const r = await deleteMyAccount({ confirmation: "DELETE MY ACCOUNT", password: "pw", captchaToken: TOKEN });
    expect(r).toEqual({ error: "Password is incorrect." });
    expect(auth.signInWithPassword.mock.calls[0][0].options.captchaToken).toBe(TOKEN);
  });

  it("sends no token when the form had none (captcha off still works)", async () => {
    auth.signInWithPassword.mockResolvedValue({ data: {}, error: { message: "Invalid login credentials" } });
    await signIn(form(login, null));
    expect(auth.signInWithPassword.mock.calls[0][0].options.captchaToken).toBeUndefined();
  });
});

describe("a failed bot check says so", () => {
  it("on sign-in, sign-up, resend and reset", async () => {
    auth.signInWithPassword.mockResolvedValue({ data: {}, error: CAPTCHA_ERR });
    auth.signUp.mockResolvedValue({ data: {}, error: CAPTCHA_ERR });
    auth.resend.mockResolvedValue({ error: CAPTCHA_ERR });
    auth.resetPasswordForEmail.mockResolvedValue({ error: CAPTCHA_ERR });
    expect((await signIn(form(login))).error).toBe(CAPTCHA_FAILED_MESSAGE);
    expect((await signInInline(form(login))).error).toBe(CAPTCHA_FAILED_MESSAGE);
    expect((await signUp(form({ ...login, username: "new_member", form_elapsed_ms: "5000" }))).error).toBe(CAPTCHA_FAILED_MESSAGE);
    // Resend and reset normally always answer "sent" (no address probing), but a
    // failed bot check reveals nothing about the address, so it is shown.
    expect((await resendSignupLink(form({ email: login.email }))).error).toBe(CAPTCHA_FAILED_MESSAGE);
    expect((await requestPasswordReset(form({ email: login.email }))).error).toBe(CAPTCHA_FAILED_MESSAGE);
  });

  it("reset still answers success for any other error", async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ error: { message: "User not found" } });
    expect(await requestPasswordReset(form({ email: login.email }))).toEqual({ success: true });
  });
});
