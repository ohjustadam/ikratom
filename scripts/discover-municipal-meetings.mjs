#!/usr/bin/env node
/**
 * discover-municipal-meetings.mjs — find upcoming city/county meetings that
 * have a kratom item on the agenda, and write ONLY what code verified on a page
 * this process fetched itself.
 *
 * WHY THIS WAS REWRITTEN. scripts/auto-approve-meetings.mjs promotes any
 * municipal_meetings row whose ai_confidence clears the site_config floor
 * (0.85) and whose source_url is non-empty straight to
 * moderation_status='approved' — onto the public /calendar and into a push
 * notification — with no human click. The old version of this file asked Gemini
 * for meetings and inserted the JSON it got back, so the MODEL authored the
 * URL, the date, the address and its own confidence number. One obliging answer
 * published a meeting that never existed, to people who plan a drive around it.
 *
 * The model is now a LEAD GENERATOR and nothing else. Whichever tier answers —
 * Gemini's grounded search or our keyless SearXNG lanes — only URLs survive the
 * handoff. Every URL is fetched, gated, read multiple-choice and scored by
 * scripts/lib/meeting-discover.mjs, which is the only code in the repo that
 * produces an ai_confidence number. `discovered_via` records which lead source
 * found the page ("searxng_verified" / "gemini_lead_verified"). The old
 * grounded-Gemini discovered_via value survives only on rows written before
 * this rewrite; that string does not appear anywhere in this file, so a grep
 * for it is a mechanical check that no unverified write path came back.
 *
 * BLOCKED IS NOT EMPTY. A run that could not search, or could not read, reports
 * status='error' on scraper_runs — never "0 found". Conflating the two is what
 * kept this pipeline green for four days while Gemini answered 429 to every
 * call and /admin/automation showed "51 states · 0 found · 0 new".
 *
 * Run:
 *   node --env-file=.env.local scripts/discover-municipal-meetings.mjs --all-states
 *   node --env-file=.env.local scripts/discover-municipal-meetings.mjs --state NY
 *   node --env-file=.env.local scripts/discover-municipal-meetings.mjs --priority-only
 *   node --env-file=.env.local scripts/discover-municipal-meetings.mjs --global-only
 *     (agenda-portal vendor sweep only — no per-state or warm-lead queries)
 *   node --env-file=.env.local scripts/discover-municipal-meetings.mjs --warm-only
 *     (only localities with a pending kratom measure)
 *   node --env-file=.env.local scripts/discover-municipal-meetings.mjs --dry-run --max-minutes 5
 */
import { createClient } from "@supabase/supabase-js";
import { groundedGenerate } from "./lib/grounded-ai.mjs";
import { searxngConfigured, searxngSearchDetailed } from "./lib/searxng.mjs";
import { resolveLocality, STATE_NAMES } from "./lib/geo-resolver.mjs";
import { placeNameOf } from "./lib/ban-verify.mjs";
import {
  discoverMeetings,
  globalPortalQueries,
  registrableDomain,
  searxngProbe,
} from "./lib/meeting-discover.mjs";

// ---------- flags ----------
const args = process.argv.slice(2);
const arg = (f) => { const i = args.indexOf(f); const v = args[i + 1]; return i >= 0 && v && !v.startsWith("--") ? v : null; };
const num = (v, dflt) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : dflt; };

const STATE = arg("--state");
const PRIORITY_ONLY = args.includes("--priority-only");
// The cron has passed --all-states since 2026-05-14 and this file never parsed
// it; it "worked" only because no-flag already meant all 51. Parsed now, so the
// cron's stated intent survives any future change to the default.
const ALL_STATES = args.includes("--all-states");
const DRY_RUN = args.includes("--dry-run");
const GLOBAL_ONLY = args.includes("--global-only");
const WARM_ONLY = args.includes("--warm-only");
const MAX_MINUTES = num(arg("--max-minutes"), 40);
const MAX_FETCHES = num(arg("--max-fetches"), 220);

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
if (!SB_URL || !SB_KEY) { console.error("Missing Supabase env"); process.exit(1); }

