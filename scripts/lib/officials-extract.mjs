/**
 * officials-extract.mjs — the keyless, Gemini-free local-officials source.
 *
 * Replaces the Gemini + Google-Search grounded lookup the batch scripts used.
 * Tiered, deterministic-first:
 *
 *   Tier 1 — Legistar webapi (authoritative clerk roster; FREE, no key, no
 *            cap) via the expanded tenant resolver (hand list + discovered
 *            cache). Officials come back pre-verified (clerk system).
 *   Tier 3 — long tail: self-hosted SearXNG FINDS the official .gov roster
 *            page, we FETCH it deterministically, and a LOCAL LLM (Ollama,
 *            falling back through free-tier Groq/Cerebras) EXTRACTS the
 *            officials from that page text.
 *
 * There is NO Google-Search grounding and NO Gemini-grounded call anywhere in
 * this path. If SearXNG/Ollama are unreachable (e.g. on a cloud runner that
 * can't see localhost), this returns { queued } so the caller leaves the
 * locality pending to be drained where the infra is reachable — it never
 * crashes and never reintroduces Gemini.
 */

import { resolveCachedTenant } from "./legistar-resolver.mjs";
import { fetchLegistarOfficials } from "./legistar-officials.mjs";
import { searxngConfigured, searxngSearch } from "./searxng.mjs";
import { reconcileLocality } from "./geo-resolver.mjs";
import { aiRouter } from "./ai-router.mjs";

const VALID_ROLES = new Set([
  "mayor", "city_council", "county_executive", "county_commissioner", "school_board", "other_local",
]);

const EXTRACT_SYSTEM = `You extract CURRENT elected local-government officials from the text of ONE government web page that was already fetched for you. Work ONLY from the page text provided — do NOT use outside knowledge and do NOT invent anyone.

Return STRICT JSON only (no prose, no markdown fences):
{
  "page_jurisdiction": "the government this page belongs to, exactly as the page presents it — e.g. \"City of Troy, Michigan\" or \"Fergus County, Montana\". REQUIRED.",
  "officials": [
    { "full_name": "Jane Doe", "role": "mayor"|"city_council"|"county_executive"|"county_commissioner", "title": "Mayor"|"Council Member, Ward 3"|null, "district": "Ward 3"|null, "email": "jane.doe@city.gov"|null, "phone": "555-555-5555"|null, "website": "https://..."|null, "party": "D"|"R"|"I"|null, "term_end_date": "2028-01-01"|null }
  ]
}

Rules:
- ALWAYS fill page_jurisdiction with the government the PAGE is about (from its header/title/footer), even when returning zero officials. It is compared against the requested jurisdiction by code.
- For a city: the Mayor + ALL current city council members. For a county: the county executive + ALL current commissioners/supervisors.
- Village/town boards count as municipal: Village President / Town Supervisor → role "mayor"; Trustees / Select Board members → role "city_council".
- Include ONLY people the page itself names as CURRENT officials. If the page is not a current roster (or names none), return {"officials":[]}.
- THE JURISDICTION MUST MATCH. If the page is about a DIFFERENT government than the one named in the prompt — a same-named city in another state, a NEIGHBORING city, the county when asked for the city, a school/water/special district, or a facility/department/authority board (medical care community, road commission, DHHS, housing authority) — return {"officials":[]}.
- full_name MUST be the person's actual name ("Jane Doe"), NEVER a title + surname ("Commissioner Doe"). If the page only gives "Commissioner Doe", omit that entry.
- Never fabricate emails or phones — leave unknown fields null.
- term_end_date as YYYY-MM-DD only if the page states it; else null.
- Output ONLY the JSON object.`;

