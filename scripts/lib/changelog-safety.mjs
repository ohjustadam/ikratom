/**
 * Changelog safety — the guardrail that stops sensitive material from reaching
 * the PUBLIC /whats-new changelog.
 *
 * The auto-generator (scripts/generate-patch-note.mjs) groups raw git commit
 * SUBJECTS into a published post. Committed verbatim that twice leaked
 * just-patched vulnerability details + intel/engine internals onto the public
 * site (see PR #691, docs/DECISIONS.md "Every campaign is actionable by
 * everyone…"). Two layers defend against that:
 *
 *   SENSITIVE_PATTERNS  — BROAD. Any commit subject matching is HELD OUT of the
 *                         auto-draft. Over-flagging is cheap: held lines go to a
 *                         gitignored sidecar + the console for a human to review
 *                         and re-add by hand if genuinely safe. The auto-draft is
 *                         meant to be CURATED, never shipped raw.
 *   PUBLISH_BLOCKLIST   — NARROW, high-confidence. A vitest guard (CI) asserts NO
 *                         published patch-note (src/content/patch-notes/*.md) ever
 *                         contains one — so a leak can't merge even if a post is
 *                         hand-written. Kept tight to avoid false-positives on
 *                         legit user copy (e.g. "where your reps stand", a generic
 *                         "security hardening" mention).
 */

export const SENSITIVE_PATTERNS = [
  // — Security / vulnerability vocabulary —
  /\bvulnerab/i, /\bCVE-?\d/i, /\bexploit/i, /\binjection\b/i, /\bXSS\b/i, /\bSSRF\b/i, /\bCSRF\b/i, /\bRCE\b/i,
  /\bIDOR\b/i, /escalat(e|es|ed|ion|ing)/i, /enumerat(e|es|ed|ion|ing)/i, /open[-\s]?redirect/i, /\bRLS\b/i,
  /MFA[-\s]?bypass/i, /auth(?:entication)?[-\s]?bypass/i, /\bprivilege/i, /\bhardening\b/i,
  /rate[-\s]?limit[-\s]?bypass/i, /clickjack/i, /self-?escalat/i, /cross-user/i, /\btamper/i,
  /\bSHC-\d/i, /\bABUSE-\d/i, /\bOAUTH-\d/i, /\bSSRF-\d/i, /\bGDPR\b/i,
  // — Intel / opposition research —
  /\bopposition\b/i, /repeal[-\s]?playbook/i, /threat[-\s]?matrix/i, /\bdonor/i, /\bstance\b/i, /\blobby/i,
  /\btakeback\b/i, /money[-\s]?trail/i,
  // — Infra / AI providers / secrets —
  /ghost[-\s]?server/i, /\bollama\b/i, /\bgroq\b/i, /\bcerebras\b/i, /\bgemini\b/i, /\bmistral\b/i, /searxng/i,
  /cron[-\s]?secret/i, /\bAPI[-_\s]?key\b/i, /\btoken\b/i, /GH_MODELS/i, /free-?tier/i,
  // Secret/credential ENV-var names (e.g. TAVILY_API_KEY, GH_MODELS_TOKEN, CRON_SECRET).
  /[A-Z0-9]{2,}_(?:KEY|TOKEN|SECRET|PASSWORD|PAT)\b/,
  // — Admin-only / campaign-engine internals —
  /cluster[-\s]?janitor/i, /syndicat/i, /\bveto\b/i, /priority[-\s]?score/i,
  /standing[-\s]?(?:vs|\/)[-\s]?rotating/i, /name-?drift/i, /auto-?campaign/i, /\bRPC\b/i,
];

export const PUBLISH_BLOCKLIST = [
  // Security / vulnerability — must never be itemized publicly.
  /\bvulnerab/i, /\bCVE-?\d/i, /\bexploit\b/i,
  /\b(?:sql|search|postgrest|template)?[-\s]?injection\b/i, /\bXSS\b/i, /\bSSRF\b/i, /\bCSRF\b/i, /\bRCE\b/i, /\bIDOR\b/i,
  /privilege (?:self-?)?escalat/i, /self-?escalat/i, /sign[-\s]?in enumeration/i, /user enumeration/i,
  /open[-\s]?redirect/i, /MFA[-\s]?bypass/i, /auth(?:entication)?[-\s]?bypass/i, /clickjack/i,
  // Intel / engine internals that should never surface to users.
  /opposition[-\s]?playbook/i, /repeal[-\s]?playbook/i, /threat[-\s]?matrix/i, /cluster[-\s]?janitor/i,
  /syndication[-\s]?veto/i, /ghost[-\s]?server/i, /GH_MODELS/i,
  // Secret/credential ENV-var names must never appear in a public post.
  /[A-Z0-9]{2,}_(?:KEY|TOKEN|SECRET|PASSWORD|PAT)\b/,
  // Pen-test / finding identifiers that leaked via commit scopes.
  /\bSHC-\d/i, /\bABUSE-\d/i, /\bOAUTH-\d/i, /\bSSRF-\d/i,
];

const CONVENTIONAL = /^(\w+)(?:\(([^)]*)\))?:\s*(.*)$/s;

/** True if a commit subject should be HELD OUT of the public auto-draft. */
export function isSensitiveSubject(text) {
  return SENSITIVE_PATTERNS.some((re) => re.test(text));
}

/**
 * True for security-scoped commits (e.g. `fix(security): …`, `chore(auth): …`).
 * These collapse into a single generic "reliability & security improvements"
 * line — security work is never itemized publicly.
 */
export function isSecurityCommit(subject) {
  const m = subject.match(CONVENTIONAL);
  const prefix = (m?.[1] ?? "").toLowerCase();
  const scope = (m?.[2] ?? "").toLowerCase();
  if (prefix === "security") return true;
  return /\b(security|sec|auth|abuse|csp|xss|ssrf|csrf|rls|mfa|gdpr|priv)\b/.test(scope);
}

/**
 * Classify a commit for the generator:
 *   "security" → collapse into the generic hardening line (not itemized)
 *   "held"     → sensitive; route to the review sidecar, never auto-published
 *   "public"   → safe to group + publish normally
 */
export function classifyCommit(subject) {
  if (isSecurityCommit(subject)) return "security";
  if (isSensitiveSubject(subject)) return "held";
  return "public";
}

/** Patterns a published string trips (empty array = clean). Used by the CI guard. */
export function publishBlocklistHits(text) {
  return PUBLISH_BLOCKLIST.filter((re) => re.test(text)).map((re) => re.toString());
}
