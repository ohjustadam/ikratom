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
// Self-critique loop (Phase 3 D5): generate draft → DeepSeek R1 critique →
// revise if flagged. Default on (1 revision pass). Use --no-critique for
// the old single-pass behavior, --max-revisions N to allow more rounds.
const NO_CRITIQUE = args.includes("--no-critique");
const MAX_REVISIONS = Math.max(0, Math.min(3, parseInt(arg("--max-revisions") ?? "1", 10) || 0));

if (!STATE && !ALL_STATES) {
  console.error("Usage: --state <2-letter>  OR  --all-states  (optionally --dry-run, --provider, --no-critique, --max-revisions N)");
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

  // Court litigation section is built by a helper (after this
  // function — keeps the inline prompt build readable).

  // State-level lobbyist registrations (Phase 3 D2). Active rows are the
  // present-day signal; historical rows give context on industry attention.
  // Currently only Utah is scraped — other states show "(no state lobbying
  // disclosures scraped yet — pilot started with UT)".
  const lobbyists = data.stateLobbyists ?? [];
  const activeLob = lobbyists.filter(r => !r.end_date);
  const formerLob = lobbyists.filter(r => r.end_date);
  let stateLobbyingSection;
  if (lobbyists.length === 0) {
    // Distinguish "no data scraped" from "we scraped and found nothing" —
    // currently we only run a scraper for UT.
    stateLobbyingSection = data.state === "UT"
      ? `\nSTATE LOBBYING REGISTRATIONS (lobbyist.utah.gov): no kratom-industry lobbyists found on most recent scrape.`
      : `\nSTATE LOBBYING REGISTRATIONS: (no state-lobbying disclosures scraped yet — Phase 3 D2 pilot started with UT; this state is queued.)`;
  } else {
    // Group active rows by principal so the advocate sees "AKA has 7
    // people working you" not "Mac Haddow + Matt Holton + Spencer Stokes
    // + ...".
    const byPrincipal = new Map();
    for (const r of activeLob) {
      if (!byPrincipal.has(r.principal_name)) byPrincipal.set(r.principal_name, []);
      byPrincipal.get(r.principal_name).push(r);
    }
    const activeLines = [...byPrincipal.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([principal, rows]) => {
        const lobNames = rows.slice(0, 8).map(r => `${r.lobbyist_name} (since ${(r.start_date ?? "?").slice(0, 7)})`).join("; ");
        return `  ${principal}: ${rows.length} active lobbyist${rows.length === 1 ? "" : "s"} — ${lobNames}`;
      }).join("\n");
    const formerCount = formerLob.length;
    stateLobbyingSection = `\nSTATE LOBBYING REGISTRATIONS (kratom industry, public disclosures):
  ACTIVE (${activeLob.length} registrations across ${byPrincipal.size} principal${byPrincipal.size === 1 ? "" : "s"}):
${activeLines || "  (no currently active kratom-industry lobbyists)"}${formerCount > 0 ? `
  FORMER: ${formerCount} registration${formerCount === 1 ? "" : "s"} ended on record (industry has invested over time, not just ramping up).` : ""}
  Use these names in the field-work tactical section. Mac Haddow specifically is the AKA's senior strategist with a decades-long Utah footprint (former Utah legislator + retained AKA lobbyist since 2017). When advocates testify, they should know which industry lobbyists are likely in the room.`;
  }

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
${stateLobbyingSection}
${buildCourtCasesSection(data)}
${buildFederalRulemakingSection(data)}
${buildFederalAwardsSection(data)}

STATE STATUS (from states table):
  kratom_status: ${data.stateStatus ?? "(unset)"}
  notes: ${data.stateNotes ?? "(none)"}

MUNICIPAL OFFICIALS ON FILE:
  ${data.municipalCount} (city councils, mayors) — anything below ~5 means we don't have meaningful local coverage yet.

Synthesize this into the briefing. Name primary bill sponsors when discussing each bill. Use capital + scheduling info verbatim when relevant. Quote admin stance rationales when listing champions/hostiles.`;
}

/**
 * Build the COURT LITIGATION prompt section. Surfaces decided opinions
 * and active dockets relevant to this state. Industry-party dockets
 * (AKA / Botanic Tonics / GKC as a named party) are flagged separately
 * because they're the highest-signal — they show whether a state's
 * kratom law is being legally challenged right now.
 */
function buildCourtCasesSection(data) {
  const cases = data.courtCases ?? [];
  if (cases.length === 0) {
    return `\nCOURT LITIGATION: (no kratom-related court cases for ${data.state} on file. CourtListener sync runs daily; cases appear here when filed in this state's courts or when the state is a named defendant.)`;
  }
  const industry = cases.filter(c => c.parties_industry);
  const opinions = cases.filter(c => c.case_kind === "opinion");
  const dockets = cases.filter(c => c.case_kind === "docket");
  const lines = [];
  lines.push(`\nCOURT LITIGATION (${cases.length} ${data.state} case${cases.length === 1 ? "" : "s"} — courts are the second battlefield after the legislature):`);
  if (industry.length > 0) {
    lines.push(`  INDUSTRY-PARTY (${industry.length} — direct AKA/GKC/Botanic Tonics involvement):`);
    for (const c of industry.slice(0, 5)) {
      lines.push(`    - ${(c.date_filed ?? "?").slice(0, 10)} · ${c.case_name?.slice(0, 100)} (${c.court_name ?? "?"})${c.challenged_law ? ` — challenges ${c.challenged_law} law` : ""}`);
    }
  }
  if (opinions.length > 0) {
    lines.push(`  PUBLISHED OPINIONS (${opinions.length} — decided cases interpreting kratom statutes):`);
    for (const o of opinions.slice(0, 3)) {
      lines.push(`    - ${(o.date_filed ?? "?").slice(0, 10)} · ${o.case_name?.slice(0, 100)} (${o.court_name ?? "?"})`);
    }
  }
  if (dockets.length > industry.length) {
    const otherDockets = dockets.filter(d => !d.parties_industry);
    if (otherDockets.length > 0) {
      lines.push(`  ACTIVE DOCKETS, non-industry (${otherDockets.length}):`);
      for (const d of otherDockets.slice(0, 3)) {
        lines.push(`    - ${(d.date_filed ?? "?").slice(0, 10)} · ${d.case_name?.slice(0, 100)}`);
      }
    }
  }
  lines.push(`  When the state passes a kratom restriction, the industry's next move is the courts. These rows surface those filings as they happen.`);
  return lines.join("\n");
}

