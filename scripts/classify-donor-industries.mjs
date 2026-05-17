#!/usr/bin/env node
/**
 * Derive top_industries from top_employers on legislator_donors rows.
 *
 * Why this exists: OpenFEC's /by_industry endpoint returns 500 (industry
 * data is OpenSecrets, not FEC). sync-legislator-donors.mjs collects
 * by_employer data instead (which IS available) but leaves
 * top_industries as []. This script does an offline derivation by
 * pattern-matching employer names against a 30-industry vocabulary,
 * aggregating amount + count per industry, and writing back the result.
 *
 * Idempotent. Re-runs are safe — overwrites top_industries with the
 * latest classification. Use --refresh to re-process already-classified
 * rows (useful when adding new industry patterns).
 *
 * Usage:
 *   node --env-file=.env.local scripts/classify-donor-industries.mjs
 *   node --env-file=.env.local scripts/classify-donor-industries.mjs --refresh
 *   node --env-file=.env.local scripts/classify-donor-industries.mjs --legislator <uuid>
 *   node --env-file=.env.local scripts/classify-donor-industries.mjs --dry-run
 */
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const argv = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const DRY_RUN = flag("--dry-run");
const REFRESH = flag("--refresh");
const SPECIFIC = argv("--legislator");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

// ============================================================
// Industry vocabulary. Each entry is { id, label, patterns, advocate_flag }.
//
// patterns: substring-lowercase-matched against employer names. Order
// matters — earlier patterns win when an employer matches multiple.
//
// advocate_flag: whether donations from this industry should raise
// a flag on the kratom-advocate briefing UI. pharma/alcohol/tobacco/
// hospital_health were the original 5 buckets in sync-legislator-donors;
// we preserve those and add a few more substance-policy-adjacent ones.
//
// Employer naming conventions in FEC:
//   - lawyers/firms: "LLP", "LLC LAW", "ATTORNEY"
//   - banks: "CHASE", "BANK OF", "WELLS FARGO", "CITIBANK"
//   - tech: "GOOGLE", "MICROSOFT", "META", "APPLE"
//   - retired: "RETIRED", "NOT EMPLOYED"
// ============================================================
const INDUSTRIES = [
  // KRATOM-RELEVANT — substance-policy adjacent (these surface on the
  // briefing's conflict-of-interest panel)
  { id: "pharma_biotech", label: "Pharma / biotech", advocate_flag: true,
    patterns: ["pfizer", "merck", "johnson & johnson", "j&j ", "novartis", "roche",
      "abbvie", "bristol myers", "bristol-myers", "eli lilly", "lilly ",
      "gilead", "amgen", "biogen", "regeneron", "vertex pharma", "moderna",
      "phrma", "pharmaceutical research", "pharmaceutical", "pharma ",
      "biopharma", "biotech", "biosciences", "therapeutics", "genentech",
      "pfizer inc", "sanofi", "astrazeneca", "glaxosmithkline", "gsk ",
      "boehringer", "takeda", "bayer", "abbott labs"] },
  { id: "alcohol", label: "Alcohol", advocate_flag: true,
    patterns: ["anheuser-busch", "anheuser busch", "ab inbev", "diageo",
      "molson coors", "constellation brands", "brown-forman", "brown forman",
      "heineken", "bacardi", "pernod ricard", "beer ", "wine ", "winery",
      "liquor", "distilled spirits", "alcohol", "brewers", "vintners",
      "distillery", "spirits"] },
  { id: "tobacco_nicotine", label: "Tobacco / nicotine", advocate_flag: true,
    patterns: ["altria", "philip morris", "reynolds american",
      "british american tobacco", "swedish match", "imperial brands",
      "tobacco", "cigarette", "vapor", "juul", "vape "] },
  { id: "hospital_health", label: "Hospital / health systems", advocate_flag: true,
    patterns: ["hca healthcare", "hca ", "ascension", "cleveland clinic",
      "mayo clinic", "kaiser permanente", "tenet healthcare",
      "universal health services", "american hospital association", "aha ",
      "hospital", "medical center", "health system", "health network",
      "health services", "mass general", "massachusetts general",
      "brigham and women", "johns hopkins", "mt sinai", "mount sinai",
      "presbyterian", "physicians group", "medical doctor"] },
  { id: "addiction_treatment", label: "Addiction treatment / recovery", advocate_flag: true,
    patterns: ["acadia healthcare", "behavioral health", "rehabilitation center",
      "treatment center", "recovery center", "addiction", "detox ",
      "methadone clinic", "suboxone"] },
  { id: "cannabis", label: "Cannabis", advocate_flag: true,
    patterns: ["curaleaf", "trulieve", "tilray", "cresco labs", "green thumb",
      "canopy growth", "aurora cannabis", "cronos group", "marijuana",
      "cannabis", "dispensary", "thc "] },

  // FINANCIAL — large lobbying spend
  { id: "finance_banking", label: "Finance / banking", advocate_flag: false,
    patterns: ["jpmorgan", "jp morgan", "chase ", "bank of america",
      "wells fargo", "citibank", "citigroup", "goldman sachs", "morgan stanley",
      "deutsche bank", "credit suisse", "barclays", "ubs ", "hsbc ",
      "american express", "amex ", "mastercard", "visa inc", "discover financial",
      "capital one", "pnc bank", "us bank", "usaa", "regions bank",
      "fifth third", "key bank", "1st financial", "first financial",
      " bank ", "savings bank", "national bank", "credit union", "fintech "] },
  { id: "investment_management", label: "Investment management / asset mgmt", advocate_flag: false,
    patterns: ["blackrock", "vanguard", "fidelity investments", "state street",
      "t rowe price", "wellington management", "pimco", "invesco", "schwab",
      "raymond james", "edward jones", "stifel", "lpl financial",
      "investment", "asset management", "wealth management", "capital management",
      "capital partners", "asset advisors"] },
  { id: "private_equity_vc", label: "Private equity / VC", advocate_flag: false,
    patterns: ["andreessen horowitz", "sequoia capital", "kleiner perkins",
      "kkr ", "blackstone", "carlyle group", "apollo global", "bain capital",
      "tpg capital", "warburg pincus", "cvc capital", "advent international",
      "general atlantic", "thoma bravo", "silver lake", "vista equity",
      "private equity", "venture capital", "venture partners", "growth equity"] },
  { id: "insurance", label: "Insurance", advocate_flag: false,
    patterns: ["aig ", "allstate", "geico", "progressive corp", "state farm",
      "liberty mutual", "metlife", "prudential financial", "aflac",
      "anthem", "cigna", "humana", "unitedhealth", "blue cross",
      "blue shield", "kaiser foundation", "molina healthcare", "centene",
      "insurance"] },
  { id: "hedge_funds", label: "Hedge funds", advocate_flag: false,
    patterns: ["bridgewater", "renaissance technologies", "citadel ", "two sigma",
      "millennium management", "de shaw", "elliott management", "point72",
      "tiger global", "soros fund", "hedge fund"] },

  // TECH + MEDIA
  { id: "tech_software", label: "Tech / software", advocate_flag: false,
    patterns: ["alphabet", "google ", "google llc", "microsoft", "apple inc",
      "amazon.com", "meta platforms", "facebook", "salesforce",
      "oracle corp", "ibm corp", "intel corp", "nvidia", "qualcomm",
      "adobe ", "intuit", "servicenow", "uber technologies", "lyft inc",
      "airbnb", "palantir", "snowflake", "databricks", "stripe inc",
      "shopify", "github", "openai", "anthropic", "coinbase",
      "robinhood markets", "robinhood", "doordash", "instacart",
      "anduril industries", "anduril", "software", "technology"] },
  { id: "telecom_media", label: "Telecom / media", advocate_flag: false,
    patterns: ["at&t", "verizon", "t-mobile", "comcast", "charter communications",
      "cox enterprises", "dish network", "disney", "warner bros", "paramount",
      "netflix", "fox corporation", "fox news", "nbcuniversal", "viacom",
      "discovery inc", "telecom", "broadcasting", "media group"] },

  // ENERGY + UTILITIES
  { id: "oil_gas", label: "Oil & gas", advocate_flag: false,
    patterns: ["exxon", "chevron corp", "conocophillips", "occidental petroleum",
      "marathon petroleum", "phillips 66", "valero", "halliburton",
      "schlumberger", "bp ", "shell oil", "anadarko petroleum",
      "energy transfer", "kinder morgan", "enterprise products",
      "pioneer natural", "devon energy", "petroleum", "oil & gas",
      "oil and gas"] },
  { id: "utilities_renewable", label: "Utilities / renewable energy", advocate_flag: false,
    patterns: ["duke energy", "dominion energy", "southern company",
      "nextera energy", "exelon", "american electric power",
      "florida power", "consolidated edison", "pg&e", "pge corp",
      "edison international", "first energy", "tva ", "tennessee valley",
      "solar ", "wind energy", "utility", "electric power", "gas company"] },
  { id: "mining_chemicals", label: "Mining / chemicals", advocate_flag: false,
    patterns: ["freeport-mcmoran", "newmont", "alcoa", "dow chemical",
      "dupont", "ppg industries", "sherwin-williams", "lyondellbasell",
      "monsanto", "chemicals", "mining", "metals corp"] },

  // INDUSTRIAL + DEFENSE
  { id: "defense_aerospace", label: "Defense / aerospace", advocate_flag: false,
    patterns: ["lockheed martin", "raytheon", "boeing", "northrop grumman",
      "general dynamics", "l3harris", "leidos", "booz allen hamilton",
      "saic ", "caci ", "bae systems", "honeywell", "textron",
      "huntington ingalls", "spacex", "blue origin", "defense",
      "aerospace", "national security", "aviation"] },
  { id: "construction_engineering", label: "Construction / engineering", advocate_flag: false,
    patterns: ["bechtel", "fluor corp", "aecom", "jacobs engineering",
      "kbr inc", "skanska", "turner construction", "vinci ",
      "construction", "engineering", "contractors", "builders inc",
      "general contractor"] },
  { id: "transportation_logistics", label: "Transportation / logistics", advocate_flag: false,
    patterns: ["fedex", "united parcel", "ups inc", "union pacific",
      "csx corp", "norfolk southern", "burlington northern",
      "delta air lines", "american airlines", "united airlines",
      "southwest airlines", "jetblue", "trucking", "logistics",
      "shipping", "railroad", "transit authority"] },
  { id: "automotive", label: "Automotive", advocate_flag: false,
    patterns: ["general motors", "ford motor", "stellantis", "tesla inc",
      "toyota motor", "honda motor", "hyundai", "nissan", "volkswagen",
      "bmw ", "mercedes-benz", "automotive", "auto dealers", "auto parts",
      "auto group"] },

  // CONSUMER
  { id: "retail_consumer", label: "Retail / consumer goods", advocate_flag: false,
    patterns: ["walmart", "amazon", "target corp", "kroger", "costco",
      "walgreens", "cvs health", "cvs ", "rite aid", "home depot",
      "lowe's", "best buy", "macy's", "tjx companies", "dollar general",
      "dollar tree", "convenience stores", "nacs ", "procter & gamble",
      "p&g ", "coca-cola", "pepsico", "unilever", "colgate-palmolive",
      "kraft heinz", "general mills", "kellogg", "mondelez", "tyson foods",
      "national retail federation", "retailers association"] },
  { id: "agriculture_food", label: "Agriculture / food", advocate_flag: false,
    patterns: ["cargill", "archer daniels midland", "adm ", "bunge ltd",
      "monsanto", "deere & co", "john deere", "agco corp", "tyson",
      "smithfield foods", "perdue farms", "dairy farmers", "farm bureau",
      "agriculture", "agricultural", "farms inc", "ranch ", "livestock",
      "poultry", "soybean", "corn growers"] },
  { id: "gaming_casino", label: "Gaming / casino", advocate_flag: true,
    patterns: ["caesars entertainment", "mgm resorts", "wynn resorts",
      "las vegas sands", "boyd gaming", "penn entertainment", "draftkings",
      "fanduel", "gaming corp", "casino", "gambling", "sportsbook"] },

  // PROFESSIONAL SERVICES
  { id: "legal_services", label: "Legal services", advocate_flag: false,
    patterns: [" llp", "law firm", "law group", "law offices", "attorneys at",
      "attorney at law", " pllc", "law llc", " p.c.", "legal services",
      "kirkland & ellis", "skadden", "latham & watkins", "white & case",
      "sidley austin", "davis polk", "wachtell", "cravath", "sullivan & cromwell",
      "weil gotshal", "paul weiss", "covington & burling", "perkins coie",
      "gibson dunn", "morgan lewis", "k&l gates", "young conaway",
      "stargatt & taylor", "dechert", "hogan lovells"] },
  { id: "accounting_consulting", label: "Accounting / consulting", advocate_flag: false,
    patterns: ["mckinsey", "bain & company", "boston consulting", "bcg ",
      "deloitte", "pwc ", "pricewaterhousecoopers", "ernst & young",
      "kpmg ", "accenture", "consulting group", "advisory services",
      "accounting firm"] },
  { id: "real_estate", label: "Real estate", advocate_flag: false,
    patterns: ["simon property", "realty trust", "real estate", "realtors",
      "property management", "hines ", "tishman speyer", "related companies",
      "brookfield property", "compass inc", "redfin", "zillow", "remax ",
      "century 21", "coldwell banker", "keller williams"] },

  // INSTITUTIONAL
  { id: "education_academia", label: "Education / academia", advocate_flag: false,
    patterns: ["university of", "harvard", "stanford ", "yale ",
      "princeton", "mit ", "columbia university", "university college",
      "state university", "college of", "academic", "school district",
      "education association", "teachers union", "academic medical center"] },
  { id: "labor_unions", label: "Labor unions", advocate_flag: false,
    patterns: ["afl-cio", "seiu ", "teamsters", "afscme", "uaw ",
      " union local", "labor union", "trades council", "carpenters union",
      "operating engineers", "iron workers", "ibew "] },
  { id: "government_civil", label: "Government / civil service", advocate_flag: false,
    patterns: ["u.s. government", "us government", "federal government",
      "state of ", "department of", "us dept of", "u.s. dept",
      "dept of ", " agency", " bureau", "city of",
      "county of", "municipal", "civil servant", "public servant",
      "us senate", "house of representatives", "u.s. senate",
      "u.s. house", "us courts", "federal courts"] },
  { id: "nonprofit_advocacy", label: "Nonprofit / advocacy", advocate_flag: false,
    patterns: ["foundation", "nonprofit", "non-profit", "501(c)",
      "advocacy group", "policy institute", "think tank", "charity",
      "philanthropy", "humane society", "red cross",
      "stand up america", "moveon ", "indivisible ", "common cause",
      "brennan center", "aclu ", "naacp ", "planned parenthood",
      "sierra club", "league of women", "leadership conference"] },

  // LOBBYING + POLITICAL
  { id: "lobbying_political", label: "Lobbying / government affairs", advocate_flag: false,
    patterns: ["government affairs", "public affairs", "lobbying",
      "policy group", "policy strategies", "strategies llc",
      "political action committee", " pac ", "campaign committee",
      "cornerstone government", "akin gump", "podesta group",
      "brownstein hyatt"] },

  // CATCHALL — keep last so they don't shadow others
  // Job titles people put on FEC forms instead of their employer.
  // Coarse but covers a long tail.
  { id: "individual_professional", label: "Individual professional (job title)", advocate_flag: false,
    patterns: [" ceo ", "ceo, ", " ceo", "founder", "executive",
      " owner", "business owner", "small business",
      "physician", "dentist", "nurse practitioner", "registered nurse",
      " rn ", "psychologist", "therapist", "veterinarian",
      "professor", "teacher", " educator", "principal",
      " consultant", "investor", "trader",
      "engineer", "architect", "designer", "scientist",
      "researcher", "writer", "journalist", "editor",
      "manager", "director", "president", "chairman", "chairwoman"] },
  { id: "self_retired_homemaker", label: "Self-employed / retired / homemaker", advocate_flag: false,
    patterns: ["not employed", "retired", "self-employed", "self employed",
      "homemaker", "housewife", "unemployed", "n/a", "none", "private",
      "information requested", "requested ", "no employer", "n / a"] },
];

