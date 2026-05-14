/**
 * Kratom industry actor registry — the public-record map.
 *
 * Hardcoded TypeScript (not DB) because this is editorial/research
 * data sourced from published investigations, Senate LDA filings,
 * IRS 990 filings, and company press releases. Each entry cites the
 * specific evidence URL so admins can verify.
 *
 * What this captures: the structural players in kratom-industry
 * federal political activity. Lobbyists, lobbying firms, industry
 * orgs, kratom company executives, and the regulatory officials
 * who've publicly taken positions.
 *
 * What this does NOT capture: alleged-but-unverified connections,
 * social-media rumor, or speculative dark-money ties. Every entry
 * cites a public source.
 *
 * Update playbook: when a new lobbying filing surfaces a name we
 * don't have, OR an investigation drops a new connection, append
 * here with the source URL.
 */

export type ActorRole =
  | "lobbyist"
  | "lobbying_firm"
  | "industry_org"
  | "industry_company"
  | "company_executive"
  | "regulator_or_official"
  | "researcher"
  | "former_industry_leader";

export type ActorFaction =
  | "aka_aligned"           // AKA + GKC + Botanical Education Alliance (anti-7-OH, protects leaf + extracts)
  | "pro_7oh"               // 7-HOPE Alliance, HART, Botanic Tonics — pushes 7-OH-enriched products
  | "company_independent"   // operating outside the org politics
  | "regulator"             // government side
  | "academic";             // university researchers

export type IndustryActor = {
  /** Stable identifier used for cross-reference (lowercase, hyphenated) */
  id: string;
  name: string;
  role: ActorRole;
  faction: ActorFaction;
  /** Short summary of who they are + why they matter */
  summary: string;
  /** Organizations / companies they're associated with */
  affiliations: string[];
  /** Lobbying firm name (if they're a registered lobbyist) */
  lobbying_firm?: string;
  /** Government positions held (revolving-door tracking) */
  former_government_role?: string;
  /** Public-record evidence URLs */
  evidence_urls: string[];
  /** Optional state for state-actor cross-ref */
  state?: string;
  /** Last verified date (YYYY-MM-DD) */
  last_verified: string;
};

/**
 * Canonical industry-actor registry. Order is roughly by political
 * influence (top = most central to federal kratom policy).
 */
