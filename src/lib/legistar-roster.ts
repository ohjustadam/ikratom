/**
 * legistar-roster.ts — TypeScript Legistar webapi client for the LIVE
 * (Vercel) officials path. Reads the discovered/seeded `legistar_tenants`
 * cache to resolve a locality to its keyless webapi {client}, then pulls the
 * authoritative current council/board roster. No key, no quota, no Gemini.
 *
 * Mirror of scripts/lib/legistar-officials.mjs (which serves the batch path);
 * kept as a separate, dependency-free TS module so the Next app never imports
 * a scripts/*.mjs file.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { SuggestedOfficial } from "@/lib/ai/suggest-officials";

const WEBAPI = "https://webapi.legistar.com/v1";
const UA = "iKratom Civic Data (contact@ikratom.org)";

interface LegistarBody {
  BodyId: number;
  BodyName: string;
  BodyTypeName?: string;
  BodyActiveFlag?: number | boolean;
}
interface LegistarOfficeRecord {
  OfficeRecordPersonId: number;
  OfficeRecordFullName?: string;
  OfficeRecordFirstName?: string;
  OfficeRecordLastName?: string;
  OfficeRecordTitle?: string;
  OfficeRecordEmail?: string;
  OfficeRecordStartDate?: string;
  OfficeRecordEndDate?: string;
}
interface LegistarPerson {
  PersonEmail?: string;
  PersonPhone?: string;
  PersonWWW?: string;
}

function normLoc(s: string | null | undefined): string {
  return String(s ?? "").trim().toLowerCase().replace(/,\s*[a-z]{2}$/i, "").replace(/\s+/g, " ").trim();
}

export function levelForTenant(locality: string, body?: string | null): "municipal" | "county" {
  if (/\b(county|borough|parish)\b/i.test(locality) || /supervisor|commission|county/i.test(body ?? "")) return "county";
  return "municipal";
}

export type LegistarTenant = {
  client: string;
  subdomain: string;
  body: string | null;
  level: "municipal" | "county";
};

/** Resolve a (state, locality) to its cached live Legistar tenant, or null. */
export async function resolveLegistarTenant(db: SupabaseClient, state: string, locality: string): Promise<LegistarTenant | null> {
  const want = normLoc(locality);
  if (!want) return null;
  const { data } = await db
    .from("legistar_tenants")
    .select("state, locality, subdomain, webapi_client, body")
    .eq("state", state.toUpperCase())
    .eq("probe_status", "live");
  const hit = (data ?? []).find(
    (t: { locality: string; webapi_client: string | null }) => normLoc(t.locality) === want && t.webapi_client,
  );
  if (!hit) return null;
  return {
    client: hit.webapi_client as string,
    subdomain: (hit.subdomain as string | null) ?? (hit.webapi_client as string),
    body: (hit.body as string | null) ?? null,
    level: levelForTenant(hit.locality as string, hit.body as string | null),
  };
}

