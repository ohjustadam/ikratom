/**
 * Server-side resolver for bill-level "email a group of officials" targeting.
 *
 * Turns a bill into up to three targetable groups the advocate can email
 * directly (outside a campaign):
 *   - STATE bill  → all state Representatives, all state Senators, and the
 *     executive trio (Governor / Lt. Governor / Attorney General) for that state.
 *   - FEDERAL bill → the user's OWN delegation (their US House member + 2 US
 *     Senators). A 535-person blast is neither deliverable nor meaningful, and
 *     there is no federal-executive data, so no executive group is offered.
 *
 * Each group is partitioned into `emailable` (a real inbox → batched into one
 * to+bcc compose) and `formOnly` (the `email` column holds an http contact-form
 * URL, or there's only a website → contacted individually via the shared
 * contact-form flow). Never batches a webform URL into a mailto recipient.
 *
 * Free-tier only (feeds mailto/Gmail/Outlook), and privacy-safe: officials are
 * public records, and the letter body (buildDefaultLetter) never emits the
 * sender's street address.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getUserLegislators, type UserCivicProfile } from "@/lib/legislators";
import { isContactFormUrl } from "./send-links";
import type { ComposeGroup, ComposeOfficial } from "./types";

type LegRow = {
  id: string;
  full_name: string;
  role: string;
  title: string | null;
  state: string;
  email: string | null;
  website: string | null;
};

const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri",
  MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
  OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  DC: "the District of Columbia",
};

function stateName(code: string | null | undefined): string {
  return (code && STATE_NAMES[code.toUpperCase()]) || "the state";
}

function toOfficial(l: LegRow): ComposeOfficial {
  return {
    id: l.id,
    name: l.full_name,
    role: l.role,
    title: l.title,
    state: l.state,
    email: l.email,
    website: l.website ?? null,
  };
}

/** Split a roster into batchable inboxes vs webform/website-only officials. */
function partition(rows: LegRow[]): Pick<ComposeGroup, "emailable" | "formOnly"> {
  const emailable: ComposeOfficial[] = [];
  const formOnly: ComposeOfficial[] = [];
  for (const l of rows) {
    const off = toOfficial(l);
    if (l.email && !isContactFormUrl(l.email)) emailable.push(off);
    else if (l.email || l.website) formOnly.push(off); // http-email or website-only
  }
  return { emailable, formOnly };
}

const nonEmpty = (g: { emailable: unknown[]; formOnly: unknown[] }): boolean =>
  g.emailable.length + g.formOnly.length > 0;

export type BillOfficialGroups = {
  scope: "state" | "federal";
  groups: ComposeGroup[];
  /** Federal bill but the viewer has no district on file — the UI prompts them
   *  to add their address instead of showing an empty/blast group. */
  needsProfile: boolean;
};

/**
 * Resolve the emailable groups for a bill. `viewerProfile` is only needed for
 * federal bills (to find the user's delegation); pass null when signed out.
 */
export async function getBillOfficialGroups(
  sb: SupabaseClient,
  bill: { state: string | null; scope: string | null },
  viewerProfile: UserCivicProfile | null,
): Promise<BillOfficialGroups> {
  const isFederal = bill.scope === "federal" || bill.state === "US";

  if (isFederal) {
    if (!viewerProfile?.state || !viewerProfile.congressional_district) {
      return { scope: "federal", groups: [], needsProfile: true };
    }
    const delegation = await getUserLegislators(sb, viewerProfile);
    const reps = delegation.filter((l) => l.role === "us_house").map((l) => l as unknown as LegRow);
    const sens = delegation.filter((l) => l.role === "us_senate").map((l) => l as unknown as LegRow);
    const federalGroups: ComposeGroup[] = [
      { key: "representatives", label: "Your U.S. Representative", greeting: "Representative", ...partition(reps) },
      { key: "senators", label: "Your U.S. Senators", greeting: "Senator", ...partition(sens) },
    ];
    return { scope: "federal", groups: federalGroups.filter(nonEmpty), needsProfile: false };
  }

  // State bill — whole-chamber + executive-trio targeting.
  const code = (bill.state ?? "").toUpperCase();
  if (!code) return { scope: "state", groups: [], needsProfile: false };
  const { data } = await sb
    .from("legislators")
    .select("id, full_name, role, title, state, email, website")
    .eq("state", code)
    .eq("active", true)
    .in("role", ["state_house", "state_senate", "governor", "lt_governor", "attorney_general"]);
  const rows = (data ?? []) as LegRow[];
  const byRole = (r: string) => rows.filter((l) => l.role === r);
  const sn = stateName(code);

  const stateGroups: ComposeGroup[] = [
    {
      key: "representatives",
      label: `All ${code} Representatives`,
      greeting: `Members of the ${sn} House of Representatives`,
      ...partition(byRole("state_house")),
    },
    {
      key: "senators",
      label: `All ${code} Senators`,
      greeting: `Members of the ${sn} Senate`,
      ...partition(byRole("state_senate")),
    },
    {
      key: "executives",
      label: "Governor, Lt. Governor & Attorney General",
      greeting: `Governor, Lt. Governor, and Attorney General of ${sn}`,
      ...partition([...byRole("governor"), ...byRole("lt_governor"), ...byRole("attorney_general")]),
    },
  ];

  return { scope: "state", groups: stateGroups.filter(nonEmpty), needsProfile: false };
}