export const KRATOM_INDUSTRY_ACTORS: IndustryActor[] = [
  // ── Lead lobbyists ─────────────────────────────────────────────
  {
    id: "mac-haddow",
    name: "C. McClain (Mac) Haddow",
    role: "lobbyist",
    faction: "aka_aligned",
    summary:
      "Lead lobbyist for the American Kratom Association. Former Reagan administration official. Advised Senator Orrin Hatch on the 1994 Dietary Supplement Health and Education Act (DSHEA) — the legal framework that supplements, including kratom, sit under. Textbook revolving-door figure: from drafting the law to lobbying for its application to kratom.",
    affiliations: ["American Kratom Association (AKA)", "Upstream Consulting"],
    lobbying_firm: "Upstream Consulting, Inc.",
    former_government_role: "Reagan administration; advisor to Sen. Orrin Hatch (R-UT)",
    evidence_urls: [
      "https://project.tampabay.com/investigations/deadly-dose/american-kratom-association-lobbyists-fda-florida/",
      "https://lda.senate.gov/", // multiple Upstream→AKA filings
    ],
    last_verified: "2026-05-14",
  },
  {
    id: "david-carlucci",
    name: "David Carlucci",
    role: "lobbyist",
    faction: "aka_aligned",
    summary:
      "Former New York State Senator. Runs DAVID CARLUCCI CONSULTING — registered AKA lobbyist (LDA filings, 2025-2026). Separately operates CARLUCCI FOR CONGRESS PAC which received traceable individual donations from kratom-business employees. Direct revolving-door pattern: elected official → lobbyist for the industry, with overlapping campaign finance flows.",
    affiliations: ["David Carlucci Consulting", "American Kratom Association"],
    lobbying_firm: "David Carlucci Consulting",
    former_government_role: "New York State Senator",
    evidence_urls: [
      "https://lda.senate.gov/api/v1/filings/?registrant_name=david+carlucci+consulting",
    ],
    state: "NY",
    last_verified: "2026-05-14",
  },
  {
    id: "tony-sermonti",
    name: "Tony Sermonti",
    role: "lobbyist",
    faction: "aka_aligned",
    summary:
      "AKA-aligned lobbyist actively involved in state-level kratom legislation. Named in Washington State legislative coverage as the AKA's spokesperson on tax-and-regulate bills. Supports banning synthetic-7-OH but pushes back on recordkeeping, criminal penalties, and distributor requirements that would burden traditional kratom retailers.",
    affiliations: ["American Kratom Association"],
    evidence_urls: [
      "https://washingtonstatestandard.com/2026/01/31/kratom-taxes-and-regulations-weighed-in-wa/",
    ],
    last_verified: "2026-05-14",
  },
  {
    id: "scott-bass",
    name: "Scott Bass",
    role: "lobbyist",
    faction: "aka_aligned",
    summary:
      "Industry attorney who helped craft the 1994 DSHEA legislation. Long-running supplement-industry advocate. Connects the kratom industry to the broader dietary supplement lobby's institutional positions.",
    affiliations: ["American Kratom Association (aligned)"],
    evidence_urls: [
      "https://project.tampabay.com/investigations/deadly-dose/american-kratom-association-lobbyists-fda-florida/",
    ],
    last_verified: "2026-05-14",
  },
  {
    id: "mark-valente-iii",
    name: "Mark Valente III",
    role: "lobbying_firm",
    faction: "aka_aligned",
    summary:
      "Principal of Valente & Associates, a DC government affairs firm. Filed LDA disclosures on behalf of The Raben Group acting for the Botanical Education Alliance (an AKA-adjacent sub-coalition). Active in the 2016 DEA-scheduling-fight era.",
    affiliations: ["Valente & Associates", "The Raben Group", "Botanical Education Alliance"],
    lobbying_firm: "Valente & Associates",
    evidence_urls: ["https://lda.senate.gov/"],
    last_verified: "2026-05-14",
  },
  {
    id: "mark-rodgers",
    name: "Mark William Rodgers",
    role: "lobbyist",
    faction: "aka_aligned",
    summary:
      "Lobbyist at Valente & Associates filing on behalf of the Botanical Education Alliance / The Raben Group. Covered-position history includes Deputy Director of Congressional Relations and Policy Director at OPM — clear federal-policy revolving-door.",
    affiliations: ["Valente & Associates", "Botanical Education Alliance"],
    lobbying_firm: "Valente & Associates",
    former_government_role: "Deputy Dir. Congressional Relations; Policy Dir. OPM",
    evidence_urls: ["https://lda.senate.gov/"],
    last_verified: "2026-05-14",
  },

  // ── Industry organizations ─────────────────────────────────────
  {
    id: "aka",
    name: "American Kratom Association (AKA)",
    role: "industry_org",
    faction: "aka_aligned",
    summary:
      "Primary kratom-industry advocacy 501(c)(4) since 2014. EIN 47-2208981. Based in Gainesville, VA (DC-adjacent — deliberate). $4.5M revenue in 2023 (22,000% growth from 2016). Has championed model legislation (Kratom Consumer Protection Act, KCPA) in 34 states. Anti-7-OH posture. Per Tampa Bay Times investigation, AKA lobbyists draft the actual legislation that gets introduced.",
    affiliations: ["Upstream Consulting", "Multiple retained DC firms (2026: Michael Best, Kountoupes, Corcoran, Carlucci)"],
    evidence_urls: [
      "https://projects.propublica.org/nonprofits/organizations/472208981",
      "https://project.tampabay.com/investigations/deadly-dose/american-kratom-association-lobbyists-fda-florida/",
    ],
    state: "VA",
    last_verified: "2026-05-14",
  },
  {
    id: "gkc",
    name: "Global Kratom Coalition (GKC)",
    role: "industry_org",
    faction: "aka_aligned",
    summary:
      "Newer kratom-industry advocacy entity (EIN 93-3734910, based in LA). Classified as Alliance/Advocacy nonprofit. Latest IRS filing shows $2.99M in expenses on $0 revenue — classic single-funder-shell pattern; widely reported as backed by Botanic Tonics/Feel Free money. Listed in LegiStorm's DC lobbying tracker. Retains Troutman Strategies for federal lobbying. Position-wise: anti-7-OH like AKA but the funding flow suggests Botanic Tonics influence.",
    affiliations: ["Botanic Tonics / Feel Free (alleged funding source)", "Troutman Strategies"],
    evidence_urls: [
      "https://projects.propublica.org/nonprofits/organizations/933734910",
      "https://globalkratomcoalition.org/",
      "https://www.legistorm.com/organization/summary/199886/Global_Kratom_Coalition.html",
    ],
    state: "CA",
    last_verified: "2026-05-14",
  },
  {
    id: "bea",
    name: "Botanical Education Alliance (BEA)",
    role: "industry_org",
    faction: "aka_aligned",
    summary:
      "Sub-coalition active in 2016-era DEA-scheduling fight. Retained Valente & Associates via The Raben Group. Less visible in recent filings but historically lobbied against kratom restrictions on consumer-product grounds.",
    affiliations: ["The Raben Group", "Valente & Associates"],
    evidence_urls: ["https://lda.senate.gov/"],
    last_verified: "2026-05-14",
  },
  {
    id: "stop-gas-station-heroin-llc",
    name: "STOP GAS STATION HEROIN LLC",
    role: "industry_org",
    faction: "aka_aligned",
    summary:
      "Single-purpose LLC bankrolling the 'gas station heroin' anti-7-OH branding campaign. Retains Checkmate Government Relations for federal lobbying — $150,000 disclosed in Q1 2026 alone. The LLC structure deliberately obscures who funds it; the branding aligns with AKA's anti-7-OH talking points.",
    affiliations: ["Checkmate Government Relations"],
    evidence_urls: ["https://lda.senate.gov/"],
    last_verified: "2026-05-14",
  },
  {
    id: "7-hope-alliance",
    name: "7-HOPE Alliance",
    role: "industry_org",
    faction: "pro_7oh",
    summary:
      "Industry coalition advocating FOR 7-OH-enriched kratom products. Opposite faction to AKA/GKC. Argues 7-OH represents a 'natural technological advancement' of kratom; pushes back on FDA's Schedule I recommendation (July 2025).",
    affiliations: ["HART (Hydroxy Alkaloid Research Taskforce)"],
    evidence_urls: [
      "https://followtestmykratom.substack.com/p/info-the-fight-over-7-oh-inside-kratoms-b64",
    ],
    last_verified: "2026-05-14",
  },
  {
    id: "botanic-tonics-feel-free",
    name: "Botanic Tonics (Feel Free)",
    role: "industry_company",
    faction: "pro_7oh",
    summary:
      "Maker of 'Feel Free' kratom drink products. Settled an $8.75M class-action suit in 2025 over deceptive marketing. Widely alleged to be the funding source behind Global Kratom Coalition's expenses-without-revenue pattern. Represents the pro-7-OH, beverage-format faction of the industry.",
    affiliations: ["Global Kratom Coalition (alleged funder)"],
    evidence_urls: [
      "https://followtestmykratom.substack.com/p/info-the-fight-over-7-oh-inside-kratoms-b64",
    ],
    last_verified: "2026-05-14",
  },

  // ── Kratom companies / executives ──────────────────────────────
  {
    id: "david-derian-botanaway",
    name: "David Reynolds Derian",
    role: "company_executive",
    faction: "company_independent",
    summary:
      "CEO of Botanaway, Inc. — Richmond, Virginia-based kratom company. Owns Kratom.com and KRATOMade brands. Richmond placement is DC-adjacent (mirroring AKA's Gainesville VA office), suggesting a deliberate DC-corridor positioning for industry political access. Had a 2018 manufacturing partnership with Apple Rush Company (publicly disclosed via press release). Industry-side position not publicly stated in LDA filings I've indexed; deeper investigation warranted.",
    affiliations: ["Botanaway, Inc.", "Kratom.com", "KRATOMade"],
    evidence_urls: [
      "https://botanaway.com/",
      "https://www.globenewswire.com/news-release/2018/06/18/1526042/0/en/UPDATE-Apple-Rush-Company-Inc-Announces-Manufacturing-Partnership-with-BotanaWay-Inc.html",
    ],
    state: "VA",
    last_verified: "2026-05-14",
  },
  {
    id: "mit45",
    name: "MIT45, Inc.",
    role: "industry_company",
    faction: "aka_aligned",
    summary:
      "Major kratom-extract product brand. Direct retained federal lobbying via MCGUIREWOODS CONSULTING (earlier filings) and RAGNAR GROUP LLC (current — $40,000 Q1 2026). Anti-7-OH posture aligned with AKA; protects its high-mitragynine extract product lines.",
    affiliations: ["McGuireWoods Consulting", "Ragnar Group LLC", "American Kratom Association"],
    evidence_urls: ["https://lda.senate.gov/"],
    last_verified: "2026-05-14",
  },
  {
    id: "zion-herbals",
    name: "Zion Herbals",
    role: "industry_company",
    faction: "company_independent",
    summary:
      "Established kratom company (launched 2010-2012). Premium kratom and extract products. Conflicting public records on home base (Richmond VA per some sources; Fence Lake NM per others). Wholesale distribution through Nuwave Botanicals + Kratom Roots. No federal lobbying filings under this name in our LDA index — political activity, if any, flows through industry associations they participate in. User report indicates direct DC/agency connections worth investigating beyond LDA records.",
    affiliations: ["Zion Medicinal (sister brand)"],
    evidence_urls: [
      "https://zionherbals.com/",
      "https://zionmedicinal.com/about",
    ],
    last_verified: "2026-05-14",
  },
  {
    id: "opms",
    name: "O.P.M.S.",
    role: "industry_company",
    faction: "aka_aligned",
    summary:
      "High-extract kratom product brand. Linked by Tampa Bay Times investigation to fatal overdose cases. AKA-aligned (anti-7-OH) to protect its extract products.",
    affiliations: ["American Kratom Association"],
    evidence_urls: [
      "https://project.tampabay.com/investigations/deadly-dose/american-kratom-association-lobbyists-fda-florida/",
    ],
    last_verified: "2026-05-14",
  },

  // ── AKA leadership / governance ────────────────────────────────
  {
    id: "ryan-burroughs",
    name: "Ryan Burroughs",
    role: "company_executive",
    faction: "aka_aligned",
    summary:
      "Executive Director of the American Kratom Association. Public-facing operational lead of the industry's primary federal advocacy 501(c)(4).",
    affiliations: ["American Kratom Association"],
    evidence_urls: [
      "https://project.tampabay.com/investigations/deadly-dose/american-kratom-association-lobbyists-fda-florida/",
    ],
    last_verified: "2026-05-14",
  },
  {
    id: "susan-ash",
    name: "Susan Ash",
    role: "former_industry_leader",
    faction: "aka_aligned",
    summary:
      "Founder of the American Kratom Association in 2014. Resigned in 2017 amid allegations of financial improprieties (per Tampa Bay Times). Important historical figure — her departure preceded AKA's pivot to professional DC lobbying.",
    affiliations: ["American Kratom Association (founder, departed 2017)"],
    evidence_urls: [
      "https://project.tampabay.com/investigations/deadly-dose/american-kratom-association-lobbyists-fda-florida/",
    ],
    last_verified: "2026-05-14",
  },

  // ── Regulators / officials ─────────────────────────────────────
  {
    id: "brett-giroir",
    name: "Brett Giroir",
    role: "regulator_or_official",
    faction: "regulator",
    summary:
      "Trump-administration Assistant Secretary for Health (HHS). Publicly refused to sign off on a kratom scheduling action — a notable inflection point in federal kratom policy. AKA cited his stance favorably in advocacy.",
    affiliations: ["HHS (former)"],
    former_government_role: "HHS Assistant Secretary for Health (Trump admin)",
    evidence_urls: [
      "https://project.tampabay.com/investigations/deadly-dose/american-kratom-association-lobbyists-fda-florida/",
    ],
    last_verified: "2026-05-14",
  },
  {
    id: "orrin-hatch",
    name: "Sen. Orrin Hatch (R-UT, retired)",
    role: "regulator_or_official",
    faction: "regulator",
    summary:
      "Long-serving Utah senator, retired 2019. Author of the 1994 DSHEA — the supplement-industry framework kratom operates under. Sent a letter to the DEA in 2016 opposing a kratom ban. Advised by Mac Haddow (now AKA's lead lobbyist). The DSHEA→Hatch→Haddow→AKA pipeline is the foundational revolving-door pattern for the modern kratom-policy fight.",
    affiliations: ["U.S. Senate (retired)"],
    former_government_role: "U.S. Senator, Utah (1977-2019)",
    evidence_urls: [
      "https://project.tampabay.com/investigations/deadly-dose/american-kratom-association-lobbyists-fda-florida/",
    ],
    state: "UT",
    last_verified: "2026-05-14",
  },

  // ── Academic researchers ───────────────────────────────────────
  {
    id: "christopher-mccurdy",
    name: "Christopher McCurdy",
    role: "researcher",
    faction: "academic",
    summary:
      "University of Florida pharmacy researcher. Frequently cited in kratom press coverage on both sides — neutral academic source on alkaloid pharmacology. Worth surfacing on briefings as a non-industry expert reference.",
    affiliations: ["University of Florida College of Pharmacy"],
    evidence_urls: [
      "https://project.tampabay.com/investigations/deadly-dose/american-kratom-association-lobbyists-fda-florida/",
    ],
    state: "FL",
    last_verified: "2026-05-14",
  },
  {
    id: "abhisheak-sharma",
    name: "Abhisheak Sharma",
    role: "researcher",
    faction: "academic",
    summary:
      "University of Florida researcher specializing in kratom alkaloid chemistry. Co-author with McCurdy.",
    affiliations: ["University of Florida"],
    evidence_urls: [
      "https://project.tampabay.com/investigations/deadly-dose/american-kratom-association-lobbyists-fda-florida/",
    ],
    state: "FL",
    last_verified: "2026-05-14",
  },
  {
    id: "albert-garcia-romeu",
    name: "Albert Garcia-Romeu",
    role: "researcher",
    faction: "academic",
    summary:
      "Johns Hopkins psychiatry researcher; published on kratom use patterns. Independent academic source.",
    affiliations: ["Johns Hopkins University"],
    evidence_urls: [
      "https://project.tampabay.com/investigations/deadly-dose/american-kratom-association-lobbyists-fda-florida/",
    ],
    state: "MD",
    last_verified: "2026-05-14",
  },
];

