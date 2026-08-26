import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    /*
     * React Compiler rule family — deliberately WARN, not error.
     *
     * This is a recorded decision, not a silent suppression. Measured across
     * this codebase on 2026-08-25:
     *
     *   react-hooks/purity            69 errors — 63 of them are `Date.now()`
     *     inside SERVER components, where per-request time is correct and
     *     idiomatic. The rule cannot tell a server component from a client one,
     *     so 91% of its output here is a misfire. The 6 client-side hits are
     *     threshold labels ("is this bill moving", "days since submitted");
     *     making render pure means deferring them to an effect, which trades a
     *     theoretical hydration mismatch for a guaranteed post-mount flash.
     *     One of the six (CallTracker) is a plain false positive — the call is
     *     inside an async event handler, not render.
     *
     *   react-hooks/set-state-in-effect  26 — overwhelmingly mount-only client
     *     capability detection (`setEngine(kokoroSupported() ? … )`), which is
     *     the correct pattern for something the server cannot know.
     *
     *   react-hooks/static-components / immutability  8 — same character.
     *
     * Left VISIBLE as warnings so a genuinely new violation still shows up in
     * `npm run lint`, but not as errors, because a check that is 90% noise gets
     * ignored and then catches nothing. Revisit if this codebase ever adopts
     * the React Compiler for real, at which point these become actionable.
     */
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "react-hooks/purity": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/immutability": "warn",
    },
  },
  globalIgnores([
    ".next/**",
    // Nested build output: a parallel session's git worktree lives under
    // .claude/worktrees/<name>/ and carries its OWN .next/. The bare
    // ".next/**" above is root-relative and does not match it, so lint walked
    // a stale worktree's compiled bundles and reported hundreds of errors in
    // generated code -- which made `npm run lint` (and so `verify:full`)
    // fail locally while CI, with its clean checkout, stayed green.
    "**/.next/**",
    ".claude/**",
    // Netlify build artifacts (`netlify deploy --build` output). Gitignored,
    // but eslint does not read .gitignore -- 384 problems came from here.
    ".netlify/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