/**
 * Build the FEDERAL RULEMAKING section. National layer — every state
 * briefing includes this because FDA/DEA/HHS rules apply uniformly.
 * Two priority levels:
 *   1. open_for_comment=true — actionable RIGHT NOW. The advocate
 *      can submit a public comment via Regulations.gov today and
 *      directly influence the rule.
 *   2. Recent (last 6 months) — context for what the federal
 *      battlefield looks like.
 */
function buildFederalRulemakingSection(data) {
  const rows = data.federalRulemaking ?? [];
  if (rows.length === 0) {
    return `\nFEDERAL RULEMAKING ACTIVITY: (no recent kratom rulemaking on file in Regulations.gov. Sync runs daily; new items appear as agencies post them.)`;
  }
  const open = rows.filter(r => r.open_for_comment);
  const closed = rows.filter(r => !r.open_for_comment);
  const lines = [];
  lines.push(`\nFEDERAL RULEMAKING ACTIVITY (Regulations.gov):`);
  if (open.length > 0) {
    lines.push(`  🚨 OPEN PUBLIC COMMENT PERIODS — advocates can submit RIGHT NOW (${open.length}):`);
    for (const r of open.slice(0, 5)) {
      lines.push(`    - [${r.agency_id}] ${r.document_type ?? "?"} closes ${r.comment_end_date}: ${r.title.slice(0, 110)}`);
      if (r.rg_url) lines.push(`      submit at: ${r.rg_url}`);
    }
    lines.push(`    These are the highest-leverage advocate moves of the week — submitting comments on FDA/DEA rules directly influences final-rule language.`);
  } else {
    lines.push(`  No federal comment periods currently open for kratom rulemaking.`);
  }
  if (closed.length > 0) {
    lines.push(`  RECENT FEDERAL ACTIVITY (last 6 months, context — ${closed.length}):`);
    for (const r of closed.slice(0, 3)) {
      lines.push(`    - [${r.agency_id}] ${(r.posted_date ?? "?").slice(0, 10)} · ${r.document_type ?? "?"}: ${r.title.slice(0, 110)}`);
    }
  }
  return lines.join("\n");
}

