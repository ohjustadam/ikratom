/**
 * Pre-written letter templates with {{placeholders}} (owner ask 2026-10-03:
 * "pre-author templates, plug in information, prompt to fill in anything
 * missing so the letter is complete").
 *
 * Rules every template follows (same as the AI drafter's system prompt):
 * natural-leaf kratom is distinguished from 7-OH / synthetic products; no
 * medical claims; one specific ask; respectful; nonpartisan; never a street
 * address. Placeholders the platform knows are filled automatically; the rest
 * are asked for before the letter can be sent.
 */
export type LetterTemplate = {
  id: string;
  label: string;
  /** Which composer contexts offer it. */
  for: Array<"local" | "bill" | "legislator">;
  subject: string;
  body: string;
};

/** Friendly prompts for placeholders the sender must supply themselves. */
export const PLACEHOLDER_PROMPTS: Record<string, { label: string; hint: string; optional?: boolean }> = {
  my_name: { label: "Your name", hint: "How you sign the letter" },
  my_city: { label: "Your city", hint: "Officials weigh local voices most" },
  my_state: { label: "Your state", hint: "Two letters, e.g. NY" },
  my_story: { label: "Why kratom matters to you", hint: "One or two sentences in your own words. This is what officials remember.", optional: true },
  body_name: { label: "The body voting", hint: "e.g. Town Board, City Council" },
  locality: { label: "Town or county", hint: "e.g. Clifton Park, NY" },
  meeting_date: { label: "Meeting date", hint: "e.g. October 6" },
  bill_number: { label: "Bill number", hint: "e.g. HB 1649" },
  official_greeting: { label: "Who you are writing to", hint: "e.g. Members of the Town Board" },
};

export const LETTER_TEMPLATES: LetterTemplate[] = [
  {
    id: "hearing_regulate_not_ban",
    label: "Hearing: regulate, don't ban",
    for: ["local"],
    subject: "Kratom item at the {{meeting_date}} {{body_name}} meeting",
    body:
`Dear {{official_greeting}},

I'm writing about the kratom item on the {{body_name}}'s {{meeting_date}} agenda. I'm {{my_name}} from {{my_city}}, {{my_state}}.

{{my_story}}

Please separate natural-leaf kratom, a plant used by millions of adults, from the concentrated 7-OH and synthetic products that are driving the headlines. A ban on the natural leaf pushes adults toward an unregulated market; sensible rules do the opposite: 21+ sales, accurate labels, and lab testing.

Will you support regulating natural-leaf kratom instead of banning it, and act against concentrated 7-OH and synthetic products specifically?

Sincerely,
{{my_name}}
{{my_city}}, {{my_state}}`,
  },
  {
    id: "hearing_written_comment",
    label: "Written public comment for the record",
    for: ["local"],
    subject: "Written public comment: kratom item, {{meeting_date}}",
    body:
`To the {{body_name}}:

Please enter this comment into the record for the {{meeting_date}} meeting.

My name is {{my_name}}, of {{my_city}}, {{my_state}}. {{my_story}}

I ask the {{body_name}} to distinguish natural-leaf kratom from concentrated 7-OH and synthetic products, and to choose age limits, labeling and testing standards over a ban on the natural leaf.

Thank you for your time and consideration.

{{my_name}}
{{my_city}}, {{my_state}}`,
  },
  {
    id: "kcpa_support",
    label: "Support a Kratom Consumer Protection Act",
    for: ["bill", "legislator"],
    subject: "Please support kratom consumer protections{{bill_suffix}}",
    body:
`Dear {{official_greeting}},

I'm {{my_name}}, writing from {{my_city}}, {{my_state}}.

{{my_story}}

A Kratom Consumer Protection Act keeps natural-leaf kratom legal for adults while setting real rules: 21+ sales, accurate labeling, lab testing, and limits on concentrated 7-OH and synthetic products. It protects consumers without pushing them to an unregulated market.

Will you support these protections{{bill_suffix}}?

Sincerely,
{{my_name}}
{{my_city}}, {{my_state}}`,
  },
  {
    id: "request_meeting",
    label: "Request a short meeting",
    for: ["local", "bill", "legislator"],
    subject: "Request: 15 minutes to discuss kratom policy",
    body:
`Dear {{official_greeting}},

My name is {{my_name}}, from {{my_city}}, {{my_state}}. {{my_story}}

I'd value 15 minutes, in person or by phone, to share how kratom policy affects people here and what sensible regulation looks like: protecting natural-leaf kratom for adults while acting on concentrated 7-OH and synthetic products.

Would you or your staff have time in the next few weeks?

Thank you,
{{my_name}}
{{my_city}}, {{my_state}}`,
  },
  {
    id: "thank_you",
    label: "Thank you for your position",
    for: ["local", "bill", "legislator"],
    subject: "Thank you for your stand on kratom",
    body:
`Dear {{official_greeting}},

Thank you for your position on kratom. I'm {{my_name}} from {{my_city}}, {{my_state}}, and it matters to me and to many people here. {{my_story}}

I'll keep following this issue and I appreciate your attention to the difference between natural-leaf kratom and concentrated 7-OH and synthetic products.

With thanks,
{{my_name}}
{{my_city}}, {{my_state}}`,
  },
];

const RX = /\{\{([a-z_]+)\}\}/g;

/** Placeholders a text uses, in order of first appearance. */
export function placeholdersIn(...texts: string[]): string[] {
  const seen: string[] = [];
  for (const t of texts) for (const m of t.matchAll(RX)) if (!seen.includes(m[1])) seen.push(m[1]);
  return seen;
}

/** Required placeholders that still have no value (optional ones never block). */
export function missingRequired(names: string[], values: Record<string, string | null | undefined>): string[] {
  return names.filter((n) => !(values[n] ?? "").trim() && !PLACEHOLDER_PROMPTS[n]?.optional);
}

/** Fill placeholders; an empty optional one collapses with its blank line. */
export function fillTemplate(text: string, values: Record<string, string | null | undefined>): string {
  return text
    .replace(RX, (_, k: string) => (values[k] ?? "").trim())
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

export function templatesFor(kind: "local" | "bill" | "legislator"): LetterTemplate[] {
  return LETTER_TEMPLATES.filter((t) => t.for.includes(kind));
}
