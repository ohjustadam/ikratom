#!/usr/bin/env node
/**
 * Generate an AI-synthesized field-work briefing for one (or all) states.
 *
 * Pulls together everything the advocate needs to take action on kratom
 * policy in their state:
 *   - Active bills (anti + pro) with sponsors + status + last action
 *   - BoP source status + recent findings
 *   - Recent news (verified, last 30 days)
 *   - Active campaigns
 *   - Legislator counts by role
 *   - State capital info
 *
 * Asks the AI router (cooldown-aware, JSON-mode) to synthesize the
 * raw data into a structured markdown briefing with these sections:
 *   1. Snapshot — one-line summary of where the state stands
 *   2. Active legislation — every anti+pro bill with status + last action
 *   3. Board of Pharmacy — administrative-rule status
 *   4. Field-work tactical — concrete steps for an advocate doing work
 *   5. Capital info — where to go, when in session
 *   6. Recent news context — last 30 days
 *   7. Open questions — what we don't know (signals where help compounds)
 *
 * Output is stored in the state_briefings table. The old active briefing
 * for the state (if any) is marked is_active=false in the same transaction.
 *
 * Run:
 *   node --env-file=.env.local scripts/generate-state-briefing.mjs --state NY
 *   node --env-file=.env.local scripts/generate-state-briefing.mjs --all-states
 *   node --env-file=.env.local scripts/generate-state-briefing.mjs --state NY --dry-run
 *   node --env-file=.env.local scripts/generate-state-briefing.mjs --state NY --provider groq
 */
import { createClient } from "@supabase/supabase-js";
import { aiRouter, listAvailableProviders } from "./lib/ai-router.mjs";

const args = process.argv.slice(2);
const arg = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const STATE = arg("--state");
const ALL_STATES = args.includes("--all-states");
const DRY_RUN = args.includes("--dry-run");
const PROVIDER_OVERRIDE = arg("--provider");

if (!STATE && !ALL_STATES) {
  console.error("Usage: --state <2-letter>  OR  --all-states  (optionally --dry-run, --provider)");
  process.exit(1);
}

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_KEY) { console.error("Missing Supabase env"); process.exit(1); }
const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

const SYSTEM = `You write field-work briefings for the iKratom advocacy platform.

You will be given the raw platform data for ONE U.S. state. Your job is to
synthesize it into a TIGHT, ACTIONABLE markdown briefing for advocates
doing real-world work in that state — visiting their capital, meeting
with their legislators, attending public hearings, organizing locally.

The reader is an advocate, not a lawyer. They want to know:
  - What is moving right now? (bills, BoP rules, court actions)
  - Who do I talk to? (key sponsors, committee chairs, allies, opponents)
  - When and where? (capital, session dates, hearing schedule)
  - What works? (talking points that landed in this state, common pushbacks)

Return a JSON object with a single field "body_md" whose value is a string
containing the full markdown briefing. Example shape (DO NOT copy the
content — write your own based on the data provided):

  {"body_md": "## Snapshot\n\nNew York currently has...\n\n## Active legislation\n\n..."}

The body_md string MUST use these section headers exactly:

## Snapshot

(One paragraph: where does this state stand on kratom right now? Active
threats, recent wins, who is paying attention. 3-5 sentences.)

## Active legislation

(For each active anti/pro bill provided: bill number · title · status ·
last action date · primary sponsor (if known). Group anti vs pro. Note
any 7-OH-specific vs natural-leaf distinctions. If zero bills, say so
clearly and move on.)

## Board of Pharmacy / administrative

(Status of the state Board of Pharmacy as an actor. Are they monitoring
kratom? Have they scheduled any agenda items? If no sources are
configured, say so honestly — that's a data gap, not "all clear.")

## Field-work tactical

(Concrete advocate actions. Where to find sympathetic ears, what
arguments work in THIS state given the data above, common pushbacks
the AG/BoP/legislators have used. Pull specifics from the bill titles
and recent news — don't be generic.)

## Capital + access

(Where is the state capital. When is the legislature in session this
year if you know. How to request a meeting. Public hearing access notes.
If you don't have specifics, give the generic process briefly.)

## Recent news context

(Bullet list of 3-5 most relevant news items from the last 30 days. Title
+ source + 1-line significance. Skip if no notable news.)

## Open questions

(What we DON'T know that an organized local advocate could help fill in.
Examples: "BoP source not configured — does NY have a regulatory body
agenda worth monitoring?" "Zero municipal officials on file — which
city councils are most likely to act?")

KEEP IT TIGHT. Total target: 600-900 words. No filler. The reader has
limited time and is going to print this and bring it to the capital.

ALWAYS distinguish natural-leaf kratom from 7-OH-enriched / synthetic
products when discussing bills. Never use "kratom" as a blanket term
for synthetics — many bills only target the latter.

Return ONLY the JSON object. No prose around it, no markdown fences.`;