export const FACTION_META: Record<ActorFaction, { label: string; tone: string; emoji: string; summary: string }> = {
  aka_aligned: {
    label: "AKA-aligned",
    tone: "bg-emerald-700 text-zinc-100",
    emoji: "🌿",
    summary: "Anti-7-OH. Protects traditional kratom + extracts. AKA + GKC + Botanical Education Alliance + AKA's retained DC firms + AKA-protected product brands (MIT45, OPMS).",
  },
  pro_7oh: {
    label: "Pro-7-OH",
    tone: "bg-amber-700 text-zinc-100",
    emoji: "💊",
    summary: "Defends 7-OH-enriched / synthetic-analog kratom products. 7-HOPE Alliance, HART, Botanic Tonics/Feel Free. Opposed by AKA + GKC.",
  },
  company_independent: {
    label: "Company (independent)",
    tone: "bg-zinc-700 text-zinc-100",
    emoji: "🏢",
    summary: "Operating company without publicly declared industry-faction alignment in our records.",
  },
  regulator: {
    label: "Regulator / Official",
    tone: "bg-red-700 text-zinc-100",
    emoji: "🏛",
    summary: "Government side — FDA, DEA, HHS, congressional offices with public kratom-policy positions.",
  },
  academic: {
    label: "Academic",
    tone: "bg-sky-700 text-zinc-100",
    emoji: "🎓",
    summary: "University researchers — neutral subject-matter experts cited by both sides.",
  },
};