/**
 * Build the FEDERAL AWARDS section — the money-flow layer. Surfaces
 * the top federal grants and contracts mentioning kratom. Most
 * actionable signal: agency-paid abuse-potential studies that
 * directly inform DEA scheduling decisions (e.g. FDA → Baylor's
 * $3.78M Human Abuse Potential Study of Kratom).
 *
 * National layer (like federal rulemaking) — every state briefing
 * surfaces this because federal awards shape national policy.
 */
function buildFederalAwardsSection(data) {
  const awards = data.federalAwards ?? [];
  if (awards.length === 0) {
    return `\nFEDERAL AWARDS / RESEARCH FUNDING: (USAspending.gov sync hasn't run or no kratom-related federal awards on file yet.)`;
  }
  const total = awards.reduce((a, r) => a + (Number(r.amount) || 0), 0);
  const lines = [];
  lines.push(`\nFEDERAL AWARDS / RESEARCH FUNDING (USAspending.gov — federal money flowing to kratom-related work):`);
  lines.push(`  Top ${awards.length} awards, $${total.toLocaleString()} total. These are who the FDA/NIH are paying to study, classify, or develop kratom-related work — and the research papers that emerge will be cited in future rulemaking + scheduling decisions.`);
  for (const r of awards.slice(0, 6)) {
    const amt = Number(r.amount) || 0;
    const agency = r.awarding_sub_agency || r.awarding_agency || "?";
    lines.push(`    - $${amt.toLocaleString()} [${agency.slice(0, 30)}] → ${(r.recipient_name || "?").slice(0, 50)}`);
    if (r.description) lines.push(`        "${r.description.slice(0, 130).replace(/\s+/g, " ")}…"`);
  }
  lines.push(`  When advocates engage federal agencies, knowing which research is funded by whom shapes the conversation. University of Florida, Cornell, Baylor, JHU dominate the kratom academic-research dollar flow.`);
  return lines.join("\n");
}

async function loadStateData(state) {
  // Parallel data fetch — includes capital info, sponsors, stances, committees
  const [
    stateRow, capitalRow, legsAll, bills, bopSrc, bopFindings, news, camps,
    stanceRows, committeeRows, stateLobbyistRows, courtCaseRows, federalRulemakingRows, federalAwardRows,
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
    sb.from("legislator_stance")
      .select("legislator_id, stance, rationale_md, last_evidence_url, legislators!inner(full_name, role, district, state)")
      .eq("topic", "kratom")
      .eq("legislators.state", state),
    // Kratom-relevant committee chairs in this state
    sb.from("legislator_committees")
      .select("committee_name, chamber, role, legislator_id, legislators!inner(full_name, role, district, state)")
      .eq("legislators.state", state)
      .eq("is_kratom_relevant", true)
      .eq("session_id", "2025-2026"),
    // Phase 3 D2: state lobbyist registrations (currently Utah-only,
    // empty for other states — that's fine, this just appears as "no
    // state-lobbying intel for STATE_CODE yet" in the prompt).
    // Active rows surface in the briefing; ended rows feed a historical
    // count for context ("AKA has cycled 9 lobbyists through this state").
    sb.from("state_lobbyist_registrations")
      .select("lobbyist_name, principal_name, registration_type, start_date, end_date, principal_state")
      .eq("state", state)
      .eq("is_kratom_relevant", true)
      .order("start_date", { ascending: false }),
    // Court litigation (CourtListener sync). Surfaces both opinions
    // (decided cases interpreting kratom statutes in this state) and
    // active dockets (industry suits, criminal challenges). Most
    // valuable: parties_industry=true rows show direct AKA / Botanic
    // Tonics / GKC litigation. Falls through to empty when court
    // sync hasn't run yet.
    sb.from("court_cases")
      .select("case_name, case_kind, court_name, date_filed, citation, parties_industry, challenged_law, cl_url, snippet")
      .eq("state", state)
      .order("date_filed", { ascending: false, nullsFirst: false })
      .limit(15),
    // Federal rulemaking from Regulations.gov. This is NATIONAL —
    // every state briefing surfaces the federal action layer because
    // FDA/DEA/HHS rules apply uniformly. The high-leverage rows are
    // open_for_comment=true (advocates can submit comments TODAY).
    // Limit to recent + open-now items.
    sb.from("federal_rulemaking")
      .select("title, agency_id, document_type, posted_date, comment_end_date, open_for_comment, rg_url")
      .or("open_for_comment.eq.true,posted_date.gte." + new Date(Date.now() - 180 * 86400000).toISOString())
      .order("posted_date", { ascending: false, nullsFirst: false })
      .limit(10),
    // Federal awards from USAspending.gov. Money-flow layer — who's
    // getting paid by the feds for kratom-related work. Surfaces
    // research grants (NIH → UF, Cornell, JHU) and FDA contracts
    // (abuse-potential studies that feed DEA scheduling). Cap to
    // top 8 by amount — these are the rows that meaningfully change
    // the policy landscape.
    sb.from("federal_awards")
      .select("amount, awarding_agency, awarding_sub_agency, recipient_name, recipient_state, description, category, start_date, end_date, usa_url")
      .order("amount", { ascending: false, nullsFirst: false })
      .limit(8),
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
    stateLobbyists: stateLobbyistRows.data ?? [],
    courtCases: courtCaseRows.data ?? [],
    federalRulemaking: federalRulemakingRows.data ?? [],
    federalAwards: federalAwardRows.data ?? [],
  };
}

