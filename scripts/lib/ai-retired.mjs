/**
 * Providers that left the free tier or shut down. Neither router offers them,
 * so a run doesn't spend a call (and a timeout) discovering it again. Naming
 * one in AI_PROVIDER_ORDER brings it back, which is the switch to flip if a
 * free tier returns. Platform rule: a provider that starts charging is dropped,
 * never paid.
 *
 * Each date is the live probe (`npm run ai:smoke`) that showed it.
 */
export const RETIRED_PROVIDERS = {
  cerebras: "402 payment required (2026-10)",
  mistral: "402 'You need a subscription' (2026-11-25)",
  github: "GitHub Models retired; answers 200 'OK' with no JSON (2026-11-25)",
};

/**
 * @param {string} name
 * @param {Record<string, string | undefined>} [env]
 */
export function isRetired(name, env = process.env) {
  if (!(name in RETIRED_PROVIDERS)) return false;
  const named = (env.AI_PROVIDER_ORDER || "")
    .split(",").map((s) => s.trim().toLowerCase());
  return !named.includes(name);
}
