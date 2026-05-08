#!/usr/bin/env node
/**
 * News → policy_alert auto-classifier.
 *
 * Reads unclassified rows from news_items and uses the AI router (Groq
 * → Gemini → Cerebras → Ollama, same multi-provider rotation as the
 * bill-journey enrichment) to determine:
 *   - Is this article describing a real, recent kratom policy event?
 *     (or just talking about kratom in general, or a national-news
 *     piece without a specific actor/event)
 *   - What kind of event? (city ordinance, state bill, BoP action,
 *     AG enforcement, court ruling, FDA/DEA action)
 *   - What location? (state, locality if local)
 *   - What severity? (critical = upcoming vote/hearing in <7d;
 *     alert = recent decision/announcement; watch = ongoing context)
 *   - Should an alert auto-fire?
 *
 * Confidence ≥ 0.7 + has_actionable_event=true → creates policy_alert
 * with moderation_status='approved' (auto-published). Lower confidence
 * creates with moderation_status='pending' for human review.
 *
 * Run:
 *   node --env-file=.env.local scripts/classify-news-policy.mjs --limit 50
 *   node --env-file=.env.local scripts/classify-news-policy.mjs --since 2026-05-01
 *   node --env-file=.env.local scripts/classify-news-policy.mjs --refresh  # re-classify already-done
 */
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const arg = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const LIMIT = parseInt(arg("--limit") ?? "50");
const SINCE = arg("--since"); // YYYY-MM-DD
const REFRESH = args.includes("--refresh");
const PROVIDER_OVERRIDE = arg("--provider");

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GROQ_KEY = process.env.GROQ_API_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const CEREBRAS_KEY = process.env.CEREBRAS_API_KEY;
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";

if (!SB_URL || !SB_KEY) { console.error("Missing Supabase env"); process.exit(1); }

const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

// ---------- prompt ----------
const SYSTEM = `You are a kratom-policy news analyst. Classify ONE news article and return strict JSON.

You're looking for ACTIONABLE policy events advocates need to know about NOW:
  - city/county/town ordinances (introduced, voted, passed)
  - state legislation moving (committee, floor, signed/vetoed)
  - state Board of Pharmacy scheduling proposals
  - state Attorney General enforcement actions / cease-and-desist
  - federal FDA/DEA actions on kratom or 7-OH
  - court rulings on kratom-related cases
  - significant industry self-regulation announcements

NOT actionable:
  - general "kratom is dangerous" public-health editorials with no event
  - product recalls of single brands (unless they trigger broader action)
  - personal-injury lawsuits without policy implications
  - articles about kratom culture / use trends with no policy hook
  - reposts of news older than 14 days

Return JSON with EXACT fields:

{
  "is_policy_event": boolean,
  "confidence": 0.00 to 1.00,
  "kind": "city_ordinance" | "state_bill" | "bop_action" | "ag_enforcement" | "court_ruling" | "fda_action" | "dea_action" | "industry_news" | "other",
  "severity": "critical" | "alert" | "watch" | "routine",
  "locality": "FED" | "ALL" | "<two-letter state code>",
  "specific_locality": "string (city/county) or null",
  "summary": "2-3 sentences in plain English. ALWAYS distinguish natural leaf kratom from 7-OH-enriched/synthetic products when relevant. Never use 'kratom' as a blanket term for synthetics.",
  "advocate_action": "1 sentence — what should advocates do? null if no action.",
  "occurs_at": "YYYY-MM-DD if there's a future hearing/vote date, otherwise null"
}

severity guide:
  - "critical": vote or hearing in next 7 days where comment/attendance still possible
  - "alert": recent decision (last 14 days) or upcoming event > 7 days out
  - "watch": ongoing context, monitoring-worthy but no specific action
  - "routine": general news, no urgency

Return ONLY the JSON. No prose, no markdown fences.`;

// AI routing now flows through the shared scripts/lib/ai-router.mjs
// (cooldown-aware + JSON repair).
import { aiRouter, listAvailableProviders } from "./lib/ai-router.mjs";

function avail() { return listAvailableProviders(); }

async function classifyOnce(_unused, sys, user) {
  const r = await aiRouter({
    systemPrompt: sys,
    userPrompt: user,
    maxTokens: 800,
    providerOverride: PROVIDER_OVERRIDE,
    verbose: true,
  });
  return { provider: r.provider, result: r.parsed };
}

