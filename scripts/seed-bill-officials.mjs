#!/usr/bin/env node
/**
 * Pull the full slate of local officials for any city/county-scoped
 * bill — mayor + ALL city council members (or county exec + ALL
 * commissioners) — and insert them into the legislators table so:
 *
 *   1. The /bills/[id] action card can render them all with mailto:/
 *      tel:/website buttons (not just the 1-2 names mentioned in the
 *      news article)
 *   2. They appear on /admin/locals + the public /legislators surface
 *      for the locality, the same as state/federal reps
 *   3. Future campaigns auto-target them (target_legislator_ids picks
 *      up these rows by role + locality)
 *
 * Mirrors src/lib/ai/suggest-officials.ts (Gemini with Search
 * grounding) but as a service-role-only Node script — bypasses the
 * admin-auth gate appropriate for the UI but blocking for batch
 * backfill.
 *
 * Run:
 *   node --env-file=.env.local scripts/seed-bill-officials.mjs --bill <uuid>
 *   node --env-file=.env.local scripts/seed-bill-officials.mjs --all-municipal
 *   node --env-file=.env.local scripts/seed-bill-officials.mjs --all-municipal --refresh
 */
import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const GEMINI_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_KEY) { console.error("GEMINI_API_KEY required (Gemini Search grounding)"); process.exit(1); }

// Domains that squat / park URLs Gemini sometimes hallucinates.
// If a council member's website resolves to one of these on a HEAD
// check, drop the URL rather than feeding it into the action UI.
const PARKED_DOMAINS = [
  "hugedomains.com",
  "sedoparking.com",
  "dan.com",
  "godaddy.com",
  "parkingcrew.net",
  "afternic.com",
  "uniregistry.com",
  "buydomains.com",
  "domainmarket.com",
];

async function isUsableUrl(rawUrl) {
  if (!rawUrl) return false;
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return false;
  }
  if (!u.protocol.startsWith("http")) return false;

  // Quick host-based check before HEAD
  const host = u.hostname.toLowerCase();
  if (PARKED_DOMAINS.some((p) => host === p || host.endsWith("." + p))) return false;

  // HEAD request to detect parking-domain redirects + clear 404s.
  // Fail-open on network error / 403 / 405 — many .gov sites block
  // bot HEAD requests but the URL is real and works in a browser.
  // The point of this check is parked-domain detection, not link
  // validity (the runtime UI handles that gracefully via the "⚠
  // Website unreliable" badge if a click ends up at a bad page).
  try {
    const res = await fetch(rawUrl, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(8_000),
      headers: { "User-Agent": "Mozilla/5.0 iKratom-link-check" },
    });
    // 403 = bot-blocking by host firewall. URL likely real.
    // 405 = method not allowed. URL likely real.
    // 404 or 5xx = treat as bad.
    if (res.status === 404 || res.status >= 500) {
      return false;
    }
    // After redirect, always check the final hostname for parking
    const finalUrl = new URL(res.url);
    const finalHost = finalUrl.hostname.toLowerCase();
    if (PARKED_DOMAINS.some((p) => finalHost === p || finalHost.endsWith("." + p))) {
      return false;
    }
    return true;
  } catch {
    return true; // fail-open on network errors
  }
}

const args = process.argv.slice(2);
const arg = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const SPECIFIC = arg("--bill");
const ALL = args.includes("--all-municipal");
const REFRESH = args.includes("--refresh");

if (!SPECIFIC && !ALL) {
  console.error("Usage: --bill <uuid>  OR  --all-municipal  (optionally --refresh)");
  process.exit(1);
}