// WAS: `if (!GEMINI_KEY) process.exit(1)`, which killed the process before any
// other backend could run — and GEMINI_KEY was never referenced again in the
// file. That one line is what made a depleted Gemini key a total outage instead
// of a degraded one.
if (!searxngConfigured() && !GEMINI_KEY) {
  console.error("No grounding backend: set SEARXNG_URL or GEMINI_API_KEY");
  process.exit(1);
}
// Leads are cheap; VERIFICATION is the product, and it lives behind
// discoverMeetings' searxngConfigured() gate. Say so loudly rather than let an
// operator read 51 blocked states as "the search found nothing".
if (!searxngConfigured()) {
  console.warn("⚠ SEARXNG_URL is unset — leads can still be generated but NOTHING can be verified,");
  console.warn("  so every state will report blocked and no row will be written. See docs/SEARXNG_DEPLOY.md.");
}

const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

// States with the most kratom legislative activity → always scanned first, so a
// wall-clock or fetch-budget stop lands on the tail, never on them.
const PRIORITY_STATES = ["NY", "FL", "TX", "CA", "OH", "MI", "TN", "MO", "PA", "GA"];

const CONCURRENCY = 4;
const PER_STATE_FETCHES = 8;
// 20 warm leads × 2 queries ≈ the 40 warm-lead searches the run budget assumes.
// The DB query below rotates by staleness, so which 20 changes day to day.
const WARM_SEED_LIMIT = 20;

const isHttpUrl = (u) => typeof u === "string" && /^https?:\/\//i.test(u);

async function pool(items, size, worker) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.max(1, size) }, async () => {
    for (;;) {
      const item = queue.shift();
      if (item === undefined) return;
      await worker(item);
    }
  }));
}

// ---------- run-scoped state ----------
const t0 = Date.now();
const deadline = t0 + MAX_MINUTES * 60_000;
// ONE counters object for the whole run. The auto-publish fuse and the
// extraction-outage detector inside discoverMeetings are run-scoped; a
// per-state object silently defeats both, and the fuse is the thing standing
// between a bad night and twenty self-published meetings.
const counters = { searched: 0, searchFailed: 0, fetched: 0, readerOk: 0, readerFailed: 0, autoPublished: 0 };
let firstBlockReason = null;

// ---------- the lead prompt (Gemini tier) ----------
const LEAD_SYSTEM = "You find real, upcoming municipal meetings from grounded web search. Never guess.";

/**
 * Unchanged from the grounded-JSON era ON PURPOSE. Every field except the URLs
 * is now discarded — but asking for the date, the excerpt and the confidence is
 * what makes the model look up a SPECIFIC meeting instead of handing back a
 * city homepage, and a URL attached to a concrete claim is a better lead.
 *
 * Its 14-day horizon is narrower than the verifier's 60-day window, so Gemini
 * leads are a subset of what the SearXNG lanes can reach. That asymmetry is
 * harmless: both feed the same verifier.
 */
function leadPrompt(stateName) {
  return `Find upcoming (next 14 days) city council, county board, board of supervisors,
or related local government meetings in ${stateName} where kratom, 7-hydroxymitragynine (7-OH),
"gas station drugs", or tianeptine appears on the agenda.

For each meeting found, return strict JSON with this exact shape:
{
  "meetings": [
    {
      "locality": "City/county name, ST",
      "body_name": "City Council / Board of Supervisors / etc",
      "meeting_iso": "ISO 8601 datetime",
      "format": "in_person" | "virtual" | "hybrid" | "unknown",
      "zoom_url": "if known, the Zoom join URL — otherwise null",
      "livestream_url": "YouTube / city stream URL if separate from Zoom — otherwise null",
      "agenda_url": "link to the official agenda page",
      "in_person_address": "if in-person or hybrid, the address — otherwise null",
      "public_comment_url": "URL to sign up for public comment if separate — otherwise null",
      "agenda_excerpt": "the specific phrase or paragraph from the agenda mentioning kratom (verbatim)",
      "confidence": 0.0 to 1.0,
      "source_url": "the URL where you found this — required"
    }
  ]
}

Only include meetings you have concrete evidence for from grounded search.
Return {"meetings":[]} if nothing found. Skip past meetings.
ALWAYS include source_url for every meeting.`;
}