function buildUserPrompt(data) {
  // Cap to most-recent 15 bills + primary sponsor only (cosponsors omitted
  // for prompt budget; admin can see full list at /bills/[id])
  const billLines = data.bills.length === 0 ? "  (none)" : data.bills.slice(0, 15).map(b => {
    const primary = (b.sponsors ?? []).find(s => s.classification === "primary");
    const cosponsorCount = (b.sponsors ?? []).filter(s => s.classification !== "primary").length;
    const sponsorSummary = primary
      ? `    primary: ${primary.name}${primary.party ? ` [${primary.party}]` : ""}${cosponsorCount > 0 ? ` + ${cosponsorCount} cosponsor(s)` : ""}`
      : "    sponsors: (not yet synced)";
    return `  ${b.bill_number} [${b.kratom_relevance}] status=${b.status ?? "?"} last=${(b.last_action_at ?? "?").slice(0,10)}\n    title: ${(b.title ?? "?").slice(0, 110)}\n${sponsorSummary}`;
  }).join("\n") + (data.bills.length > 15 ? `\n  ... +${data.bills.length - 15} older bills omitted` : "");

  const capitalSection = data.capital ? `\nSTATE CAPITAL (hand-curated):
  City: ${data.capital.capital_city}
  Address: ${data.capital.capital_address ?? "?"}
  Current session: ${data.capital.current_session_id ?? "?"} (${data.capital.current_session_start ?? "?"} → ${data.capital.current_session_end ?? "?"})
  Public comment URL: ${data.capital.public_comment_url ?? "?"}
  Hearing schedule URL: ${data.capital.hearing_schedule_url ?? "?"}
  Staff directory: ${data.capital.staff_directory_url ?? "?"}
${data.capital.notes_md ? `  ADMIN FIELD-WORK NOTES (use verbatim where relevant):\n${data.capital.notes_md}` : ""}` : `
STATE CAPITAL: (no row in state_capital_info — admin has not curated yet)
`;

  // Group stances by category, surface non-unknown most prominently
  const stanceGroups = { champion: [], sympathetic: [], hostile: [], neutral: [], unknown: [] };
  for (const s of data.stances ?? []) {
    if (stanceGroups[s.stance]) stanceGroups[s.stance].push(s);
  }
  // Cap rationale length to keep prompt within provider input budgets.
  // Champions + hostiles get full rationale (they matter most), sympathetic
  // gets short rationale, neutral/unknown just names + counts.
  const renderFull = s => `${s.legislators?.full_name ?? "?"} (${s.legislators?.role ?? "?"}${s.legislators?.district ? ` · D${s.legislators.district}` : ""}) — ${(s.rationale_md ?? "").slice(0, 180)}`;
  const renderShort = s => `${s.legislators?.full_name ?? "?"}${s.legislators?.district ? ` (D${s.legislators.district})` : ""}`;
  const stanceSection = (data.stances ?? []).length === 0
    ? `\nLEGISLATOR STANCES (AI-drafted): (none drafted yet)`
    : `\nLEGISLATOR STANCES (AI-drafted, admin-reviewable at /admin/stance):
  CHAMPIONS (${stanceGroups.champion.length}):${stanceGroups.champion.length === 0 ? " (none yet)" : "\n" + stanceGroups.champion.slice(0, 5).map(s => "    - " + renderFull(s)).join("\n")}
  HOSTILE (${stanceGroups.hostile.length}):${stanceGroups.hostile.length === 0 ? " (none yet)" : "\n" + stanceGroups.hostile.slice(0, 5).map(s => "    - " + renderFull(s)).join("\n")}
  SYMPATHETIC (${stanceGroups.sympathetic.length}):${stanceGroups.sympathetic.length === 0 ? " (none yet)" : " " + stanceGroups.sympathetic.slice(0, 12).map(renderShort).join(" · ")}
  NEUTRAL: ${stanceGroups.neutral.length}  ·  Unknown: ${stanceGroups.unknown.length}`;

  // Committee chairs of kratom-relevant committees — most leverage targets
  const chairRows = (data.committees ?? []).filter(c => c.role === "chair");
  const committeeSection = chairRows.length === 0
    ? `\nKRATOM-RELEVANT COMMITTEE CHAIRS: (committee data not yet scraped for this state)`
    : `\nKRATOM-RELEVANT COMMITTEE CHAIRS (${chairRows.length}; these are the decision-makers — bills die in their committees):
${chairRows.map(c => `  ${c.chamber.toUpperCase()} · ${c.committee_name}: chair = ${c.legislators?.full_name ?? "?"} (${c.legislators?.district ? "district " + c.legislators.district : "?"})`).join("\n")}`;

  return `STATE: ${data.state} (${data.stateName || data.state})

LEGISLATOR COVERAGE:
  Total active in our directory: ${data.legCount}
  Roles: ${Object.entries(data.legByRole).map(([k,v]) => `${k}=${v}`).join(", ")}
  Stale (>30d since sync): ${data.legStale}
  Missing contact: ${data.legNoContact}

ACTIVE BILLS (${data.bills.length} total — each row includes the primary sponsor + cosponsors. Name the primary sponsor in your Active legislation section so advocates know who to email first):
${billLines}
${capitalSection}
BOARD OF PHARMACY:
  Sources configured: ${data.bopSrcCount}
  Findings logged: ${data.bopFindingCount}
${data.bopSrc.length === 0 ? "  WARNING: No BoP source URL is configured. The state may not have one, OR we may simply not have onboarded it yet — admin should investigate." : data.bopSrc.map(s => `  - ${s.board_name}: ${s.agenda_url} (last scrape: ${s.last_scraped_at ?? "never"}, status: ${s.last_status ?? "?"})${s.notes ? `\n    notes: ${s.notes.slice(0, 200)}` : ""}`).join("\n")}

CAMPAIGNS:
  Active: ${data.campAct.length} - ${data.campAct.map(c => c.title).slice(0, 3).join(" / ") || "(none)"}
  Pending review: ${data.campPending}

RECENT NEWS (last 30 days, body-verified, deduplicated):
${data.news.length === 0 ? "  (none in last 30 days)" : data.news.map(n => `  - ${(n.published_at ?? "").slice(0, 10)} · ${n.source_name ?? "?"} · ${n.title}`).join("\n")}
${committeeSection}
${stanceSection}

STATE STATUS (from states table):
  kratom_status: ${data.stateStatus ?? "(unset)"}
  notes: ${data.stateNotes ?? "(none)"}

MUNICIPAL OFFICIALS ON FILE:
  ${data.municipalCount} (city councils, mayors) — anything below ~5 means we don't have meaningful local coverage yet.

Synthesize this into the briefing. Name primary bill sponsors when discussing each bill. Use capital + scheduling info verbatim when relevant. Quote admin stance rationales when listing champions/hostiles.`;
}

