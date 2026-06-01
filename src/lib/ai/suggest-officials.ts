/**
 * AI-assisted local-official suggestions via Google Gemini with Search grounding.
 * Server-only — never import in client components (uses GEMINI_API_KEY).
 *
 * Quota reality: Gemini Flash with `google_search` grounding is capped well
 * below the non-grounded 1M-token/day allotment — ~500 grounded queries/
 * project/day on free tier. The Sunday weekly cron + ad-hoc admin clicks
 * burned through that in one tick before migration 0169. The
 * grounding-budget guard now hard-stops at site_config.gemini_grounded_
 * daily_cap (default 400) before each call.
 *
 * Always requires human review — never auto-inserts.
 */

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  assertGroundingBudget,
  GroundingQuotaError,
  recordGroundingCall,
} from "./grounding-budget";

const MODEL = "gemini-2.5-flash";
const API = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

export type SuggestedOfficial = {
  full_name: string;
  role: "mayor" | "city_council" | "county_executive" | "county_commissioner" | "school_board" | "other_local";
  title: string | null;
  district: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  party: string | null;
  source_note: string | null;
  /** ISO date when the official's current term ends, if discoverable
   *  on the source page (e.g. "term expires January 2028" → 2028-01-01).
   *  Cron uses this to auto-retire stale entries — see migration 0148. */
  term_end_date: string | null;
  /** Specific source URL that cited this official by name. The verifier
   *  pass fetches this URL to confirm the name appears before auto-accept. */
  source_url: string | null;
};

export type SuggestResult =
  | { ok: true; locality: string; officials: SuggestedOfficial[]; sources: string[] }
  | {
      error: string;
      /** When true, caller should NOT stamp the row as terminally
       *  processed — the call failed for quota / transient reasons
       *  and will likely succeed on a future retry. */
      transient?: boolean;
    };

const SYSTEM = `You are a research assistant that finds current elected local government officials in US cities and counties.

Use Google Search to find authoritative sources (the city's official .gov site, official county pages, state-level rosters). Do NOT guess. If a piece of info isn't on a verifiable source, leave it null.

For EACH official you return, you MUST provide a specific source_url — a direct link to the page that names that person. This URL will be verified downstream (our system fetches the page and confirms the name appears). If you can't supply a verifiable source_url for an official, omit that entry entirely.

When the source page mentions when the official's term ends (e.g. "term expires January 2028", "serving through 2027", "up for re-election November 2026"), capture term_end_date as YYYY-MM-DD (use month=01 day=01 if only year is known, or the election month if known). Otherwise null.

Return ONLY a JSON object inside <result>...</result> tags with this exact shape:

<result>
{
  "officials": [
    {
      "full_name": "Jane Doe",
      "role": "mayor" | "city_council" | "county_executive" | "county_commissioner" | "school_board" | "other_local",
      "title": "Mayor" | "Council Member, District 4" | etc,
      "district": "4" | null,
      "email": "jane.doe@city.gov" | null,
      "phone": "555-555-5555" | null,
      "website": "https://..." | null,
      "party": "Democratic" | "Republican" | "Nonpartisan" | null,
      "source_note": "Sourced from cityname.gov/council, accessed YYYY-MM-DD",
      "term_end_date": "2028-01-01" | null,
      "source_url": "https://cityname.gov/council/jane-doe"
    }
  ],
  "sources": ["url1", "url2"]
}
</result>

Rules:
- Include the mayor + ALL current city council members for cities.
- Include the county executive + ALL current county commissioners for counties.
- Skip school boards unless explicitly asked.
- If you cannot find verifiable current data, return an empty officials array with an explanation in sources.
- Phone numbers in 555-555-5555 format.
- Never fabricate emails. If only a contact form is published, put the form URL in website and leave email null.
- Output ONLY the <result>...</result> block. No prose before or after.`;