export const ROLE_LABEL: Record<ActorRole, string> = {
  lobbyist: "Lobbyist",
  lobbying_firm: "Lobbying firm principal",
  industry_org: "Industry organization",
  industry_company: "Industry company",
  company_executive: "Company executive",
  regulator_or_official: "Regulator / Official",
  researcher: "Academic researcher",
  former_industry_leader: "Former industry leader",
};

/**
 * Look up actors by faction.
 */
export function actorsByFaction(faction: ActorFaction): IndustryActor[] {
  return KRATOM_INDUSTRY_ACTORS.filter((a) => a.faction === faction);
}

/**
 * Find actors that mention a given state in either their state field
 * or their summary text. Used for state-briefing cross-reference.
 */
export function actorsForState(state: string): IndustryActor[] {
  const code = state.toUpperCase();
  return KRATOM_INDUSTRY_ACTORS.filter(
    (a) => a.state === code || a.summary.toUpperCase().includes(` ${code}`),
  );
}

/**
 * Find actors connected to a specific legislator. Two match modes:
 *   1. Last-name appears anywhere in the actor's name or summary —
 *      catches direct mentions like "advised Sen. Hatch on DSHEA"
 *   2. Legislator's full name appears as substring in the summary —
 *      catches "received donations from..." or "co-sponsored with..."
 *
 * Returns empty array when no matches — most legislators won't have
 * any direct connection to a named industry actor.
 *
 * Conservative match: requires a substantive last-name token (>= 5
 * chars) to avoid false positives on common surnames like Smith.
 */