// ---------- main ----------
console.log(`Providers: ${avail().join(", ")}`);

let q = sb.from("news_items").select("id, title, url, source_name, state, published_at, summary").eq("active", true).limit(LIMIT);
if (!REFRESH) q = q.is("policy_classified_at", null);
if (SINCE) q = q.gte("published_at", SINCE);
q = q.order("published_at", { ascending: false });

const { data: items, error } = await q;
if (error) { console.error(error.message); process.exit(1); }
if (!items || items.length === 0) { console.log("Nothing to classify."); process.exit(0); }

console.log(`Classifying ${items.length} news item(s)...\n`);

let alertsCreated = 0, classified = 0, skipped = 0, failed = 0;

for (const item of items) {
  const tag = `[${item.state ?? "?"}] ${(item.title ?? "").slice(0, 80)}`;
  process.stdout.write(`  ${tag} `);
  try {
    const userPrompt =
      `Title: ${item.title ?? "(none)"}\n` +
      `Source: ${item.source_name ?? "(unknown)"}\n` +
      `State scope: ${item.state ?? "(unknown)"}\n` +
      `Published: ${item.published_at ?? "(unknown)"}\n` +
      (item.summary ? `Summary: ${item.summary}` : "");
    const start = null; // router picks internally
    const { provider, result } = await classifyOnce(start, SYSTEM, userPrompt);

    const isEvent = !!result.is_policy_event;
    const conf = Number.isFinite(result.confidence) ? result.confidence : 0;
    let alertId = null;

    if (isEvent && conf >= 0.6) {
      // Auto-publish at high confidence; mark pending at moderate
      const moderationStatus = conf >= 0.8 ? "approved" : "pending";
      const sev = ["critical", "alert", "watch", "routine"].includes(result.severity) ? result.severity : "watch";
      const locality = /^[A-Z]{2,4}$/.test(result.locality ?? "") || result.locality === "ALL" ? result.locality : "ALL";
      const kindMap = {
        city_ordinance: "bill_event",
        state_bill: "bill_event",
        bop_action: "bop_hearing",
        ag_enforcement: "fda_action",
        court_ruling: "news_break",
        fda_action: "fda_action",
        dea_action: "dea_action",
        industry_news: "news_break",
        other: "news_break",
      };
      const kind = kindMap[result.kind] ?? "news_break";

      const { data: alert, error: aerr } = await sb.from("policy_alerts").insert({
        kind,
        severity: sev,
        title: (item.title ?? "").slice(0, 240),
        body: result.summary
          ? `${result.summary}\n\n**Source:** ${item.source_name ?? "(unknown)"} — ${item.url}\n${result.advocate_action ? `\n**Advocate action:** ${result.advocate_action}` : ""}${result.specific_locality ? `\n**Locality:** ${result.specific_locality}` : ""}`
          : null,
        locality,
        source_url: item.url,
        action_required: !!(result.advocate_action && result.advocate_action.toLowerCase() !== "null"),
        occurs_at: result.occurs_at && /^\d{4}-\d{2}-\d{2}$/.test(result.occurs_at) ? `${result.occurs_at}T12:00:00Z` : null,
        moderation_status: moderationStatus,
      }).select("id").single();

      if (!aerr) {
        alertId = alert.id;
        alertsCreated++;
      }
    } else {
      skipped++;
    }

    await sb.from("news_items").update({
      policy_classified_at: new Date().toISOString(),
      policy_event_score: conf,
      policy_event_kind: result.kind ?? null,
      policy_alert_id: alertId,
    }).eq("id", item.id);

    classified++;
    if (alertId) {
      console.log(`✓ ALERT ${alertId.slice(0, 8)} (${result.kind}, conf=${conf.toFixed(2)}, ${provider})`);
    } else {
      console.log(`✓ no-event (${result.kind ?? "?"}, conf=${conf.toFixed(2)}, ${provider})`);
    }
  } catch (e) {
    console.log(`✗ ${e.message?.slice(0, 80)}`);
    failed++;
  }
  await new Promise((r) => setTimeout(r, 1500)); // polite delay
}

console.log(`\nDone. classified=${classified}, alerts=${alertsCreated}, skipped=${skipped}, failed=${failed}`);
