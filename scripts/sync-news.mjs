#!/usr/bin/env node
/**
 * iKratom — Daily news scraper.
 *
 * Uses Gemini (free tier) with Google Search grounding to find recent
 * kratom-related news, AI-summarize, score relevance, and store per-state.
 *
 * Run with: node --env-file=.env.local scripts/sync-news.mjs
 *           node --env-file=.env.local scripts/sync-news.mjs OK    # single state
 *           node --env-file=.env.local scripts/sync-news.mjs FED   # federal-only
 *
 * Cron-able: schedule daily at 7am ET via Vercel Cron / external cron service.
 */

import { createClient } from "@supabase/supabase-js";

const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM",
  "NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA",
  "WV","WI","WY",
];

const STATE_NAMES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_API = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const SYSTEM = `You are a news researcher tracking kratom-related news in the United States.

Use Google Search to find news articles about kratom, mitragynine, 7-OH (7-hydroxymitragynine), or kratom legislation/regulation in the LAST 30 DAYS for the given scope.

Return ONLY a JSON object inside <result>...</result> tags:

<result>
{
  "items": [
    {
      "title": "Original article title",
      "summary": "2-3 sentence neutral summary, factual",
      "url": "https://...",
      "source_name": "AP" | "Reuters" | "Tulsa World" | etc.,
      "published_at": "YYYY-MM-DD" or null if unknown,
      "kratom_topic": "legislation" | "science" | "business" | "enforcement" | "culture",
      "ai_relevance_score": 0.95
    }
  ]
}
</result>

Rules:
- Find the 5-10 most relevant articles in the last 30 days.
- ai_relevance_score is 0.00 to 1.00 — higher = more directly about kratom.
- Skip results that are pure pharmaceutical industry pieces unrelated to kratom advocacy.
- URLs must be real, working URLs (no fabrications).
- Output ONLY the <result>...</result> block.`;

const apiKey = process.env.GEMINI_API_KEY;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!apiKey || !supabaseUrl || !serviceKey) {
  console.error("Missing env vars (GEMINI_API_KEY / Supabase keys)");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchNews(scope, attempt = 0) {
  const userPrompt = scope === "FED"
    ? `Find recent (last 30 days) federal-level kratom news in the United States. Focus on FDA, DEA, Congress, federal court rulings, and 7-OH legislation.`
    : `Find recent (last 30 days) kratom-related news in ${STATE_NAMES[scope]} (${scope}). Include any local bans, KCPA progress, court cases, busts, advocacy efforts.`;

  const res = await fetch(`${GEMINI_API}?key=${apiKey}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      systemInstruction: { parts: [{ text: SYSTEM }] },
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (res.status === 429 && attempt < 3) {
    const delay = (attempt + 1) * 60_000;
    console.log(`    rate limited — waiting ${delay / 1000}s and retrying…`);
    await sleep(delay);
    return fetchNews(scope, attempt + 1);
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = (data.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? "")
    .join("\n");
  const m = text.match(/<result>([\s\S]*?)<\/result>/);
  if (!m) throw new Error(`no <result> block`);
  const parsed = JSON.parse(m[1].trim());
  return parsed.items ?? [];
}

async function syncScope(scope) {
  process.stdout.write(`  ${scope}: `);
  let items;
  try {
    items = await fetchNews(scope);
  } catch (e) {
    console.log(`FAILED — ${e.message}`);
    return { scope, count: 0, error: e.message };
  }

  if (!Array.isArray(items) || items.length === 0) {
    console.log("0 items found");
    return { scope, count: 0 };
  }

  const cap = (s, n) => (s ? String(s).slice(0, n).trim() || null : null);
  const validTopics = new Set(["legislation", "science", "business", "enforcement", "culture"]);

  const rows = items
    .filter((i) => i.url && i.title && /^https?:\/\//.test(i.url))
    .map((i) => ({
      state: scope === "FED" ? null : scope,
      title: cap(i.title, 300),
      summary: cap(i.summary, 1000),
      url: cap(i.url, 1000),
      source_name: cap(i.source_name, 100),
      published_at: i.published_at ? new Date(i.published_at).toISOString() : null,
      kratom_topic: validTopics.has(i.kratom_topic) ? i.kratom_topic : null,
      ai_relevance_score: typeof i.ai_relevance_score === "number"
        ? Math.max(0, Math.min(1, i.ai_relevance_score))
        : 0.5,
    }));

  if (rows.length === 0) {
    console.log("0 valid");
    return { scope, count: 0 };
  }

  const { error } = await supabase
    .from("news_items")
    .upsert(rows, { onConflict: "url", ignoreDuplicates: true });

  if (error) {
    console.log(`DB ERROR — ${error.message}`);
    return { scope, count: 0, error: error.message };
  }
  console.log(`${rows.length} items`);
  return { scope, count: rows.length };
}

// ---------- main ----------
const arg = process.argv[2]?.toUpperCase();
let targets;
if (!arg) {
  targets = ["FED", ...STATES];
} else if (arg === "FED" || STATE_NAMES[arg]) {
  targets = [arg];
} else {
  console.error(`Unknown scope: ${arg}`);
  process.exit(1);
}

console.log(`\nSyncing news for ${targets.length} scope(s) via Gemini…`);
console.log(`(8s delay between calls to stay under Gemini free-tier limits)\n`);

const t0 = Date.now();
const summary = [];
for (const scope of targets) {
  const r = await syncScope(scope);
  summary.push(r);
  await sleep(8000);
}

const total = summary.reduce((a, b) => a + (b.count || 0), 0);
const failed = summary.filter((s) => s.error);
const elapsed = ((Date.now() - t0) / 1000 / 60).toFixed(1);
console.log(`\n----------------------------------------`);
console.log(`Done in ${elapsed} min — ${total} news items across ${targets.length} scopes`);
if (failed.length) console.log(`Failed: ${failed.map((f) => f.scope).join(", ")}`);
process.exit(0);