const SYSTEM = `You are a civic-data analyst. Given a U.S. city or county, find the CURRENT elected officials AND the city/county general contact info. Return strict JSON inside a <result>...</result> block. Use Google Search grounding for accuracy — prefer .gov / .us domains over third-party aggregators.

Return shape:
<result>
{
  "officials": [
    {
      "full_name": "Jane Doe",
      "role": "mayor" | "city_council" | "county_executive" | "county_commissioner",
      "title": "Mayor" | "Council Member, Ward 3" | "County Judge-Executive" | etc.,
      "district": "Ward 3" or null,
      "party": "D" | "R" | "I" | null,
      "email": "jane.doe@cityofx.gov" or null,
      "phone": "555-555-5555" or null,
      "website": "https://..." or null
    }
  ],
  "city_general": {
    "name": "City of Marshall, IL",
    "general_phone": "555-555-5555" or null,
    "general_email": "info@cityofmarshall.org" or null,
    "contact_form_url": "https://cityofmarshall.org/contact" or null,
    "mailing_address": "123 Main St, Marshall, IL 62441" or null,
    "council_meeting_url": "https://cityofmarshall.org/meetings" or null,
    "official_website": "https://cityofmarshall.org" or null
  },
  "sources": ["https://cityofx.gov/council", ...]
}
</result>

Rules:
- Include the mayor + ALL current city council members for cities.
- Include the county executive + ALL current county commissioners for counties.
- ALWAYS populate city_general with at minimum the official_website. Most small cities have a single phone + general email even when individual council members don't publish theirs — find them.
- Skip school boards unless explicitly asked.
- If you cannot find verifiable current data, return officials: [] with an explanation in sources.
- Phone numbers in 555-555-5555 format.
- Never fabricate emails. If only a contact form is published, put the form URL in website (or contact_form_url for city_general) and leave email null.
- Output ONLY the <result>...</result> block. No prose before or after.`;

