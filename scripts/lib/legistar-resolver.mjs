/**
 * legistar-resolver.mjs — expand keyless Legistar officials coverage.
 *
 * The hand-curated LEGISTAR_TENANTS list only covers ~22 big metros. This
 * module auto-discovers which (locality, state) pairs run on the public,
 * key-less Legistar webapi by probing candidate {client}.legistar.com slugs
 * derived from the locality name, and resolves a locality to its cached tenant.
 *
 * SAFETY (data-integrity gate): a probed slug is only ACCEPTED when
 *   (a) the place/county name is UNIQUE to the expected state per the Census
 *       gazetteer, OR the candidate slug carries the 2-letter state code; AND
 *   (b) the tenant's member home/office addresses don't contradict the state.
 * This blocks cross-state slug collisions (e.g. probing "columbus" for
 * Columbus, MS would otherwise hit Columbus, OH) from seeding wrong-state
 * officials — the same "never publish a contradicted locality" rule the
 * gazetteer guard enforces elsewhere.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LEGISTAR_TENANTS } from "./legistar-tenants.mjs";
import { resolveTenant, webapiClientFor } from "./legistar-officials.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COUNTIES = JSON.parse(fs.readFileSync(path.join(HERE, "geo", "us-counties.json"), "utf8"));
const PLACES = JSON.parse(fs.readFileSync(path.join(HERE, "geo", "us-places.json"), "utf8"));

const WEBAPI = "https://webapi.legistar.com/v1";
const UA = "iKratom Civic Data (contact@ikratom.org)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Strip ", ST", lowercase, collapse whitespace. Matches resolveTenant's norm. */
export function normLoc(s) {
  return String(s ?? "").trim().toLowerCase().replace(/,\s*[a-z]{2}$/i, "").replace(/\s+/g, " ").trim();
}

/** Mirror of sync-legistar-officials.mjs levelFor — keep one rule. */
export function levelForTenant({ locality, body }) {
  if (/\b(county|borough|parish)\b/i.test(locality ?? "") || /supervisor|commission|county/i.test(body ?? "")) return "county";
  return "municipal";
}

/** Which states does this bare place/county name exist in? null if unknown. */
export function statesForName(locality) {
  const bare = normLoc(locality);
  if (!bare) return null;
  const fromCounty = COUNTIES[bare];
  if (fromCounty) return Array.isArray(fromCounty) ? fromCounty : [fromCounty];
  const fromPlace = PLACES[bare];
  if (fromPlace) return Array.isArray(fromPlace) ? fromPlace : [fromPlace];
  return null;
}

/**
 * Candidate webapi {client} slugs for a locality, each tagged `disambiguated`
 * (carries the state code → safe even for common names).
 */
export function slugCandidates(locality, state) {
  const st = String(state ?? "").toLowerCase();
  const bare = normLoc(locality).replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  if (!bare) return [];
  const isCounty = /\b(county|parish|borough)\b/.test(bare);
  const core = bare.replace(/\b(county|parish|borough)\b/g, "").replace(/\s+/g, " ").trim();
  const out = [];
  const add = (slug, disambiguated) => {
    if (slug && slug.length >= 3 && !out.some((o) => o.slug === slug)) out.push({ slug, disambiguated });
  };
  if (isCounty) {
    const c = core.replace(/\s+/g, "");
    add(c + "county" + st, true);
    add(c + st, true);
    add(c + "county", false);
    add(c, false);
    add(core.replace(/\s+/g, "-") + "-county", false);
  } else {
    const c = bare.replace(/\s+/g, "");
    add(c + st, true);
    add(c, false);
    add(bare.replace(/\s+/g, "-"), false);
    add("cityof" + c, false);
  }
  return out.slice(0, 6);
}

async function probeBodies(client, timeoutMs = 12_000) {
  try {
    const res = await fetch(`${WEBAPI}/${encodeURIComponent(client)}/Bodies?$top=1`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": UA },
    });
    if (!res.ok) return false;
    const j = await res.json();
    return Array.isArray(j) && j.length > 0;
  } catch {
    return false;
  }
}

