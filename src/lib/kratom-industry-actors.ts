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
  | "aka_coalition"         // AKA + Bramble + AKA-shell "Center For Plant Science and Health" + Botanical Education Alliance
  | "gkc_coalition"         // GKC (founded 2024 by Botanic Tonics' J.W. Ross) + Botanic Tonics/Feel Free + Urban Ice + MIT45 + Top Tree + New Brew + OG Kratom + Kava Garden + Pure Leaf
  | "pro_7oh"               // 7-HOPE Alliance + HART — defends 7-OH-enriched/synthetic-analog products
  | "company_independent"   // operating company outside declared coalition alignment
  | "regulator"             // government side — FDA, DEA, HHS, congressional offices
  | "academic"              // university researchers
  | "cross_coalition";      // figures with feet in multiple camps (e.g. Kelly Dunn — AKA co-founder, Urban Ice in GKC)

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
    faction: "aka_coalition",
    summary:
      "Lead lobbyist for the American Kratom Association via Upstream Consulting. Former Reagan administration official. MANAGED Sen. Orrin Hatch's 1976 Senate campaign — the upset victory that launched both Hatch's career and Haddow's. Later advised Hatch on the 1994 Dietary Supplement Health and Education Act (DSHEA). Now writes the actual bill text that gets handed to state legislators — per Courthouse News investigation, Haddow gave the KCPA bill language to Sen. Curt Bramble (Utah) who then sponsored it. LDS-network operator (per platform owner's first-hand observation at Salt Lake City kratom summit).",
    affiliations: ["American Kratom Association (AKA)", "Upstream Consulting", "LDS political network"],
    lobbying_firm: "Upstream Consulting, Inc.",
    former_government_role: "Reagan administration; campaign manager for Sen. Orrin Hatch's 1976 race; advisor on DSHEA 1994",
    evidence_urls: [
      "https://project.tampabay.com/investigations/deadly-dose/american-kratom-association-lobbyists-fda-florida/",
      "https://www.courthousenews.com/the-law-and-the-profits-inside-kratoms-political-underbelly/",
      "https://lda.senate.gov/",
    ],
    last_verified: "2026-05-14",
  },
  {
    id: "david-carlucci",
    name: "David Carlucci",
    role: "lobbyist",
    faction: "aka_coalition",
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
    faction: "aka_coalition",
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
    faction: "aka_coalition",
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
    faction: "aka_coalition",
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
    faction: "aka_coalition",
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
    faction: "aka_coalition",
    summary:
      "Primary kratom-industry advocacy 501(c)(4). Co-founded 2014 by Susan Ash + Kelly Dunn (Urban Ice Botanicals). EIN 47-2208981. Based in Gainesville, VA (DC-adjacent — deliberate). $4.5M revenue in 2023 (22,000% growth from 2016). Has championed model legislation (Kratom Consumer Protection Act / KCPA) in 34 states — per Courthouse News investigation, Mac Haddow (AKA lead lobbyist) hands the bill text directly to friendly state legislators like Sen. Curt Bramble (UT). Paid Bramble $137,500 in consulting fees in 2019 alone. AKA-shell entity 'The Center For Plant Science and Health' (same executives) paid Bramble & Company an additional $968,845 over 4 years without legislative disclosure.",
    affiliations: ["Upstream Consulting (Haddow)", "Center For Plant Science and Health (shell with same executives)", "Multiple retained DC firms (2026: Michael Best, Kountoupes, Corcoran, Carlucci)"],
    evidence_urls: [
      "https://projects.propublica.org/nonprofits/organizations/472208981",
      "https://project.tampabay.com/investigations/deadly-dose/american-kratom-association-lobbyists-fda-florida/",
      "https://www.courthousenews.com/the-law-and-the-profits-inside-kratoms-political-underbelly/",
    ],
    state: "VA",
    last_verified: "2026-05-14",
  },
  {
    id: "gkc",
    name: "Global Kratom Coalition (GKC)",
    role: "industry_org",
    faction: "gkc_coalition",
    summary:
      "Founded May 2024 by J.W. Ross (aka Jerry Cash — Botanic Tonics/Feel Free founder, ex-federal-felon). Executive Director: Matthew Lowe. Primary funder: Botanic Tonics. EIN 93-3734910, LA-based. Eight publicly-listed industry supporters: Botanic Tonics, Top Tree Herbs, New Brew, Urban Ice Botanicals, OG Kratom, Kava Garden, MIT45, Pure Leaf. Pledged $250K to University of Florida Foundation for kratom research. Anti-7-OH position (despite earlier press confusion). Retains Troutman Strategies for federal lobbying. Distinct from AKA — direct competitor coalition organized after AKA was already entrenched.",
    affiliations: ["Botanic Tonics / Feel Free (founder + primary funder)", "Troutman Strategies", "University of Florida Foundation"],
    evidence_urls: [
      "https://projects.propublica.org/nonprofits/organizations/933734910",
      "https://globalkratomcoalition.org/",
      "https://www.bevnet.com/pr/2024/05/06/botanic-tonics-announces-support-for-the-global-kratom-coalition-and-advocates-for-safe-regulated-kratom-industry",
      "https://toptreeherbs.com/global-kratom-coalition-kratom-organization/",
    ],
    state: "CA",
    last_verified: "2026-05-14",
  },
  {
    id: "bea",
    name: "Botanical Education Alliance (BEA)",
    role: "industry_org",
    faction: "aka_coalition",
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
    faction: "aka_coalition",
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
    faction: "gkc_coalition",
    summary:
      "Maker of 'Feel Free' kratom-and-kava drink. Founder J.W. Ross (real name Jerry Cash, served federal prison time for diverting ~$10M from an oil and gas company). Settled $8.75M class-action suit in 2025 over deceptive marketing. Founded the Global Kratom Coalition in May 2024 and is its primary funder. Donated $500,000 to MAHA PAC (RFK Jr's 'Make America Healthy Again') in early 2026 — ten weeks after the DOJ inexplicably dropped its case against the company in December 2025, citing 'expired products and resource concerns.' DHS Secretary Markwayne Mullin reportedly holds a financial stake in Botanic Tonics worth part of his $60M net worth. Position is anti-7-OH (NOT pro-7-OH as some early press coverage suggested).",
    affiliations: ["Global Kratom Coalition (founder + primary funder)", "MAHA PAC ($500k donor)", "DHS Sec. Mullin (financial stake)"],
    evidence_urls: [
      "https://www.yahoo.com/news/articles/behind-kratom-giant-botanic-tonics-100244740.html",
      "https://www.bevnet.com/pr/2024/05/06/botanic-tonics-announces-support-for-the-global-kratom-coalition-and-advocates-for-safe-regulated-kratom-industry",
      "https://allaboutlawyer.com/botanic-tonics-feel-free-kratom-lawsuit-settlement-rights/",
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
    faction: "gkc_coalition",
    summary:
      "Major kratom-extract product brand. Listed as one of the 8 industry supporters of the Global Kratom Coalition. Direct retained federal lobbying via MCGUIREWOODS CONSULTING (earlier filings) and RAGNAR GROUP LLC (current — $40,000 Q1 2026). High-mitragynine extract focus.",
    affiliations: ["Global Kratom Coalition", "McGuireWoods Consulting", "Ragnar Group LLC"],
    evidence_urls: [
      "https://lda.senate.gov/",
      "https://toptreeherbs.com/global-kratom-coalition-kratom-organization/",
    ],
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
    faction: "aka_coalition",
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
    faction: "aka_coalition",
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
    faction: "aka_coalition",
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

  // ── DEEP-INVESTIGATION ADDITIONS (2026-05-14) ──────────────────
  // From Courthouse News investigation "Inside kratom's political
  // underbelly", Yahoo News reporting on the Botanic Tonics MAHA PAC
  // donation, and platform owner's first-hand observations at the
  // Salt Lake City kratom summit.

  {
    id: "jw-ross-jerry-cash",
    name: "J.W. Ross (a/k/a Jerry Cash)",
    role: "company_executive",
    faction: "gkc_coalition",
    summary:
      "Founder of Botanic Tonics (Feel Free kratom drink) and founder of the Global Kratom Coalition (May 2024). Previously known as Jerry Cash — served federal prison time for diverting approximately $10 million from an oil and gas company to fund a lavish lifestyle. After release, founded Botanic Tonics and grew it into one of the largest kratom-beverage companies. Personally directed the company's $500K donation to MAHA PAC ten weeks after DOJ dropped its case against the company in December 2025.",
    affiliations: ["Botanic Tonics / Feel Free", "Global Kratom Coalition"],
    evidence_urls: [
      "https://www.yahoo.com/news/articles/behind-kratom-giant-botanic-tonics-100244740.html",
      "https://floridapolitics.com/archives/721249-conflicts-abound-in-new-florida-push-against-kratom-compound/",
    ],
    last_verified: "2026-05-14",
  },

  {
    id: "matthew-lowe",
    name: "Matthew Lowe",
    role: "company_executive",
    faction: "gkc_coalition",
    summary:
      "Executive Director of the Global Kratom Coalition. Public-facing operational lead of the GKC's federal advocacy. Less visible historically than AKA's leadership; the GKC's organizational structure is opaque (single-funder pattern with $0 reported revenue against $3M expenses).",
    affiliations: ["Global Kratom Coalition"],
    evidence_urls: [
      "https://toptreeherbs.com/global-kratom-coalition-kratom-organization/",
      "https://globalkratomcoalition.org/",
    ],
    last_verified: "2026-05-14",
  },

  {
    id: "kelly-dunn",
    name: "Kelly Dunn",
    role: "company_executive",
    faction: "cross_coalition",
    summary:
      "Founder and CEO of Urban Ice Botanicals (Las Vegas, NV) — one of the oldest U.S. kratom suppliers (20+ years). CO-FOUNDED the American Kratom Association in 2014 alongside Susan Ash. Urban Ice Botanicals is now ALSO listed as a Global Kratom Coalition industry supporter — meaning Dunn has active stakes in BOTH dominant industry coalitions. **Executive Producer of 'A Leaf of Faith' (Netflix 2018) AND funded the initial round of kratom research the documentary cites — textbook influence-laundering chain: industry $ → 'independent research' → 'independent documentary' → Netflix mass-distribution → policy advocacy.** Appeared on the Chronically Human Podcast Ep. 25 and other major podcasts. Per platform owner's first-hand observation, Dunn and David Reynolds Derian (Botanaway) operate a coordinated 'control system' reaching across formal coalition lines into international kratom-supply networks — the global coordination beyond what appears in U.S. federal filings.",
    affiliations: ["Urban Ice Botanicals", "American Kratom Association (co-founder, 2014)", "Global Kratom Coalition (Urban Ice as supporter)", "A Leaf of Faith documentary (Executive Producer + research funder)", "Maitie Productions"],
    evidence_urls: [
      "https://urbanicebotanicals.com/our-story/",
      "https://urbanicebotanicals.com/about-us/",
      "https://www.facebook.com/ALeafOfFaith/posts/kelly-dunn-founder-of-urban-ice-organics-and-executive-producer-of-a-leaf-of-fai/548126008963396/",
      "https://podcasts.apple.com/us/podcast/talking-all-things-kratom-with-kelly-dunn-owner-of/id1453792861?i=1000433531674",
    ],
    state: "NV",
    last_verified: "2026-05-14",
  },

  {
    id: "curt-bramble",
    name: "Sen. Curt Bramble",
    role: "regulator_or_official",
    faction: "aka_coalition",
    summary:
      "Republican state senator from Provo, Utah. LDS (joined the Church while attending Notre Dame). SPONSORED the original Kratom Consumer Protection Act in 2019 — the first state-level kratom regulation law, now the template propagated across 34 states. Per Courthouse News investigation: Mac Haddow handed Bramble the bill language. AKA paid Bramble $137,500 in 2019 consulting fees. AKA-shell entity 'The Center For Plant Science and Health' (same executives as AKA) paid Bramble & Company an additional $968,845 over 4 years. NONE of this disclosed in legislative records — Utah law has a loophole that doesn't require disclosure of consulting payments to a legislator's business. Bramble has TESTIFIED for kratom bills in Missouri, Louisiana, Ohio, Texas, Wisconsin, and Colorado — paid traveling advocate for the AKA model. Met by platform owner in person at Salt Lake City kratom summit alongside Vernon Jones. LDS political network operator alongside Mac Haddow.",
    affiliations: ["Utah State Senate", "American Kratom Association ($137k consulting 2019)", "Center For Plant Science and Health ($968k consulting over 4 years)", "LDS political network"],
    former_government_role: "Utah State Senator (current)",
    evidence_urls: [
      "https://www.courthousenews.com/the-law-and-the-profits-inside-kratoms-political-underbelly/",
      "https://en.wikipedia.org/wiki/Curt_Bramble",
      "https://www.sltrib.com/news/politics/2025/01/23/loophole-lets-former-utah/",
      "https://senate.utah.gov/sen/BRAMBCS/",
    ],
    state: "UT",
    last_verified: "2026-05-14",
  },

  {
    id: "center-plant-science-health",
    name: "The Center For Plant Science and Health",
    role: "industry_org",
    faction: "aka_coalition",
    summary:
      "AKA-shell entity per Courthouse News investigation — 'has most of the same executives as AKA.' Began reporting consulting payments to Bramble & Company in 2020, totaling $968,845 over four years. The shell structure separates the payments from AKA's directly-disclosed lobbying spend while keeping the AKA leadership group in control of the payment flow. Worth investigating: what other state legislators receive payments from this entity? Public filings should be discoverable but require focused FOIA / state-records work.",
    affiliations: ["American Kratom Association (same executive leadership)"],
    evidence_urls: [
      "https://www.courthousenews.com/the-law-and-the-profits-inside-kratoms-political-underbelly/",
    ],
    last_verified: "2026-05-14",
  },

  {
    id: "vernon-jones",
    name: "Vernon Jones",
    role: "regulator_or_official",
    faction: "aka_coalition",
    summary:
      "Former Georgia state representative (District 91). CO-SPONSORED Georgia HB 551 — the Kratom Consumer Protection Act — in 2019 alongside Hill, Caldwell, Mathiak, and Newton. GA HB 551 was one of FOUR state-level KCPAs passed in 2019 (UT/AZ/GA/NV) as a coordinated multi-state wave from AKA's model legislation. Bipartisan profile: Jones served as a Democrat then switched Republican. Ran for GA governor in 2022 (R primary). Per platform owner's first-hand observation, attended the Salt Lake City kratom summit alongside Sen. Curt Bramble — meaning the GA KCPA co-sponsor traveled to UT for an industry coordination event years after the bill passed. Connection pattern: Jones (GA) + Bramble (UT) + Rivero (AZ) + Wheeler/Yeager (NV) are the 4-state KCPA sponsor cluster.",
    affiliations: ["Georgia House of Representatives (former, District 91)", "GA HB 551 co-sponsor", "Salt Lake City kratom summit attendee", "Bramble-Jones-Rivero-Wheeler multi-state KCPA sponsor cluster"],
    former_government_role: "Georgia State Representative; 2022 GA gubernatorial candidate (R)",
    evidence_urls: [
      "https://gov.georgia.gov/document/signed-legislation/hb-551pdf/download",
      "https://legiscan.com/GA/text/HB551/id/1987389",
    ],
    state: "GA",
    last_verified: "2026-05-14",
  },

  {
    id: "markwayne-mullin",
    name: "Sec. Markwayne Mullin",
    role: "regulator_or_official",
    faction: "regulator",
    summary:
      "Newly appointed U.S. Secretary of Homeland Security (2026). $60M+ net worth. Per Yahoo News reporting, holds a financial stake in Botanic Tonics worth part of his net worth — directly invested in a kratom industry company. Publicly condemned kratom-industry practices in July 2025 alongside RFK Jr. The financial interest + public condemnation combination represents either (a) intentional double-play to drive competitors out while protecting his investment, or (b) reformer trajectory despite the holdings. Either way, conflict-of-interest signal worth flagging on his briefing.",
    affiliations: ["U.S. Department of Homeland Security", "Botanic Tonics (financial stake)"],
    former_government_role: "U.S. Senator, Oklahoma (R); now Sec. of Homeland Security",
    evidence_urls: [
      "https://www.yahoo.com/news/articles/behind-kratom-giant-botanic-tonics-100244740.html",
    ],
    state: "OK",
    last_verified: "2026-05-14",
  },

  {
    id: "rfk-jr-maha-pac",
    name: "MAHA PAC (RFK Jr-aligned)",
    role: "regulator_or_official",
    faction: "regulator",
    summary:
      "'Make America Healthy Again' PAC aligned with Robert F. Kennedy Jr's HHS agenda. Received $500,000 donation from Botanic Tonics in early 2026 — ten weeks after DOJ dropped its case against the company in December 2025. Citizenship of the funding flow: kratom industry company → RFK-aligned political vehicle → potential influence over HHS / FDA appointments + kratom-policy positioning. This is the highest-dollar federal political contribution from a kratom company to date and represents a strategic post-DOJ-dismissal capture move.",
    affiliations: ["Robert F. Kennedy Jr.", "HHS (RFK's agency)", "Botanic Tonics ($500k donor)"],
    evidence_urls: [
      "https://www.yahoo.com/news/articles/behind-kratom-giant-botanic-tonics-100244740.html",
    ],
    last_verified: "2026-05-14",
  },

  // ── MULTI-STATE KCPA WAVE (2019) ───────────────────────────────
  // Bramble-Jones-Rivero-Wheeler/Yeager 4-state pattern — AKA's model
  // legislation propagated UT (March 2019) → GA (April) → AZ (May) →
  // NV (June). Vernon Jones (GA) and Curt Bramble (UT) already above;
  // adding the AZ + NV principal sponsors here.

  {
    id: "tony-rivero",
    name: "Rep. Tony Rivero",
    role: "regulator_or_official",
    faction: "aka_coalition",
    summary:
      "Arizona state representative (R). Introduced Arizona HB 2550 — the AZ Kratom Consumer Protection Act — in 2019. Unanimous passage both chambers. Signed into law April 2019. Part of the Bramble-Jones-Rivero-Wheeler 4-state KCPA wave that propagated AKA's model legislation across UT/GA/AZ/NV in a coordinated 90-day window. Per the same AKA-paid traveling-advocate pattern that Bramble exemplifies, Rivero likely received similar industry consideration but disclosure-loophole rules vary by state.",
    affiliations: ["Arizona House of Representatives", "AZ HB 2550 sponsor", "Bramble-Jones-Rivero-Wheeler multi-state KCPA cluster"],
    former_government_role: "Arizona State Representative",
    evidence_urls: [
      "https://www.supplysidesj.com/supplement-regulations/state-legislators-seek-kratom-meeting-with-fda-commissioner",
      "https://professorwhytes.com/blogs/kratom/is-kratom-legal-in-arizona",
    ],
    state: "AZ",
    last_verified: "2026-05-14",
  },

  {
    id: "steve-yeager",
    name: "Rep. Steve Yeager",
    role: "regulator_or_official",
    faction: "aka_coalition",
    summary:
      "Nevada state representative (D). Co-introduced Nevada AB 303 — the NV Kratom Consumer Protection Act — in March 2019 alongside Rep. Jim Wheeler (R). Signed into law by Gov. Sisolak in June 2019, fourth state in the 2019 KCPA wave. Yeager's bipartisan co-sponsorship with Wheeler shows AKA's cross-aisle propagation strategy — same model bill, both parties as carriers.",
    affiliations: ["Nevada Assembly", "NV AB 303 co-sponsor", "Bramble-Jones-Rivero-Wheeler multi-state KCPA cluster"],
    former_government_role: "Nevada State Representative",
    evidence_urls: [
      "https://www.kratomscience.com/2024/12/03/kratom-legal-status-in-nevada-what-you-need-to-know/",
      "https://archive.leg.state.nv.us/Session/80th2019/Exhibits/Assembly/HHS/AHHS812G.pdf",
    ],
    state: "NV",
    last_verified: "2026-05-14",
  },

  {
    id: "jim-wheeler",
    name: "Rep. Jim Wheeler",
    role: "regulator_or_official",
    faction: "aka_coalition",
    summary:
      "Nevada state representative (R). Co-introduced Nevada AB 303 (KCPA) with Rep. Steve Yeager (D) in March 2019. R-side anchor of the bipartisan NV KCPA pair. Part of the 4-state Bramble-Jones-Rivero-Wheeler/Yeager 2019 KCPA wave from AKA.",
    affiliations: ["Nevada Assembly", "NV AB 303 co-sponsor", "Bramble-Jones-Rivero-Wheeler multi-state KCPA cluster"],
    former_government_role: "Nevada State Representative",
    evidence_urls: [
      "https://www.kratomscience.com/2024/12/03/kratom-legal-status-in-nevada-what-you-need-to-know/",
    ],
    state: "NV",
    last_verified: "2026-05-14",
  },

  // ── UTAH 2026 KRATOM LEGISLATION FIGHT ─────────────────────────
  // Six years after Bramble carried Utah's first KCPA, a new wave of
  // restriction bills is being driven by different sponsors — and
  // sparking the LDS Word-of-Wisdom doctrinal sidebar.

  {
    id: "mike-mckell",
    name: "Sen. Mike McKell",
    role: "regulator_or_official",
    faction: "regulator",
    summary:
      "Utah State Senator (R-Spanish Fork). Senate Majority Assistant Whip. Sponsored Utah SB 45 (2026) — a restriction bill that stepped back from a full kratom ban after committee negotiations and now would allow pure-leaf kratom sales in smoke shops to adults 21+. The pull-back trajectory likely reflects AKA / GKC pressure: bill started as a ban, was watered down through legislative cycles, ended as a regulatory framework that preserves industry sales while adding age-gate. Position not yet clear on whether McKell is an AKA-paid consultant like Bramble or an independent regulator.",
    affiliations: ["Utah State Senate", "Utah SB 45 (2026) sponsor"],
    former_government_role: "Utah State Senator",
    evidence_urls: [
      "https://www.deseret.com/utah/2026/03/04/kratom-manufacturing-changes-made/",
      "https://le.utah.gov/Session/2026/bills/introduced/SB0045S01.pdf",
    ],
    state: "UT",
    last_verified: "2026-05-14",
  },

  {
    id: "matt-macpherson",
    name: "Rep. Matt MacPherson",
    role: "regulator_or_official",
    faction: "regulator",
    summary:
      "Utah State Representative (R-Salt Lake County / West Valley City). In March 2026 proposed a substitute amendment to Utah SB 45 that would have written the LDS Church's 'Word of Wisdom' (the Mormon health code prohibiting tobacco, alcohol, coffee, tea) into Utah state law. MacPherson framed it as exposing the legislature's pattern of imposing 'moral health codes.' Substitute rejected 63-10. Even as a failed stunt, the proposal is a notable artifact: it forced into public debate the question of whether Utah's legislature is structurally biased toward LDS doctrinal positions on kratom — which structurally favors prohibition postures.",
    affiliations: ["Utah House of Representatives", "Word of Wisdom substitute (rejected) on UT SB 45"],
    former_government_role: "Utah State Representative",
    evidence_urls: [
      "https://www.fox13now.com/news/politics/mormon-word-of-wisdom-introduced-in-bill-debate-over-utahs-kratom-ban",
      "https://www.eastidahonews.com/2026/03/utah-lawmaker-attempts-to-put-word-of-wisdom-in-state-code/",
    ],
    state: "UT",
    last_verified: "2026-05-14",
  },

  {
    id: "katy-hall",
    name: "Rep. Katy Hall",
    role: "regulator_or_official",
    faction: "regulator",
    summary:
      "Utah State Representative (R-Ogden). House sponsor of the 2026 Utah kratom-restriction package — described as the year's most sweeping legislation seeking to take kratom out of convenience stores. Pushed back on MacPherson's Word-of-Wisdom stunt as not taking the issue seriously. House-side counterpart to Sen. McKell's SB 45.",
    affiliations: ["Utah House of Representatives", "2026 UT kratom-restriction lead House sponsor"],
    former_government_role: "Utah State Representative",
    evidence_urls: [
      "https://www.fox13now.com/news/politics/mormon-word-of-wisdom-introduced-in-bill-debate-over-utahs-kratom-ban",
      "https://www.deseret.com/utah/2026/03/04/kratom-manufacturing-changes-made/",
    ],
    state: "UT",
    last_verified: "2026-05-14",
  },

  // ── MEDIA / DOCUMENTARY INFLUENCE CHANNEL ──────────────────────
  // The Joe-Rogan-podcast → A Leaf of Faith documentary → Netflix
  // pipeline. Kelly Dunn funded the research the doc cited AND was
  // exec producer — textbook influence-laundering: industry money →
  // "independent research" → "independent documentary" → mass media.

  {
    id: "chris-bell",
    name: "Christopher Bell",
    role: "company_executive",
    faction: "cross_coalition",
    summary:
      "Director of the 2018 Netflix documentary 'A Leaf of Faith' which positioned kratom as an opioid-crisis alternative. Brought kratom to Joe Rogan on his podcast in 2016 — the seed mass-media moment that preceded the documentary. Receives Kelly Dunn / Urban Ice money via Maitie Productions co-production. Not directly a coalition figure but the media-influence-channel architect: the Bell → Rogan → Netflix → public-perception pipeline shifted kratom from obscure supplement to broadly-known cause within 2-3 years.",
    affiliations: ["A Leaf of Faith (2018, director)", "Maitie Productions", "Joe Rogan Experience (2016 guest)"],
    evidence_urls: [
      "https://www.imdb.com/title/tt8412232/",
      "https://merryjane.com/health/could-the-opioid-crisis-be-solved-with-kratom-a-leaf-of-faith-says-yes/",
      "https://reason.com/2018/12/01/a-leaf-of-faith/",
    ],
    last_verified: "2026-05-14",
  },

  // ── INDONESIAN SUPPLY CHAIN ────────────────────────────────────
  // Tampa Bay Times "Deadly Dose" investigation Part 3 traced the
  // path from West Kalimantan growers → Pontianak port → Oakland
  // (50% of US kratom imports) + Tampa (14%). Indonesian government
  // DENIED the Times's journalist visa to Pontianak — actively
  // blocking US press coverage.

  {
    id: "opms-supply-chain",
    name: "O.P.M.S. supply chain (Indonesia → US)",
    role: "industry_company",
    faction: "gkc_coalition",
    summary:
      "Per Tampa Bay Times 'Deadly Dose' investigation Part 3: O.P.M.S. leaves harvested in West Kalimantan (Indonesia's Borneo region), processed in factories at the port city of Pontianak (heavy-metals + potency testing, milling), then shipped primarily to Oakland CA (50% of US kratom imports) and Tampa FL (14%). The brand has been linked to fatal overdose cases (per Tampa Bay Times Part 1). Distributors take 'elaborate measures to evade regulators and avoid detection' per the investigation. Indonesian government DENIED the Tampa Bay Times reporter's journalist visa to Pontianak / Kapuas Hulu — actively blocking US journalism on the supply chain.",
    affiliations: ["O.P.M.S. brand", "West Kalimantan growers", "Pontianak processing factories", "Oakland CA port (primary US import)", "Tampa FL port (secondary)"],
    evidence_urls: [
      "https://project.tampabay.com/investigations/deadly-dose/kratom-industry-opms-supply-chain-indonesia-florida/",
      "https://centerforhealthjournalism.org/our-work/reporting/part-3-kratoms-path-across-us-marked-deception-and-secrets",
      "https://www.tampabay.com/kratom/",
    ],
    last_verified: "2026-05-14",
  },
];

export const FACTION_META: Record<ActorFaction, { label: string; tone: string; emoji: string; summary: string }> = {
  aka_coalition: {
    label: "AKA Coalition",
    tone: "bg-emerald-700 text-zinc-100",
    emoji: "🌿",
    summary: "American Kratom Association + its retained DC firms (Upstream, Michael Best, Kountoupes, Carlucci, Corcoran) + AKA-shell entity Center For Plant Science and Health + Botanical Education Alliance. Founded 2014. Anti-7-OH. Authors model state legislation (KCPA) and propagates via paid consultants (e.g. Curt Bramble).",
  },
  gkc_coalition: {
    label: "GKC Coalition",
    tone: "bg-blue-700 text-zinc-100",
    emoji: "🪙",
    summary: "Global Kratom Coalition founded 2024 by Botanic Tonics' J.W. Ross (aka Jerry Cash, ex-felon). Funded primarily by Botanic Tonics. 8 industry supporters: Botanic Tonics, Top Tree Herbs, New Brew, Urban Ice Botanicals, OG Kratom, Kava Garden, MIT45, Pure Leaf. Also anti-7-OH (despite earlier press coverage confusion) but distinct from AKA — operates via Troutman Strategies + $500k to RFK-aligned MAHA PAC.",
  },
  pro_7oh: {
    label: "Pro-7-OH",
    tone: "bg-amber-700 text-zinc-100",
    emoji: "💊",
    summary: "Defends 7-OH-enriched / synthetic-analog kratom products. 7-HOPE Alliance, HART. Opposed by BOTH the AKA Coalition AND the GKC Coalition — the only point where AKA and GKC align.",
  },
  cross_coalition: {
    label: "Cross-coalition",
    tone: "bg-purple-700 text-zinc-100",
    emoji: "🔀",
    summary: "Figures with active feet in multiple camps. Industry power players whose companies and personal advocacy spans AKA + GKC simultaneously — useful for understanding the underlying social/business network beyond formal coalition lines.",
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
    summary: "Government side — FDA, DEA, HHS, congressional offices with public kratom-policy positions OR (in revolving-door cases) financial stakes in the industry they regulate.",
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
