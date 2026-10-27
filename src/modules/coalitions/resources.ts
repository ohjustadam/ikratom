/**
 * Pinned resources + testimony templates (migration 0293): the pure half, so
 * the form, the server action and the tests share one set of rules. The
 * table's check constraints are the authority; these mirror them.
 */

export type ResourceKind = "link" | "template";
export type ResourceInput = { kind: ResourceKind; title: string; note?: string; url?: string; subject?: string; body?: string };
export type ResourceRow = {
  id: string; kind: ResourceKind; title: string; note: string | null;
  url: string | null; subject: string | null; body: string | null; created_by: string; created_at: string;
};

/** The placeholders a group template may use; the composer fills them per member and per official. */
export const TEMPLATE_PLACEHOLDERS = ["official_greeting", "official_name", "my_name", "my_city", "my_state"] as const;

/** How a template reads on its page before a member sends it. */
export const PLACEHOLDER_PREVIEW: Record<(typeof TEMPLATE_PLACEHOLDERS)[number], string> = {
  official_greeting: "[official's name]",
  official_name: "[official's name]",
  my_name: "[your name]",
  my_city: "[your city]",
  my_state: "[your state]",
};

/** What a new template starts from. ___ marks what each member fills in before sending. */
export const STARTER_TEMPLATE = {
  subject: "Please support sensible kratom rules",
  body: [
    "Dear {{official_greeting}},",
    "I'm {{my_name}} from {{my_city}}, {{my_state}}, and I'm writing about ___.",
    "Natural-leaf kratom is used by millions of adults. Please keep it separate from concentrated 7-OH and synthetic products, and support 21+ sales, accurate labels and lab testing instead of a ban.",
    "Will you ___?",
    "Thank you for your time.",
    "Sincerely,\n{{my_name}}\n{{my_city}}, {{my_state}}",
  ].join("\n\n"),
};

const HTTP_RE = /^https?:\/\/[^\s]+$/i;

export function validateResource(input: ResourceInput):
  | { ok: true; row: { kind: ResourceKind; title: string; note: string | null; url: string | null; subject: string | null; body: string | null } }
  | { ok: false; error: string } {
  const kind = input?.kind;
  if (kind !== "link" && kind !== "template") return { ok: false, error: "Pick a link or a template." };
  const title = String(input.title ?? "").trim();
  if (title.length < 3 || title.length > 120) return { ok: false, error: "Give it a title of 3–120 characters." };
  const note = String(input.note ?? "").trim() || null;
  if (note && note.length > 500) return { ok: false, error: "Keep the note under 500 characters." };
  if (kind === "link") {
    const url = String(input.url ?? "").trim();
    if (!HTTP_RE.test(url) || url.length > 2000) return { ok: false, error: "Paste a full web address starting with https://" };
    return { ok: true, row: { kind, title, note, url, subject: null, body: null } };
  }
  const subject = String(input.subject ?? "").trim() || null;
  if (subject && subject.length > 200) return { ok: false, error: "Keep the subject under 200 characters." };
  const body = String(input.body ?? "").trim();
  if (!body || body.length > 5000) return { ok: false, error: "Write the template (up to 5,000 characters)." };
  return { ok: true, row: { kind, title, note, url: null, subject, body } };
}
