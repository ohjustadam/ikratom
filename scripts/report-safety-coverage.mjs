/**
 * report-safety-coverage.mjs — make PHANTOM GREEN visible.
 *
 * WHY: `npm run verify` is `tsc --noEmit && vitest run --exclude '**\/rls.test.ts'`,
 * and `tests/rate-limit.test.ts` guards itself with
 * `describe.skipIf(!HAS_DB)` where `HAS_DB = !!(NEXT_PUBLIC_SUPABASE_URL &&
 * SUPABASE_SERVICE_ROLE_KEY)`. The CI "Typecheck + tests" job has NO `env:`
 * block at all, so in CI:
 *   - rls.test.ts        is excluded outright, and
 *   - rate-limit.test.ts silently SKIPS (vitest reports skipped as success).
 *
 * The job then reports green. On a project whose own definition of "done"
 * requires an RLS policy for every new table, the two suites that would catch
 * an RLS or rate-limit regression have never once gated a merge — and nothing
 * on the run says so. A skipped safety test is indistinguishable from a passing
 * one, which is the most dangerous shape a check can have.
 *
 * This does NOT try to run those suites against production. `rls.test.ts`
 * creates real auth users via the service role; pointing it at prod would make
 * junk accounts and trip Supabase's user-creation rate limit (this is exactly
 * why `verify` excludes it — see AGENTS.md "Pre-commit verification"). The fix
 * for real coverage is a dedicated Supabase test project; until that exists,
 * the honest thing is to stop the run from IMPLYING coverage it does not have.
 *
 * Exit code is always 0 — this reports, it does not block. It emits a GitHub
 * Actions ::warning:: so the gap is visible on every single CI run instead of
 * living in a doc nobody re-reads.
 */

const inCI = !!process.env.GITHUB_ACTIONS;
const hasUrl = !!process.env.NEXT_PUBLIC_SUPABASE_URL;
const hasService = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasAnon = !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const rateLimitRan = hasUrl && hasService;
const rlsRan = false; // always excluded by `verify`

const lines = [
  `rate-limit.test.ts : ${rateLimitRan ? "RAN" : "SKIPPED (no NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)"}`,
  `rls.test.ts        : SKIPPED (excluded by \`verify\`; needs a dedicated Supabase test project)`,
  `anon key present   : ${hasAnon ? "yes" : "no"}`,
];

console.log("── Safety-suite coverage ─────────────────────────────────");
for (const l of lines) console.log(`  ${l}`);

if (!rateLimitRan || !rlsRan) {
  const msg =
    "SAFETY SUITES DID NOT RUN: " +
    [!rateLimitRan && "rate-limit", !rlsRan && "RLS"].filter(Boolean).join(" + ") +
    ". This run is GREEN but proves nothing about RLS or rate limiting.";
  console.log(`  ⚠ ${msg}`);
  if (inCI) console.log(`::warning title=Phantom green::${msg}`);
} else {
  console.log("  ✓ DB-backed safety suites ran against a real database.");
}
console.log("──────────────────────────────────────────────────────────");
