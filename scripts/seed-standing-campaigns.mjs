#!/usr/bin/env node
/**
 * Seed the per-state STANDING campaign backbone (owner P5, 2026-06-22).
 *
 * Each state already has ONE combined evergreen ("Tell your <State> legislators
 * kratom matters", both chambers). The owner wants it SPLIT into targeted
 * standing actions, one per recipient group:
 *   • Email your State Representatives   → target_roles ['state_house']
 *   • Email your State Senators          → target_roles ['state_senate']
 *   • Email your Governor & AG (+ Lt.Gov)→ target_roles ['governor','attorney_general','lt_governor']
 *
 * All are is_standing=true (never auto-expired), active=true, mobilization_type
 * 'constituent', auto_generated=false — cloned from the proven tx-introduce-yourself
 * shape so recipient resolution works exactly like the live evergreens.
 *
 * DETERMINISTIC — no AI. Three reusable {{placeholder}} templates × the states
 * that actually have those officials. Idempotent: skips any slug that exists.
 *
 * TOPIC-KEY SAFETY: campaign_topic_key(state,title) keys non-bill titles as
 * STATE|kw|event, and ux_campaigns_topic_key_live excludes only |unknown|unknown.
 * A title containing a kratom keyword would key STATE|kratom|unknown and COLLIDE
 * with the state's existing evergreen. So these titles are deliberately
 * keyword/event-free → STATE|unknown|unknown → index-excluded → safe. The script
 * verifies this for every title before inserting and refuses any that wouldn't.
 *
 *   node --env-file=.env.local scripts/seed-standing-campaigns.mjs            # dry-run
 *   node --env-file=.env.local scripts/seed-standing-campaigns.mjs --apply
 */
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const t0 = Date.now();