// ---------- lane 1: the global portal sweep ----------
/**
 * The agenda-portal vendors (Legistar, Granicus, CivicClerk…) host thousands of
 * cities, so ~11 `site:` queries run ONCE per run cover more ground than 51
 * per-state queries and cost a fixed amount however many states we scan.
 *
 * Each hit is bucketed to a state from its title, snippet and HOST — a search
 * hint only, never the state we write: verifyCandidate re-derives that from the
 * page it fetched. A hit we cannot bucket is not discarded, it is queued for the
 * unbucketed pool that runs last with no scope state, where the fetched page
 * decides.
 */
async function runGlobalLane(probe) {
  const buckets = new Map();
  const unbucketed = [];
  if (!searxngConfigured() || (probe && !probe.ok)) return { buckets, unbucketed };

  const hits = [];
  await pool(globalPortalQueries(), CONCURRENCY, async (q) => {
    counters.searched++;
    const r = await searxngSearchDetailed(q, { count: 10 });
    if (!r?.ok) {
      counters.searchFailed++;
      firstBlockReason ??= `searxng-${r?.reason ?? "unknown"}`;
      return;
    }
    for (const hit of r.results ?? []) hits.push({ ...hit, query: q });
  });

  const seen = new Set();
  for (const h of hits) {
    if (seen.has(h.url)) continue;
    seen.add(h.url);
    let host = "";
    try { host = new URL(h.url).hostname; } catch { continue; }
    const { locality } = resolveLocality({ title: `${h.title} ${host}`, text: h.content });
    if (STATE_NAMES[locality]) {                      // a real 2-letter code, never FED/ALL
      if (!buckets.has(locality)) buckets.set(locality, []);
      buckets.get(locality).push(h);
    } else {
      unbucketed.push(h);
    }
  }
  return { buckets, unbucketed };
}

// ---------- lane 3: warm leads ----------
/**
 * The localities where a kratom measure is actually pending, plus the bodies
 * that have already hosted a kratom item. This is the population where local
 * kratom ordinances happen and precisely what a big-city portal sweep misses —
 * the ordinance passes in a town of 9,000 whose agenda is a PDF.
 */
async function loadWarmSeeds() {
  const byKey = new Map();
  const add = (state, locality) => {
    const st = String(state ?? "").toUpperCase();
    const loc = String(locality ?? "").trim();
    if (!STATE_NAMES[st] || !loc) return;
    const key = `${st}|${loc.toLowerCase()}`;
    if (!byKey.has(key)) byKey.set(key, { state: st, locality: loc });
  };

  try {
    const { data } = await sb.from("locality_intel")
      .select("state, locality, legal_status, pending_count, swept_at")
      .or("pending_count.gt.0,legal_status.eq.pending_measure")
      .order("swept_at", { ascending: true, nullsFirst: true })   // rotate the backlog
      .limit(60);
    for (const r of data ?? []) add(r.state, r.locality);
  } catch { /* an optional lane must never sink the run */ }

  try {
    const { data } = await sb.from("municipal_meetings")
      .select("state, locality, body_name, meeting_at")
      .eq("kratom_relevance", "confirmed")
      .order("meeting_at", { ascending: false })
      .limit(60);
    for (const r of data ?? []) add(r.state, r.locality);
  } catch { /* ditto */ }

  return [...byKey.values()].slice(0, WARM_SEED_LIMIT);
}

// ---------- per-state discovery ----------
/**
 * One state (or the unbucketed pool, with `st = null`).
 *
 * Exactly ONE discoverMeetings call per state, whichever tier generated the
 * leads, so the run-scoped fetch dedupe, the concurrency pool and the
 * auto-publish fuse all apply once and from one implementation.
 */
