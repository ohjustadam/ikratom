#!/usr/bin/env node
/**
 * review-diff.mjs — adversarial code review of a diff, on the FREE AI router.
 *
 * WHY THIS EXISTS (owner ask 2026-09-08: "can dynamic workflows use the free
 * router so as not to burn Claude usage?").
 *
 * The short answer is no: Claude Code's Workflow tool spawns CLAUDE subagents.
 * Its `model` option accepts only Anthropic models, so there is no hook to
 * point those agents at Groq/Cerebras/Gemini. A workflow's cost IS Claude
 * usage — measured on 2026-09-08, one failed run spent 1,005,871 subagent
 * tokens and returned nothing.
 *
 * What we CAN do is build the fan-out ourselves on the router we already have.
 * That is this script: N providers review the same diff INDEPENDENTLY, each
 * blind to the others, and agreement across models is the signal. It is the
 * same "diverse lens" shape a workflow gives, at $0.
 *
 * It is not a replacement for Claude on hard reasoning — free-tier models miss
 * subtle things. It IS a genuine second pair of eyes on mechanical review:
 * leaked secrets, missed awaits, dropped error handling, unsafe casts, and the
 * specific caching/RLS traps this codebase keeps hitting.
 *
 *   node --env-file=.env.local scripts/review-diff.mjs                    # staged + unstaged
 *   node --env-file=.env.local scripts/review-diff.mjs --range origin/main..HEAD
 *   node --env-file=.env.local scripts/review-diff.mjs --paths src/app/news
 */
import { execFileSync } from "node:child_process";
import { aiRouter, listAvailableProviders } from "./lib/ai-router.mjs";

const args = process.argv.slice(2);
const arg = (f) => { const i = args.indexOf(f); const v = args[i + 1]; return i >= 0 && v && !v.startsWith("--") ? v : null; };
const RANGE = arg("--range");
const PATHS = args.includes("--paths") ? args.slice(args.indexOf("--paths") + 1).filter((a) => !a.startsWith("--")) : [];
const MAX_DIFF = Number(arg("--max-chars") ?? 60_000);