// Management API SQL (superuser) — needed to (dis/en)able the notify trigger,
// which PostgREST/service-role cannot. Same channel as scripts/db-push.mjs.
async function runSql(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${process.env.SUPABASE_PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

const STATE_NAME = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado",
  CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky",
  LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire",
  NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
  OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

// Mirror of campaign_topic_key()'s kw/event detection (migration 0186) — used to
// PROVE a title keys to |unknown|unknown before we insert it.
const KW_RX = /\b(7-?hydroxymitragynine|mitragyn[a-z]*|7-?o?h|kratomite|kratoms?|gas[- ]?station|tianeptine)\b/i;
const EV_RX = /\b(ban|restrict|regulat|hearing|schedul|enact|veto|repeal|ordinance|crackdown|law|ruling|pass|sign|approv|reject|withdraw|stall|halt)/i;
const keysToUnknown = (title) => !KW_RX.test(title) && !EV_RX.test(title);

function bodyFor(salutation, roleLine, stateName) {
  return `${salutation}\n\nMy name is {{full_name}} and I am a constituent in {{city}}, {{state}} {{zip}}. I am writing as someone who follows kratom-related policy in our state.\n\nI support sensible regulation that keeps natural leaf kratom legal for adults while setting quality standards and protecting minors — the framework of the Kratom Consumer Protection Act that several states have adopted.\n\n${roleLine}\n\nI respectfully ask you to:\n\n1. Oppose any legislation that would ban kratom outright.\n\n2. Be cautious of bills that target the 7-hydroxymitragynine (7-OH) alkaloid in ways that would function as a backdoor ban on kratom as a whole.\n\n3. Reach out to constituents like me if kratom policy comes before you — we are glad to share our experience.\n\nThank you for your time and your service to ${stateName}.\n\nSincerely,\n{{full_name}}\n{{street}}\n{{city}}, {{state}} {{zip}}`;
}

function plan(abbr) {
  const name = STATE_NAME[abbr] || abbr;
  return {
    house: {
      slug: `${abbr.toLowerCase()}-email-state-house`,
      title: `Email your ${name} State Representatives`,
      blurb: `One click to message your ${name} state House members in support of safe, regulated kratom access. A standing action — always available.`,
      target_roles: ["state_house"],
      subject_template: `Constituent input on kratom policy in ${name}`,
      body_template: bodyFor("Dear Representative,", `As a member of the ${name} House, your vote shapes how our state treats kratom.`, name),
    },
    senate: {
      slug: `${abbr.toLowerCase()}-email-state-senate`,
      title: `Email your ${name} State Senators`,
      blurb: `One click to message your ${name} state Senators in support of safe, regulated kratom access. A standing action — always available.`,
      target_roles: ["state_senate"],
      subject_template: `Constituent input on kratom policy in ${name}`,
      body_template: bodyFor("Dear Senator,", `As a member of the ${name} Senate, your vote shapes how our state treats kratom.`, name),
    },
    exec: {
      slug: `${abbr.toLowerCase()}-email-statewide-officials`,
      title: `Email your ${name} Governor and Attorney General`,
      blurb: `One click to message ${name}'s Governor and Attorney General — the officials who sign, veto, and enforce kratom policy. A standing action — always available.`,
      target_roles: ["governor", "attorney_general", "lt_governor"],
      subject_template: `Constituent input on kratom policy in ${name}`,
      body_template: bodyFor("Dear Governor and Attorney General,", `As ${name}'s chief executive and chief law-enforcement officer, you set the tone for how our state treats kratom.`, name),
    },
  };
}

const ROW_DEFAULTS = { target_locality: null, target_legislator_ids: null, mobilization_type: "constituent", allow_non_residents: false, ai_personalize: false, active: true, is_standing: true, auto_generated: false };

console.log(`${APPLY ? "🔧 APPLY" : "🔍 DRY-RUN"} — seed per-state standing campaigns\n`);

// Which states actually have each role (active legislators).
const roleStates = { state_house: new Set(), state_senate: new Set(), exec: new Set() };
for (let f = 0; ; f += 1000) {
  const { data } = await sb.from("legislators").select("role, state, active").range(f, f + 999);
  if (!data?.length) break;
  for (const l of data) {
    if (l.active === false || !l.state) continue;
    if (l.role === "state_house") roleStates.state_house.add(l.state);
    else if (l.role === "state_senate") roleStates.state_senate.add(l.state);
    else if (["governor", "attorney_general", "lt_governor"].includes(l.role)) roleStates.exec.add(l.state);
  }
  if (data.length < 1000) break;
}
console.log(`coverage — house: ${roleStates.state_house.size} states · senate: ${roleStates.state_senate.size} · exec: ${roleStates.exec.size}\n`);

// Existing slugs (skip).
const existing = new Set();
for (let f = 0; ; f += 1000) {
  const { data } = await sb.from("campaigns").select("slug").range(f, f + 999);
  if (!data?.length) break;
  for (const c of data) existing.add(c.slug);
  if (data.length < 1000) break;
}

// Build the insert list.
const toInsert = [];
const states = Object.keys(STATE_NAME);
for (const abbr of states) {
  const p = plan(abbr);
  const want = [];
  if (roleStates.state_house.has(abbr)) want.push(p.house);
  if (roleStates.state_senate.has(abbr)) want.push(p.senate);
  if (roleStates.exec.has(abbr)) want.push(p.exec);
  for (const c of want) {
    if (existing.has(c.slug)) continue;            // idempotent
    if (!keysToUnknown(c.title)) { console.error(`  ⚠ REFUSING ${c.slug}: title would key non-unknown ("${c.title}")`); continue; }
    toInsert.push({ ...ROW_DEFAULTS, ...c, state: abbr });
  }
}
console.log(`to insert: ${toInsert.length} (skipped ${existing.size ? "existing slugs" : "none"})`);
const byKind = toInsert.reduce((a, c) => { const k = c.target_roles[0]; a[k] = (a[k] || 0) + 1; return a; }, {});
console.log("  by kind:", JSON.stringify(byKind));
for (const c of toInsert.slice(0, 6)) console.log(`   ${c.slug}  roles=${JSON.stringify(c.target_roles)}  "${c.title}"`);
if (toInsert.length > 6) console.log(`   … and ${toInsert.length - 6} more`);

if (APPLY && toInsert.length) {
  // Suppress the per-campaign notify fan-out — campaign_notify_trigger notifies
  // on every active INSERT (0008), so seeding 149 active campaigns would blast
  // users. Disable just that trigger for the seed; re-enable in finally even on
  // error. These are backbone infrastructure, not breaking news.
  let ok = 0, fail = 0;
  console.log("Disabling campaign_notify_trigger for the seed…");
  await runSql("ALTER TABLE public.campaigns DISABLE TRIGGER campaign_notify_trigger;");
  try {
    for (const row of toInsert) {
      const { error } = await sb.from("campaigns").insert(row);
      if (error) { console.error(`  ✗ ${row.slug}: ${error.message}`); fail++; continue; }
      ok++;
    }
  } finally {
    await runSql("ALTER TABLE public.campaigns ENABLE TRIGGER campaign_notify_trigger;");
    console.log("Re-enabled campaign_notify_trigger.");
  }
  console.log(`\n✅ Inserted ${ok} standing campaigns (${fail} failed) — no notifications sent.`);
  try {
    await sb.from("scraper_runs").insert({ source: "seed_standing_campaigns", started_at: new Date(t0).toISOString(), finished_at: new Date().toISOString(),
      status: "success", rows_updated: ok, notes: `house+senate+exec standing campaigns; failed=${fail}` });
  } catch { /* best-effort */ }
} else if (toInsert.length) {
  console.log(`\n(dry-run — re-run with --apply to create these.)`);
} else {
  console.log(`\nNothing to insert — all standing campaigns already exist.`);
}
console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
