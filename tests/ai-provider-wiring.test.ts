/**
 * Guard: every scheduled workflow that runs an AI script must hand the router
 * the FULL free-provider pool.
 *
 * Why this test exists. The router is env-gated — a provider with no key in the
 * environment is skipped silently, by design, so that adding one is just a key.
 * The failure mode that produces is invisible: keys were added per step as each
 * provider was adopted, so steps written earlier kept an older, smaller pool.
 * By 2026-09-17 cron-hourly.yml — which runs classify-news-policy, summarize-news
 * and generate-news-digest — had no OPENROUTER_API_KEY anywhere in it, while
 * OpenRouter was the only provider still answering (Cerebras went paid, GitHub
 * Models is retiring, Gemini was out of quota). News ingestion kept running and
 * every enrichment step on top of it failed in bulk, and nothing in CI noticed,
 * because a starved router is indistinguishable from an unlucky one.
 *
 * The fix is a workflow-level `env:` block that every job and step inherits.
 * This test asserts it stays there, so the next provider that dies costs one
 * line of YAML rather than another silent week.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const WORKFLOW_DIR = ".github/workflows";
const SCRIPT_DIR = "scripts";

/** Modules that ARE the pool. Anything importing them (directly or not) needs keys. */
const AI_ROOTS = new Set(["scripts/lib/ai-router.mjs", "scripts/lib/grounded-ai.mjs"]);

/**
 * Every provider the router knows how to call. A workflow running AI work must
 * expose all of them: the whole point is that the pool degrades gracefully, and
 * it cannot degrade onto a provider whose key never reached the process.
 */
const REQUIRED_KEYS = [
  "GROQ_API_KEY",
  "GEMINI_API_KEY",
  "MISTRAL_API_KEY",
  "OPENROUTER_API_KEY",
  "SAMBANOVA_API_KEY",
  "NVIDIA_API_KEY",
  "CEREBRAS_API_KEY",
  "CLOUDFLARE_AI_TOKEN",
  "GH_MODELS_TOKEN",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".archive" || e.name === "node_modules") continue;
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, out);
    else if (f.endsWith(".mjs") || f.endsWith(".js")) out.push(f.replace(/\\/g, "/"));
  }
  return out;
}

/** Scripts that reach an AI root through any depth of relative imports. */
function scriptsUsingAI(): Set<string> {
  const importsOf = new Map<string, Set<string>>();
  for (const f of walk(SCRIPT_DIR)) {
    const deps = new Set<string>();
    for (const m of fs.readFileSync(f, "utf8").matchAll(/from\s+["'](\.[^"']+)["']/g)) {
      deps.add(path.normalize(path.join(path.dirname(f), m[1])).replace(/\\/g, "/"));
    }
    importsOf.set(f, deps);
  }
  const uses = new Set<string>();
  for (let changed = true; changed; ) {
    changed = false;
    for (const [f, deps] of importsOf) {
      if (uses.has(f)) continue;
      if ([...deps].some((d) => AI_ROOTS.has(d) || uses.has(d))) { uses.add(f); changed = true; }
    }
  }
  return uses;
}

const AI_SCRIPTS = scriptsUsingAI();

const workflowsRunningAI = fs
  .readdirSync(WORKFLOW_DIR)
  .filter((f) => f.endsWith(".yml"))
  .map((f) => ({ file: f, src: fs.readFileSync(path.join(WORKFLOW_DIR, f), "utf8") }))
  .map((w) => ({ ...w, scripts: [...AI_SCRIPTS].filter((s) => w.src.includes(s)) }))
  .filter((w) => w.scripts.length > 0);

describe("AI provider wiring", () => {
  it("finds the scripts that depend on the router", () => {
    // A sanity floor, not a pin: if the import scan silently stops resolving,
    // every assertion below would vacuously pass.
    expect(AI_SCRIPTS.size).toBeGreaterThan(10);
    expect(workflowsRunningAI.length).toBeGreaterThan(0);
  });

  it.each(workflowsRunningAI.map((w) => [w.file, w] as const))(
    "%s exposes the whole free provider pool",
    (_file, w) => {
      const missing = REQUIRED_KEYS.filter((k) => !w.src.includes(k));
      expect(
        missing,
        `${w.file} runs ${w.scripts.length} AI script(s) but never mentions ` +
          `${missing.join(", ")}. The router cannot fall back onto a provider whose ` +
          `key is not in the environment. Add it to the workflow-level env: block ` +
          `(see docs/AI_PROVIDERS.md).`,
      ).toEqual([]);
    },
  );

  it("keeps the pool at workflow level so new steps inherit it", () => {
    for (const w of workflowsRunningAI) {
      const topLevelEnv = /\nenv:\n(?:[ \t]+\S[^\n]*\n|[ \t]*#[^\n]*\n|\n)+/.exec(w.src);
      expect(topLevelEnv, `${w.file} has no top-level env: block`).not.toBeNull();
      const block = topLevelEnv![0];
      const missing = REQUIRED_KEYS.filter((k) => !block.includes(k));
      expect(
        missing,
        `${w.file}: these keys exist somewhere in the file but not in the ` +
          `workflow-level env: block, so a newly added step would not inherit ` +
          `them — ${missing.join(", ")}`,
      ).toEqual([]);
    }
  });
});
