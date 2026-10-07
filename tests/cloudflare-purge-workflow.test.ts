/**
 * cloudflare-purge-workflow.test.ts — Cloudflare is cleared after every deploy
 * that changes the site, and only then.
 *
 * Cloudflare holds signed-out pages for 30 min to 3 h (2026-10-07, 300-credit
 * plan). If the purge workflow's path filter drifted from netlify.toml's build
 * skip list, a site change could deploy and stay hidden behind the old cache.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import yaml from "js-yaml";

const toml = fs.readFileSync("netlify.toml", "utf8");
const ignoreLine = toml.split(/\r?\n/).find((l) => /^\s*ignore\s*=/.test(l)) ?? "";
// Each skipped path appears as ':(exclude)scripts/**' (or ':(exclude,glob)*.md').
const netlifySkips = [...ignoreLine.matchAll(/:\(exclude(?:,glob)?\)([A-Za-z0-9_.*/-]+)/g)].map((m) => m[1].replace(/^\*\.md$/, "**.md"));
const wf = yaml.load(fs.readFileSync(".github/workflows/cloudflare-purge-after-deploy.yml", "utf8")) as {
  on: { push: { branches: string[]; "paths-ignore": string[] } };
  jobs: { purge: { steps: { run?: string }[] } };
};

describe("Cloudflare purge after deploy", () => {
  it("reads Netlify's skip list (guards against a parse that finds nothing)", () => {
    expect(netlifySkips.length).toBeGreaterThanOrEqual(6);
  });
  it("runs for exactly the pushes that trigger a production build", () => {
    expect(wf.on.push.branches).toEqual(["main"]);
    expect([...wf.on.push["paths-ignore"]].sort()).toEqual([...netlifySkips].sort());
  });
  it("waits for this commit's deploy, then purges", () => {
    const runs = wf.jobs.purge.steps.map((s) => s.run ?? "").join("\n");
    expect(runs).toMatch(/commit_ref == \$s and \.context == "production"/);
    expect(runs).toMatch(/purge_everything/);
  });
});