async function suggestOfficials({ city, state }) {
  const isCounty = /county$/i.test(city);
  const userPrompt = isCounty
    ? `Find the current ${city} ${state} commissioners / supervisors and county executive (or judge-executive). Search the official county government website first.`
    : `Find the current Mayor and ALL City Council members for ${city}, ${state}. Search the official city government website (look for .gov or .us domains) first.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      systemInstruction: { parts: [{ text: SYSTEM }] },
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const candidate = data.candidates?.[0];
  const text = (candidate?.content?.parts ?? []).map((p) => p.text ?? "").join("\n");
  const m = text.match(/<result>([\s\S]*?)<\/result>/);
  if (!m) throw new Error(`Model did not return a <result> block. Got: ${text.slice(0, 200)}`);
  const parsed = JSON.parse(m[1].trim());
  return {
    officials: Array.isArray(parsed.officials) ? parsed.officials : [],
    city_general: (parsed.city_general && typeof parsed.city_general === "object")
      ? parsed.city_general : null,
    sources: Array.isArray(parsed.sources) ? parsed.sources : [],
  };
}

// Return values:
//   "ok"   — seeded new officials
//   "skip" — no-op (locality already covered, or no locality on bill)
//   "fail" — actual failure (Gemini error, insert error, 0 officials returned)
async function processBill(bill) {
  console.log(`\n=== ${bill.id.slice(0, 8)} | ${bill.state} ${bill.bill_number} | ${bill.locality} ===`);
  if (!bill.locality) { console.log("  ⏭  no locality on bill"); return "skip"; }

  // Parse "Marshall, IL" → "Marshall"
  const cityMatch = bill.locality.match(/^([^,]+),\s*([A-Z]{2})/);
  const city = cityMatch?.[1]?.trim() ?? bill.locality.trim();

  // Skip if locality already has officials and not forcing refresh
  if (!REFRESH) {
    const { count } = await sb.from("legislators").select("id", { count: "exact", head: true })
      .eq("state", bill.state)
      .eq("locality", bill.locality)
      .in("role", ["city_council", "mayor", "county_executive", "county_commissioner"])
      .eq("active", true);
    if ((count ?? 0) > 0) {
      console.log(`  ⏭  ${count} officials already exist for ${bill.locality}; skip (use --refresh to force)`);
      return "skip";
    }
  }

  console.log(`  asking Gemini for ${city}, ${bill.state} officials…`);
  let suggestion;
  try {
    suggestion = await suggestOfficials({ city, state: bill.state });
  } catch (e) {
    console.log(`  ✗ Gemini failed: ${e.message?.slice(0, 200)}`);
    return "fail";
  }
  if (suggestion.officials.length === 0) {
    console.log(`  ⚠ Gemini returned 0 officials. Sources: ${suggestion.sources.slice(0, 2).join(", ")}`);
    return "fail";
  }
  console.log(`  ✓ Gemini found ${suggestion.officials.length} official(s)`);

  // Persist city_general into bills.local_meta so the campaign page
  // can render a "City contacts" block as a fallback when individual
  // council members don't publish per-member contact info (typical
  // for small towns like Marshall, IL).
  if (suggestion.city_general) {
    const cg = suggestion.city_general;
    // Validate every URL in city_general before persisting — Gemini
    // sometimes hallucinates parked-domain URLs (the discovermarshall.com
    // hugedomains case). isUsableUrl() does HEAD + redirect-final-host
    // checks. Failed URLs become null, not the bad string.
    const validatedContactForm = await isUsableUrl(cg.contact_form_url);
    const validatedMeeting = await isUsableUrl(cg.council_meeting_url);
    const validatedSite = await isUsableUrl(cg.official_website);
    const safeCg = {
      name: cg.name?.toString().slice(0, 200) ?? null,
      general_phone: cg.general_phone?.toString().slice(0, 30) ?? null,
      general_email: cg.general_email?.toString().slice(0, 254) ?? null,
      contact_form_url: validatedContactForm ? cg.contact_form_url.toString().slice(0, 500) : null,
      mailing_address: cg.mailing_address?.toString().slice(0, 300) ?? null,
      council_meeting_url: validatedMeeting ? cg.council_meeting_url.toString().slice(0, 500) : null,
      official_website: validatedSite ? cg.official_website.toString().slice(0, 500) : null,
    };
    const droppedUrls = [];
    if (cg.contact_form_url && !validatedContactForm) droppedUrls.push("contact_form_url");
    if (cg.council_meeting_url && !validatedMeeting) droppedUrls.push("council_meeting_url");
    if (cg.official_website && !validatedSite) droppedUrls.push("official_website");
    if (droppedUrls.length > 0) {
      console.log(`  ⚠ city_general dropped invalid/parked URLs: ${droppedUrls.join(", ")}`);
    }
    // Merge into existing local_meta — do not clobber other fields
    // (e.g. summary_one_line, officials_to_contact from extract-local-meta).
    const { data: billRow } = await sb.from("bills")
      .select("local_meta").eq("id", bill.id).single();
    const existingMeta = billRow?.local_meta && typeof billRow.local_meta === "object"
      ? billRow.local_meta : {};
    const newMeta = { ...existingMeta, city_general: safeCg };
    const { error: metaErr } = await sb.from("bills")
      .update({ local_meta: newMeta }).eq("id", bill.id);
    if (metaErr) {
      console.log(`  ⚠ city_general persist failed: ${metaErr.message}`);
    } else {
      const filled = Object.entries(safeCg).filter(([, v]) => v).map(([k]) => k);
      console.log(`  ✓ city_general saved (${filled.length} field(s): ${filled.join(", ")})`);
    }
  }

  const cap = (s, n) => s ? String(s).slice(0, n).trim() || null : null;
  // Validate per-official website URLs (parallel HEAD requests). Drop
  // anything that resolves to a parking domain. Keeps the action-button
  // UI from sending advocates to hugedomains.com.
  const websiteValidations = await Promise.all(
    suggestion.officials.map((o) => isUsableUrl(o.website))
  );
  const droppedWebsites = suggestion.officials
    .filter((_, i) => suggestion.officials[i].website && !websiteValidations[i])
    .map((o) => o.full_name);
  if (droppedWebsites.length > 0) {
    console.log(`  ⚠ dropped ${droppedWebsites.length} invalid/parked official website(s): ${droppedWebsites.slice(0,3).join(", ")}${droppedWebsites.length > 3 ? "…" : ""}`);
  }
  const rows = suggestion.officials.map((o, i) => {
    const isCounty = (o.role ?? "").startsWith("county_");
    return {
      full_name: cap(o.full_name, 120) ?? "Unknown",
      state: bill.state,
      role: o.role,
      locality: bill.locality,
      title: cap(o.title, 120),
      district: cap(o.district, 30),
      email: cap(o.email, 254),
      phone: cap(o.phone, 30),
      website: websiteValidations[i] ? cap(o.website, 500) : null,
      party: cap(o.party, 60),
      level: isCounty ? "county" : "municipal",
      active: true,
    };
  });

  // Dedupe against existing rows in (state, locality, role, lower(full_name))
  const { data: existing } = await sb.from("legislators").select("role, full_name")
    .eq("state", bill.state)
    .eq("locality", bill.locality)
    .in("level", ["municipal", "county"]);
  const existingKeys = new Set(
    (existing ?? []).map((r) => `${r.role}::${(r.full_name ?? "").toLowerCase().trim()}`),
  );
  const newRows = rows.filter(
    (r) => !existingKeys.has(`${r.role}::${r.full_name.toLowerCase().trim()}`),
  );
  const skipped = rows.length - newRows.length;
  if (newRows.length === 0) {
    console.log(`  ⏭  all ${rows.length} already in DB`);
    return "skip";
  }

  const { data: inserted, error } = await sb.from("legislators").insert(newRows).select("id");
  if (error) {
    console.log(`  ✗ insert failed: ${error.message}`);
    return "fail";
  }
  console.log(`  ✓ inserted ${inserted?.length ?? 0} new official(s); skipped ${skipped} dupe(s)`);
  for (const o of newRows) {
    console.log(`     - ${o.role.padEnd(15)} ${o.full_name}${o.district ? ` (${o.district})` : ""}${o.email ? `  ✉ ${o.email}` : ""}`);
  }

  // Phase 4 retarget hook (migration 0073). Now that this locality has
  // city/county officials, fix any auto-generated campaigns that landed
  // before the seed ran and ended up either with empty targets
  // (post-0073 behavior) or with the wrong all-state-legs fallback
  // (pre-0073 behavior — Marshall, IL was the canonical case). Calls
  // the SECURITY DEFINER RPC so it bypasses RLS like the rest of this
  // service-role script.
  try {
    const cityForMatch = bill.locality.split(",")[0].trim();
    const { data: retargets, error: retargetErr } = await sb.rpc(
      "retarget_auto_campaigns_for_locality",
      { p_state: bill.state, p_locality: cityForMatch },
    );
    if (retargetErr) {
      console.log(`  ⚠ retarget RPC failed: ${retargetErr.message}`);
    } else if (retargets && retargets.length > 0) {
      const fixed = retargets.filter((r) => r.result?.ok === true);
      console.log(`  ↻ retargeted ${fixed.length}/${retargets.length} auto-campaign(s)`);
      for (const r of fixed) {
        console.log(`     - ${r.campaign_id.slice(0, 8)}: ${r.result.old_count} → ${r.result.new_count} targets (${r.result.tier})`);
      }
    }
  } catch (e) {
    console.log(`  ⚠ retarget hook error: ${e.message?.slice(0, 200)}`);
  }
  return "ok";
}

let bills;
if (SPECIFIC) {
  const { data } = await sb.from("bills").select("id, state, bill_number, locality, scope")
    .eq("id", SPECIFIC).single();
  bills = data ? [data] : [];
} else {
  const { data } = await sb.from("bills").select("id, state, bill_number, locality, scope")
    .in("scope", ["municipal", "county"])
    .eq("active", true)
    .order("created_at", { ascending: false });
  bills = data ?? [];
}

if (bills.length === 0) { console.log("No bills to process."); process.exit(0); }
console.log(`Processing ${bills.length} local bill(s)…`);

let ok = 0, fail = 0, skip = 0;
for (const b of bills) {
  const r = await processBill(b);
  if (r === "ok") ok++;
  else if (r === "fail") fail++;
  else skip++;
  await new Promise((r) => setTimeout(r, 2000));
}
console.log(`\nDone. ok=${ok}, fail=${fail}, skip=${skip}`);
try {
  // Status semantics: error only if there were ACTUAL failures (Gemini
  // call failed, insert failed). Skips ("already exists", "no locality")
  // are not errors — they're correct no-ops. Empty if literally nothing
  // happened. Success otherwise.
  const status =
    fail > 0 ? "error" :
    (ok === 0 && skip === 0) ? "empty" :
    (ok === 0 && skip > 0) ? "success" :   // all-skipped is a clean noop
    "success";
  await sb.from("scraper_runs").insert({
    source: "seed_bill_officials",
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    status,
    rows_added: ok,
    notes: `${ok} seeded, ${skip} no-op skipped, ${fail} failed`,
  });
} catch { /* best-effort */ }
