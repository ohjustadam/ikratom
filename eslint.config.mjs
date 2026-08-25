import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
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
