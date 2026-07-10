"use server";

import { createClient } from "@/lib/supabase/server";
import { completeStructured } from "@/lib/ai";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  buildDefaultLetter,
  type LetterContext,
  type OfficialLite,
} from "./default-letter";

/**
 * Server actions behind the shared email composer (EmailOfficialButton /
 * ComposeModal). One backend for every email surface — briefing, bill pages,
 * directories, dashboard — so drafting behaves identically platform-wide.
 *
 * PRIVACY: the AI prompt gets name + city/state + story fields only — never
 * street or ZIP (same rule as actions-personalize.ts). Signatures are
 * name + city/state.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Sanitize client-supplied strings before they touch an AI prompt or the DB. */
function clean(s: string | null | undefined, max: number): string | null {
  if (!s) return null;
  const t = s.replace(/[\r\n]+/g, " ").trim().slice(0, max);
  return t || null;
}

type OfficialInput = {
  /** legislators.id when the recipient is a tracked official (enables logging + server-side lookup) */
  officialId?: string | null;
  /** Display name — used only when officialId is absent (e.g. bill stakeholders) */
  officialName?: string | null;
  role?: string | null;
  title?: string | null;
  state?: string | null;
};

async function resolveOfficial(
  sb: Awaited<ReturnType<typeof createClient>>,
  input: OfficialInput,
): Promise<OfficialLite & { id: string | null }> {
  if (input.officialId && UUID_RE.test(input.officialId)) {
    const { data } = await sb
      .from("legislators")
      .select("id, full_name, role, title, state")
      .eq("id", input.officialId)
      .maybeSingle();
    if (data) return data;
  }
  return {
    id: null,
    full_name: clean(input.officialName, 80) ?? "the official",
    role: clean(input.role, 40),
    title: clean(input.title, 60),
    state: clean(input.state, 2),
  };
}

async function resolveBill(
  sb: Awaited<ReturnType<typeof createClient>>,
  billId: string | null | undefined,
): Promise<{ bill_number: string; title: string | null } | null> {
  if (!billId || !UUID_RE.test(billId)) return null;
  const { data } = await sb
    .from("bills")
    .select("bill_number, title")
    .eq("id", billId)
    .maybeSingle();
  return data ?? null;
}

/**
 * Instant, deterministic prefill for the compose modal — no AI. Returns the
 * default letter merged with the viewer's profile (or a generic letter when
 * signed out).
 */
export async function getComposePrefill(input: {
  official: OfficialInput;
  billId?: string | null;
  kind?: LetterContext["kind"];
  stance?: LetterContext["stance"];
  ask?: string | null;
}): Promise<{
  subject: string;
  body: string;
  signedIn: boolean;
  hasStory: boolean;
}> {
  try {
    const sb = await createClient();
    const { data: { user } } = await sb.auth.getUser();

    let sender: { fullName?: string | null; city?: string | null; state?: string | null } = {};
    let hasStory = false;
    if (user) {
      const { data: p } = await sb
        .from("profiles")
        .select("full_name, city, state, kratom_story")
        .eq("id", user.id)
        .single();
      sender = { fullName: p?.full_name, city: p?.city, state: p?.state };
      hasStory = !!p?.kratom_story && p.kratom_story.trim().length >= 80;
    }

    const [official, bill] = await Promise.all([
      resolveOfficial(sb, input.official),
      resolveBill(sb, input.billId),
    ]);

    const letter = buildDefaultLetter({
      official,
      sender,
      context: {
        kind: input.kind ?? (bill ? "bill" : "legislator"),
        billNumber: bill?.bill_number ?? null,
        billTitle: bill?.title ?? null,
        stance: input.stance ?? null,
        ask: clean(input.ask, 300),
      },
    });
    return { ...letter, signedIn: !!user, hasStory };
  } catch {
    // Never throw to the route error boundary — hand back a generic letter,
    // preserving the recipient's role/title/state so the greeting stays
    // correct ("Dear Governor Landry," not "Dear Landry,").
    const letter = buildDefaultLetter({
      official: {
        full_name: clean(input.official.officialName, 80) ?? "the official",
        role: input.official.role ?? null,
        title: input.official.title ?? null,
        state: input.official.state ?? null,
      },
      sender: {},
      context: input.kind
        ? { kind: input.kind, stance: input.stance ?? null, ask: clean(input.ask, 300) }
        : null,
    });
    return { ...letter, signedIn: false, hasStory: false };
  }
}

const DRAFT_SYSTEM_PROMPT = `You draft advocacy emails from kratom advocates to public officials.

You ARE the advocate writing. First person, 150-300 words. Sound like a real
person, not a form letter. Weave in ONE concrete personal detail when given
(their kratom story, years of use, advocate type).

Hard rules:
  1. Always distinguish NATURAL LEAF KRATOM from 7-OH-enriched / synthetic
     products. Most policymakers conflate them; the email must clarify.
  2. Respectful but direct. NO inflammatory language.
  3. Only claim to be the official's constituent if CONSTITUENT=true in the
     input. Otherwise write as an advocate following the issue.
  4. End with ONE specific, answerable ask (commit to a carve-out, share
     their position, support testing/labeling standards).
  5. NEVER include claims about kratom curing/treating any condition.
  6. Sign off exactly: 'Sincerely,\\n{NAME}\\n{CITY_STATE}' using the values
     given — never invent an address, never include a street address.

Return STRICT JSON:
{ "subject": "single-line subject under 80 chars", "body": "the email body in plain text" }`;