// =============================================================
// Self-critique loop (Phase 3 D5)
//
// Why this exists: a single AI generation pass can quietly drop bills,
// invent sponsor names, conflate natural-leaf kratom with 7-OH
// synthetics, or paper over data gaps. A second AI — OpenAI's open-weights
// GPT-OSS-120B routed via Groq for its chain-of-thought quality (it
// emits explicit reasoning_tokens internally) — reads the draft against
// the raw data and flags issues. If anything's flagged we regenerate
// once with the critique attached. Cost: one extra Groq call per
// briefing (free tier), ~400ms-2s latency. Quality lift comes from
// catching the long tail of "good-looking but wrong" briefings.
//
// Originally targeted DeepSeek R1 Distill 70B; Groq decommissioned that
// model on 2026-04. GPT-OSS-120B has equivalent reasoning capability
// (MIT-licensed open weights, US-hosted, also $0 on Groq's free tier).
// Privacy posture unchanged: DeepSeek's hosted API stays banned (Chinese
// servers, ToS allows training on submitted data).
// =============================================================
const CRITIQUE_MODEL = "openai/gpt-oss-120b";
const CRITIQUE_SYSTEM = `You are a senior advocacy strategist reviewing a kratom-policy state briefing for the iKratom platform. The briefing was AI-generated from raw platform data. Your job: catch errors and gaps an advocate printing this to bring to the capital can't afford.

Check the draft against the raw data provided. Flag concrete issues — not style notes — across these categories:

1. MISSING BILLS — did the draft skip any bill listed as anti or pro in the raw data, especially anti-kratom ones?
2. KRATOM-VS-7-OH CONFLATION — does the draft treat natural-leaf kratom and 7-OH/synthetic products as interchangeable when bills target only one? (Bills with targets_synthetic_only=true should be called out as 7-OH-specific.)
3. WRONG SPONSORS — does the draft name a primary sponsor not in the data, or attribute a bill to the wrong sponsor?
4. UNSOURCED CLAIMS — does the draft state specific facts (vote counts, deal-making, quotes) not grounded in the data provided?
5. GENERIC FIELD-WORK — is the "Field-work tactical" section state-specific advice grounded in the bills, news, and capital info, or generic boilerplate?
6. UNACKNOWLEDGED GAPS — when data is absent (zero bills, no BoP source, no stances, no committee chairs), does the draft acknowledge that or paper over it as "all clear"?

Return ONLY a JSON object:
  {"needs_revision": boolean, "issues": ["short specific issue", ...], "suggestions": ["concrete fix to apply", ...]}

Rules:
- needs_revision = true only when there is at least one substantive issue. Style/wording nits do not count.
- Cap issues + suggestions at 5 each. Keep each under 200 chars.
- Each suggestion should map to a fix the regeneration AI can apply (e.g. "Add HB 1234 by Rep Smith to Active legislation section; it's anti and missing").
- If the draft is solid, return {"needs_revision": false, "issues": [], "suggestions": []}. Don't manufacture issues.
- No prose around the JSON. No markdown fences.`;

/**
 * Ask the reasoning critic (GPT-OSS-120B via Groq) to review a briefing
 * draft against the raw state data. Returns
 *   { needs_revision, issues[], suggestions[] }
 * or { error } on failure (caller should ship the draft as-is).
 */
