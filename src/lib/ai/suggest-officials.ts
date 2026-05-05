/**
 * AI-assisted local-official suggestions via Google Gemini with Search grounding.
 * Server-only — never import in client components (uses GEMINI_API_KEY).
 *
 * FREE TIER: 1M tokens/day, 15 requests/min. A typical city lookup uses ~5–10K
 * tokens, so ~100+ queries/day on free tier.
 *
 * Always requires human review — never auto-inserts.
 */

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
};

export type SuggestResult =
  | { ok: true; locality: string; officials: SuggestedOfficial[]; sources: string[] }
  | { error: string };

const SYSTEM = `You are a research assistant that finds current elected local government officials in US cities and counties.

Use Google Search to find authoritative sources (the city's official .gov site, official county pages, state-level rosters). Do NOT guess. If a piece of info isn't on a verifiable source, leave it null.

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
      "source_note": "Sourced from cityname.gov/council, accessed YYYY-MM-DD"
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
}): Promise<SuggestResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { error: "GEMINI_API_KEY not configured. Get a free key at aistudio.google.com." };
  }

  const city = input.city.trim();
  const state = input.state.trim().toUpperCase();
  if (!city) return { error: "City is required." };
  if (!/^[A-Z]{2}$/.test(state)) return { error: "State must be 2-letter code." };

  const isCounty = /county$/i.test(city);
  const userPrompt = isCounty
    ? `Find the current ${city} ${state} commissioners / supervisors and county executive (or judge-executive). Search the official county government website first.`
    : `Find the current Mayor and ALL City Council members for ${city}, ${state}. Search the official city government website (look for .gov or .us domains) first.`;

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
    return { error: `Gemini fetch failed: ${(e as Error).message}` };
  }

  if (!res.ok) {
    const body = await res.text();
    return { error: `Gemini ${res.status}: ${body.slice(0, 300)}` };
  }

  const data = await res.json();
  const candidate = data.candidates?.[0];
  if (!candidate) return { error: "Gemini returned no candidates." };

  const finalText: string = (candidate.content?.parts ?? [])
    .map((p: { text?: string }) => p.text ?? "")
    .join("\n");

  const m = finalText.match(/<result>([\s\S]*?)<\/result>/);
  if (!m) {
    return { error: `Model did not return a <result> block. Got: ${finalText.slice(0, 200)}…` };
  }

  let parsed: { officials: SuggestedOfficial[]; sources?: string[] };
  try {
    parsed = JSON.parse(m[1].trim());
  } catch (e) {
    return { error: `Could not parse JSON: ${(e as Error).message}` };
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

  return { ok: true, locality: `${city}, ${state}`, officials, sources };
}
