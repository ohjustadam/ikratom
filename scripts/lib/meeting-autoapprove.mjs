/**
 * meeting-autoapprove.mjs — which municipal_meetings rows a MACHINE may publish.
 *
 * auto-approve-meetings.mjs promotes a pending meeting straight to the public
 * /calendar and fires the 7d/3d/1d push reminders, with no human click. Until
 * 2026-09-17 its only gates were ai_confidence >= the site_config floor and a
 * non-empty source_url. That trusted the NUMBER without asking who wrote it.
 *
 * extract-news-events.mjs writes whatever confidence the model returns, so a
 * model could publish its own guess by being sure of it. That is what happened.
 * On 2026-09-17 three news-extracted rows were live and future-dated, and two
 * were not meetings at all: "Ban on retail sale of kratom products effective"
 * (a law's effective date, filed as a Naperville City Council meeting, 0.95) and
 * "Expiration of temporary kratom ban" (an expiry, filed as a North Dakota
 * Legislature meeting on 2027-01-01, 0.95). Both would have pushed reminders
 * for meetings that do not exist.
 *
 * So eligibility now depends on PROVENANCE first, confidence second. A row
 * qualifies only when its confidence was assigned by code from structured or
 * verified evidence — never when a model authored the number.
 *
 * ALLOWLIST, NOT DENYLIST, ON PURPOSE. A denylist lets every future writer
 * through by default, which is how this hole opened in the first place. With an
 * allowlist a new writer is held for human review until someone decides it is
 * trustworthy. tests/meeting-autoapprove.test.ts scans every discovered_via
 * literal in scripts/ and fails if one is in neither map, so that decision
 * cannot be skipped by accident.
 */

/** Writers whose ai_confidence is assigned by code, not by a model. */
export const VERIFIED_VIA = Object.freeze({
  // meeting-discover.mjs: the model answers multiple choice about ONE fetched
  // page; code supplies url/date/confidence and binds the quote to an agenda
  // item context (#913).
  searxng_verified: "code-scored; quote, date and item context verified on the fetched page",
  gemini_lead_verified: "Gemini only supplies a URL; the page goes through the same verifier",
  // Structured agenda-platform scrapers. No model call anywhere in the path:
  // date, body and agenda text come from the platform's own records.
  legistar_fetch: "structured Legistar agenda record, no model",
  legistar_scan: "structured Legistar tenant scan, no model",
  granicus_fetch: "structured Granicus agenda record, no model",
  granicus_scan: "structured Granicus tenant scan, no model",
  boarddocs_fetch: "structured BoardDocs agenda record, no model",
  civicplus_fetch: "structured CivicPlus agenda record, no model",
});

/** Writers that must always wait for a human, and why. */
export const HUMAN_REVIEW_VIA = Object.freeze({
  news_article: "extract-news-events.mjs stores the MODEL's self-reported confidence",
  gemini_grounded_watchlist_recheck: "recheck-watchlist-meetings.mjs writes Gemini JSON at a fixed 0.85, exactly the floor",
  gemini_grounded: "legacy: the model authored the whole row",
  manual: "entered by a person; a person should publish it",
});

export const VERIFIED_VIA_LIST = Object.freeze(Object.keys(VERIFIED_VIA));

/**
 * @param {{discovered_via?:string|null, ai_confidence?:number|null, source_url?:string|null, meeting_at?:string|null}} m
 * @param {{minConf:number, requireSource:boolean, now?:Date}} policy
 * @returns {{ok:boolean, reason:string}}
 */
export function isAutoApprovable(m, { minConf, requireSource, now = new Date() }) {
  const via = String(m?.discovered_via ?? "");
  // Provenance first: a confident number from an untrusted author is still untrusted.
  if (!Object.hasOwn(VERIFIED_VIA, via)) {
    return { ok: false, reason: `unverified provenance (${via || "none"}) — human review` };
  }
  const conf = Number(m?.ai_confidence);
  if (!Number.isFinite(conf) || conf < minConf) return { ok: false, reason: `confidence ${m?.ai_confidence} < ${minConf}` };
  if (requireSource && !(typeof m?.source_url === "string" && m.source_url.length > 0)) {
    return { ok: false, reason: "no source_url" };
  }
  const at = Date.parse(String(m?.meeting_at ?? ""));
  if (!Number.isFinite(at) || at < now.getTime()) return { ok: false, reason: "not future-dated" };
  return { ok: true, reason: VERIFIED_VIA[via] };
}
