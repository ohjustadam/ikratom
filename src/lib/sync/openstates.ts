/**
 * OpenStates v3 sync helper. Used by both the CLI script and admin server actions.
 * Syncs state-level legislators (state_senate, state_house) for one state.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

const OPENSTATES = "https://v3.openstates.org";

type OpenStatesPerson = {
  id: string;
  name: string;
  party?: string;
  email?: string;
  current_role?: { org_classification?: string; district?: string | number } | null;
  offices?: { voice?: string; address?: string }[];
  links?: { url: string; note?: string }[];
};

type SyncResult = { state: string; count: number; error?: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function mapPerson(state: string, p: OpenStatesPerson) {
  const role = p.current_role;
  if (!role) return null;
  const orgClass = role.org_classification;
  let mappedRole: string | null = null;
  if (orgClass === "upper") mappedRole = "state_senate";
  else if (orgClass === "lower") mappedRole = "state_house";
  else if (orgClass === "legislature") mappedRole = "state_senate"; // unicameral (NE, DC)
  else return null;

  const phone = (p.offices || []).find((o) => o.voice)?.voice ?? null;
  const website =
    (p.links || []).find((l) => /home|official/i.test(l.note || ""))?.url ||
    (p.links || [])[0]?.url ||
    null;
  const officeAddr = (p.offices || []).find((o) => o.address)?.address ?? null;

  return {
    state,
    role: mappedRole,
    district: role.district != null ? String(role.district) : null,
    full_name: p.name,
    party: p.party ?? null,
    email: p.email ?? null,
    phone,
    office_address: officeAddr,
    website,
    openstates_id: p.id,
    active: true,
    last_synced_at: new Date().toISOString(),
  };
}

export async function syncStateLegislators(
  state: string,
  supabase: SupabaseClient,
  apiKey: string
): Promise<SyncResult> {
  const all: ReturnType<typeof mapPerson>[] = [];
  let page = 1;

  while (true) {
    const url = `${OPENSTATES}/people?jurisdiction=${state.toLowerCase()}&page=${page}&per_page=50&include=offices`;
    const res = await fetch(url, { headers: { "X-API-Key": apiKey } });

    if (res.status === 429) {
      await sleep(30_000);
      continue;
    }
    if (!res.ok) {
      const body = await res.text();
      return { state, count: 0, error: `OpenStates ${res.status}: ${body.slice(0, 200)}` };
    }

    const data = (await res.json()) as {
      results?: OpenStatesPerson[];
      pagination?: { page?: number; max_page?: number };
    };

    for (const p of data.results ?? []) {
      const row = mapPerson(state, p);
      if (row) all.push(row);
    }

    const max = data.pagination?.max_page ?? 1;
    if (page >= max) break;
    page++;
    await sleep(1100); // be polite
  }

  const rows = all.filter((r): r is NonNullable<typeof r> => r !== null);
  if (rows.length === 0) return { state, count: 0 };

  const { error } = await supabase
    .from("legislators")
    .upsert(rows, { onConflict: "openstates_id" });

  if (error) return { state, count: 0, error: error.message };
  return { state, count: rows.length };
}