async function loadStateData(state) {
  // Parallel data fetch — includes capital info, sponsors, stances, committees
  const [
    stateRow, capitalRow, legsAll, bills, bopSrc, bopFindings, news, camps,
    stanceRows, committeeRows,
  ] = await Promise.all([
    sb.from("states").select("abbr, name, kratom_status, notes").eq("abbr", state).maybeSingle(),
    sb.from("state_capital_info")
      .select("capital_city, capital_address, current_session_id, current_session_start, current_session_end, public_comment_url, hearing_schedule_url, staff_directory_url, notes_md")
      .eq("state", state).maybeSingle(),
    sb.from("legislators")
      .select("id, role, level, full_name, district, last_synced_at, email, phone, party")
      .eq("state", state).eq("active", true).limit(2000),
    sb.from("bills")
      .select("id, bill_number, title, summary, summary_ai, kratom_relevance, status, last_action_at, targets_natural_leaf, targets_synthetic_only")
      .eq("state", state).eq("active", true).in("kratom_relevance", ["anti", "pro", "neutral"])
      .order("last_action_at", { ascending: false, nullsFirst: false })
      .limit(30),
    sb.from("bop_sources").select("board_name, agenda_url, last_scraped_at, last_status, notes").eq("state", state),
    sb.from("bop_findings").select("id", { count: "exact", head: true }).eq("state", state),
    sb.from("news_items")
      .select("title, source_name, published_at, url")
      .eq("state", state).eq("active", true)
      .is("duplicate_of", null)
      .not("body_has_kratom_keyword", "is", false)
      .gte("published_at", new Date(Date.now() - 30 * 86400000).toISOString())
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(10),
    sb.from("campaigns")
      .select("id, title, active, review_state").eq("state", state),
    // Per-legislator kratom stance (champion / hostile / etc) joined to legislators
    sb.from("legislator_kratom_stance")
      .select("legislator_id, stance, rationale_md, last_evidence_url, legislators!inner(full_name, role, district, state)")
      .eq("legislators.state", state),
    // Kratom-relevant committee chairs in this state
    sb.from("legislator_committees")
      .select("committee_name, chamber, role, legislator_id, legislators!inner(full_name, role, district, state)")
      .eq("legislators.state", state)
      .eq("is_kratom_relevant", true)
      .eq("session_id", "2025-2026"),
  ]);

  // Sponsors: pull all rows for these specific bills + their resolved legislator names.
  const billIds = (bills.data ?? []).map(b => b.id);
  let sponsors = [];
  if (billIds.length > 0) {
    const { data: spRows } = await sb.from("bill_sponsors")
      .select("bill_id, name, classification, party, district, legislator_id")
      .in("bill_id", billIds);
    sponsors = spRows ?? [];
  }
  // Group sponsors by bill
  const sponsorsByBill = new Map();
  for (const s of sponsors) {
    if (!sponsorsByBill.has(s.bill_id)) sponsorsByBill.set(s.bill_id, []);
    sponsorsByBill.get(s.bill_id).push(s);
  }

  const legByRole = {};
  let legStale = 0, legNoContact = 0, municipalCount = 0;
  for (const r of legsAll.data ?? []) {
    legByRole[r.role] = (legByRole[r.role] ?? 0) + 1;
    if (!r.last_synced_at || new Date(r.last_synced_at).getTime() < Date.now() - 30 * 86400000) legStale++;
    if (!r.email && !r.phone) legNoContact++;
    if (r.level === "municipal") municipalCount++;
  }

  // Annotate each bill with its sponsor list
  const billsWithSponsors = (bills.data ?? []).map(b => ({
    ...b,
    sponsors: sponsorsByBill.get(b.id) ?? [],
  }));

  return {
    state,
    stateName: stateRow.data?.name ?? state,
    stateStatus: stateRow.data?.kratom_status ?? null,
    stateNotes: stateRow.data?.notes ?? null,
    capital: capitalRow.data ?? null,
    legCount: legsAll.data?.length ?? 0,
    legByRole,
    legStale,
    legNoContact,
    municipalCount,
    bills: billsWithSponsors,
    bopSrc: bopSrc.data ?? [],
    bopSrcCount: bopSrc.data?.length ?? 0,
    bopFindingCount: bopFindings.count ?? 0,
    news: news.data ?? [],
    campAct: (camps.data ?? []).filter(c => c.active),
    campPending: (camps.data ?? []).filter(c => c.review_state === "pending_review").length,
    stances: stanceRows.data ?? [],
    committees: committeeRows.data ?? [],
  };
}