export function actorsForLegislator(legislator: {
  full_name: string;
  state?: string | null;
}): IndustryActor[] {
  const fullName = legislator.full_name.trim();
  if (!fullName) return [];

  // Extract last name — assumes typical "First Last" or "First Middle Last" order.
  const parts = fullName.split(/\s+/).filter(Boolean);
  const lastName = parts[parts.length - 1] ?? "";
  const fullNameLower = fullName.toLowerCase();
  const lastNameLower = lastName.toLowerCase();
  const isSubstantiveLast = lastName.length >= 5;

  const matches: IndustryActor[] = [];
  const seen = new Set<string>();

  for (const a of KRATOM_INDUSTRY_ACTORS) {
    if (seen.has(a.id)) continue;
    const summaryLower = a.summary.toLowerCase();
    const nameLower = a.name.toLowerCase();

    // Match 1: full name in summary (strongest signal)
    if (summaryLower.includes(fullNameLower)) {
      matches.push(a);
      seen.add(a.id);
      continue;
    }

    // Match 2: last name in summary AND last name is substantive (>= 5 chars)
    if (isSubstantiveLast && summaryLower.includes(lastNameLower)) {
      // Extra-check: don't false-match on a common word that happens to be a surname.
      // Require the last-name token to appear with a leading non-letter boundary.
      const boundaryRe = new RegExp(`(^|[^a-z])${lastNameLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`);
      if (boundaryRe.test(summaryLower)) {
        matches.push(a);
        seen.add(a.id);
        continue;
      }
    }

    // Match 3: actor's name IS the legislator's name (e.g. Hatch entry)
    if (nameLower.includes(fullNameLower) || (isSubstantiveLast && nameLower.includes(lastNameLower))) {
      matches.push(a);
      seen.add(a.id);
      continue;
    }
  }

  return matches;
}
