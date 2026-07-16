#!/usr/bin/env node
/**
 * Seeds two policy_alerts that the news scraper just surfaced:
 *
 *   1. Marshall, IL — city council passed an ordinance banning the
 *      SALE of kratom within city limits (penalties on sellers, not
 *      possessors). Article: mywabashvalley.com, May 7, 2026.
 *
 *   2. Alabama AG — Attorney General Steve Marshall issued a statewide
 *      cease-and-desist order targeting illegal 7-OH-enriched kratom
 *      products. Surfaced via Gulf Coast Media + Yellowhammer News.
 *
 * Both surface a class of intel that legislative-tracker APIs miss:
 * city-level ordinances and state-AG enforcement actions don't show
 * up in LegiScan or OpenStates. News scraping + AI classification is
 * the way to catch them. This script is the manual stand-in until
 * Phase 1 ships the news → alert auto-pipeline.
 */
import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

async function insertIfMissing(payload, fingerprint) {
  const { data: existing } = await sb
    .from("policy_alerts")
    .select("id")
    .eq("kind", payload.kind)
    .eq("locality", payload.locality)
    .ilike("title", `%${fingerprint}%`)
    .limit(1);
  if (existing && existing.length > 0) {
    console.log(`  already seeded: ${existing[0].id} (${fingerprint})`);
    return;
  }
  const { data, error } = await sb.from("policy_alerts").insert(payload).select("id").single();
  if (error) {
    console.log(`  insert failed (${fingerprint}): ${error.message}`);
    return;
  }
  console.log(`  ✓ ${data.id} — ${payload.title}`);
}

await insertIfMissing({
  kind: "bill_event",
  severity: "alert",
  title: "Marshall, IL — city ordinance bans kratom SALES (already in effect)",
  body: `**WHAT:** City of Marshall, Illinois passed an ordinance banning the SALE of kratom within city limits. Penalties target sellers — businesses caught selling face ordinance citations, court fines, and possible license revocation. Possession is NOT criminalized.

**WHO:** Mayor John Hasten + Marshall Police Chief Brian Jaeger. Quote from mayor: "We felt at the time Marshall needed to lead rather than follow."

**WHY (cited reasons):** Two local incidents — an employee who had a "medical episode" at work and a driver who became unresponsive while operating a vehicle. Both attributed to kratom use. Mayor explicitly hopes Illinois will follow with a statewide ban.

**STATUS:** Already enacted. Local businesses notified they may no longer sell kratom. This is post-fact news, not advance warning — the ordinance is law.

**WHAT TO WATCH:** Mayor's "lead rather than follow" framing suggests this could be a model other Illinois municipalities copy. Watching for similar ordinances in other Clark County / central Illinois cities is now warranted.

**SUBSTANCE FRAMING:** Article uses "kratom" as a blanket term — does NOT distinguish natural leaf from 7-OH-enriched products. The ordinance, as reported, also makes no such distinction. This is exactly the conflation the federal NDCS 2026 strategy and most modern bills explicitly avoid.

**ADVOCATE ACTION:**
- Reach out to Marshall City Hall to request the ordinance text
- Push for amendment language that exempts natural-leaf kratom (the model from NH SB 557, Ohio HB 281, etc.)
- Engage Illinois state legislators on a KCPA-style framework that would preempt city-level bans

**Source:** mywabashvalley.com, "City of Marshall institutes a ban on the sale of Kratom," May 7 2026.`,
  locality: "IL",
  source_url: "https://www.mywabashvalley.com/news/local-news/city-of-marshall-institutes-a-ban-on-the-sale-of-kratom/",
  action_required: true,
  occurs_at: "2026-05-07T00:00:00-05:00",
  // No expires_at — this is a passed ordinance, not an upcoming hearing
  moderation_status: "approved",
  is_anonymous: false,
}, "Marshall, IL");

await insertIfMissing({
  kind: "fda_action", // close enough — state AG enforcement parallels FDA action
  severity: "critical",
  title: "Alabama AG Steve Marshall — statewide cease-and-desist on illegal 7-OH-enhanced kratom products",
  body: `**WHAT:** Alabama Attorney General Steve Marshall (no relation to the IL city) issued a statewide cease-and-desist order targeting illegal kratom products — specifically those marketed without disclosure or that contain enhanced 7-OH levels.

**LEGAL CONTEXT:** Alabama is one of six states with an existing statewide kratom ban (Schedule I, in effect since 2016). The cease-and-desist is enforcement of THAT existing ban — not a new prohibition. Targets sellers continuing to distribute kratom products under labels that obscure their nature, often as "supplements."

**SCOPE:** Statewide. Action is administrative + civil — vendors face cease-and-desist requirements before any criminal escalation.

**WHY THIS MATTERS:**
1. Even in already-banned states, AG enforcement waves come in cycles. This one signals a renewed push that vendors elsewhere should watch as a template.
2. Quote from AG framing: "These products prey on unsuspecting consumers." That language is being adopted across states — expect to hear it in other AG / BoP communications.
3. Alabama's existing Schedule I framework conflates natural leaf with synthetic — a structural problem the legitimate industry has been calling out. This enforcement reinforces that conflation.

**ADVOCATE TAKEAWAY:**
- Vendors doing business in or shipping to Alabama: legal-team review of compliance NOW
- For everyone else: watch for the same "prey on unsuspecting consumers" language in your state's communications — it's a leading indicator of pending enforcement

**Sources:**
- Gulf Coast Media: "Alabama Attorney General Steve Marshall issues statewide cease-and-desist order over illegal kratom products"
- Yellowhammer News: "These products prey on unsuspecting consumers: AG Marshall issues cease-and-desist order targeting illegal Kratom products"`,
  locality: "AL",
  source_url: "https://www.yellowhammernews.com/", // Yellowhammer News base; specific article URL is a Google News redirect
  action_required: false, // Alabama already bans kratom; not actionable for advocates outside AL
  occurs_at: null,
  moderation_status: "approved",
  is_anonymous: false,
}, "Alabama AG Steve Marshall");

console.log("\nDone. Both alerts in the policy_alerts table. /pulse will surface them when Phase 1 ships.");