async function generateOne(state) {
  const tag = `[${state}]`;
  process.stdout.write(`${tag} loading data… `);
  const data = await loadStateData(state);
  console.log(`${data.legCount} legs · ${data.bills.length} bills · ${data.news.length} news · ${data.bopSrcCount} BoP sources`);

  if (DRY_RUN) {
    console.log(`${tag} DRY RUN — prompt would be:\n${buildUserPrompt(data).slice(0, 600)}\n…`);
    return { state, status: "dry" };
  }

  const userPrompt = buildUserPrompt(data);
  process.stdout.write(`${tag} generating via AI (prompt ${userPrompt.length} chars)… `);
  let result;
  try {
    result = await aiRouter({
      systemPrompt: SYSTEM,
      userPrompt,
      maxTokens: 2400,
      providerOverride: PROVIDER_OVERRIDE,
      verbose: true,
    });
  } catch (e) {
    console.log(`✗ AI: ${e.message?.slice(0, 80)}`);
    return { state, status: "ai-error", error: e.message };
  }
  const body = (result.parsed?.body_md ?? "").trim();
  if (!body || body.length < 200) {
    // Some providers return JSON schema fragments ({"type":"object"}) instead
    // of valid responses under JSON-mode + large prompts. The router will
    // already have tried multiple providers; surface what we got for debug.
    console.log(`✗ empty/short response (${body.length} chars) from ${result.provider}`);
    console.log(`  parsed=${JSON.stringify(result.parsed).slice(0, 200)}`);
    return { state, status: "empty" };
  }
  console.log(`✓ ${body.length} chars via ${result.provider}`);

  // Atomic swap: deactivate old + insert new
  await sb.from("state_briefings").update({ is_active: false }).eq("state", state).eq("is_active", true);
  const { error: insertErr, data: row } = await sb.from("state_briefings").insert({
    state,
    body_md: body,
    generated_by_provider: result.provider ?? "unknown",
    data_snapshot: {
      legCount: data.legCount,
      billCount: data.bills.length,
      newsCount: data.news.length,
      bopSrcCount: data.bopSrcCount,
      campActiveCount: data.campAct.length,
    },
    is_active: true,
  }).select("id").single();
  if (insertErr) {
    console.log(`${tag} ✗ DB: ${insertErr.message}`);
    return { state, status: "db-error", error: insertErr.message };
  }
  return { state, status: "ok", id: row.id, provider: result.provider, chars: body.length };
}