export async function suggestLocalOfficials(input: {
  city: string;
  state: string;
  /** Caller label for ai_jobs (e.g. "admin-inline-suggest" or
   *  "reverify-local-officials"). Defaults to "suggest-officials". */
  caller?: string;
}): Promise<SuggestResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { error: "GEMINI_API_KEY not configured. Get a free key at aistudio.google.com." };
  }

  const city = input.city.trim();
  const state = input.state.trim().toUpperCase();
  if (!city) return { error: "City is required." };
  if (!/^[A-Z]{2}$/.test(state)) return { error: "State must be 2-letter code." };

  const sb = createServiceRoleClient();
  const caller = input.caller ?? "suggest-officials";

  // Budget guard: bail BEFORE hitting Gemini if today's cap is reached.
  // Cheap (one indexed count + one single-row select) and prevents the
  // "every admin click returns raw 429" UX. quota_exhausted is marked
  // transient=true so callers leave their work item open for tomorrow.
  try {
    await assertGroundingBudget(sb);
  } catch (e) {
    if (e instanceof GroundingQuotaError) {
      return { error: e.message, transient: true };
    }
    throw e;
  }

  const isCounty = /county$/i.test(city);
  const userPrompt = isCounty
    ? `Find the current ${city} ${state} commissioners / supervisors and county executive (or judge-executive). Search the official county government website first.`
    : `Find the current Mayor and ALL City Council members for ${city}, ${state}. Search the official city government website (look for .gov or .us domains) first.`;

  const startedAt = Date.now();
  let res: Response;
  try {
    res = await fetch(`${API}?key=${apiKey}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        systemInstruction: { parts: [{ text: SYSTEM }] },
        tools: [{ google_search: {} }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 4096,
        },
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    const msg = `Gemini fetch failed: ${(e as Error).message}`;
    await recordGroundingCall(sb, {
      caller,
      status: "failure",
      error: msg,
      elapsedMs: Date.now() - startedAt,
      promptPreview: userPrompt,
    });
    return { error: msg, transient: true };
  }

  if (!res.ok) {
    const body = await res.text();
    const msg = `Gemini ${res.status}: ${body.slice(0, 300)}`;
    await recordGroundingCall(sb, {
      caller,
      status: "failure",
      error: msg,
      elapsedMs: Date.now() - startedAt,
      promptPreview: userPrompt,
    });
    // 429 / 5xx are retryable; 4xx other than 429 (bad key, malformed)
    // generally aren't.
    const transient = res.status === 429 || res.status >= 500;
    return { error: msg, transient };
  }

  const data = await res.json();
  const candidate = data.candidates?.[0];
  if (!candidate) return { error: "Gemini returned no candidates." };

  const finalText: string = (candidate.content?.parts ?? [])
    .map((p: { text?: string }) => p.text ?? "")
    .join("\n");

  const m = finalText.match(/<result>([\s\S]*?)<\/result>/);
  if (!m) {
    const msg = `Model did not return a <result> block. Got: ${finalText.slice(0, 200)}…`;
    await recordGroundingCall(sb, {
      caller,
      status: "failure",
      error: msg,
      elapsedMs: Date.now() - startedAt,
      promptPreview: userPrompt,
    });
    return { error: msg };
  }

  let parsed: { officials: SuggestedOfficial[]; sources?: string[] };
  try {
    parsed = JSON.parse(m[1].trim());
  } catch (e) {
    const msg = `Could not parse JSON: ${(e as Error).message}`;
    await recordGroundingCall(sb, {
      caller,
      status: "failure",
      error: msg,
      elapsedMs: Date.now() - startedAt,
      promptPreview: userPrompt,
    });
    return { error: msg };
  }

  const officials = Array.isArray(parsed.officials) ? parsed.officials : [];

  // Combine model-stated sources with grounding metadata URLs from Google Search
  const stated = Array.isArray(parsed.sources) ? parsed.sources : [];
  const groundingChunks = candidate.groundingMetadata?.groundingChunks ?? [];
  const groundingUrls: string[] = groundingChunks
    .map((c: { web?: { uri?: string } }) => c.web?.uri)
    .filter((u: unknown): u is string => typeof u === "string");
  const sources = Array.from(new Set([...stated, ...groundingUrls]));

  // Sanitize role values
  const validRoles = new Set([
    "mayor", "city_council", "county_executive",
    "county_commissioner", "school_board", "other_local",
  ]);
  for (const o of officials) {
    if (!validRoles.has(o.role)) o.role = "other_local";
  }

  await recordGroundingCall(sb, {
    caller,
    status: "success",
    elapsedMs: Date.now() - startedAt,
    promptPreview: userPrompt,
    metadata: { officials_returned: officials.length, sources_count: sources.length },
  });

  return { ok: true, locality: `${city}, ${state}`, officials, sources };
}
