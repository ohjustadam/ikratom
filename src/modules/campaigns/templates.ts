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
  representatives: string;
};

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
      return rendered;
    })
    .filter((l): l is string => l !== null)
    .join("\n");
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
    city: profile?.city ?? "",
    state: profile?.state ?? "",
    zip: profile?.zip ?? "",
    legislator_name: legislator?.full_name ?? "Representative",
    legislator_role: legislator ? ROLE_SHORT[legislator.role] ?? legislator.role : "",
    representatives: allLegislators
      .map((l) => `${ROLE_SHORT[l.role] ?? ""} ${l.full_name}`.trim())
      .join(", "),
  };
}

/**
 * True when the profile's full_name is missing — caller renders a
 * warning prompting the user to add it for higher-impact emails.
 */
export function missingFullName(profile: { full_name: string | null } | null): boolean {
  return !profile?.full_name?.trim();
}
