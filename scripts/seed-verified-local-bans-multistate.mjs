#!/usr/bin/env node
/**
 * Seed VERIFIED non-MS local kratom bans so /banned reflects reality (it had
 * only MS + Marshall IL, which read as broken — MS is famous for the most, but
 * it is NOT the only state with local bans).
 *
 * Every row is PRIMARY-anchored (municipal code page) or backed by reputable
 * local news, and repeal-checked 2026-06-08 (the real failure mode is listing a
 * REPEALED ban as active — so each was checked for a reversal, not just presence):
 *
 *   FL · Sarasota County — first US county ban (2014); Sarasota County Code
 *        Ch.62 Art.XIII §62-348/351 (Municode, PRIMARY).
 *   CO · Parker (poss+sale, 2019, 9news), Monument (sale; Town Code §8.34.010,
 *        Municode PRIMARY), Greenwood Village (sale; Municode + Westword).
 *        Denver = labeling rule only, Castle Rock = license moratorium → EXCLUDED.
 *   IL · Jerseyville (City Code Tit.6 Ch.5C, amLegal PRIMARY), Alton (City Code
 *        Ch.16, amLegal PRIMARY), Edwardsville (Municode), Glen Carbon (Village
 *        Code Ch.6, amLegal PRIMARY), Maryville (Code §138.21, amLegal PRIMARY),
 *        Wood River (amLegal), Godfrey (Jan 2025, Riverbender + AdvantageNews).
 *
 * EXCLUDED (verified NOT current / handled elsewhere): CA San Diego/Oceanside/
 *   Newport Beach → superseded by CA's statewide CDPH action (Oct 2025), already
 *   at state level; NH Franklin → repealed 2017; NY Suffolk County → committee
 *   resolution only, never enacted; banned STATES (AR/WI/VT/IN/AL/LA/CT) → state-level.
 *
 * Idempotent UPSERT on (state, bill_number). Dry-run by default.
 * Owner authorized (2026-06-08, "primary-anchor all first, then seed").
 *   node --env-file=.env.local scripts/seed-verified-local-bans-multistate.mjs
 *   node --env-file=.env.local scripts/seed-verified-local-bans-multistate.mjs --apply
 */
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const CHECKED = "2026-06-08";
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);
const src = (url, tier) => ({ url, tier, checked_at: CHECKED });