async function critiqueDraft(state, userPrompt, body) {
  // Critique input: original data + the draft. We trim the data block
  // to its first ~4000 chars so we stay inside Groq's prompt budget
  // for the reasoning model.
  const dataExcerpt = userPrompt.length > 4000 ? userPrompt.slice(0, 4000) + "\n…(truncated for critique budget)" : userPrompt;
  const critiqueUser = `STATE: ${state}

DRAFT BRIEFING TO REVIEW:
---
${body}
---

RAW SOURCE DATA THE DRAFT WAS GENERATED FROM:
---
${dataExcerpt}
---

Review the draft against the source data. Return the JSON.`;

  try {
    const result = await aiRouter({
      systemPrompt: CRITIQUE_SYSTEM,
      userPrompt: critiqueUser,
      maxTokens: 1200,
      providerOverride: "groq",
      modelOverride: CRITIQUE_MODEL,
      verbose: false,
    });
    const parsed = result.parsed ?? {};
    return {
      needs_revision: !!parsed.needs_revision,
      issues: Array.isArray(parsed.issues) ? parsed.issues.slice(0, 5).map(String) : [],
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.slice(0, 5).map(String) : [],
      provider: result.provider,
    };
  } catch (e) {
    // Critique is best-effort. If R1 is down (Groq cooldown, quota, etc.)
    // we ship the original draft rather than block on it.
    return { error: String(e.message ?? e).slice(0, 120) };
  }
}

/**
 * Regenerate the briefing with critique feedback appended to the user
 * prompt. Same SYSTEM prompt + provider routing as the initial generation,
 * so the format contract is identical.
 */