async function runState(st, { stateName, seedCandidates = [], seeds = [], probe }) {
  const opts = {
    sb,
    scopeState: st,
    stateName,
    seeds,
    deadline,
    concurrency: CONCURRENCY,
    maxFetches: Math.min(PER_STATE_FETCHES, Math.max(0, MAX_FETCHES - counters.fetched)),
    dryRun: DRY_RUN,
    counters,
    probeResult: probe,
    stateLane: !!st && !GLOBAL_ONLY && !WARM_ONLY,
    localityLane: !!st && !GLOBAL_ONLY,
    via: "searxng_verified",
  };

  // The unbucketed pool has no state to ask a model about — it is a pure
  // verification pass over hits we already hold, so it skips the lead tier
  // entirely rather than spending a Gemini call on "meetings in United States".
  if (!st) {
    const d = await discoverMeetings({ ...opts, seedCandidates });
    return { status: d.status, reason: d.reason, rows: d.rows, agendaHits: d.agendaHits };
  }

  // The SearXNG lanes are wired in as groundedGenerate's SECOND grounding tier,
  // so a healthy Gemini key keeps its historical first slot and a depleted one
  // falls through in-process instead of failing the state. The engine has
  // already fetched, read and scored everything it returns — "ok" here means
  // CODE proved it, not that a model asserted it.
  let engine = null;
  const grounder = async () => {
    engine = await discoverMeetings({ ...opts, seedCandidates });
    // "empty" is a real answer (we looked, nothing was there). Only "blocked"
    // is a declination — mapping empty to ok:false would report every quiet
    // state as an outage.
    if (engine.status === "blocked") return { ok: false, reason: engine.reason };
    return { ok: true, provider: "searxng", parsed: { rows: engine.rows } };
  };

  let r;
  try {
    r = await groundedGenerate({
      system: LEAD_SYSTEM,
      user: leadPrompt(stateName),
      maxTokens: 2048,
      allowUngrounded: false,      // discovery without search is invention
      grounder,
    });
  } catch (e) {
    const msg = String(e.message ?? e);
    if (msg.startsWith("GROUNDING_UNAVAILABLE")) {
      // The engine's own reason when it ran, otherwise the joined attempt log —
      // which names every door that was shut, not just that one was.
      return { status: "blocked", reason: engine?.reason ?? msg.slice(0, 110), rows: [], agendaHits: engine?.agendaHits ?? 0 };
    }
    return { status: "error", reason: msg.slice(0, 90), rows: [], agendaHits: 0 };
  }

  if (r.provider !== "gemini") {
    return { status: engine?.status ?? "empty", reason: engine?.reason ?? null, rows: engine?.rows ?? [], agendaHits: engine?.agendaHits ?? 0 };
  }

  // Gemini answered, so the grounder never ran. Keep ONLY the URLs: the dates,
  // addresses and confidence numbers in that JSON are exactly what this rewrite
  // exists to stop trusting.
  const leadUrls = [
    ...(r.parsed?.urls ?? []),                                                 // a bare-URL answer
    ...(r.parsed?.meetings ?? []).flatMap((m) => [m?.source_url, m?.agenda_url]),
  ].filter(isHttpUrl);
  const leadSet = new Set(leadUrls);

  // DEVIATION from a literal reading of §5: the state's own SearXNG lanes still
  // run on this path. A Gemini answer of {"meetings":[]} is one provider's
  // opinion, not evidence that the state has no meetings, and reporting the
  // state as "empty" on that basis would re-create the exact failure this PR
  // exists to end — a green run in which nothing was actually searched. §7's
  // budget (102 state queries) assumes the state lane runs regardless.
  const d = await discoverMeetings({
    ...opts,
    seedCandidates: [...seedCandidates, ...leadUrls.map((u) => ({ url: u, title: "", content: "" }))],
  });
  // Per-URL provenance: the engine tags a whole call, but within this call the
  // Gemini leads and our own hits have different origins and the row must say
  // which one found it.
  const rows = d.rows.map((row) => (leadSet.has(row.fetchedUrl) ? { ...row, via: "gemini_lead_verified" } : row));
  return { status: d.status, reason: d.reason, rows, agendaHits: d.agendaHits };
}

// ---------- write path ----------
/**
 * INSERT first, then a targeted ENRICH on the dedupe collision. Never an upsert:
 * upsert would overwrite moderation_status, which is how a meeting an admin
 * REJECTED walks back onto the calendar on the next nightly run.
 *
 * @returns {Promise<"new"|"enriched"|"dup"|"error"|"dry">}
 */
