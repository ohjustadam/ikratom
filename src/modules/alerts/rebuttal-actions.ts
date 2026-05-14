"use server";

import { createClient } from "@/lib/supabase/server";
import { completeStructured } from "@/lib/ai";

/**
 * Server action: draft an opposition / support / public-comment letter
 * in response to a policy_alert, personalized to the signed-in user.
 *
 * The mission lever: well-funded astroturf groups submit hundreds of
 * polished form-letter comments during BoP rule windows. Grassroots
 * advocates typically submit 12 hand-typed ones. This action equalizes
 * by generating individually-personalized letters that the advocate
 * reviews + edits before submitting — so each one reads as a real
 * advocate's voice, not bot output.
 *
 * Returns `{ subject, body }` markdown for the UI to render + copy.
 */

const SYSTEM_PROMPT = `You draft public comment letters for kratom advocates.

You ARE the advocate writing. Use first person. Keep it 200-400 words.
Sound like a real person, not a form letter. Include ONE concrete personal
detail when given in the input (their kratom story, advocate type, state).

Hard rules:
  1. Always distinguish NATURAL LEAF KRATOM from 7-OH-enriched / synthetic
     products. Most policymakers conflate them; the rebuttal must clarify.
  2. Be respectful but direct. NO inflammatory language.
  3. Cite ONE concrete fact (study, FDA statement, real death-toll comparison
     vs alcohol/opioids) when relevant — but don't fabricate citations.
  4. End with a SPECIFIC ASK ('do not advance HB 1649', 'extend the comment
     period 30 days', 'add a natural-leaf carve-out').
  5. NEVER include claims about kratom curing/treating any condition.
     Federal law treats those as drug claims.

Return STRICT JSON inside <result>...</result>:
<result>
{
  "subject": "single-line email subject (under 80 chars)",
  "body": "the letter body in plain text or light markdown. include
            signature line at the end: 'Sincerely, {FIRST_NAME}\\n{CITY}, {STATE}'"
}
</result>`;

function buildUserPrompt(input: {
  alertTitle: string;
  alertBody: string | null;
  alertKind: string;
  alertLocality: string | null;
  fullName: string | null;
  state: string | null;
  city: string | null;
  advocateType: string | null;
  kratomStory: string | null;
  kratomYears: number | null;
  tone: string;
}): string {
  const personalLines: string[] = [];
  if (input.advocateType) personalLines.push(`Advocate type: ${input.advocateType}`);
  if (input.kratomYears) personalLines.push(`Has used kratom for: ${input.kratomYears} years`);
  if (input.kratomStory) personalLines.push(`Personal story (use ONE sentence from this if relevant): "${input.kratomStory.slice(0, 400)}"`);

  return `ALERT being responded to:
  Title: ${input.alertTitle}
  Kind: ${input.alertKind}
  Locality: ${input.alertLocality ?? "(federal/national)"}
  ${input.alertBody ? `Details:\n${input.alertBody.slice(0, 1200)}` : ""}

THE ADVOCATE writing this letter:
  Name: ${input.fullName ?? "(name not set — use 'A Kratom Advocate')"}
  City/State: ${[input.city, input.state].filter(Boolean).join(", ") || "(unset)"}
  ${personalLines.join("\n  ") || "(no personal details available)"}

TONE: ${input.tone}

Write the letter the advocate would submit to the relevant agency/legislator.`;
}

export async function draftAlertResponse(input: {
  alertId: string;
  tone?: "formal" | "personal" | "urgent";
}): Promise<
  | { ok: true; subject: string; body: string; provider: string }
  | { ok: false; error: string }
> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { ok: false, error: "Sign in to draft a response." };

  // Load alert + profile in parallel
  const [alertResult, profileResult] = await Promise.all([
    sb.from("policy_alerts")
      .select("id, kind, severity, title, body, locality")
      .eq("id", input.alertId)
      .eq("moderation_status", "approved")
      .maybeSingle(),
    sb.from("profiles")
      .select("full_name, state, city, advocate_type, kratom_story, kratom_years")
      .eq("id", user.id)
      .single(),
  ]);

  if (alertResult.error || !alertResult.data) {
    return { ok: false, error: "Alert not found or not approved." };
  }
  const alert = alertResult.data;
  const profile = profileResult.data ?? {};

  const tone = input.tone ?? "personal";

  const p = profile as {
    full_name?: string | null;
    state?: string | null;
    city?: string | null;
    advocate_type?: string | null;
    kratom_story?: string | null;
    kratom_years?: number | null;
  };

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
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: buildUserPrompt({
            alertTitle: alert.title,
            alertBody: alert.body,
            alertKind: alert.kind,
            alertLocality: alert.locality,
            fullName: p.full_name ?? null,
            state: p.state ?? null,
            city: p.city ?? null,
            advocateType: p.advocate_type ?? null,
            kratomStory: p.kratom_story ?? null,
            kratomYears: p.kratom_years ?? null,
            tone,
          }),
        },
      ],
      schema,
      { preferSpeed: true },
      { maxTokens: 900, temperature: 0.5 },
    );

    const subject = (r.data?.subject ?? "").slice(0, 200)
      || `Comment re: ${alert.title.slice(0, 60)}`;
    const body = (r.data?.body ?? "").slice(0, 4000);
    if (!body || body.length < 80) {
      return { ok: false, error: "AI returned an unusably short response. Try again or compose manually." };
    }
    return { ok: true, subject, body, provider: r.provider };
  } catch (e) {
    return { ok: false, error: `Generation failed: ${(e as Error).message?.slice(0, 200)}` };
  }
}
