/**
 * attribution-capture.test.ts — the referral funnel must accept what the
 * product actually puts in front of people.
 *
 * `src/proxy.ts` captured the embed / invite / landing-state cookies until it
 * was disabled for the Netlify migration (2026-07-26). PR #845 rebuilt the
 * capture as a client island plus `POST /api/attribution`, and nothing tested
 * it — so a validator that was tighter than the middleware's went unnoticed:
 * the host pattern required a dot, every partner slug has none, and every
 * printed QR code therefore set no cookie and credited nobody.
 *
 * That failure is silent by construction. A rejected param looks exactly like a
 * visitor who arrived with no params at all, which is the overwhelmingly common
 * case. So the guard here is not "the regex is correct" — it is "the thing that
 * generates the link and the thing that reads it still agree", asserted from
 * the real producers:
 *
 *   - `partnerQrUrl()`, which is what gets printed on a poster
 *   - the embed widget's own default `data-state` ("FED")
 *   - the /i/[code] shortlink's accepted code shape
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { POST } from "../src/app/api/attribution/route";
import { partnerQrUrl } from "../src/modules/partners/qr";

async function capture(body: unknown): Promise<{ set: string[]; cookies: string[] }> {
  const res = await POST(
    new NextRequest("https://www.ikratom.org/api/attribution", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  const json = (await res.json()) as { set?: string[] };
  return { set: json.set ?? [], cookies: res.headers.getSetCookie() };
}

describe("partner QR codes", () => {
  it("credits the partner whose slug is on the poster", async () => {
    // Exactly the URL the print kit encodes.
    const url = new URL(partnerQrUrl({ origin: "https://www.ikratom.org", slug: "green-leaf-okc" }));
    const { set, cookies } = await capture({
      ref: url.searchParams.get("ref"),
      host: url.searchParams.get("host"),
    });
    expect(set).toContain("embed_ref");
    expect(cookies.join("\n")).toContain("embed_ref=green-leaf-okc");
  });

  it("accepts every slug shape the partners table permits", async () => {
    // Migration 0043 constrains the slug to ^[a-z0-9-]{1,80}$ — no dots. If
    // that constraint ever changes, this test should be updated with it.
    const constraint = readFileSync(
      path.join(process.cwd(), "supabase/migrations/0043_partners.sql"),
      "utf8",
    );
    expect(constraint).toContain("slug ~ '^[a-z0-9-]{1,80}$'");

    for (const slug of ["a1b2", "shop", "green-leaf-okc", "x".repeat(80)]) {
      const { set } = await capture({ ref: "embed", host: slug });
      expect(set, `slug ${slug.slice(0, 12)} should be credited`).toContain("embed_ref");
    }
  });
});

describe("embed widget", () => {
  it("credits the embedding site's hostname", async () => {
    const { set, cookies } = await capture({ ref: "embed", host: "Shop.Example.COM" });
    expect(set).toContain("embed_ref");
    expect(cookies.join("\n")).toContain("embed_ref=shop.example.com");
  });

  it("accepts the widget's own default state code", async () => {
    // src/app/embed/v1/email-rep.js sends data-state, defaulting to FED — and
    // consumeLandingState() in auth/actions.ts validates FED on the read side,
    // so rejecting it here would make that branch unreachable.
    const widget = readFileSync(
      path.join(process.cwd(), "src/app/embed/v1/email-rep.js/route.ts"),
      "utf8",
    );
    expect(widget).toContain('"data-state") || "FED"');
    for (const state of ["FED", "OK", "ny"]) {
      const { set } = await capture({ state });
      expect(set, `state ${state}`).toContain("landing_state");
    }
  });
});

describe("invite links", () => {
  it("accepts every code the /i/[code] shortlink forwards", async () => {
    const shortlink = readFileSync(
      path.join(process.cwd(), "src/app/i/[code]/page.tsx"),
      "utf8",
    );
    // Whatever the shortlink lets through is what this endpoint receives.
    expect(shortlink).toContain("/^[a-z0-9]{4,32}$/");
    for (const code of ["ab12", "a1b2c3d4", "z".repeat(32)]) {
      const { set } = await capture({ via: code });
      expect(set, `code length ${code.length}`).toContain("invite_ref");
    }
  });
});

describe("what must still be rejected", () => {
  it("drops anything that is not a bare host, state or code", async () => {
    const junk: Array<[string, unknown]> = [
      ["scheme", { ref: "embed", host: "https://evil.example.com" }],
      ["path", { ref: "embed", host: "example.com/../admin" }],
      ["port", { ref: "embed", host: "example.com:8080" }],
      ["leading dot", { ref: "embed", host: ".example.com" }],
      ["trailing hyphen", { ref: "embed", host: "shop-" }],
      ["over the 80-char cap", { ref: "embed", host: "x".repeat(81) }],
      ["no ref=embed", { host: "example.com" }],
      ["state that is not a state", { state: "OKLAHOMA" }],
      ["code with punctuation", { via: "abc-1234" }],
      ["code too short", { via: "ab" }],
    ];
    for (const [label, body] of junk) {
      const { set } = await capture(body);
      expect(set, label).toEqual([]);
    }
  });

  it("rejects a malformed request body", async () => {
    const res = await POST(
      new NextRequest("https://www.ikratom.org/api/attribution", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not json",
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("the cookies themselves", () => {
  it("are httpOnly, path-wide, and actually reach the response", async () => {
    // The handler sets cookies on one response and returns a second one built
    // from its headers. That is easy to break in a refactor and impossible to
    // notice by eye, so pin it: a Set-Cookie per accepted param, httpOnly.
    const { set, cookies } = await capture({
      ref: "embed",
      host: "green-leaf-okc",
      state: "OK",
      via: "a1b2c3d4",
    });
    expect(set).toEqual(["embed_ref", "landing_state", "invite_ref"]);
    expect(cookies).toHaveLength(3);
    for (const c of cookies) {
      expect(c).toContain("HttpOnly");
      expect(c).toContain("Path=/");
      expect(c).toContain("SameSite=lax");
    }
    // The partner window outlives the visit — 60 days, as docs/GLOSSARY.md says.
    expect(cookies.find((c) => c.startsWith("embed_ref="))).toContain(`Max-Age=${60 * 86400}`);
  });

  it("never lets the client choose the cookie value directly", async () => {
    // The island reports params; the server decides. A value that did not come
    // from a validated param must not appear in a Set-Cookie header.
    const { cookies } = await capture({ ref: "embed", host: "ok.example.com", evil: "x" });
    expect(cookies.join("\n")).not.toContain("evil");
  });
});
