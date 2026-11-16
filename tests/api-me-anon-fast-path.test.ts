/**
 * `/api/me` answers a request with no Supabase auth cookie without touching
 * the database (2026-11-16 credit cut).
 *
 * The daily residential-proxy crawler calls the route directly with no
 * session. Every one of those calls used to write a rate-limit row over the
 * network before it answered "signed out" (3,228 of 5,086 origin-seconds on
 * 11-11, ~6.6 s a call). A request carrying an auth cookie must still take the
 * full rate-limited path, so a forged cookie buys a bot nothing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  cookie: null as string | null,
  rateLimit: vi.fn(async () => true),
  authProfile: vi.fn(async () => ({ userId: null, profile: null })),
  readLocale: vi.fn(async () => "en"),
  clientIp: vi.fn(async () => "203.0.113.7"),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(h.cookie === null ? {} : { cookie: h.cookie }),
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: h.rateLimit, getClientIp: h.clientIp }));
vi.mock("@/lib/supabase/server", () => ({
  getCachedAuthProfile: h.authProfile,
  createClient: async () => {
    throw new Error("the anonymous path must not open a Supabase client");
  },
}));
vi.mock("@/modules/auth/actions-locale", () => ({ readLocale: h.readLocale }));

import { GET } from "../src/app/api/me/route";

beforeEach(() => {
  h.cookie = null;
  h.rateLimit.mockClear();
  h.authProfile.mockClear();
  h.readLocale.mockClear();
  h.clientIp.mockClear();
});

describe("/api/me without a session cookie", () => {
  it("answers signed-out with no rate-limit write and no auth read", async () => {
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.userId).toBeNull();
    expect(body.isAdmin).toBe(false);
    expect(body.locale).toBe("en");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(h.rateLimit).not.toHaveBeenCalled();
    expect(h.clientIp).not.toHaveBeenCalled();
    expect(h.authProfile).not.toHaveBeenCalled();
    expect(h.readLocale).not.toHaveBeenCalled();
  });

  it("still honours the language cookie", async () => {
    h.cookie = "theme=dark; locale=id; ph_phc_x_posthog=%7B%7D";
    const body = await (await GET()).json();
    expect(body.locale).toBe("id");
    expect(body.userId).toBeNull();
    expect(h.rateLimit).not.toHaveBeenCalled();
  });

  it("treats a cleared session cookie as no session", async () => {
    h.cookie = "sb-abcd1234-auth-token=; locale=en";
    await GET();
    expect(h.rateLimit).not.toHaveBeenCalled();
  });
});

describe("/api/me with a session cookie", () => {
  it("takes the rate-limited path, so a forged cookie is still capped", async () => {
    h.cookie = "sb-abcd1234-auth-token=base64-forged";
    const body = await (await GET()).json();
    expect(h.rateLimit).toHaveBeenCalledTimes(1);
    expect(h.authProfile).toHaveBeenCalledTimes(1);
    // An unverifiable cookie still reads as signed out.
    expect(body.userId).toBeNull();
  });

  it("returns 429 with the signed-out shape when the cap is hit", async () => {
    h.cookie = "sb-abcd1234-auth-token.0=base64-eyJ; sb-abcd1234-auth-token.1=xyz";
    h.rateLimit.mockResolvedValueOnce(false);
    const res = await GET();
    expect(res.status).toBe(429);
    expect((await res.json()).userId).toBeNull();
  });
});