/** Rank SearXNG results, preferring official government domains. */
function pickCandidateUrls(results, city) {
  const want = String(city ?? "").toLowerCase().replace(/[^a-z]/g, "");
  const scored = [];
  for (const r of results ?? []) {
    let u;
    try { u = new URL(r.url); } catch { continue; }
    const host = u.hostname.toLowerCase();
    const hay = host + u.pathname.toLowerCase();
    let score = 0;
    if (host.endsWith(".gov")) score += 5;
    else if (host.endsWith(".us")) score += 4;
    if (/(city|town|village|borough|township|parish|county)of/.test(host)) score += 3;
    if (/\b(council|commission|government|cityclerk|board|mayor)\b/.test(hay)) score += 2;
    if (want && host.replace(/[^a-z]/g, "").includes(want.slice(0, 8))) score += 2;
    if (/legistar\.com$/.test(host) || /granicus\.com$/.test(host)) score += 1;
    if (score <= 0) continue;
    scored.push({ url: r.url, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return [...new Set(scored.map((s) => s.url))].slice(0, 3);
}

async function fetchPageText(url) {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: { "User-Agent": "iKratom Civic Data (contact@ikratom.org)" },
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("pdf")) return null; // no PDF extraction in this path
    const html = (await res.text()).slice(0, 600_000);
    // Always use the full tag-stripped page text, NOT Readability: rosters
    // live in tables/sidebars that article extraction discards (verified on
    // cityoflewistown.com — Readability kept the meeting schedule and dropped
    // every commissioner). Noise is fine; the extractor works from raw text.
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;|&#160;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&#(\d+);/g, (_, n) => { const c = Number(n); return c >= 32 && c < 65536 ? String.fromCharCode(c) : " "; })
      .replace(/\s+/g, " ")
      .trim();
    return text.slice(0, 24_000);
  } catch {
    return null;
  }
}

async function extractFromText({ text, city, state, level, sourceUrl }) {
  const user = `Page URL: ${sourceUrl}\nJurisdiction: ${city}, ${state} (${level})\n\nPAGE TEXT:\n${text}`;
  let result;
  try {
    // Prefer local Ollama (keyless, unlimited); aiRouter falls back through
    // the free-tier cloud providers (Groq/Cerebras/…) on its own. This is
    // plain JSON extraction from text we already fetched — NO grounding.
    result = await aiRouter({ systemPrompt: EXTRACT_SYSTEM, userPrompt: user, maxTokens: 4096, providerOverride: "ollama", verbose: false });
  } catch {
    return { officials: [], provider: null };
  }
  // JURISDICTION cross-check, in code: the model reliably reports what page
  // it's reading even when it over-eagerly extracts. If the page's own
  // jurisdiction doesn't name our locality, these are someone else's
  // officials (the batch run pulled Troy, MI for "Hamilton, MI" off a page
  // that merely mentioned a Hamilton street). Missing field = reject —
  // precision over recall; the locality just stays queued.
  const claimed = String(result.parsed?.page_jurisdiction ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const wantBare = String(city ?? "").toLowerCase().replace(/\b(county|parish|borough|village|township|city|town|of)\b/g, " ").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  if (!claimed || (wantBare.length >= 3 && !claimed.includes(wantBare))) {
    return { officials: [], provider: result.provider, jurisdictionMismatch: claimed || "(none reported)" };
  }
  const raw = Array.isArray(result.parsed?.officials) ? result.parsed.officials : [];
  // Strip leading titles the model sometimes leaves on ("Commissioner
  // Patterson-Gladney") and drop officials without a real first+last name —
  // a bare surname can't be reliably verified and reads as broken data.
  const TITLE_PREFIX_RE = /^(commissioner|council\s?member|councilman|councilwoman|mayor|vice[- ]mayor|supervisor|trustee|alder(?:man|woman)|chair(?:man|woman|person)?|president|freeholder|select(?:man|woman))\.?\s+/i;
  const cleanName = (s) => {
    let n = String(s ?? "").trim();
    for (let i = 0; i < 2 && TITLE_PREFIX_RE.test(n); i++) n = n.replace(TITLE_PREFIX_RE, "").trim();
    return n;
  };
  const officials = raw
    .map((o) => (o && typeof o.full_name === "string" ? { ...o, full_name: cleanName(o.full_name) } : o))
    .filter((o) => o && typeof o.full_name === "string" && o.full_name.length >= 5 && /\s/.test(o.full_name))
    .map((o) => ({
      full_name: o.full_name.trim(),
      role: VALID_ROLES.has(o.role) ? o.role : (level === "county" ? "county_commissioner" : "city_council"),
      title: o.title ?? null,
      district: o.district ?? null,
      email: o.email && /@/.test(String(o.email)) ? o.email : null,
      phone: o.phone ?? null,
      website: o.website ?? null,
      party: o.party ?? null,
      term_end_date: o.term_end_date ?? null,
      source_url: sourceUrl,
      source_note: `Extracted from ${new URL(sourceUrl).hostname} via SearXNG + ${result.provider}, ${new Date().toISOString().slice(0, 10)}`,
      source_kind: "search",
    }));
  return { officials, provider: result.provider };
}

async function logExtract(sb, { caller, provider, status, city, state, count }) {
  if (!sb) return;
  try {
    await sb.from("ai_jobs").insert({
      task_kind: "officials_extract", // NOT 'gemini_grounded' — the freed metric
      provider_used: provider ?? "none",
      model_used: provider === "ollama" ? "llama3.3:70b" : (provider ?? "none"),
      status,
      caller,
      prompt_preview: `${city}, ${state} officials`,
      metadata: { officials_returned: count, source: "searxng" },
      completed_at: new Date().toISOString(),
    });
  } catch { /* best-effort telemetry */ }
}

/**
 * Resolve the current officials for a locality WITHOUT Gemini.
 *
 * @returns one of:
 *   { ok:true, source, provider, officials:[…], sources:[…] }
 *   { queued:true, reason }   — couldn't resolve deterministically and the
 *                               long-tail infra is unavailable; leave pending.
 *   { error }                 — unexpected failure.
 */
export async function findAndExtractOfficials({ sb, city, state, locality, level, caller = "officials-extract" }) {
  const loc = locality ?? `${city}, ${state}`;
  const cityName = city ?? loc.replace(/,\s*[A-Z]{2}$/i, "").trim();
  const lvl = level ?? (/\b(county|parish|borough)\b/i.test(loc) ? "county" : "municipal");

  // Census-designated places are unincorporated — there IS no municipal
  // government to find. Searching would surface some same-named real city
  // (the Hamilton, MI → Hamilton, OH failure shape). Leave for a human.
  if (/\bcdp\b/i.test(loc)) return { queued: true, reason: "unincorporated-cdp" };

  // ---- Tier 1: Legistar (authoritative clerk roster, keyless) ----
  try {
    const tenant = await resolveCachedTenant(sb, state, loc);
    if (tenant) {
      const lg = await fetchLegistarOfficials({ client: tenant.client, bodyHint: tenant.body, level: tenant.level ?? lvl, subdomain: tenant.subdomain });
      if (lg.ok && lg.officials.length > 0) {
        return {
          ok: true, source: "legistar", provider: "legistar",
          officials: lg.officials.map((o) => ({ ...o, source_kind: "legistar" })),
          sources: [`https://${tenant.subdomain}.legistar.com/People.aspx`],
        };
      }
    }
  } catch { /* fall through to long-tail */ }

  // ---- Tier 3: SearXNG (find page) + Ollama/Groq/Cerebras (extract) ----
  if (!searxngConfigured()) return { queued: true, reason: "searxng-unconfigured" };
  const query = lvl === "county"
    ? `${cityName} ${state} county commissioners board members official site`
    : `${cityName} ${state} city council members mayor official site`;
  const results = await searxngSearch(query, { count: 12 });
  if (!results.length) return { queued: true, reason: "searxng-empty" };
  const candidates = pickCandidateUrls(results, cityName);
  if (!candidates.length) return { queued: true, reason: "no-gov-candidate" };

  // LOCALITY-NAME gate input: the page (or its host) must actually mention
  // the place it's supposed to govern. Without this, an unincorporated place
  // with no site of its own resolves to SOME same-state city's page — the
  // batch run pulled Troy, MI for "Hamilton, MI" and Portage, MI for
  // "Mattawan, MI" (the .gov score bonus outranked the correct mattawanmi.org).
  const bareName = cityName.toLowerCase().replace(/\b(county|parish|borough|village|township|city|town|of)\b/gi, " ").replace(/\s+/g, " ").trim();
  const squashedName = bareName.replace(/[^a-z0-9]/g, "");

  let lastProvider = null;
  for (const url of candidates) {
    const text = await fetchPageText(url);
    if (!text) continue;
    // STATE gate: the fetched page must not belong to a same-named place in
    // another state (Hamilton, MI query → cityofhamilton.com = Hamilton,
    // OHIO). The gazetteer resolver pins the page's state from its own text;
    // an uncorroborated different-state pin means wrong government — skip.
    const geo = reconcileLocality({ aiLocality: state, scopeState: state, text: text.slice(0, 16_000), title: cityName });
    if (!geo.corroborated && /^[A-Z]{2}$/.test(geo.locality) && geo.locality !== String(state).toUpperCase()) {
      continue; // page is about a different state's government
    }
    // LOCALITY-NAME gate: same-state-but-wrong-city pages don't mention the
    // locality at all — require the name in the page text or the hostname.
    if (bareName.length >= 3) {
      const host = (() => { try { return new URL(url).hostname.toLowerCase().replace(/[^a-z0-9]/g, ""); } catch { return ""; } })();
      if (!text.toLowerCase().includes(bareName) && !(squashedName && host.includes(squashedName))) {
        continue; // page never names the locality it would be governing
      }
    }
    const { officials, provider } = await extractFromText({ text, city: cityName, state, level: lvl, sourceUrl: url });
    lastProvider = provider;
    if (officials.length > 0) {
      await logExtract(sb, { caller, provider, status: "success", city: cityName, state, count: officials.length });
      return { ok: true, source: `searxng-${provider}`, provider, officials, sources: candidates };
    }
  }
  await logExtract(sb, { caller, provider: lastProvider, status: "empty", city: cityName, state, count: 0 });
  return { queued: true, reason: "no-extract" };
}
