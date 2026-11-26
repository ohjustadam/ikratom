import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { scrubEvent } from "../src/lib/sentry-scrub";

const dirty = () => ({
  request: {
    url: "https://www.example.test/account?email=a%40b.c#top",
    method: "POST",
    cookies: { "sb-ref-auth-token": "SESSION" },
    data: { password: "BODY" },
    query_string: "email=a%40b.c",
    headers: {
      "user-agent": "ua",
      cookie: "x=SESSION",
      Authorization: "Bearer TOKEN",
      "x-forwarded-for": "203.0.113.9",
      "x-nf-client-connection-ip": "203.0.113.9",
      referer: "https://www.example.test/?q=a%40b.c",
    },
  },
  contexts: { nextjs: { request_path: "/account?email=a%40b.c" } },
  breadcrumbs: [
    { data: { url: "https://db.example.test/rest/v1/profiles?email=eq.a%40b.c", "http.query": "?email=eq.a%40b.c" } },
  ],
  user: { ip_address: "203.0.113.9" },
});

describe("error reports", () => {
  it("carry no cookie, token, IP address, body or query string", () => {
    const sent = JSON.stringify(scrubEvent(dirty()));
    for (const leak of ["SESSION", "TOKEN", "BODY", "203.0.113.9", "a%40b.c"]) {
      expect(sent).not.toContain(leak);
    }
  });

  it("keep what is needed to find the bug", () => {
    const e = scrubEvent(dirty());
    expect(e.request.url).toBe("https://www.example.test/account");
    expect(e.request.method).toBe("POST");
    expect(e.request.headers).toEqual({ "user-agent": "ua" });
    expect(e.contexts.nextjs.request_path).toBe("/account");
  });

  it("every Sentry config sends its events through the scrub", () => {
    const configs = readdirSync(".").filter((f) => /^sentry\..+\.config\.ts$/.test(f));
    expect(configs.length).toBeGreaterThanOrEqual(3);
    for (const file of configs) {
      const source = readFileSync(file, "utf8");
      expect(source, file).toContain("beforeSend: scrubEvent");
      expect(source, file).toContain("sendDefaultPii: false");
    }
  });
});
