/**
 * Free-tier Gemini API key rotation pool for grounded-search calls.
 *
 * WHY: Gemini's grounded Google-Search free tier throttles hard after
 * ~6–10 successful calls/day *per project*. Each Google Cloud project
 * gets its OWN free grounding quota, so configuring several free keys
 * (one per project, all under the same Google account, $0) and rotating
 * across them multiplies the daily grounded ceiling without spending a
 * cent — no billing enablement required.
 *
 * CONFIGURE (any combination; deduped, primary-first):
 *   GEMINI_API_KEY          primary (existing)
 *   GEMINI_API_KEY_2.._9    extra free keys, one per extra GCP project
 *   GEMINI_API_KEYS         OR a comma-separated list (takes precedence order-wise)
 *
 * Each extra key: console.cloud.google.com → new project → enable the
 * Generative Language API → create an API key. No billing needed for the
 * free grounded allotment.
 *
 * Cooldown-aware: a key that returns 429 is parked for COOLDOWN_MS so the
 * rotation skips it (it's almost certainly exhausted for a while) and
 * reaches for a fresh project's quota instead.
 *
 * NOTE: plain (non-grounded) generateContent calls have a much higher free
 * tier and don't need this — use it for the google_search grounded paths
 * (local-officials lookups) where the scarce limit actually bites.
 */

const COOLDOWN_MS = 90_000;

function loadKeys() {
  const keys = [];
  if (process.env.GEMINI_API_KEYS) {
    for (const k of process.env.GEMINI_API_KEYS.split(",").map((s) => s.trim()).filter(Boolean)) {
      keys.push(k);
    }
  }
  if (process.env.GEMINI_API_KEY) keys.push(process.env.GEMINI_API_KEY);
  for (let i = 2; i <= 9; i++) {
    const k = process.env[`GEMINI_API_KEY_${i}`];
    if (k) keys.push(k);
  }
  return Array.from(new Set(keys)); // dedupe, preserve first-seen order
}

const KEYS = loadKeys();
const cooldownUntil = new Map(); // key -> epoch ms when it's usable again
let _cursor = -1;

/** Number of distinct configured keys (>= 0). */
export function geminiKeyCount() {
  return KEYS.length;
}

/**
 * Pick the next usable key, round-robin, skipping any in cooldown. Returns
 * null only when no keys are configured at all. If every key is cooling
 * down we return one anyway (better to try-and-maybe-429 than to give up).
 */
export function pickGeminiKey() {
  if (KEYS.length === 0) return null;
  const now = Date.now();
  const fresh = KEYS.filter((k) => (cooldownUntil.get(k) ?? 0) <= now);
  const pool = fresh.length ? fresh : KEYS;
  _cursor = (_cursor + 1) % pool.length;
  return pool[_cursor];
}

/** Park a key after a 429 so the rotation skips it for a while. */
export function markGeminiKeyCooldown(key, ms = COOLDOWN_MS) {
  if (!key) return;
  cooldownUntil.set(key, Date.now() + ms);
}