async function persist(row) {
  const payload = {
    state: row.state,                                      // from the fetched page, never the search bucket
    locality: `${placeNameOf(row.place)}, ${row.state}`,   // canonical, so ux_municipal_meetings_dedupe actually dedupes
    body_name: row.body_name ?? null,
    meeting_at: row.meetingAtIso,
    format: ["in_person", "virtual", "hybrid", "unknown"].includes(row.format) ? row.format : "unknown",
    zoom_url: row.zoom_url,
    livestream_url: row.livestream_url,
    in_person_address: row.in_person_address,
    public_comment_signup_url: row.public_comment_signup_url,
    // Not truncated. The column is unbounded text and a URL cut at 500 chars is
    // a source_url that 404s — auto-approve-meetings only checks that it is
    // non-empty, so a truncated one publishes as proof of nothing.
    agenda_url: row.fetchedUrl,
    source_url: row.fetchedUrl,
    agenda_text: row.quote.slice(0, 1000),
    discovered_via: row.via,                               // searxng_verified | gemini_lead_verified
    ai_confidence: row.confidence,                         // scoreMeetingEvidence ONLY
    ai_notes: `engine=${row.engineProvider} tier=${row.tier} domain=${registrableDomain(row.fetchedUrl)}`
      + ` item_context=${row.itemContext} date_source=${row.dateSource}`
      + ` tz=${row.tzUsed}${row.tzAssumed ? ` (state default${row.tzAmbiguousState ? ", split-zone state" : ""})` : ""}`
      + ` quote_verified=true query=${(row.query ?? "").slice(0, 80)} · ${row.reason}`,
  };

  if (DRY_RUN) return "dry";

  const { error } = await sb.from("municipal_meetings").insert(payload);
  if (!error) return "new";
  if (error.code !== "23505") {
    console.log(`    ✗ db insert: ${error.message?.slice(0, 80)}`);
    return "error";
  }

  // 23505 = the dedupe index fired: this meeting is already known. Fill in what
  // the earlier pass lacked — every column below is either agenda provenance or
  // a contact field we lifted off the page we just read.
  const enrichable = {};
  for (const k of ["body_name", "zoom_url", "livestream_url", "in_person_address",
    "public_comment_signup_url", "agenda_url", "source_url", "agenda_text",
    "discovered_via", "ai_notes"]) {
    if (payload[k] !== null && payload[k] !== undefined && payload[k] !== "") enrichable[k] = payload[k];
  }
  // "unknown" is the absence of a format, not a format — writing it over an
  // existing "hybrid" would delete a fact to record a non-fact.
  if (payload.format !== "unknown") enrichable.format = payload.format;

  const { data: touched, error: upErr } = await sb.from("municipal_meetings")
    .update(enrichable)
    .eq("state", payload.state)
    .eq("locality", payload.locality)
    .eq("meeting_at", payload.meeting_at)
    // The whole point of the targeted update: an approved or rejected row is a
    // HUMAN decision and this script does not get to touch it.
    .eq("moderation_status", "pending_review")
    .select("id");
  if (upErr) {
    console.log(`    ✗ db enrich: ${upErr.message?.slice(0, 80)}`);
    return "error";
  }
  if (!touched?.length) return "dup";        // already moderated — the guard doing its job

  // Confidence moves UP only. A row we independently verified at 0.90 has
  // earned it (matching on state + locality + exact instant means a second,
  // separately-fetched page said the same thing), but a weaker pass tonight
  // must never walk back a stronger one from yesterday.
  await sb.from("municipal_meetings")
    .update({ ai_confidence: payload.ai_confidence })
    .eq("state", payload.state)
    .eq("locality", payload.locality)
    .eq("meeting_at", payload.meeting_at)
    .eq("moderation_status", "pending_review")
    .or(`ai_confidence.is.null,ai_confidence.lt.${payload.ai_confidence}`);
  return "enriched";
}

// ---------- main ----------
let targets;
if (STATE) {
  targets = [STATE.toUpperCase()];
} else if (PRIORITY_ONLY && !ALL_STATES) {
  targets = PRIORITY_STATES;
} else {
  // Default is still all 51, so the cron's behaviour is unchanged — but
  // --all-states now actually overrides --priority-only instead of agreeing
  // with the default by luck.
  // Priority states first, the rest rotated by day-of-year. The fetch and
  // wall-clock budgets usually stop the run before the tail, so a fixed
  // alphabetical order would mean Wyoming is never actually scanned.
  const rest = Object.keys(STATE_NAMES).filter((s) => !PRIORITY_STATES.includes(s));
  const doy = Math.floor((Date.now() - Date.UTC(new Date().getUTCFullYear(), 0, 0)) / 86_400_000);
  const cut = rest.length ? doy % rest.length : 0;
  targets = [...PRIORITY_STATES, ...rest.slice(cut), ...rest.slice(0, cut)];
}