async function reviseDraft(userPrompt, previousBody, critique) {
  const reviseUser = `${userPrompt}

PREVIOUS DRAFT (already generated — fix the issues below, keep what's good):
---
${previousBody}
---

CRITIQUE — issues a senior reviewer found:
${critique.issues.map((i, n) => `${n + 1}. ${i}`).join("\n")}

SUGGESTED FIXES:
${critique.suggestions.map((s, n) => `${n + 1}. ${s}`).join("\n")}

Regenerate the briefing addressing each issue. Same JSON shape: {"body_md": "..."}. Keep the section headers identical.`;

  return aiRouter({
    systemPrompt: SYSTEM,
    userPrompt: reviseUser,
    maxTokens: 2400,
    providerOverride: PROVIDER_OVERRIDE,
    verbose: true,
  });
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
  let body = (result.parsed?.body_md ?? "").trim();
  // A real briefing has 5 sections × roughly 400-800 chars each ≈ 2000-4000
  // chars at minimum. Anything under 1500 chars is either a schema fragment
  // ({"type":"object"}), a provider-collapsed stub (gemini sometimes returns
  // a one-paragraph summary under JSON-mode with large prompts), or
  // structurally broken output. Reject so we don't swap a regression into
  // prod; the operator can rerun once provider budgets refresh.
  if (!body || body.length < 1500) {
    console.log(`✗ empty/short response (${body.length} chars) from ${result.provider}`);
    console.log(`  parsed=${JSON.stringify(result.parsed).slice(0, 200)}`);
    return { state, status: "empty" };
  }
  console.log(`✓ ${body.length} chars via ${result.provider}`);

  // Self-critique loop. Off when --no-critique is passed or
  // --max-revisions 0. Each pass = 1 critique + 1 regenerate.
  const critiqueHistory = [];
  let revisions = 0;
  let finalProvider = result.provider;
  if (!NO_CRITIQUE && MAX_REVISIONS > 0) {
    for (let i = 0; i < MAX_REVISIONS; i++) {
      process.stdout.write(`${tag} critique pass ${i + 1}… `);
      const critique = await critiqueDraft(state, userPrompt, body);
      if (critique.error) {
        console.log(`skipped (${critique.error})`);
        break;
      }
      if (!critique.needs_revision || critique.issues.length === 0) {
        console.log(`✓ clean`);
        critiqueHistory.push({ pass: i + 1, needs_revision: false, issues: [], provider: critique.provider });
        break;
      }
      console.log(`${critique.issues.length} issue(s) → revising:`);
      critique.issues.forEach((iss, n) => console.log(`    ${n + 1}. ${iss.slice(0, 140)}`));
      // Brief pause before revision so the provider we just used for
      // generation has a chance to clear any near-quota state. Without
      // this, gen → critique → revise lands three calls in <5s and one
      // of them eats a 429.
      await new Promise(r => setTimeout(r, 1500));
      let reviseResult;
      try {
        reviseResult = await reviseDraft(userPrompt, body, critique);
      } catch (e) {
        console.log(`    ✗ revision failed: ${e.message?.slice(0, 80)} (keeping prior draft)`);
        critiqueHistory.push({ pass: i + 1, needs_revision: true, issues: critique.issues, suggestions: critique.suggestions, revised: false, provider: critique.provider });
        break;
      }
      const reviseBody = (reviseResult.parsed?.body_md ?? "").trim();
      // Defensive: if the regeneration collapsed (returned a stub, schema
      // fragment, or much shorter content), keep the original draft.
      if (reviseBody.length < Math.max(200, body.length * 0.5)) {
        console.log(`    ⚠ revision rejected (${reviseBody.length} chars vs prior ${body.length}); keeping prior draft`);
        critiqueHistory.push({ pass: i + 1, needs_revision: true, issues: critique.issues, suggestions: critique.suggestions, revised: false, rejection_reason: "too_short", provider: critique.provider });
        break;
      }
      body = reviseBody;
      finalProvider = reviseResult.provider;
      revisions++;
      critiqueHistory.push({ pass: i + 1, needs_revision: true, issues: critique.issues, suggestions: critique.suggestions, revised: true, provider: critique.provider });
      console.log(`    ✓ revised to ${body.length} chars via ${reviseResult.provider}`);
    }
  }

  // Atomic swap: deactivate old + insert new
  await sb.from("state_briefings").update({ is_active: false }).eq("state", state).eq("is_active", true);
  const { error: insertErr, data: row } = await sb.from("state_briefings").insert({
    state,
    body_md: body,
    generated_by_provider: finalProvider ?? "unknown",
    data_snapshot: {
      legCount: data.legCount,
      billCount: data.bills.length,
      newsCount: data.news.length,
      bopSrcCount: data.bopSrcCount,
      campActiveCount: data.campAct.length,
      // Self-critique provenance — admin can audit which briefings
      // went through revision and which issues R1 caught.
      critique: {
        enabled: !NO_CRITIQUE && MAX_REVISIONS > 0,
        max_revisions: MAX_REVISIONS,
        revisions_applied: revisions,
        history: critiqueHistory,
      },
    },
    is_active: true,
  }).select("id").single();
  if (insertErr) {
    console.log(`${tag} ✗ DB: ${insertErr.message}`);
    return { state, status: "db-error", error: insertErr.message };
  }
  return { state, status: "ok", id: row.id, provider: finalProvider, chars: body.length, revisions };
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
const erroredRuns = results.filter(r => r.status?.includes("error"));
const errored = erroredRuns.length;
const revisedRuns = results.filter(r => (r.revisions ?? 0) > 0).length;
const totalRevisions = results.reduce((acc, r) => acc + (r.revisions ?? 0), 0);
const elapsed = ((Date.now() - t0) / 1000 / 60).toFixed(1);
console.log(`\nDone in ${elapsed} min — ok=${ok} errored=${errored}/${results.length}`);
if (!NO_CRITIQUE && MAX_REVISIONS > 0) {
  console.log(`Critique: ${revisedRuns}/${ok} briefing(s) revised by reasoning critic (${totalRevisions} total revisions)`);
}

// Summarize per-state failures so the telemetry row records WHY — previously
// error_message was never set, so /admin/automation showed a blank error and a
// recurring failure was undiagnosable without a manual re-run.
const errSummary = erroredRuns
  .slice(0, 6)
  .map(r => `${r.state}:${r.status}${r.error ? ` ${String(r.error).slice(0, 60)}` : ""}`)
  .join(" | ");

try {
  await sb.from("scraper_runs").insert({
    source: "generate_state_briefing",
    started_at: new Date(t0).toISOString(),
    finished_at: new Date().toISOString(),
    // "partial" when some briefings generated despite failures; only a run that
    // produced NOTHING is a hard error (matches the partial-success convention).
    status: ok === 0 && errored > 0 ? "error" : errored > 0 ? "partial" : "success",
    rows_added: ok,
    error_message: errored > 0 ? errSummary.slice(0, 500) : null,
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
