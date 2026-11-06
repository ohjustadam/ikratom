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
 *   PUBLISH_BLOCKLIST   — High-confidence terms for finished copy. A vitest guard
 *                         (CI) asserts no patch-note file contains one, and
 *                         /admin/whats-new refuses to publish a database note that
 *                         does. Kept off everyday words so legit copy still passes
 *                         (e.g. "where your reps stand", "group admins").
 *
 * The rule behind both (owner, 2026-11-06): What's New carries only changes a
 * member can see. Internal, infrastructure and security work stays off it, and
 * that includes a generic "security improvements" line, which the blocklist used
 * to allow.
 */

/**
 * Words that mark a line as internal or security work. They hold a commit out
 * of a draft and stop finished copy going public.
 */
export const INTERNAL_TERMS = [
  // — Security work, even described in general terms —
  /\bsecurity\b/i, /\bharden(?:ed|ing)\b/i, /\bPII\b/, /\bleak(?:s|ed|ing)?\b/i, /\bbreach/i,
  /\brate[-\s]?limit/i, /\bbypass/i,
  // — How the platform is run —
  /\bcrons?\b/i, /\bworkflows?\b/i, /\bdeploy(?:s|ed|ments?)?\b/i, /\bmigrations?\b/i, /\bwebhooks?\b/i,
  /\bnetlify\b/i, /\bvercel\b/i, /\bcloudflare\b/i, /\bsupabase\b/i, /\bpostgres/i, /\bgithub\b/i,
  /\btelemetry\b/i, /\bwatchdog\b/i, /\begress\b/i, /\bscrapers?\b/i, /\bpipelines?\b/i, /\bbackfill/i,
  /\bschema\b/i, /\bRLS\b/,
  // — AI providers —
  /\bollama\b/i, /\bgroq\b/i, /\bgemini\b/i, /\bmistral\b/i, /\bcerebras\b/i,
  // — Pages members don't use —
  /\/admin\b/i, /\/pitch\b/i,
  // — The catch-all lines drafts used to end with —
  /\bunder the hood\b/i, /\bbehind[-\s]the[-\s]scenes\b/i,
];


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
  ...INTERNAL_TERMS,
  // Build bookkeeping. Commit and PR references mean nothing to a member.
  /\(#\d+\)/, /\b\d+ commits?\b/i,
];

const CONVENTIONAL = /^(\w+)(?:\(([^)]*)\))?:\s*(.*)$/s;

/** True if a commit subject should be HELD OUT of the public auto-draft. */
export function isSensitiveSubject(text) {
  return SENSITIVE_PATTERNS.some((re) => re.test(text)) || INTERNAL_TERMS.some((re) => re.test(text));
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

/**
 * The words in a note that stop it going public, for a message a person can act
 * on (empty array = clean).
 * @param {string} text
 * @returns {string[]}
 */
export function publishBlocklistMatches(text) {
  const words = new Set();
  for (const re of PUBLISH_BLOCKLIST) {
    const m = text.match(re);
    if (m) words.add(m[0].trim().toLowerCase());
  }
  return [...words];
}

/** Patterns a published string trips (empty array = clean). Used by the CI guard. */
export function publishBlocklistHits(text) {
  return PUBLISH_BLOCKLIST.filter((re) => re.test(text)).map((re) => re.toString());
}