const mode = [ALL_STATES ? "all-states" : null, GLOBAL_ONLY ? "global-only" : null, WARM_ONLY ? "warm-only" : null, DRY_RUN ? "DRY RUN" : null]
  .filter(Boolean).join(" · ");
console.log(`Discovering municipal meetings across ${targets.length} state(s)${mode ? ` [${mode}]` : ""}…`);
console.log(`  budget: ${MAX_MINUTES} min · ${MAX_FETCHES} fetches\n`);

// One probe per RUN. A dead instance then blocks every state without spending a
// single query proving it again.
const probe = searxngConfigured() ? await searxngProbe() : { ok: false, reason: "unconfigured", resultCount: 0 };
if (!probe.ok) {
  firstBlockReason ??= `searxng-${probe.reason}`;
  console.log(`⛔ SearXNG probe failed (${probe.reason}) — verification is unavailable this run.\n`);
}

const { buckets, unbucketed } = WARM_ONLY ? { buckets: new Map(), unbucketed: [] } : await runGlobalLane(probe);
if (!WARM_ONLY) {
  console.log(`Global portal lane: ${[...buckets.values()].reduce((n, v) => n + v.length, 0)} bucketed hit(s) across ${buckets.size} state(s), ${unbucketed.length} unbucketed.\n`);
}

const warm = GLOBAL_ONLY ? [] : await loadWarmSeeds();
const warmByState = new Map();
for (const w of warm) {
  if (!warmByState.has(w.state)) warmByState.set(w.state, []);
  warmByState.get(w.state).push(w);
}
if (warm.length) console.log(`Warm leads: ${warm.length} localit(ies) with a pending measure or a confirmed kratom body.\n`);

let blocked = 0, errored = 0, writeErrors = 0, agendaHits = 0, rowsNew = 0, rowsEnriched = 0, done = 0, budgetStopped = false;

/**
 * Write one state's verified rows and tally them. Write failures are COUNTED,
 * not just logged: a run that verified ten meetings and could not persist any
 * of them has done nothing, and without this counter it reports "empty" —
 * indistinguishable from a quiet night.
 */
async function persistAll(rows) {
  let made = 0, enriched = 0;
  for (const row of rows) {
    const out = await persist(row);
    if (out === "new") made++;
    else if (out === "enriched") enriched++;
    else if (out === "error") writeErrors++;
  }
  rowsNew += made;
  rowsEnriched += enriched;
  return { made, enriched };
}

for (const st of targets) {
  if (Date.now() > deadline) { budgetStopped = true; console.log(`  ⏱ wall-clock budget (${MAX_MINUTES}m) reached — stopping cleanly`); break; }
  if (counters.fetched >= MAX_FETCHES) { budgetStopped = true; console.log(`  ⏱ fetch budget (${MAX_FETCHES}) reached — stopping cleanly`); break; }
  const stateName = STATE_NAMES[st];
  if (!stateName) { console.log(`  ${st}: · unknown state`); continue; }

  process.stdout.write(`  ${st}: `);
  const r = await runState(st, {
    stateName,
    seedCandidates: buckets.get(st) ?? [],
    seeds: warmByState.get(st) ?? [],
    probe,
  });
  done++;
  agendaHits += r.agendaHits ?? 0;

  if (r.status === "blocked") {
    blocked++;
    firstBlockReason ??= r.reason;
    console.log(`⛔ ${r.reason}`);
    continue;
  }
  if (r.status === "error") { errored++; console.log(`✗ ${r.reason}`); continue; }

  const { made, enriched } = await persistAll(r.rows);
  if (r.rows.length) {
    const pub = r.rows.filter((x) => x.publishable).length;
    console.log(`✓ ${r.rows.length} verified, ${made} new, ${enriched} enriched${pub ? `, ${pub} auto-publishable` : ""}`);
  } else {
    console.log("· nothing on agendas");
  }
}