async function getJson(url: string, timeoutMs = 15_000): Promise<unknown> {
  const res = await fetch(encodeURI(url), { signal: AbortSignal.timeout(timeoutMs), headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`legistar ${res.status}`);
  return res.json();
}

const NON_MEMBERSHIP = /\b(session|briefing|committee|subcommittee|special|closed|agenda|hearing|workshop|study|joint|ad hoc|task force|select|meeting|quorum|youth|young adult|advisory|ethics|redistricting)\b/i;

function pickCouncilBody(bodies: LegistarBody[], bodyHint?: string | null): LegistarBody | null {
  const active = bodies.filter((b) => b.BodyActiveFlag === 1 || b.BodyActiveFlag === true);
  const norm = (s: string | undefined) => (s ?? "").toLowerCase();
  const hint = norm(bodyHint ?? undefined);
  if (hint) {
    const exact = active.find((b) => norm(b.BodyName) === hint || norm(b.BodyTypeName) === hint);
    if (exact) return exact;
  }
  const KW = ["city council", "board of supervisors", "board of county commissioners", "board of commissioners",
    "county council", "municipal council", "city commission", "metro council", "board of aldermen", "common council", "council"];
  const eligible = active.filter((b) => !NON_MEMBERSHIP.test(b.BodyName));
  if (hint) {
    const byHint = eligible.find((b) => norm(b.BodyName).includes(hint));
    if (byHint) return byHint;
  }
  for (const kw of KW) {
    const hit = eligible.find((b) => norm(b.BodyName).includes(kw) || norm(b.BodyTypeName).includes(kw));
    if (hit) return hit;
  }
  return null;
}

function mapRole(level: "municipal" | "county", title?: string | null): SuggestedOfficial["role"] {
  const t = (title ?? "").toLowerCase();
  if (level === "county") {
    if (/executive|judge|mayor/.test(t)) return "county_executive";
    return "county_commissioner";
  }
  if (/mayor/.test(t)) return "mayor";
  return "city_council";
}

const endRank = (d: string | null | undefined) => (d ? new Date(d).getTime() : Infinity); // null end = ongoing → latest

/** Pull the current roster for a resolved tenant as SuggestedOfficial[]. */
export async function fetchLegistarRoster(tenant: LegistarTenant): Promise<SuggestedOfficial[]> {
  let bodiesRaw: unknown;
  try { bodiesRaw = await getJson(`${WEBAPI}/${tenant.client}/bodies`); } catch { return []; }
  if (!Array.isArray(bodiesRaw)) return [];
  const body = pickCouncilBody(bodiesRaw as LegistarBody[], tenant.body);
  if (!body) return [];

  const today = new Date().toISOString().slice(0, 19);
  let recordsRaw: unknown;
  try {
    recordsRaw = await getJson(`${WEBAPI}/${tenant.client}/officeRecords?$filter=OfficeRecordBodyId eq ${body.BodyId} and (OfficeRecordEndDate gt datetime'${today}' or OfficeRecordEndDate eq null)`);
  } catch { return []; }
  if (!Array.isArray(recordsRaw) || recordsRaw.length === 0) return [];
  const todayMs = new Date(today).getTime();
  const current = (recordsRaw as LegistarOfficeRecord[]).filter(
    (r) => !r.OfficeRecordStartDate || new Date(r.OfficeRecordStartDate).getTime() <= todayMs,
  );

  const byPerson = new Map<number, LegistarOfficeRecord>();
  for (const r of current) {
    const prev = byPerson.get(r.OfficeRecordPersonId);
    if (!prev || endRank(r.OfficeRecordEndDate) > endRank(prev.OfficeRecordEndDate)) byPerson.set(r.OfficeRecordPersonId, r);
  }

  const officials: SuggestedOfficial[] = [];
  for (const r of byPerson.values()) {
    let person: LegistarPerson = {};
    try {
      const p = await getJson(`${WEBAPI}/${tenant.client}/persons/${r.OfficeRecordPersonId}`);
      if (p && typeof p === "object") person = p as LegistarPerson;
    } catch { /* contact join best-effort */ }
    const email = r.OfficeRecordEmail || person.PersonEmail || null;
    const phone = person.PersonPhone || null;
    const website = person.PersonWWW || `https://${tenant.subdomain}.legistar.com/PersonDetail.aspx?ID=${r.OfficeRecordPersonId}`;
    const title = r.OfficeRecordTitle || (tenant.level === "county" ? "Commissioner" : "Council Member");
    officials.push({
      full_name: (r.OfficeRecordFullName?.trim()) || `${r.OfficeRecordFirstName ?? ""} ${r.OfficeRecordLastName ?? ""}`.trim(),
      role: mapRole(tenant.level, title),
      title,
      district: null,
      email: email && /@/.test(email) ? email : null,
      phone: phone && phone.trim() ? phone.trim() : null,
      website,
      party: null,
      source_note: `Legistar (official ${body.BodyName} roster), retrieved ${today.slice(0, 10)}`,
      term_end_date: r.OfficeRecordEndDate ? r.OfficeRecordEndDate.slice(0, 10) : null,
      source_url: `https://${tenant.subdomain}.legistar.com/People.aspx`,
      source_kind: "legistar",
    });
  }
  return officials;
}
