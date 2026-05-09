import type { Legislator } from "@/lib/legislators";
import { ROLE_SHORT } from "@/lib/legislators";

export type TemplateVars = {
  full_name: string;
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
 */
export function renderTemplate(tpl: string, vars: Partial<TemplateVars>): string {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
    const v = (vars as Record<string, string | undefined>)[key];
    return v ?? `{{${key}}}`;
  });
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
    street: profile?.street ?? "",
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
