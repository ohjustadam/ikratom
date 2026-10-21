import type { Legislator } from "@/lib/legislators";
import { ROLE_SHORT } from "@/lib/legislators";

export type TemplateVars = {
  full_name: string;
  /** Always "" — street never enters an email body (privacy; see buildVars). */
  street: string;
  city: string;
  state: string;
  zip: string;
  legislator_name: string;
  legislator_role: string;
  /** "Senator", "Representative", "Mayor", "Council Member"… — for "Dear {{recipient_title}} {{recipient_last_name}}". */
  recipient_title: string;
  recipient_last_name: string;
  representatives: string;
};

/**
 * Fields that differ per recipient. Everything else describes the SENDER and is
 * the same in every copy of a letter. The composer fills the sender fields and
 * leaves these as placeholders, so the text a user edits is still a template
 * and each official gets their own name (2026-10-21: the box used to be filled
 * with the FIRST official's name, which is why one-click could not send it).
 */
export const RECIPIENT_FIELDS = [
  "legislator_name",
  "legislator_role",
  "recipient_title",
  "recipient_last_name",
  "representatives",
] as const;

/**
 * Render `{{var}}` placeholders in a template. Unknown vars left as-is.
 * Lines that contained only placeholders which all resolved empty are
 * dropped entirely — so a signature like `{{street}}\n{{city}}, {{state}}`
 * doesn't leave a stray blank line (or a dangling ", ") for users without
 * those fields.
 */
export function renderTemplate(tpl: string, vars: Partial<TemplateVars>): string {
  return tpl
    .split("\n")
    .map((line) => {
      let hadVar = false;
      let allEmpty = true;
      const rendered = line.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
        const v = (vars as Record<string, string | undefined>)[key];
        if (v === undefined) return `{{${key}}}`; // unknown var: keep + counts as content
        hadVar = true;
        if (v !== "") allEmpty = false;
        return v;
      });
      // Placeholder-only line where every var came back empty → drop the line.
      if (hadVar && allEmpty && rendered.replace(/[\s,]/g, "") === "") return null;
      // An empty field mid-line ("Dear {{title}} {{last_name}}," with no last
      // name) must not leave "Dear Senators ," behind.
      return hadVar
        ? rendered.replace(/[ \t]+([,.;:])/g, "$1").replace(/([^ \t])[ \t]{2,}/g, "$1 ").replace(/[ \t]+$/, "")
        : rendered;
    })
    .filter((l): l is string => l !== null)
    .join("\n");
}

/**
 * Every `{{placeholder}}` still in a letter. A send is refused while this is
 * non-empty: on 2026-10-21 we found nearly every one-click email ever sent had
 * opened "Dear {{recipient_title}} {{recipient_last_name}}," because the
 * renderer didn't know those two names and kept them verbatim.
 */
export function unfilledPlaceholders(text: string): string[] {
  return [...new Set([...String(text ?? "").matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]))];
}

/** "Poydras CDP" → "Poydras". A Census label never belongs in a signature. */
export function cleanCity(city: string | null | undefined): string {
  return String(city ?? "").replace(/\s+CDP$/i, "").trim();
}

const ASSEMBLY_STATES = new Set(["CA", "NV", "NY", "WI", "NJ"]);
const DELEGATE_STATES = new Set(["MD", "VA", "WV"]);

/** How to address an official in a salutation: "Senator", "Delegate", "Mayor"… */
export function recipientTitle(leg: Pick<Legislator, "role" | "state" | "title"> | null): string {
  if (!leg) return "";
  const t = String(leg.title ?? "");
  switch (leg.role) {
    case "us_senate":
    case "state_senate":
      return "Senator";
    case "us_house":
      return "Representative";
    case "state_house":
      if (ASSEMBLY_STATES.has(leg.state)) return "Assemblymember";
      if (DELEGATE_STATES.has(leg.state)) return "Delegate";
      return "Representative";
    case "mayor":
      return /village president/i.test(t) ? "President" : "Mayor";
    case "county_executive":
      return /judge/i.test(t) ? "Judge" : "County Executive";
    case "school_board":
      return "Board Member";
    default: {
      const m = /\b(alder(?:man|woman|person)|council ?(?:member|man|woman)|councilor|commissioner|supervisor|trustee|select(?:man|woman|board member)|legislator|freeholder|judge)\b/i.exec(t);
      if (m) return m[1].replace(/\b\w/g, (c) => c.toUpperCase()).replace(/^Councilmember$/i, "Council Member");
      return leg.role === "county_commissioner" ? "Commissioner" : leg.role === "city_council" ? "Council Member" : "";
    }
  }
}