const ROWS = [
  { state: "FL", scope: "county", locality: "Sarasota County, FL", enacted: "2014",
    title: "Sarasota County, FL — county-level kratom prohibition (first US county ban, 2014)",
    summary: "Sarasota County banned kratom in 2014 — the first US county to do so — and it remains in force, codified at County Code Ch.62 Art.XIII (Designer Drugs) §62-348/351. Repeal-checked 2026-06-08: none.",
    source_url: "https://library.municode.com/fl/sarasota_county/codes/code_of_ordinances?nodeId=PTIICOOR_CH62HESA_ARTXIIIDEDR_S62-351REDEDRMICOCO",
    sources: [src("https://library.municode.com/fl/sarasota_county/codes/code_of_ordinances?nodeId=PTIICOOR_CH62HESA_ARTXIIIDEDR_S62-351REDEDRMICOCO", "authoritative"), src("http://sarasotacounty.elaws.us/code/coor_ch62_artxiii_sec62-348", "authoritative")] },

  { state: "CO", scope: "municipal", locality: "Parker, CO", enacted: "2019",
    title: "Parker, CO — municipal kratom prohibition (possession + sale)",
    summary: "Parker made it unlawful to possess, sell, manufacture, or use kratom (2019) — a full prohibition, not KCPA-style age limits; $500/violation. Repeal-checked 2026-06-08: none.",
    source_url: "https://www.9news.com/article/news/health/parker-businesses-banned-from-selling-kratom/73-c8fdbb1f-0c42-4fb2-8321-07a42967522e",
    sources: [src("https://www.9news.com/article/news/health/parker-businesses-banned-from-selling-kratom/73-c8fdbb1f-0c42-4fb2-8321-07a42967522e", "authoritative")] },

  { state: "CO", scope: "municipal", locality: "Monument, CO", enacted: "2019",
    title: "Monument, CO — municipal kratom sales ban",
    summary: "Monument's Board of Trustees prohibited the retail sale of kratom (Ord. 35-2019), codified at Town Code Tit.8 Ch.8.34 §8.34.010. Possession remains legal. Repeal-checked 2026-06-08: none.",
    source_url: "https://library.municode.com/co/monument/codes/code_of_ordinances?nodeId=TIT8HESA_CH8.34KRRE_8.34.010PRSAKR",
    sources: [src("https://library.municode.com/co/monument/codes/code_of_ordinances?nodeId=TIT8HESA_CH8.34KRRE_8.34.010PRSAKR", "authoritative")] },

  { state: "CO", scope: "municipal", locality: "Greenwood Village, CO", enacted: "2019",
    title: "Greenwood Village, CO — municipal kratom sales ban",
    summary: "Greenwood Village banned the retail sale of kratom for human consumption — a local exception to Colorado's statewide KCPA. Repeal-checked 2026-06-08: none.",
    source_url: "https://library.municode.com/co/greenwood_village/codes/municipal_code",
    sources: [src("https://library.municode.com/co/greenwood_village/codes/municipal_code", "authoritative"), src("https://www.westword.com/news/colorado-tackles-kratom-conundrum-40785403/", "semi")] },

  { state: "IL", scope: "municipal", locality: "Jerseyville, IL", enacted: "2017",
    title: "Jerseyville, IL — municipal kratom prohibition (first IL city, 2017)",
    summary: "Jerseyville was the first IL city to ban kratom (Ord. 1693/1694, 2017), codified at City Code Tit.6 Ch.5C. Repeal-checked 2026-06-08: none.",
    source_url: "https://codelibrary.amlegal.com/codes/jerseyvilleil/latest/jerseyville_il/0-0-0-1807",
    sources: [src("https://codelibrary.amlegal.com/codes/jerseyvilleil/latest/jerseyville_il/0-0-0-1807", "authoritative"), src("https://www.iml.org/file.cfm?key=30042", "authoritative")] },

  { state: "IL", scope: "municipal", locality: "Alton, IL", enacted: "2018",
    title: "Alton, IL — municipal kratom prohibition",
    summary: "Alton prohibited the possession, distribution, or delivery of kratom (2018), codified at City Code Ch.16 'Kratom Prohibited'. Repeal-checked 2026-06-08: none.",
    source_url: "https://codelibrary.amlegal.com/codes/alton_il/latest/alton_il/0-0-0-6433",
    sources: [src("https://codelibrary.amlegal.com/codes/alton_il/latest/alton_il/0-0-0-6433", "authoritative"), src("https://www.advantagenews.com/news/alton-city-council-bans-kratom/article_57049cfd-4a70-549f-8820-ce4437151311.html", "authoritative")] },

  { state: "IL", scope: "municipal", locality: "Edwardsville, IL", enacted: "2020",
    title: "Edwardsville, IL — municipal kratom prohibition",
    summary: "Edwardsville's City Council unanimously added kratom to its prohibited-substances code (March 2020). Repeal-checked 2026-06-08: none.",
    source_url: "https://library.municode.com/il/edwardsville",
    sources: [src("https://library.municode.com/il/edwardsville", "authoritative")] },

  { state: "IL", scope: "municipal", locality: "Glen Carbon, IL", enacted: "2019",
    title: "Glen Carbon, IL — municipal kratom prohibition",
    summary: "Glen Carbon banned the possession, distribution, and delivery of kratom (Aug 2019), codified at Village Code Ch.6 'Kratom Prohibited'. Repeal-checked 2026-06-08: none.",
    source_url: "https://codelibrary.amlegal.com/codes/glencarbonil/latest/glencarbon_il/0-0-0-3031",
    sources: [src("https://codelibrary.amlegal.com/codes/glencarbonil/latest/glencarbon_il/0-0-0-3031", "authoritative")] },

  { state: "IL", scope: "municipal", locality: "Maryville, IL", enacted: "2019",
    title: "Maryville, IL — municipal kratom prohibition",
    summary: "Maryville Code §138.21 forbids the use, possession, sale, distribution, or delivery of kratom. Repeal-checked 2026-06-08: none.",
    source_url: "https://codelibrary.amlegal.com/codes/maryville/latest/maryville_il/0-0-0-19985",
    sources: [src("https://codelibrary.amlegal.com/codes/maryville/latest/maryville_il/0-0-0-19985", "authoritative")] },

  { state: "IL", scope: "municipal", locality: "Wood River, IL", enacted: "2023",
    title: "Wood River, IL — municipal kratom sales ban",
    summary: "Wood River adopted an ordinance banning the sale of kratom (Nov 2023), in its Code of Ordinances. Repeal-checked 2026-06-08: none.",
    source_url: "https://codelibrary.amlegal.com/codes/woodriveril/latest/woodriver_il/0-0-0-1",
    sources: [src("https://codelibrary.amlegal.com/codes/woodriveril/latest/woodriver_il/0-0-0-1", "authoritative")] },

  { state: "IL", scope: "municipal", locality: "Godfrey, IL", enacted: "2025",
    title: "Godfrey, IL — municipal kratom prohibition",
    summary: "Godfrey's Village Board unanimously banned the possession, sale, and distribution of kratom (Jan 2025); $100–$750/violation. Repeal-checked 2026-06-08: none.",
    source_url: "https://www.riverbender.com/news/details/godfrey-approves-kratom-ban-78641.cfm",
    sources: [src("https://www.riverbender.com/news/details/godfrey-approves-kratom-ban-78641.cfm", "authoritative"), src("https://www.advantagenews.com/news/local/godfrey-bans-kratom/article_e0a054ec-cdfb-11ef-8aeb-9fd49649d0be.html", "authoritative")] },
];

