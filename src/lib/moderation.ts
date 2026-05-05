/**
 * Forum moderation — content signal detection.
 *
 * Pure functions, no DB calls. Used by createPost / createThread server
 * actions to decide whether a post should auto-flag for review.
 *
 * Strategy: precision over recall. We'd rather miss some spam (admin can
 * report it) than block legitimate posts about, e.g., a kratom shop's
 * statehouse testimony. Whitelist-based URL handling reflects this.
 */

// ── URL whitelist ─────────────────────────────────────────────────
// Trusted domains where linking is fine. Match: exact host or
// "*.<whitelisted>". Order matters only for readability.
const URL_WHITELIST = [
  // Government
  "congress.gov",
  "house.gov",
  "senate.gov",
  "fda.gov",
  "dea.gov",
  "openstates.org",
  "legiscan.com",
  // Advocacy / kratom-specific
  "americankratom.org",
  "kratom.org",
  "globalkratomcoalition.org",
  "kratomscience.com",
  // Reference
  "wikipedia.org",
  "ncbi.nlm.nih.gov",
  "pubmed.ncbi.nlm.nih.gov",
  "scholar.google.com",
  // News (reputable)
  "reuters.com",
  "apnews.com",
  "nytimes.com",
  "washingtonpost.com",
  "wsj.com",
  // Internal
  "ikratom.org",
  "ikratom.com",
  "ikratom.vercel.app",
];

// Generic .gov domains are also whitelisted (state/local gov sites)
const GOV_DOMAIN_RE = /\.gov$/i;
const EDU_DOMAIN_RE = /\.edu$/i;

function isWhitelistedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, "");
  if (URL_WHITELIST.includes(h)) return true;
  if (URL_WHITELIST.some((w) => h.endsWith("." + w))) return true;
  if (GOV_DOMAIN_RE.test(h) || EDU_DOMAIN_RE.test(h)) return true;
  return false;
}

// ── Detection regexes ─────────────────────────────────────────────
// Full URL with scheme
const URL_FULL_RE = /https?:\/\/([a-z0-9.-]+\.[a-z]{2,})(\/[^\s]*)?/gi;
// Bare domain (e.g. "buykratom.shop") — at least one letter, real TLD
const URL_BARE_RE = /\b([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)\b/gi;
// US phone numbers
const PHONE_RE = /\b(?:\+?1[-.\s]?)?\(?[2-9]\d{2}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g;
// Email
const EMAIL_RE = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi;
// Crypto addresses (BTC + ETH; covers most spam wallets)
const BTC_RE = /\b(?:bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}\b/g;
const ETH_RE = /\b0x[a-fA-F0-9]{40}\b/g;

// Common TLDs we trust as "this is actually a domain", to keep false
// positives down on bare-domain matching (otherwise sentences like
// "I.am.unsure" trigger).
const REAL_TLDS = new Set([
  "com","net","org","io","co","gov","edu","us","app","dev","shop","store",
  "info","biz","me","tv","blog","health","money","life","online","site",
  "xyz","top","club","page","cloud","tech","ai","mil","int",
]);

export type ModerationSignals = {
  /** Non-whitelisted full URLs (with scheme) */
  urls: string[];
  /** Bare domains that look like links (no scheme), non-whitelisted */
  bareDomains: string[];
  /** US phone numbers */
  phones: string[];
  /** Email addresses */
  emails: string[];
  /** Crypto wallet addresses */
  cryptoWallets: string[];
};

export function detectModerationSignals(text: string): ModerationSignals {
  if (!text) return { urls: [], bareDomains: [], phones: [], emails: [], cryptoWallets: [] };

  const out: ModerationSignals = {
    urls: [],
    bareDomains: [],
    phones: [],
    emails: [],
    cryptoWallets: [],
  };

  // Full URLs
  for (const m of text.matchAll(URL_FULL_RE)) {
    const host = m[1];
    if (host && !isWhitelistedHost(host)) {
      out.urls.push(m[0].slice(0, 200));
    }
  }

  // Strip emails before bare-domain detection so we don't catch the email
  // host as a "bare domain".
  const stripped = text.replace(EMAIL_RE, " ").replace(URL_FULL_RE, " ");
  for (const m of stripped.matchAll(URL_BARE_RE)) {
    const candidate = m[1].toLowerCase();
    const tld = candidate.split(".").pop() ?? "";
    if (!REAL_TLDS.has(tld)) continue;
    // Must have at least one alphabetical part beyond the TLD
    const labels = candidate.split(".");
    if (labels.length < 2) continue;
    if (isWhitelistedHost(candidate)) continue;
    // Skip pure numeric hosts (false positives like "1.2.3.4" version strings)
    if (labels.every((l) => /^\d+$/.test(l))) continue;
    out.bareDomains.push(m[1]);
  }

  // Phones
  for (const m of text.matchAll(PHONE_RE)) {
    out.phones.push(m[0]);
  }

  // Emails
  for (const m of text.matchAll(EMAIL_RE)) {
    out.emails.push(m[0]);
  }

  // Crypto
  for (const m of text.matchAll(BTC_RE)) out.cryptoWallets.push(m[0]);
  for (const m of text.matchAll(ETH_RE)) out.cryptoWallets.push(m[0]);

  // Dedupe each list
  out.urls = [...new Set(out.urls)];
  out.bareDomains = [...new Set(out.bareDomains)];
  out.phones = [...new Set(out.phones)];
  out.emails = [...new Set(out.emails)];
  out.cryptoWallets = [...new Set(out.cryptoWallets)];

  return out;
}

export type ModerationDecision = {
  status: "approved" | "pending" | "auto_flagged";
  signals: ModerationSignals | null;
  reason: string | null;
};

/**
 * Decide what moderation status a new post/thread should have.
 *
 *   isPrivileged → 'approved' regardless (admin / leader)
 *   any non-whitelisted URL / bare domain / phone / email / wallet
 *     → 'auto_flagged'
 *   author has < 3 approved posts → 'pending'
 *   else → 'approved'
 */
export function moderateNewContent(input: {
  body: string;
  authorPostCount: number;
  isPrivileged: boolean;
}): ModerationDecision {
  const { body, authorPostCount, isPrivileged } = input;

  // Privileged users (admin / owner / leader) bypass everything
  if (isPrivileged) {
    return { status: "approved", signals: null, reason: null };
  }

  const signals = detectModerationSignals(body);
  const hasContact =
    signals.urls.length > 0 ||
    signals.bareDomains.length > 0 ||
    signals.phones.length > 0 ||
    signals.emails.length > 0 ||
    signals.cryptoWallets.length > 0;

  if (hasContact) {
    const parts: string[] = [];
    if (signals.urls.length) parts.push(`${signals.urls.length} non-whitelisted URL(s)`);
    if (signals.bareDomains.length) parts.push(`${signals.bareDomains.length} bare domain(s)`);
    if (signals.phones.length) parts.push(`${signals.phones.length} phone number(s)`);
    if (signals.emails.length) parts.push(`${signals.emails.length} email(s)`);
    if (signals.cryptoWallets.length) parts.push(`${signals.cryptoWallets.length} wallet address(es)`);
    return {
      status: "auto_flagged",
      signals,
      reason: `Contains: ${parts.join(", ")}`,
    };
  }

  if (authorPostCount < 3) {
    return {
      status: "pending",
      signals: null,
      reason: `New account (${authorPostCount} approved post${authorPostCount === 1 ? "" : "s"} so far)`,
    };
  }

  return { status: "approved", signals: null, reason: null };
}
