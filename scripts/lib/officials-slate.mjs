/**
 * officials-slate.mjs — shared helper: fetch + persist the full slate of
 * local officials for a "City, ST" / "County, ST" locality.
 *
 * Extracted so both scripts/seed-bill-officials.mjs (bill-driven) and
 * scripts/extract-news-officials.mjs (news-alert-driven) can build the
 * same legislators rows the same way. (seed-bill-officials still has its
 * own inline copy as of 2026-05-30 — folding it onto this helper is a
 * low-risk future cleanup noted in V2_KICKOFF.)
 *
 * Uses Gemini 2.5 Flash with Google Search grounding (free tier) — no
 * paid API. Validates official websites against known parked-domain
 * squatters before persisting. Per migration 0169, every grounded call
 * runs through assertGroundingBudget() so the Sunday weekly burst can't
 * blow the daily ~500 grounded-query free-tier ceiling — once today's
 * cap is hit, callers get status='skip' with a quota_exhausted error
 * and the alert/request stays unprocessed for tomorrow's retry.
 */

import { assertGroundingBudget, GroundingQuotaError, recordGroundingCall } from "./grounding-budget.mjs";

const PARKED_DOMAINS = [
  "hugedomains.com", "sedoparking.com", "dan.com", "godaddy.com",
  "parkingcrew.net", "afternic.com", "uniregistry.com", "buydomains.com",
  "domainmarket.com",
];