// The unbucketed pool runs LAST, with no scope state: these are portal hits
// whose state the title and host could not pin, so the fetched page is the only
// thing that can. Running them under a guessed bucket would trip the gazetteer
// gate and throw away exactly the leads this pool exists to rescue.
if (unbucketed.length && Date.now() <= deadline && counters.fetched < MAX_FETCHES) {
  process.stdout.write(`  ··: `);
  const r = await runState(null, {
    stateName: "United States",
    seedCandidates: unbucketed,
    seeds: [],
    probe,
  });
  agendaHits += r.agendaHits ?? 0;
  if (r.status === "blocked") { blocked++; firstBlockReason ??= r.reason; console.log(`⛔ ${r.reason}`); }
  else if (r.status === "error") { errored++; console.log(`✗ ${r.reason}`); }
  else {
    const { made, enriched } = await persistAll(r.rows);
    console.log(r.rows.length ? `✓ ${r.rows.length} verified, ${made} new, ${enriched} enriched (unbucketed)` : "· nothing on agendas (unbucketed)");
  }
}

const elapsed = ((Date.now() - t0) / 1000 / 60).toFixed(1);
console.log(`\nDone in ${elapsed} min — ${counters.searched} searches (${counters.searchFailed} failed) · ${counters.fetched} fetched · ${agendaHits} agenda hits · ${counters.skippedNonAuthoritative ?? 0} non-official skipped · ${counters.readerFailed} reader failures`);
if (topRejects(counters.rejectReasons)) console.log(`  rejected by gate: ${topRejects(counters.rejectReasons, 8)}`);
console.log(`  ${rowsNew} new · ${rowsEnriched} enriched · ${counters.autoPublished} auto-publishable${DRY_RUN ? " [DRY RUN — nothing written]" : ""}`);
if (blocked > 0) {
  console.log(`⛔ ${blocked}/${done} states could NOT be searched or read (${firstBlockReason}).`);
  console.log('   This is NOT "no meetings exist" — it is "we were unable to look".');
}

try {
  await sb.from("scraper_runs").insert({
    source: "discover_municipal_meetings",   // three registries key off this exact string
    started_at: new Date(t0).toISOString(),
    finished_at: new Date().toISOString(),
    // A run that fetched NOTHING verified nothing, whatever the models said.
    // verify-local-bans' all-queued rule: that has to go red, not green forever.
    status: (blocked >= targets.length || counters.fetched === 0) ? "error"
      : (blocked > 0 || errored > 0 || writeErrors > 0) ? "partial"
        : rowsNew > 0 ? "success"
          : "empty",
    rows_added: rowsNew,
    rows_updated: rowsEnriched,
    error_message: blocked > 0
      ? `grounding unavailable for ${blocked}/${targets.length} states — ${firstBlockReason}`
      : null,
    notes: `${targets.length} states · ${counters.searched} searches (${counters.searchFailed} failed) · ${counters.fetched} fetched`
      + ` · ${agendaHits} agenda hits · ${counters.skippedNonAuthoritative ?? 0} non-official skipped · ${counters.readerFailed} reader failures · ${rowsNew} new · ${rowsEnriched} enriched`
      + ` · ${counters.autoPublished} auto-publishable`
      + (topRejects(counters.rejectReasons) ? ` · rejected: ${topRejects(counters.rejectReasons)}` : "")
      + (blocked ? ` · ${blocked} BLOCKED (could not search)` : "")
      + (writeErrors ? ` · ${writeErrors} WRITE ERRORS` : "")
      + (budgetStopped ? ` · budget stop after ${done}/${targets.length}` : "")
      + (DRY_RUN ? " [dry-run]" : ""),
  });
} catch { /* best-effort */ }

/**
 * The reject tally, most common first — e.g. "no-in-window-date 14, archive 6".
 *
 * Runs on 09-18 and 09-19 read "29 agenda hits · 0 new" and stopped there, so
 * "there are no kratom meetings this week" and "we reject every page we fetch"
 * produced an identical line. The reason strings already existed on every
 * reject; they were simply thrown away. Capped so the notes column stays
 * readable.
 */
function topRejects(reasons, max = 4) {
  const rows = Object.entries(reasons ?? {}).sort((a, b) => b[1] - a[1]).slice(0, max);
  return rows.length ? rows.map(([r, n]) => `${r} ${n}`).join(", ") : "";
}

// Unconditional: the watchlist re-check is a later step in the SAME CI job, and
// a non-zero exit here would skip it. scraper_runs.status is the monitored
// signal, not the process exit code.
process.exit(0);
