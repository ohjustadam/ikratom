import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * /privacy once promised things the code did not do (Do Not Track, session
 * replay, "never user data" to AI). These tie the promises to the code, so
 * changing one without the other fails here.
 */
const read = (file: string) => readFileSync(file, "utf8");
const page = read("src/app/privacy/page.tsx").replace(/<\/?strong>/g, "").replace(/\s+/g, " ");
const analytics = read("src/lib/posthog/PostHogProvider.tsx");

describe("/privacy matches the code", () => {
  it("Do Not Track is promised and honored", () => {
    expect(page).toContain("Do Not Track, we collect no analytics");
    expect(analytics).toContain("respect_dnt: true");
  });

  it("the screen is not recorded, as the page says", () => {
    expect(page).toContain("we do not record your screen");
    expect(analytics).toContain("disable_session_recording: true");
  });

  it("names every outside AI provider the web app can call", () => {
    const registry = read("src/lib/ai/router.ts").match(/const REGISTRY[^=]*=\s*\{([\s\S]*?)\n\};/)?.[1] ?? "";
    // `name,` is a wired provider; `name: null` is not; ollama is self-hosted.
    const wired = [...registry.matchAll(/^\s*([a-z]+),/gm)].map((m) => m[1]).filter((n) => n !== "ollama");
    expect(wired.length).toBeGreaterThanOrEqual(2);
    for (const name of wired) expect(page.toLowerCase(), name).toContain(name);
  });
});