export async function isUsableUrl(rawUrl) {
  if (!rawUrl) return false;
  let u;
  try { u = new URL(rawUrl); } catch { return false; }
  if (!u.protocol.startsWith("http")) return false;
  const host = u.hostname.toLowerCase();
  if (PARKED_DOMAINS.some((p) => host === p || host.endsWith("." + p))) return false;
  try {
    const res = await fetch(rawUrl, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(8_000),
      headers: { "User-Agent": "Mozilla/5.0 iKratom-link-check" },
    });
    if (res.status === 404 || res.status >= 500) return false;
    const finalHost = new URL(res.url).hostname.toLowerCase();
    if (PARKED_DOMAINS.some((p) => finalHost === p || finalHost.endsWith("." + p))) return false;
    return true;
  } catch {
    return true; // fail-open on network errors (many .gov block HEAD)
  }
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
- ALWAYS populate city_general with at minimum the official_website.
- Skip school boards unless explicitly asked.
- If you cannot find verifiable current data, return officials: [] with an explanation in sources.
- Phone numbers in 555-555-5555 format.
- Never fabricate emails. If only a contact form is published, put the form URL in website (or contact_form_url for city_general) and leave email null.
- Output ONLY the <result>...</result> block. No prose before or after.`;

async function suggestOfficials({ sb, city, state, geminiKey, caller }) {
  const isCounty = /county$/i.test(city);
  const userPrompt = isCounty
    ? `Find the current ${city} ${state} commissioners / supervisors and county executive (or judge-executive). Search the official county government website first.`
    : `Find the current Mayor and ALL City Council members for ${city}, ${state}. Search the official city government website (look for .gov or .us domains) first.`;

  // Budget guard BEFORE the call. Throws GroundingQuotaError if today's
  // cap is reached; seedLocalitySlate catches and converts to status='skip'.
  await assertGroundingBudget(sb);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`;
  const startedAt = Date.now();
  let res;
  try {
    res = await fetch(url, {
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
  } catch (e) {
    await recordGroundingCall(sb, { caller, status: "failure", error: `fetch failed: ${e.message}`, elapsedMs: Date.now() - startedAt, promptPreview: userPrompt });
    throw e;
  }
  if (!res.ok) {
    const errBody = (await res.text()).slice(0, 300);
    await recordGroundingCall(sb, { caller, status: "failure", error: `Gemini ${res.status}: ${errBody}`, elapsedMs: Date.now() - startedAt, promptPreview: userPrompt });
    throw new Error(`Gemini ${res.status}: ${errBody}`);
  }
  const data = await res.json();
  const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("\n");
  const m = text.match(/<result>([\s\S]*?)<\/result>/);
  if (!m) {
    await recordGroundingCall(sb, { caller, status: "failure", error: "no <result> block", elapsedMs: Date.now() - startedAt, promptPreview: userPrompt });
    throw new Error(`Model did not return a <result> block. Got: ${text.slice(0, 200)}`);
  }
  const parsed = JSON.parse(m[1].trim());
  await recordGroundingCall(sb, { caller, status: "success", elapsedMs: Date.now() - startedAt, promptPreview: userPrompt, metadata: { officials_returned: Array.isArray(parsed.officials) ? parsed.officials.length : 0 } });
  return {
    officials: Array.isArray(parsed.officials) ? parsed.officials : [],
    sources: Array.isArray(parsed.sources) ? parsed.sources : [],
  };
}

/**
 * Fetch + persist the full official slate for a locality. Idempotent:
 * dedupes against existing (state, locality, role, lower(full_name)).
 *
 * @returns {Promise<{ status: "ok"|"skip"|"fail", inserted: number,
 *                      existing: number, officialIds: string[] }>}
 *   officialIds = ALL active city/county official IDs for the locality
 *   after the run (existing + newly inserted) — the set to target.
 */
export async function seedLocalitySlate({ sb, state, locality, geminiKey, refresh = false, caller = "officials-slate" }) {
  const city = locality.split(",")[0].trim();

  // Already covered?
  const { data: pre } = await sb.from("legislators").select("id")
    .eq("state", state)
    .eq("locality", locality)
    .in("role", ["city_council", "mayor", "county_executive", "county_commissioner"])
    .eq("active", true);
  const preIds = (pre ?? []).map((r) => r.id);
  if (!refresh && preIds.length > 0) {
    return { status: "skip", inserted: 0, existing: preIds.length, officialIds: preIds };
  }

  let suggestion;
  try {
    suggestion = await suggestOfficials({ sb, city, state, geminiKey, caller });
  } catch (e) {
    // Quota exhaustion is the common "leave it for tomorrow" case —
    // surface a clean error string so callers can match on it via
    // isRetryableGroundingError(). All raw errors are already in
    // ai_jobs via recordGroundingCall.
    if (e instanceof GroundingQuotaError) {
      return { status: "fail", inserted: 0, existing: preIds.length, officialIds: preIds, error: e.message };
    }
    return { status: "fail", inserted: 0, existing: preIds.length, officialIds: preIds, error: e.message };
  }
  if (suggestion.officials.length === 0) {
    return { status: "fail", inserted: 0, existing: preIds.length, officialIds: preIds, error: "0 officials returned" };
  }

  const cap = (s, n) => (s ? String(s).slice(0, n).trim() || null : null);
  const websiteOk = await Promise.all(suggestion.officials.map((o) => isUsableUrl(o.website)));
  const rows = suggestion.officials.map((o, i) => {
    const isCounty = (o.role ?? "").startsWith("county_");
    return {
      full_name: cap(o.full_name, 120) ?? "Unknown",
      state,
      role: o.role,
      locality,
      title: cap(o.title, 120),
      district: cap(o.district, 30),
      email: cap(o.email, 254),
      phone: cap(o.phone, 30),
      website: websiteOk[i] ? cap(o.website, 500) : null,
      party: cap(o.party, 60),
      level: isCounty ? "county" : "municipal",
      active: true,
    };
  }).filter((r) => ["city_council", "mayor", "county_executive", "county_commissioner"].includes(r.role));

  // Dedupe against existing
  const { data: existing } = await sb.from("legislators").select("id, role, full_name")
    .eq("state", state)
    .eq("locality", locality)
    .in("level", ["municipal", "county"]);
  const existingKeys = new Set((existing ?? []).map((r) => `${r.role}::${(r.full_name ?? "").toLowerCase().trim()}`));
  const newRows = rows.filter((r) => !existingKeys.has(`${r.role}::${r.full_name.toLowerCase().trim()}`));

  let insertedIds = [];
  if (newRows.length > 0) {
    const { data: ins, error } = await sb.from("legislators").insert(newRows).select("id");
    if (error) return { status: "fail", inserted: 0, existing: preIds.length, officialIds: preIds, error: error.message };
    insertedIds = (ins ?? []).map((r) => r.id);
  }

  const allIds = [...new Set([...(existing ?? []).map((r) => r.id), ...insertedIds])];
  return {
    status: insertedIds.length > 0 ? "ok" : "skip",
    inserted: insertedIds.length,
    existing: (existing ?? []).length,
    officialIds: allIds,
  };
}
