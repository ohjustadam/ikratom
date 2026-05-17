/**
 * Source-verification for AI-suggested local officials.
 *
 * Owner directive 2026-05-16: auto-populate local reps without admin
 * in the loop, but with a "failsafe" so we never list someone who
 * isn't actually a current official. The verification: every suggested
 * official has a source_url; we fetch that URL and confirm the
 * full_name appears in the visible text. If it does, we trust the AI
 * and auto-accept. If not (URL dead, name absent, etc.) we defer to
 * admin review.
 *
 * This is more robust than running 3 LLMs and taking majority vote
 * — three models trained on similar data can all hallucinate the
 * same plausible name. Grounding in the actual source page closes
 * that hole.
 */

import { stripHtmlToText } from "@/lib/research-metadata";

/** Verification confidence tier.
 *  - `verified`  — full name appears on the cited page. High confidence.
 *  - `tentative` — name not in page but URL is on a credible .gov / .us
 *                  /state-level domain. Admin should spot-check, but we
 *                  trust the source enough to surface in the queue.
 *  - rejected     — neither (returned as ok=false).
 */
export type VerifyResult =
  | { ok: true; tier: "verified" | "tentative"; matchedAt: string; pageSnippet: string }
  | { ok: false; reason: "no-url" | "fetch-failed" | "name-not-found" | "untrusted-domain"; detail?: string };

/**
 * Domain credibility check — official .gov, .us, government .org-style
 * domains qualify as "trusted enough" for tentative acceptance even
 * when the specific URL doesn't contain the name (common for JS-rendered
 * CMS pages or roster PDFs).
 */
function isTrustedGovDomain(urlStr: string): boolean {
  try {
    const u = new URL(urlStr);
    const host = u.hostname.toLowerCase();
    // Federal/state/local .gov + .us
    if (host.endsWith(".gov") || host === "gov") return true;
    if (host.endsWith(".us") || host === "us") return true;
    if (host.endsWith(".mil")) return true;
    // Common municipal CMS domains — legit government portals even
    // when the underlying TLD is .org / .net / .com.
    if (/^(www\.)?(city|town|village|borough|township|parish|county)of[a-z]/.test(host)) return true;
    if (/(city|town|village|borough|township|parish|county)\.(org|net)$/.test(host)) return true;
    if (/\.(net|org)$/.test(host) && /(gov|council|city|town|county|parish|borough)/.test(host)) return true;
    return false;
  } catch { return false; }
}

/**
 * Looser domain check used as a last-resort fallback before rejecting:
 * does the homepage of the cited domain reference the locality name?
 * Catches cases like sbpg.net (St. Bernard Parish Government) where
 * the TLD/host doesn't match a regex but the site IS the official
 * government portal for that locality.
 */
async function domainMatchesLocality(urlStr: string, localityHint: string): Promise<boolean> {
  try {
    const u = new URL(urlStr);
    const root = `${u.protocol}//${u.host}`;
    const r = await fetch(root, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "User-Agent": "iKratom Civic Verifier (research@ikratom.org)" },
    });
    if (!r.ok) return false;
    const text = stripHtmlToText(await r.text()).toLowerCase().slice(0, 200_000);
    // Strip "City" / "County" / "Borough" suffix from the hint so we
    // match the bare locality name in the homepage.
    const bareLocality = localityHint
      .toLowerCase()
      .replace(/,\s*[a-z]{2}$/i, "")
      .replace(/\b(city|town|village|borough|township|parish|county)\b/g, "")
      .trim();
    if (bareLocality.length < 3) return false;
    return text.includes(bareLocality);
  } catch {
    return false;
  }
}

const FETCH_TIMEOUT_MS = 12_000;
const MAX_FETCH_BYTES = 1_000_000;

/**
 * Fetch the source URL and confirm `fullName` appears in the visible
 * text. Returns the surrounding snippet on match.
 *
 * `localityHint` (optional) enables a parent-domain fallback for sparse-
 * web localities where the regex domain-trust list doesn't catch the
 * official site (e.g., sbpg.net = St. Bernard Parish Gov).
 */