/** 'F.B. "Rusty" Walker, IV' → "Walker"; "B.J. Sellers, Jr." → "Sellers". */
export function lastName(fullName: string | null | undefined): string {
  const words = String(fullName ?? "")
    .replace(/["“”][^"“”]*["“”]/g, " ") // quoted nicknames
    .replace(/\([^)]*\)/g, " ")
    .split(/[\s,]+/)
    .filter(Boolean)
    .filter((w) => !/^(jr|sr|ii|iii|iv|v|phd|md|esq)\.?$/i.test(w));
  return words[words.length - 1] ?? "";
}

/**
 * Generic recipient fields for a letter going to SEVERAL officials at once (a
 * mailto / web-compose with BCC), where one name can't be right for everyone.
 */
export function groupVars(targets: Pick<Legislator, "role" | "state" | "title" | "full_name">[]): Partial<TemplateVars> {
  if (targets.length === 1) return recipientVars(targets[0] as Legislator);
  const titles = [...new Set(targets.map((t) => recipientTitle(t)).filter(Boolean))];
  const group =
    titles.length === 1 ? `${titles[0]}s`.replace(/ss$/, "s")
    : titles.length === 2 ? `${titles[0]}s and ${titles[1]}s`
    : "Officials";
  return { recipient_title: group, recipient_last_name: "", legislator_name: group, legislator_role: "" };
}

/** The per-recipient fields for one official. */
export function recipientVars(leg: Legislator | null): Partial<TemplateVars> {
  return {
    legislator_name: leg?.full_name ?? "Representative",
    legislator_role: leg ? ROLE_SHORT[leg.role] ?? leg.role : "",
    recipient_title: recipientTitle(leg) || "Representative",
    recipient_last_name: leg ? lastName(leg.full_name) : "",
  };
}

export function buildVars(
  profile: {
    full_name: string | null;
    username?: string | null;
    street: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
  } | null,
  legislator: Legislator | null,
  allLegislators: Legislator[]
): TemplateVars {
  // Name fallback chain: full_name → @username → "an iKratom advocate".
  // Username-fallback is preferable to a blank because legislator
  // staffers triage anonymous-looking emails differently, but we flag
  // it client-side via missingFullName() so the editor can warn.
  const name =
    profile?.full_name?.trim() ||
    (profile?.username ? `@${profile.username}` : "") ||
    "an iKratom advocate";
  return {
    full_name: name,
    // PRIVACY (owner call 2026-07-09, docs/DECISIONS.md): the street address
    // NEVER enters an email body — advocates in prohibition states were
    // deleting their address to keep it out of letters, which also broke
    // district matching. profiles.street is used ONLY for district lookup;
    // city + state + zip carry the constituent signal in letters. Legacy
    // {{street}} placeholders render empty and renderTemplate drops the line.
    street: "",
    city: cleanCity(profile?.city),
    state: profile?.state ?? "",
    zip: profile?.zip ?? "",
    ...(recipientVars(legislator) as Pick<TemplateVars, "legislator_name" | "legislator_role" | "recipient_title" | "recipient_last_name">),
    representatives: allLegislators
      .map((l) => `${ROLE_SHORT[l.role] ?? ""} ${l.full_name}`.trim())
      .join(", "),
  };
}

/**
 * Fill only the SENDER's fields, leaving every recipient field as a
 * placeholder. This is what the composer shows and what one-click sends.
 */
export function renderSenderOnly(tpl: string, vars: TemplateVars): string {
  const senderOnly: Partial<TemplateVars> = { ...vars };
  for (const k of RECIPIENT_FIELDS) delete senderOnly[k];
  return renderTemplate(tpl, senderOnly);
}

/**
 * Make a letter true for someone who doesn't live where the officials serve.
 * The campaign templates say "I am a constituent in…" / "I'm writing as a
 * constituent…"; sent from Mississippi to 147 Oklahoma legislators, that is a
 * false statement in the sender's name (2026-10-21). Applied to the TEMPLATE
 * before the composer shows it, so the user sees, and can edit, exactly what
 * will go out; we never rewrite a user's own words behind their back.
 */
export function adaptForNonResident(tpl: string): string {
  return tpl
    .replace(/\bI am a constituent in (?=\{\{\s*city\s*\}\})/gi, "I live in ")
    .replace(/\bI(?:'m| am) a constituent in\b/gi, "I live in {{city}}, {{state}} and follow kratom policy in")
    .replace(/\b(?:I'm|I am) writing as a constituent\b/gi, "I'm writing from {{city}}, {{state}}")
    .replace(/\bas a constituent\b/gi, "as someone from {{city}}, {{state}}")
    .replace(/\bconstituents like me\b/gi, "advocates like me");
}

/**
 * True when the profile's full_name is missing — caller renders a
 * warning prompting the user to add it for higher-impact emails.
 */
export function missingFullName(profile: { full_name: string | null } | null): boolean {
  return !profile?.full_name?.trim();
}