function git(...a) {
  return execFileSync("git", a, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}

const diff = RANGE
  ? git("diff", RANGE, "--", ...(PATHS.length ? PATHS : ["."]))
  : [git("diff", "--cached", "--", ...(PATHS.length ? PATHS : ["."])),
     git("diff", "--", ...(PATHS.length ? PATHS : ["."]))].join("\n");

if (!diff.trim()) { console.log("no diff to review"); process.exit(0); }
if (diff.length > MAX_DIFF) {
  console.log(`⚠ diff is ${diff.length} chars; reviewing the first ${MAX_DIFF}. Narrow with --paths for full coverage.`);
}

const SYSTEM = `You are a hostile code reviewer on a civic-advocacy platform. Assume the diff is WRONG and find why.

The codebase has specific, repeated failure modes. Weight these heavily:
- CACHING vs PRIVACY: a page that is cached (ISR/static) is served to EVERYONE. Any per-user data rendered into it is a disclosure bug. Gated content must be FETCHED client-side, never rendered-then-hidden with CSS.
- A cookie read (createClient from lib/supabase/server, cookies(), auth.getUser(), readLocale) opts a Next.js route OUT of caching, even with no force-dynamic export.
- On a DYNAMIC SEGMENT ([param]), "export const revalidate" alone does NOT cache. It also needs generateStaticParams.
- RLS: the anon client sees less than service-role. Swapping a cookie client for anon is only safe if anon genuinely sees the same rows. Swapping to SERVICE-ROLE inside a cached path can leak RLS-protected data.
- Public anonymity: user identity in any shared surface must render as @username via publicHandle(), never full_name or email.
- Missing await, unhandled promise rejection, swallowed errors that hide failure.
- Secrets or PII in committed code.

Report ONLY concrete defects you can point at a line for. No style opinions, no praise, no summary of what the diff does. If you find nothing real, say NO ISSUES FOUND.

Return JSON: {"findings":[{"severity":"high|medium|low","file":"...","what":"the defect","why":"the consequence"}]}`;

const providers = listAvailableProviders().filter((p) => p !== "ollama");
if (providers.length === 0) { console.error("no free providers configured"); process.exit(1); }

console.log(`Reviewing ${diff.length} chars of diff across ${providers.length} independent providers: ${providers.join(", ")}\n`);

const results = await Promise.all(providers.map(async (p) => {
  try {
    const r = await aiRouter({
      systemPrompt: SYSTEM,
      userPrompt: `Review this diff:\n\n${diff.slice(0, MAX_DIFF)}`,
      maxTokens: 1500,
      providerOverride: p,
      verbose: false,
    });
    return { asked: p, got: r.provider, findings: r.parsed?.findings ?? [] };
  } catch (e) {
    return { asked: p, got: null, error: String(e.message ?? e).slice(0, 90), findings: [] };
  }
}));

// Group by file+defect so cross-model agreement is visible. Two independent
// models flagging the same thing is a much stronger signal than one.
//
// ⚠ VOTERS ARE DEDUPED BY THE PROVIDER THAT ACTUALLY ANSWERED, not the one we
// asked. The router FALLS THROUGH on failure, so asking eight providers can
// easily land on the same model eight times — the first run of this script
// reported "5 models agree" when five requests had all fallen through to
// Cloudflare. That is one model answering five times, and presenting it as
// consensus would make this tool actively misleading rather than merely
// limited.
const byKey = new Map();
for (const r of results) {
  for (const f of r.findings) {
    if (!f?.what) continue;
    const key = `${(f.file ?? "?").trim()}|${String(f.what).slice(0, 60).toLowerCase()}`;
    const cur = byKey.get(key) ?? { ...f, voters: new Set() };
    cur.voters.add(r.got ?? r.asked);
    byKey.set(key, cur);
  }
}

for (const r of results) {
  const label = r.got && r.got !== r.asked ? `${r.asked}→${r.got}` : r.asked;
  console.log(`  ${String(label).padEnd(22)} ${r.error ? "FAILED " + r.error : `${r.findings.length} finding(s)`}`);
}

const ranked = [...byKey.values()].sort((a, b) =>
  b.voters.size - a.voters.size ||
  ({ high: 0, medium: 1, low: 2 }[a.severity] ?? 3) - ({ high: 0, medium: 1, low: 2 }[b.severity] ?? 3));

const distinctModels = new Set(results.map((r) => r.got).filter(Boolean));
console.log(`
${distinctModels.size} DISTINCT model(s) actually answered: ${[...distinctModels].join(", ") || "none"}`);
if (distinctModels.size < 2) {
  console.log("  ⚠ fallthrough collapsed the fleet onto ONE model — this is a single review, NOT a consensus.");
}
// Stated every run, because it is the tool's main limitation and a reader who
// forgets it will chase ghosts. Verified live on the first run: three separate
// HIGH findings against /api/me were all false — the route sets no-store on
// every return path and is force-dynamic, none of which is visible in a hunk.
console.log("These models see ONLY the diff hunks, not whole files, so they routinely flag");
console.log("\"no auth check\" or \"missing cache header\" on code the surrounding file already");
console.log("handles. CONFIRM every finding against the file before acting on it.");
console.log(`\n${ranked.length} distinct finding(s):\n`);
for (const f of ranked) {
  const agree = f.voters.size > 1 ? `  ⚠ ${f.voters.size} DISTINCT models agree (${[...f.voters].join(", ")})` : "";
  console.log(`[${String(f.severity ?? "?").toUpperCase()}] ${f.file ?? "?"}${agree}`);
  console.log(`  ${f.what}`);
  if (f.why) console.log(`  → ${f.why}`);
  console.log();
}
if (ranked.length === 0) console.log("  (nothing flagged — not proof of correctness, only that this fleet found nothing)");
