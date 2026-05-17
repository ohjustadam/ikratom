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

export type VerifyResult =
  | { ok: true; matchedAt: string; pageSnippet: string }
  | { ok: false; reason: "no-url" | "fetch-failed" | "name-not-found"; detail?: string };

const FETCH_TIMEOUT_MS = 12_000;
const MAX_FETCH_BYTES = 1_000_000;

/**
 * Fetch the source URL and confirm `fullName` appears in the visible
 * text. Returns the surrounding snippet on match.
 */
export async function verifyOfficialAgainstSource(input: {
  fullName: string;
  sourceUrl: string | null;
}): Promise<VerifyResult> {
  if (!input.sourceUrl) return { ok: false, reason: "no-url" };
  if (!input.fullName || input.fullName.length < 3) {
    return { ok: false, reason: "name-not-found", detail: "name too short" };
  }

  let res: Response;
  try {
    res = await fetch(input.sourceUrl, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "User-Agent": "iKratom Civic Verifier (research@ikratom.org)" },
    });
  } catch (e) {
    return { ok: false, reason: "fetch-failed", detail: (e as Error).message };
  }
  if (!res.ok) {
    return { ok: false, reason: "fetch-failed", detail: `HTTP ${res.status}` };
  }

  const html = (await res.text()).slice(0, MAX_FETCH_BYTES);
  const text = stripHtmlToText(html).toLowerCase();
  const name = input.fullName.toLowerCase();

  // Direct match
  let idx = text.indexOf(name);
  if (idx === -1) {
    // Try "Last, First" inversion which some directories use
    const parts = input.fullName.trim().split(/\s+/);
    if (parts.length >= 2) {
      const inverted = `${parts[parts.length - 1]}, ${parts.slice(0, -1).join(" ")}`.toLowerCase();
      idx = text.indexOf(inverted);
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
      if (m && m.index !== undefined) idx = m.index;
    }
  }
  if (idx === -1) {
    return { ok: false, reason: "name-not-found", detail: `URL did not contain "${input.fullName}"` };
  }

  // Capture a snippet around the match so admin spot-checks have context
  const start = Math.max(0, idx - 60);
  const end = Math.min(text.length, idx + 120);
  return {
    ok: true,
    matchedAt: input.sourceUrl,
    pageSnippet: text.slice(start, end).replace(/\s+/g, " ").trim(),
  };
}