function classifyEmployer(name) {
  const lower = String(name || "").toLowerCase();
  if (!lower) return null;
  for (const ind of INDUSTRIES) {
    for (const pat of ind.patterns) {
      if (lower.includes(pat)) return ind.id;
    }
  }
  return null; // unclassified
}

// ============================================================
// Main
// ============================================================
let q = sb
  .from("legislator_donors")
  .select("legislator_id, top_employers, top_industries, kratom_relevant")
  .eq("resolved_status", "matched")
  .not("top_employers", "is", null);
if (SPECIFIC) q = q.eq("legislator_id", SPECIFIC);

const { data: rows, error } = await q;
if (error) { console.error("query failed:", error.message); process.exit(1); }
console.log(`Found ${rows?.length ?? 0} matched donor rows with employers.`);

let updated = 0, skipped = 0, unclassified = 0, totalEmployers = 0, classifiedEmployers = 0;
for (const r of rows ?? []) {
  if (!REFRESH && Array.isArray(r.top_industries) && r.top_industries.length > 0) {
    skipped++;
    continue;
  }
  const employers = Array.isArray(r.top_employers) ? r.top_employers : [];
  if (employers.length === 0) { skipped++; continue; }

  // Aggregate amount + count + employer-set per industry
  const byIndustry = new Map();
  for (const e of employers) {
    totalEmployers++;
    const id = classifyEmployer(e.employer);
    const amount = Number(e.amount ?? 0);
    const count = Number(e.count ?? 0);
    if (!id) { unclassified++; continue; }
    classifiedEmployers++;
    const agg = byIndustry.get(id) ?? { industry: id, amount: 0, count: 0, employers: [] };
    agg.amount += amount;
    agg.count += count;
    if (e.employer && agg.employers.length < 5) agg.employers.push(e.employer);
    byIndustry.set(id, agg);
  }

  const sorted = [...byIndustry.values()]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 15)
    .map((row) => ({
      industry: row.industry,
      label: INDUSTRIES.find((i) => i.id === row.industry)?.label ?? row.industry,
      advocate_flag: INDUSTRIES.find((i) => i.id === row.industry)?.advocate_flag ?? false,
      amount: Math.round(row.amount),
      count: row.count,
      sample_employers: row.employers,
    }));

  if (DRY_RUN) {
    console.log(`  ${r.legislator_id}: ${sorted.length} industries derived`);
    for (const s of sorted.slice(0, 5)) console.log(`    ${s.industry.padEnd(28)} $${s.amount.toLocaleString().padStart(12)} (${s.count} contribs)`);
    updated++;
    continue;
  }

  const { error: upErr } = await sb
    .from("legislator_donors")
    .update({ top_industries: sorted })
    .eq("legislator_id", r.legislator_id);
  if (upErr) {
    console.error(`  ✗ ${r.legislator_id}: ${upErr.message}`);
    continue;
  }
  updated++;
}

console.log(`\nDone${DRY_RUN ? " (DRY RUN)" : ""}: updated=${updated}, skipped=${skipped}.`);
console.log(`Classification coverage: ${classifiedEmployers}/${totalEmployers} (${(classifiedEmployers/Math.max(1,totalEmployers)*100).toFixed(1)}%) employers matched.`);
console.log(`Unclassified employers: ${unclassified}.`);