/**
 * AI-drafted email to a specific official — the uniform "✨ Draft with AI"
 * behind every compose surface. Free-tier router only (Groq → Ollama →
 * Gemini via completeStructured). Falls back to the deterministic letter so
 * the button always produces something.
 */
export async function draftOfficialEmail(input: {
  official: OfficialInput;
  billId?: string | null;
  kind?: LetterContext["kind"];
  stance?: LetterContext["stance"];
  ask?: string | null;
  tone?: "personal" | "formal" | "urgent";
}): Promise<
  | { ok: true; subject: string; body: string; provider: string }
  | { ok: false; error: string }
> {
  try {
    const sb = await createClient();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return { ok: false, error: "Sign in to use AI drafting." };

    // Shared hourly budget across compose surfaces (mirrors personalize's 8/hr).
    const allowed = await checkRateLimit(`ai-draft-official:user:${user.id}`, 8, 3_600);
    if (!allowed) {
      return { ok: false, error: "AI drafting is limited to 8 per hour. Edit the prefilled letter, or try again later." };
    }

    const [{ data: p }, official, bill] = await Promise.all([
      sb.from("profiles")
        .select("full_name, city, state, advocate_type, kratom_story, kratom_years, lose_if_banned")
        .eq("id", user.id)
        .single(),
      resolveOfficial(sb, input.official),
      resolveBill(sb, input.billId),
    ]);

    const sender = { fullName: p?.full_name, city: p?.city, state: p?.state };
    const askHint = clean(input.ask, 300);
    const context: LetterContext = {
      kind: input.kind ?? (bill ? "bill" : "legislator"),
      billNumber: bill?.bill_number ?? null,
      billTitle: bill?.title ?? null,
      stance: input.stance ?? null,
      ask: askHint,
    };
    const fallback = () => buildDefaultLetter({ official, sender, context });

    const isConstituent = !!p?.state && !!official.state && p.state === official.state;
    const tone = input.tone ?? "personal";
    const cityState = [p?.city, p?.state].filter(Boolean).join(", ");
    const personal: string[] = [];
    if (p?.advocate_type) personal.push(`Advocate type: ${p.advocate_type}`);
    if (p?.kratom_years) personal.push(`Years using kratom: ${p.kratom_years}`);
    if (p?.lose_if_banned) personal.push(`What's at stake if banned: ${String(p.lose_if_banned).slice(0, 300)}`);
    if (p?.kratom_story) personal.push(`Personal story (use ONE sentence if relevant): "${p.kratom_story.slice(0, 400)}"`);

    const userPrompt = `RECIPIENT:
  Name: ${official.full_name}
  Role: ${official.title ?? official.role ?? "public official"}
  State: ${official.state ?? "(unknown)"}
${bill ? `  Regarding bill: ${bill.bill_number}${bill.title ? ` — ${bill.title.slice(0, 120)}` : ""}` : ""}
${input.stance ? `  ASK POSTURE: the advocate wants to ${input.stance} this bill — make that the central, explicit request.` : ""}
${askHint ? `  SPECIFIC ASK: ${askHint}` : ""}

THE ADVOCATE writing:
  Name: ${p?.full_name ?? "(not set — sign as 'A concerned advocate')"}
  CITY_STATE: ${cityState || "(unset — omit the locality line)"}
  CONSTITUENT=${isConstituent}
  ${personal.join("\n  ") || "(no personal details available)"}

TONE: ${tone}

Write the email now.`;

    const schema = {
      type: "object" as const,
      properties: {
        subject: { type: "string" as const },
        body: { type: "string" as const },
      },
      required: ["subject", "body"],
    };

    try {
      const r = await completeStructured<{ subject: string; body: string }>(
        "general",
        [
          { role: "system", content: DRAFT_SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        schema,
        { preferSpeed: true },
        { maxTokens: 900, temperature: 0.5 },
      );
      const subject = (r.data?.subject ?? "").slice(0, 200);
      const body = (r.data?.body ?? "").slice(0, 4000);
      if (!subject || !body || body.length < 80) {
        const fb = fallback();
        return { ok: true, ...fb, provider: "template" };
      }
      return { ok: true, subject, body, provider: r.provider };
    } catch {
      const fb = fallback();
      return { ok: true, ...fb, provider: "template" };
    }
  } catch {
    return { ok: false, error: "Couldn't draft right now. Please try again in a moment." };
  }
}

/**
 * Best-effort log of a direct (non-campaign) send. Called fire-and-forget
 * when the user opens a compose window / copies the message — same convention
 * as CampaignAction (external sends log as method 'mailto').
 */
export async function logOfficialContact(input: {
  officialId?: string | null;
  source: string;
  subject: string;
  body: string;
}): Promise<{ ok: boolean }> {
  try {
    const sb = await createClient();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return { ok: false };

    // Light anti-junk cap — direct sends are one-offs, not batches.
    const allowed = await checkRateLimit(`direct-log:user:${user.id}`, 60, 3_600);
    if (!allowed) return { ok: false };

    const officialId =
      input.officialId && UUID_RE.test(input.officialId) ? input.officialId : null;
    const source = clean(input.source, 40) ?? "compose";

    const { error } = await sb.from("campaign_actions").insert({
      user_id: user.id,
      campaign_id: null,
      legislator_id: officialId,
      method: "mailto",
      subject: input.subject.slice(0, 500),
      body: input.body.slice(0, 8000),
      source,
    });
    // Achievement points accrue via the campaign_actions insert trigger
    // (Academy P1, mig 0236) — one award per contacted official, skipped when
    // there's no tracked official id, so ad-hoc/stakeholder sends can't farm.
    return { ok: !error };
  } catch {
    return { ok: false };
  }
}
