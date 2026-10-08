/**
 * legistar-events.mjs — pure helpers for reading upcoming agendas from the
 * keyless Legistar webapi (`/v1/{client}/events` + `/events/{id}/eventitems`).
 *
 * WHY (2026-10-08): scan-legistar-tenants.mjs scraped Calendar.aspx HTML, which
 * is built client-side — every tenant returned "no meeting links found", so the
 * job wrote "0 hits" nightly while scanning nothing. The webapi returns the same
 * meetings and agenda items as structured JSON, no model anywhere in the path.
 */
import { KRATOM_KEYWORD_RX } from "./kratom-keywords.mjs";
import { toUtcIso, TZ_BY_STATE } from "./meeting-discover.mjs";

// Unambiguous kratom terms. KRATOM_KEYWORD_RX also matches a bare "7-OH" /
// "7 OH", which an agenda can print for other reasons ("Item 7 OH..."), so an
// item matched ONLY that way is kept but held below the auto-publish floor.
const STRONG_RX = /\b(kratom[s]?|kratomite|mitragyna|mitragynine|7-?hydroxymitragynine|gas[- ]?station\s+(?:drugs?|heroin|opioids?)|tianeptine)\b/i;

/** Confidence this code assigns: strong term → auto-publishable; "7-OH" only → human review. */
export const CONF_STRONG = 0.95;
export const CONF_WEAK = 0.8; // below AUTOPUBLISH_FLOOR (0.85) on purpose

const stripTags = (s) => String(s ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

/**
 * Agenda items that mention kratom. Looks at the item title, its matter name
 * and the agenda note (HTML stripped).
 * @returns {{ title: string, strong: boolean }[]}
 */
export function kratomItems(items) {
  const out = [];
  for (const it of items ?? []) {
    const hay = [it.EventItemTitle, it.EventItemMatterName, stripTags(it.EventItemAgendaNote)].filter(Boolean).join(" · ");
    if (!KRATOM_KEYWORD_RX.test(hay)) continue;
    out.push({ title: stripTags(it.EventItemTitle || it.EventItemMatterName || hay).slice(0, 600), strong: STRONG_RX.test(hay) });
  }
  return out;
}

/** "6:30 PM" → { hh: 18, mm: 30 }; anything unparseable → null. */
export function parseEventTime(s) {
  const m = /^\s*(\d{1,2}):(\d{2})\s*([AP])\.?M\.?\s*$/i.exec(String(s ?? ""));
  if (!m) return null;
  let hh = Number(m[1]) % 12;
  if (m[3].toUpperCase() === "P") hh += 12;
  return { hh, mm: Number(m[2]) };
}

/**
 * Legistar prints EventDate as a local midnight with no zone ("2026-10-14T00:00:00")
 * and EventTime as local wall-clock text. Combine them in the tenant state's
 * zone. When no time is published, use local noon (keeps the date right in
 * every US zone) and say so.
 * @returns {{ iso: string, timeKnown: boolean, tz: string } | null}
 */
export function eventMeetingAt(event, state) {
  const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(event?.EventDate ?? ""));
  if (!d) return null;
  const t = parseEventTime(event.EventTime);
  const wall = { y: Number(d[1]), m: Number(d[2]), d: Number(d[3]), hh: t?.hh ?? 12, mm: t?.mm ?? 0 };
  return { iso: toUtcIso(wall, state), timeKnown: !!t, tz: TZ_BY_STATE[String(state).toUpperCase()] ?? "America/New_York" };
}

/** One municipal_meetings row for an event that has kratom agenda items. */
export function buildMeetingRow(tenant, event, hits) {
  const when = eventMeetingAt(event, tenant.state);
  if (!when || hits.length === 0) return null;
  const strong = hits.some((h) => h.strong);
  const detail = event.EventInSiteURL || null;
  return {
    state: tenant.state,
    locality: tenant.locality,
    body_name: event.EventBodyName || tenant.body || null,
    meeting_at: when.iso,
    format: "hybrid",
    in_person_address: event.EventLocation ? String(event.EventLocation).slice(0, 300) : null,
    agenda_url: event.EventAgendaFile || detail,
    source_url: detail || event.EventAgendaFile || null,
    agenda_text: hits.map((h) => `• ${h.title}`).join("\n").slice(0, 4000),
    discovered_via: "legistar_scan",
    ai_confidence: strong ? CONF_STRONG : CONF_WEAK,
    ai_notes: `Legistar webapi (${tenant.client}) event ${event.EventId}: ${hits.length} kratom agenda item(s)` +
      `${strong ? "" : ", matched only on a bare '7-OH', held for review"}; ` +
      `${when.timeKnown ? `time read in ${when.tz}` : `no time published, set to local noon (${when.tz})`}.`,
    kratom_relevance: "confirmed",
    moderation_status: "pending_review", // auto-approve-meetings publishes legistar_scan rows at/above the floor
  };
}

/**
 * Merge the live DB tenants with the static list, one entry per webapi client.
 * DB rows win: they were probed against the webapi itself.
 */
export function mergeTenants(dbRows, staticList, clientFor) {
  const byClient = new Map();
  for (const r of dbRows ?? []) {
    if (!r.webapi_client) continue;
    byClient.set(r.webapi_client, { client: r.webapi_client, state: r.state, locality: r.locality, body: r.body ?? null, fromDb: true });
  }
  const knownLocalities = new Set([...byClient.values()].map((t) => t.locality));
  for (const t of staticList ?? []) {
    const client = clientFor(t);
    if (!client || byClient.has(client) || knownLocalities.has(t.locality)) continue;
    byClient.set(client, { client, state: t.state, locality: t.locality, body: t.body ?? null });
  }
  return [...byClient.values()];
}