export async function verifyOfficialAgainstSource(input: {
  fullName: string;
  sourceUrl: string | null;
  localityHint?: string;
}): Promise<VerifyResult> {
  if (!input.sourceUrl) return { ok: false, reason: "no-url" };
  if (!input.fullName || input.fullName.length < 3) {
    return { ok: false, reason: "name-not-found", detail: "name too short" };
  }

  const trusted = isTrustedGovDomain(input.sourceUrl);

  let res: Response;
  try {
    res = await fetch(input.sourceUrl, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "User-Agent": "iKratom Civic Verifier (research@ikratom.org)" },
    });
  } catch (e) {
    // Untrusted + fetch failed → reject. Trusted + fetch failed → tentative
    // (the AI cited a credible .gov page; the page may have moved but
    // domain backing is still strong evidence vs hallucinated names on
    // random .com sites).
    if (trusted) {
      return {
        ok: true,
        tier: "tentative",
        matchedAt: input.sourceUrl,
        pageSnippet: `[tentative — cited URL on trusted domain ${new URL(input.sourceUrl).hostname} but fetch failed: ${(e as Error).message}]`,
      };
    }
    return { ok: false, reason: "fetch-failed", detail: (e as Error).message };
  }
  if (!res.ok) {
    if (trusted) {
      return {
        ok: true,
        tier: "tentative",
        matchedAt: input.sourceUrl,
        pageSnippet: `[tentative — cited URL on trusted domain ${new URL(input.sourceUrl).hostname} returned HTTP ${res.status}; admin should spot-check]`,
      };
    }
    return { ok: false, reason: "fetch-failed", detail: `HTTP ${res.status}` };
  }

  const ct = res.headers.get("content-type") || "";
  // PDF responses: we don't currently extract PDF text — treat as
  // tentative on trusted domains, reject on others.
  if (ct.includes("pdf")) {
    if (trusted) {
      return {
        ok: true,
        tier: "tentative",
        matchedAt: input.sourceUrl,
        pageSnippet: `[tentative — source is a PDF on ${new URL(input.sourceUrl).hostname}; admin spot-check recommended]`,
      };
    }
    return { ok: false, reason: "name-not-found", detail: "PDF source on non-trusted domain" };
  }

  const html = (await res.text()).slice(0, MAX_FETCH_BYTES);
  const text = stripHtmlToText(html).toLowerCase();
  const name = input.fullName.toLowerCase();

  // Direct match — strongest signal
  let idx = text.indexOf(name);
  let matchType: "full" | "inverted" | "last" | null = idx >= 0 ? "full" : null;
  if (idx === -1) {
    // Try "Last, First" inversion which some directories use
    const parts = input.fullName.trim().split(/\s+/);
    if (parts.length >= 2) {
      const inverted = `${parts[parts.length - 1]}, ${parts.slice(0, -1).join(" ")}`.toLowerCase();
      idx = text.indexOf(inverted);
      if (idx >= 0) matchType = "inverted";
    }
  }
  if (idx === -1) {
    // Try the last name alone — common in council rosters that
    // distinguish by district rather than first name (e.g. "Council
    // Member Smith — District 4"). Single-token last names only.
    const last = input.fullName.trim().split(/\s+/).pop();
    if (last && last.length >= 4) {
      const re = new RegExp(`\\b${last.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
      const m = text.match(re);
      if (m && m.index !== undefined) {
        idx = m.index;
        matchType = "last";
      }
    }
  }

  if (idx === -1) {
    // No name match at all. If the domain is trusted (.gov/.us/etc.),
    // accept as tentative — the AI cited a credible government source
    // for this locality, and the page may use JS-rendered names or
    // images. Admin can spot-check.
    if (trusted) {
      return {
        ok: true,
        tier: "tentative",
        matchedAt: input.sourceUrl,
        pageSnippet: `[tentative — name not found in HTML of ${new URL(input.sourceUrl).hostname} but domain is government-credible; possible JS-rendered or image-embedded roster. Admin spot-check.]`,
      };
    }
    // Last-resort fallback: if a locality hint was supplied, check
    // whether the cited domain's homepage references the locality. If
    // sbpg.net's homepage says "St. Bernard Parish", we trust it as
    // the official portal even though our static regex didn't catch it.
    if (input.localityHint) {
      const domainMatches = await domainMatchesLocality(input.sourceUrl, input.localityHint);
      if (domainMatches) {
        return {
          ok: true,
          tier: "tentative",
          matchedAt: input.sourceUrl,
          pageSnippet: `[tentative — name not in cited page, but ${new URL(input.sourceUrl).hostname} homepage references "${input.localityHint}" so domain is the official portal. Admin spot-check.]`,
        };
      }
    }
    return { ok: false, reason: "name-not-found", detail: `URL did not contain "${input.fullName}"` };
  }

  // Capture a snippet around the match so admin spot-checks have context
  const start = Math.max(0, idx - 60);
  const end = Math.min(text.length, idx + 120);
  const snippet = text.slice(start, end).replace(/\s+/g, " ").trim();
  // Full-name match anywhere → verified. Last-name-only match is
  // tentative even on trusted domains (could be a different person
  // with the same last name).
  const tier: "verified" | "tentative" = matchType === "full" || matchType === "inverted"
    ? "verified"
    : "tentative";
  return { ok: true, tier, matchedAt: input.sourceUrl, pageSnippet: snippet };
}