const STATE_LIST = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN",
  "IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH",
  "NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT",
  "VT","VA","WA","WV","WI","WY",
];

console.log(`Providers available: ${listAvailableProviders().join(", ")}\n`);

// Gating: --all-states honors states.briefing_gen_enabled. Explicit
// --state overrides the gate (admin can manually regenerate any state).
// This lets owner hand-tune NY before unlocking the other 50.
let targets;
if (STATE) {
  targets = [STATE.toUpperCase()];
} else {
  const { data: enabled } = await sb.from("states")
    .select("abbr")
    .eq("briefing_gen_enabled", true);
  const enabledSet = new Set((enabled ?? []).map(r => r.abbr));
  targets = STATE_LIST.filter(s => enabledSet.has(s));
  console.log(`--all-states: ${targets.length} of ${STATE_LIST.length} states have briefing_gen_enabled=true`);
  console.log(`  Enabled: ${targets.join(", ") || "(none)"}\n`);
  if (targets.length === 0) {
    console.log("No states enabled. Toggle in DB: UPDATE states SET briefing_gen_enabled=true WHERE abbr='XX'");
    process.exit(0);
  }
}
const t0 = Date.now();
const results = [];
for (const s of targets) {
  const r = await generateOne(s);
  results.push(r);
  // Polite delay between AI calls
  if (!DRY_RUN) await new Promise(r => setTimeout(r, 1500));
}

const ok = results.filter(r => r.status === "ok").length;
const errored = results.filter(r => r.status?.includes("error")).length;
const elapsed = ((Date.now() - t0) / 1000 / 60).toFixed(1);
console.log(`\nDone in ${elapsed} min — ok=${ok} errored=${errored}/${results.length}`);

try {
  await sb.from("scraper_runs").insert({
    source: "generate_state_briefing",
    started_at: new Date(t0).toISOString(),
    finished_at: new Date().toISOString(),
    status: errored > results.length / 2 ? "error" : "success",
    rows_added: ok,
    notes: `${ok} generated, ${errored} errored` + (STATE ? ` (state=${STATE})` : " (all states)"),
  });
} catch { /* best-effort */ }

// Flush OG cache for each regenerated briefing so social-share previews
// reflect the new content. Fire-and-forget.
const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://www.ikratom.org";
const FB_TOKEN = process.env.FB_APP_ACCESS_TOKEN;
const flushedUrls = results.filter(r => r.status === "ok").map(r => `${appUrl}/briefings/state/${r.state}`);
await Promise.allSettled(flushedUrls.map(async (url) => {
  try {
    if (FB_TOKEN) {
      const params = new URLSearchParams({ id: url, scrape: "true", access_token: FB_TOKEN });
      await fetch(`https://graph.facebook.com/v18.0/?${params}`, { method: "POST", signal: AbortSignal.timeout(8_000) });
    } else {
      await fetch(url, {
        headers: { "User-Agent": "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)", Accept: "text/html" },
        signal: AbortSignal.timeout(8_000),
      });
    }
  } catch { /* best-effort */ }
}));
if (flushedUrls.length > 0) {
  console.log(`OG cache flushed for ${flushedUrls.length} briefing URL(s)${FB_TOKEN ? " (authenticated)" : " (UA pre-warm)"}`);
}

process.exit(0);