/**
 * Returns true if the tenant's member addresses corroborate the expected
 * state, false if they CONTRADICT it, null if there's no address signal.
 * Used as a second guard against slug collisions.
 */
async function corroborateState(client, want, timeoutMs = 12_000) {
  try {
    const res = await fetch(`${WEBAPI}/${encodeURIComponent(client)}/Persons?$top=15`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": UA },
    });
    if (!res.ok) return null;
    const persons = await res.json();
    if (!Array.isArray(persons)) return null;
    const seen = [];
    for (const p of persons) {
      for (const k of ["PersonState1", "PersonState2"]) {
        const v = (p?.[k] ?? "").toString().trim().toUpperCase();
        if (/^[A-Z]{2}$/.test(v)) seen.push(v);
      }
    }
    if (seen.length === 0) return null;
    const matches = seen.filter((s) => s === want).length;
    return matches > 0 && matches >= seen.length / 2;
  } catch {
    return null;
  }
}

/**
 * Probe candidate slugs for (locality, state); return { client } for the first
 * SAFE live tenant, or null. Throttled to be polite to webapi.legistar.com.
 */
export async function discoverTenant({ locality, state, throttleMs = 800 }) {
  const want = String(state ?? "").toUpperCase();
  const states = statesForName(locality);
  const unique = Array.isArray(states) && states.length === 1 && states[0] === want;
  // Try state-encoded slugs first (slugCandidates orders them first), then bare.
  const cands = slugCandidates(locality, state);
  for (const { slug, disambiguated } of cands) {
    const live = await probeBodies(slug);
    if (live) {
      const corr = await corroborateState(slug, want);
      if (corr === false) { await sleep(throttleMs); continue; } // member addresses contradict the state
      // A BARE slug for a name shared by multiple states needs POSITIVE state
      // confirmation (member addresses match) before we accept it — otherwise
      // it could be a same-named city elsewhere (e.g. "columbus" → Columbus,
      // OH). State-encoded slugs and gazetteer-unique names are safe without it.
      if (!disambiguated && !unique && corr !== true) { await sleep(throttleMs); continue; }
      return { client: slug };
    }
    await sleep(throttleMs);
  }
  return null;
}

/**
 * Resolve a (state, locality) to a usable Legistar tenant: the hand-curated
 * list first, then the discovered `legistar_tenants` cache. Returns an object
 * shaped for fetchLegistarOfficials, or null.
 */
export async function resolveCachedTenant(sb, state, locality) {
  const hand = resolveTenant(LEGISTAR_TENANTS, state, locality);
  if (hand) {
    return {
      client: webapiClientFor(hand), subdomain: hand.subdomain, body: hand.body,
      state: hand.state, locality: hand.locality, level: levelForTenant(hand), source: "handlist",
    };
  }
  if (!sb) return null;
  const want = normLoc(locality);
  const { data } = await sb
    .from("legistar_tenants")
    .select("state, locality, subdomain, webapi_client, body")
    .eq("state", String(state ?? "").toUpperCase())
    .eq("probe_status", "live");
  const hit = (data ?? []).find((t) => normLoc(t.locality) === want && t.webapi_client);
  if (!hit) return null;
  return {
    client: hit.webapi_client, subdomain: hit.subdomain ?? hit.webapi_client, body: hit.body,
    state: hit.state, locality: hit.locality, level: levelForTenant(hit), source: "cache",
  };
}

export async function upsertTenant(sb, { state, locality, subdomain, webapi_client, body, probe_status, officials_count }) {
  if (!sb) return;
  await sb.from("legistar_tenants").upsert(
    {
      state: String(state).toUpperCase(),
      locality,
      subdomain: subdomain ?? webapi_client ?? null,
      webapi_client: webapi_client ?? null,
      body: body ?? null,
      probe_status,
      officials_count: officials_count ?? null,
      probed_at: new Date().toISOString(),
    },
    { onConflict: "state,locality" },
  );
}