function billNumber(r) {
  const slug = r.locality.replace(/,?\s*[A-Z]{2}\s*$/, "").replace(/\s+County\s*$/, "").trim().replace(/\s+/g, "-").toUpperCase();
  return `LOCAL-BAN ${slug}-${r.scope === "county" ? "CO" : "CITY"}`;
}

console.log(`${APPLY ? "APPLY" : "DRY-RUN"} — seeding ${ROWS.length} primary-anchored local bans (FL/CO/IL)\n`);
let ok = 0, fail = 0;
for (const r of ROWS) {
  const bn = billNumber(r);
  const row = {
    state: r.state, bill_number: bn, title: r.title, summary: r.summary,
    status: "enacted", kratom_relevance: "anti", relevance_confidence: 0.95,
    scope: r.scope, locality: r.locality,
    targets_natural_leaf: true, targets_synthetic_only: false,
    active: true,
    verification_status: "confirmed",
    verification_sources: r.sources,
    verified_at: new Date().toISOString(),
    source_url: r.source_url,
    session_id: "editorial-verified",
    last_action: `Enacted local ordinance ~${r.enacted} (verified current ${CHECKED})`,
    last_synced_at: new Date().toISOString(),
  };
  console.log(`  ${APPLY ? "↑" : "would seed"} ${r.state} · ${r.locality} (${r.scope}) — ${bn}  [${r.sources.length} src]`);
  if (APPLY) {
    const { error } = await sb.from("bills").upsert(row, { onConflict: "state,bill_number" });
    if (error) { console.log(`    ✗ ${error.message?.slice(0, 160)}`); fail++; continue; }
    ok++;
  }
}
console.log(`\n${APPLY ? `Seeded/updated ${ok}, failed ${fail}` : "Dry-run — re-run with --apply to write."}`);
process.exit(0);
