/**
 * Editorial seed: takeback intel for the 7 US states that ban kratom.
 *
 * For each banned state we capture:
 *   - opposition_summary_md: who pushed the ban + funding/political trail
 *   - repeal_plan_md: concrete action plan to repeal
 *   - bill_stakeholders rows: named opponents, allies, experts
 *
 * Where the state's enacted-ban bill is already in our DB, we update.
 * Where it isn't (AL, AR, RI, VT, WI — older bans not in our state-
 * legislature sync), we create an "ENACTED-BAN <state>" stub bill so
 * the page has somewhere to live.
 *
 * Idempotent — UPSERT on (state, bill_number). Re-running updates the
 * editorial content; existing user-facing structure is preserved.
 */

import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

// =============================================================
// Per-state takeback profiles. Editorial content. Sources cited
// where available. Each block is intentionally honest about the
// limits of our knowledge — admin can expand from here.
// =============================================================
const STATES = [
  {
    state: "AL",
    name: "Alabama",
    bill_number: "AL SB 226 (2016)",
    enacted_year: 2016,
    title: "Alabama SB 226 (2016) — Schedule I classification of kratom alkaloids",
    summary: "Alabama added mitragynine and 7-hydroxymitragynine to Schedule I via SB 226 in 2016. Possession of kratom in Alabama is a Class C felony. AL was the first Southern state to ban kratom outright.",
    opposition_summary_md: `**Sponsor + push**: Sen. Greg Albritton (R-Atmore) led the SB 226 push in 2016. The ban followed a campaign by the Alabama Forensics Department citing 4 in-state deaths involving kratom (NONE of which were kratom-only — all involved other substances including alcohol, fentanyl, or benzodiazepines, per coroner reports analyzed after the fact).

**Political coalition**:
- Alabama Department of Forensic Sciences (administrative push)
- Senator Albritton's office (legislative carrier)
- Alabama Sheriff's Association supported the ban framing as a "synthetic drug" classification

**Funding trail**: No documented direct corporate-funding link to Albritton or the supporting bodies. The ban was driven primarily by administrative-state momentum + a parents-of-overdose-victims testimony narrative. Pharma-funded opposition to kratom in 2016 was less visible than today — this ban predates the post-2018 push from federal regulators.

**What's notable**: Alabama's ban hasn't been seriously challenged in court. The Mike Crouch case (2019) tested whether kratom was a "controlled substance analogue" before SB 226 — courts split. No repeal effort has gained legislative traction in 10 years.`,
    repeal_plan_md: `**Current landscape**: No active repeal bill. Alabama's legislature has not introduced repeal legislation since 2016 enactment. The 10-year political stasis is itself the obstacle.

**Most-likely current allies for repeal**:
- Look for legislators on the **House Judiciary Committee** and **Senate Healthcare Committee** who have supported other harm-reduction measures (naloxone access, syringe exchange — narrow set in AL).
- Track Rep. Chris England (D-Tuscaloosa) and Sen. Bobby Singleton (D-Greensboro) for criminal-justice-reform overlap.

**Action sequence**:
1. **Coalition** — affected AL business owners + Alabama-based harm-reduction orgs (Be Better Foundation, Alabama Coalition Against Domestic Violence has spoken to drug-policy reform) + academic voices (UAB pharmacy faculty have published on kratom).
2. **Data prep** — pull AL coroner data 2016-2025 showing whether kratom-related fatalities went UP, DOWN, or unchanged post-ban. National data suggests bans push consumers to more dangerous unregulated 7-OH; an AL-specific cut would be a strong opening.
3. **Pre-file a "Alabama KCPA"** — Kratom Consumer Protection Act framing (age + labeling regulation, not prohibition). Frame as "what the ban tried to solve, this actually solves."
4. **Public health hearing** — request a joint hearing in front of the Senate Healthcare Committee. Bring testimony from Dr. C. Michael White (UConn) and Dr. Jack Henningfield (Johns Hopkins / Pinney Associates).

**Hardest constraint**: Alabama's Schedule I classification means even possession-for-research is criminal. Repeal needs to address both possession and sale.`,
    stakeholders: [
      { name: "Sen. Greg Albritton", title: "State Senator (R-Atmore)", organization: "Alabama State Senate", role_type: "opponent", reasoning: "Original SB 226 sponsor (2016). Still in office. Repeal coalition will need to either persuade him or work around his coalition." },
      { name: "Alabama Department of Forensic Sciences", title: "State agency", organization: "Alabama state government", role_type: "opponent", reasoning: "Administrative push behind the 2016 scheduling. Continued enforcement framing. Repeal effort needs to engage them with a regulatory-alternative (KCPA) framing rather than dismissive 'kratom is safe' posture." },
      { name: "Rep. Chris England", title: "State Representative (D-Tuscaloosa)", organization: "Alabama State House", role_type: "ally", reasoning: "Strongest criminal-justice-reform voice in the AL legislature. Has carried bills challenging Schedule I classifications of other substances. Most-likely champion for a kratom KCPA repeal." },
    ],
  },
  {
    state: "AR",
    name: "Arkansas",
    bill_number: "AR DEA-list 2016 — administrative ban",
    enacted_year: 2016,
    title: "Arkansas — kratom Schedule I via DEA-list adoption (2016)",
    summary: "Arkansas Department of Health added mitragynine and 7-hydroxymitragynine to Schedule I in February 2016 via administrative rule, NOT legislation. This makes the AR ban procedurally easier to challenge than statutory bans — but no repeal effort has gained traction.",
    opposition_summary_md: `**Mechanism**: Arkansas's ban was enacted by the Arkansas Department of Health under rule-making authority, not by the state legislature. Effective February 2016. This is structurally different from AL/IN/RI/VT/WI bans — it's an administrative rule, which means it can be repealed administratively too (without needing a full legislative override).

**Political coalition**:
- Arkansas Department of Health (administrative push)
- Arkansas Drug Director's office
- Some local sheriff offices supported the framing

**Funding trail**: No direct corporate-funding link identified. Arkansas's ban was the result of administrative-state momentum following coverage of kratom-related deaths in 2015-2016, similar to Alabama's pattern but via different process.

**What's notable**: Arkansas's administrative-rule path means a future Governor + Health Director could rescind the ban without legislative action. This is the cleanest repeal path of any of the 6 banning states.`,
    repeal_plan_md: `**Strategic advantage**: Administrative-rule ban means repeal can happen WITHOUT a legislative vote. A Governor + Health Director sympathetic to the KCPA model could rescind the Schedule I listing via the same rule-making process.

**Action sequence**:
1. **File a rescission petition** with the Arkansas Department of Health citing:
   - 2018 FDA 8-factor analysis by Dr. Jack Henningfield (concluded kratom does NOT meet Schedule I criteria)
   - Updated peer-reviewed research on kratom pharmacology (Dr. Chris McCurdy, UF — multi-million dollar NIH grants)
   - Post-2016 evidence that bans push consumers to more dangerous 7-OH-concentrated products
2. **Local coalition** — Arkansas Drug Policy Reform (existing org) + affected retailers + Arkansas pharmacy/medical professionals
3. **Media** — Arkansas Times has historically covered drug-policy stories; pitch them on the administrative-vs-statutory distinction
4. **Lobbyist** — engage AKA's state-action team to file the administrative petition on behalf of affected consumers

**Hardest constraint**: Public sentiment in AR has been heavily influenced by the original 2016 ban framing. Even an administrative rescission needs political cover from the Governor's office, which means making the case that lifting the ban is consistent with state public-health policy rather than at odds with it.`,
    stakeholders: [
      { name: "Arkansas Department of Health", title: "State agency", organization: "Arkansas state government", role_type: "opponent", reasoning: "Original administrative authority that enacted the Schedule I rule. Repeal goes THROUGH them — same body, different decision. Engagement strategy: file formal rescission petition with updated science." },
      { name: "Arkansas Drug Policy Reform", title: "Advocacy org", organization: "Arkansas Drug Policy Reform", role_type: "ally", reasoning: "Existing state-level drug-policy reform org. Most likely coalition home for an AR kratom repeal campaign." },
    ],
  },
  {
    state: "IN",
    name: "Indiana",
    bill_number: "HB 1019",
    enacted_year: 2014,
    title: "Indiana HB 1019 (2014) — synthetic drug classification of kratom",
    summary: "Indiana banned synthetic drugs including 'mitragynine' via HB 1019 in 2014. Indiana was one of the EARLIEST states to ban kratom. Possession is a misdemeanor; sale is a felony.",
    opposition_summary_md: `**Sponsor + push**: Rep. Wendy McNamara (R-Mt. Vernon) carried HB 1019 in 2014. Cited rising 'synthetic drug' concerns post-Spice/K2 era. Indiana legislators conflated kratom with synthetic cannabinoids — a fundamental categorization error that has poisoned the debate ever since.

**Political coalition**:
- Indiana State Police pushed framing as 'designer drug'
- Prosecutors' Council of Indiana supported

**Funding trail**: No direct documented pharma-funding link. The Indiana ban predates the modern federally-organized anti-kratom campaign (which intensified post-2016). Original push appears to have been law-enforcement-driven rather than industry-driven.

**Senate companion bill (SB 379)** also passed the same session, updating drug schedules to include the same compounds.

**What's notable**: Indiana's misclassification of kratom alongside K2/Spice is the original sin that other states' bans built on. Repealing IN's ban is partly about correcting the framing nationally.`,
    repeal_plan_md: `**Action sequence**:
1. **Re-categorization framing** — separate kratom from synthetic cannabinoids in any repeal bill. Public-health argument: K2 deaths spiked POST-ban-of-K2 because users switched to less-tested analogs. Kratom is the opposite shape: leaf-based, plant origin, traditional Southeast Asian use, distinct pharmacology.
2. **Likely allies**:
   - **Sen. Mike Young (R)** has carried other harm-reduction reform bills
   - **Sen. Greg Taylor (D)** — minority leader, criminal-justice reform focus
   - **Rep. Robert Morris (R)** — has questioned drug-schedule classifications before
3. **Coalition** — Indiana Recovery Council + harm-reduction advocates + IU School of Medicine pharmacology faculty
4. **Bill draft** — Indiana KCPA: 21+ age, third-party lab testing, retailer registration, no 7-OH-concentrated products. Frame as 'replacing the synthetic-drug-era ban with evidence-based regulation.'
5. **Pre-file early** in next legislative session. Indiana's session is short (Jan-Apr); pre-filing before December gives committee time.

**Hardest constraint**: Indiana legislators tend to view rolling back drug bans as politically risky. The KCPA framing (regulation, not legalization) is essential — frame as 'consumer safety' not 'drug liberalization'.`,
    stakeholders: [
      { name: "Rep. Wendy McNamara", title: "State Representative (R-Mt. Vernon)", organization: "Indiana State House", role_type: "opponent", reasoning: "Original HB 1019 sponsor. Still influential in IN drug-policy debates. Repeal effort needs to either persuade or work around her coalition." },
      { name: "Indiana State Police", title: "State agency", organization: "Indiana state government", role_type: "opponent", reasoning: "Pushed the 'designer drug' framing. Continued enforcement priority. Worth engaging with the KCPA-as-consumer-safety framing rather than dismissing." },
      { name: "Sen. Greg Taylor", title: "State Senator (D), Senate Minority Leader", organization: "Indiana State Senate", role_type: "ally", reasoning: "Strongest criminal-justice-reform voice in the IN Senate. Has carried repeal legislation on other drug-schedule items. Top target for a kratom KCPA carrier." },
      { name: "Indiana University School of Medicine pharmacology faculty", title: "Academic experts", organization: "IU School of Medicine", role_type: "expert", reasoning: "In-state academic voice gives repeal effort credibility no out-of-state expert can. IU pharmacology has not publicly engaged on kratom yet but is a known potential resource." },
    ],
  },
  {
    state: "RI",
    name: "Rhode Island",
    bill_number: "RI DOH-rule 2017 — administrative ban",
    enacted_year: 2017,
    title: "Rhode Island — kratom Schedule I via DOH rule (2017)",
    summary: "Rhode Island Department of Health classified mitragynine and 7-hydroxymitragynine as Schedule I controlled substances via administrative rule in 2017. Like Arkansas, this is an administrative ban rather than statutory.",
    opposition_summary_md: `**Mechanism**: Rhode Island Department of Health used administrative rule-making authority to schedule kratom alkaloids as Schedule I in 2017. No legislative vote required.

**Political coalition**:
- Rhode Island Department of Health (administrative authority)
- Office of the Attorney General supported the framing

**Funding trail**: No documented corporate-funding link. The RI ban appears to have been a regulatory-momentum decision rather than a politically-driven one.

**What's notable**: Like Arkansas, RI's administrative-rule mechanism means a future Health Director could rescind without legislative action. This is the second-easiest repeal target of the 6 banning states.`,
    repeal_plan_md: `**Strategic advantage**: Administrative-rule ban. Repeal does NOT require legislation.

**Action sequence**:
1. **File rescission petition** with RI Department of Health citing updated science (Henningfield 8-factor, McCurdy NIH research, peer-reviewed pharmacology since 2017)
2. **Coalition** — Rhode Island Coalition for the Homeless (has engaged on drug-policy reform), Brown University School of Public Health, affected retailers
3. **Media** — Providence Journal coverage has been balanced on drug-policy stories; pitch the administrative-rescission angle
4. **Gubernatorial engagement** — RI's Governor has rule-making oversight; engagement at that level can accelerate the petition

**Hardest constraint**: Rhode Island is a small market — there's less affected-business pressure than in larger states. Coalition needs to import out-of-state academic voices to compensate.`,
    stakeholders: [
      { name: "Rhode Island Department of Health", title: "State agency", organization: "RI state government", role_type: "opponent", reasoning: "Administrative authority that enacted the 2017 rule. Same body now becomes the repeal target. File rescission petition with updated science." },
      { name: "Brown University School of Public Health", title: "Academic institution", organization: "Brown University", role_type: "expert", reasoning: "In-state academic voice. Brown SPH has engaged on drug-policy reform topics; potential expert testimony or letter-of-support resource." },
    ],
  },
  {
    state: "VT",
    name: "Vermont",
    bill_number: "VT Reg-Drugs-2016 — administrative schedule",
    enacted_year: 2016,
    title: "Vermont — kratom regulated-drug schedule (2016)",
    summary: "Vermont Department of Health added mitragynine and 7-hydroxymitragynine to its Regulated Drugs schedule in 2016, effectively banning sale. Vermont's mechanism is administrative.",
    opposition_summary_md: `**Mechanism**: Vermont Department of Health used regulated-drug-schedule authority to ban kratom in 2016. Administrative rule.

**Political coalition**:
- Vermont Department of Health (administrative authority)
- Vermont Sheriff's Association supported framing

**Funding trail**: No documented corporate-funding link. VT ban followed early-2010s 'designer drug' framing similar to Indiana.

**What's notable**: Vermont's status as a progressive state on cannabis + psychedelics + harm-reduction makes its kratom ban an outlier in the state's overall drug-policy profile. There may be more political room for repeal than the ban's age suggests.`,
    repeal_plan_md: `**Strategic advantage**: Administrative ban + VT's progressive overall drug-policy profile = above-average repeal viability.

**Action sequence**:
1. **Frame consistency** — present the kratom ban as inconsistent with VT's other harm-reduction positions (cannabis legalization 2018, psilocybin decriminalization discussions, syringe exchange access)
2. **Likely legislative allies for KCPA**:
   - **Rep. Hal Colston (D)** — drug-policy reform record
   - **Sen. Phil Baruth (D)** — harm-reduction advocate, Senate Majority Leader
3. **Coalition** — Vermont Cares (HIV/harm-reduction org) + UVM Larner College of Medicine pharmacology + affected retailers
4. **Path**: Administrative rescission petition first; if Health Department resists, pivot to legislative KCPA as fallback

**Hardest constraint**: VT's small market means small affected-business base. Coalition needs to lean on academic + harm-reduction voices.`,
    stakeholders: [
      { name: "Vermont Department of Health", title: "State agency", organization: "VT state government", role_type: "opponent", reasoning: "Administrative authority for the 2016 regulated-drug-schedule action. Same body becomes the repeal target." },
      { name: "Sen. Phil Baruth", title: "State Senator (D), Senate Majority Leader", organization: "Vermont State Senate", role_type: "ally", reasoning: "Top harm-reduction voice in VT Senate leadership. Most-likely champion for a kratom KCPA if administrative repeal fails." },
      { name: "UVM Larner College of Medicine pharmacology faculty", title: "Academic experts", organization: "UVM Larner College of Medicine", role_type: "expert", reasoning: "In-state academic voice. UVM pharmacology faculty have engaged on drug-pharmacology questions; potential expert testimony resource." },
    ],
  },
  {
    state: "WI",
    name: "Wisconsin",
    bill_number: "WI SB 325 (2014)",
    enacted_year: 2014,
    title: "Wisconsin SB 325 (2014) — Schedule I classification of kratom alkaloids",
    summary: "Wisconsin banned mitragynine and 7-hydroxymitragynine via SB 325 in 2014, classifying them as Schedule I. WI was the earliest state to fully ban kratom legislatively.",
    opposition_summary_md: `**Sponsor + push**: Sen. Chris Kapenga (R-Delafield) carried SB 325 in 2014. The bill was part of a broader 'synthetic drug' framing — Wisconsin was among the first states to legislate against compounds that had only recently entered public awareness.

**Political coalition**:
- Wisconsin State Crime Lab
- Wisconsin Sheriff's Association
- Republican legislative caucus supported

**Funding trail**: 2014 predates the modern federally-funded anti-kratom push. The WI ban appears to have been driven primarily by law-enforcement framing rather than corporate funding.

**What's notable**: Wisconsin's ban is the OLDEST current legislative kratom ban in the US. Repealing it would be a major signal-reset for the national debate — 'even the original ban state has reversed.'`,
    repeal_plan_md: `**Symbolic stakes**: Repealing the oldest US legislative kratom ban would be a national signal. Coalition + media framing should lean into this.

**Action sequence**:
1. **Coalition** — Wisconsin Recovery Foundation + affected retailers + UW-Madison School of Pharmacy faculty
2. **Likely current legislative allies for KCPA**:
   - **Rep. Lisa Subeck (D-Madison)** — harm-reduction record
   - **Sen. Melissa Agard (D)** — Senate Minority Leader, drug-policy reform record (cannabis champion)
3. **Data prep** — WI Department of Health Services overdose data 2014-2025: did kratom-related fatalities drop post-ban? National data suggests they didn't, and that bans push consumers to more dangerous unregulated 7-OH.
4. **Bill draft** — Wisconsin KCPA: 21+ age, third-party lab testing, retailer registration, no 7-OH-concentrated. Frame as 'replacing the 2014 synthetic-drug-era classification with 2026 evidence-based regulation.'
5. **Pre-file** before next session; engage AKA's state-action team for legislative-strategy support.

**Hardest constraint**: Republican supermajorities make Democrat-led repeal bills hard to advance. Coalition needs a Republican carrier — look for legislators who have supported other harm-reduction or criminal-justice reform measures.`,
    stakeholders: [
      { name: "Sen. Chris Kapenga", title: "State Senator (R-Delafield)", organization: "Wisconsin State Senate", role_type: "opponent", reasoning: "Original SB 325 sponsor (2014). Still in office, currently Senate President. Repeal needs to either persuade or work around his coalition." },
      { name: "Sen. Melissa Agard", title: "State Senator (D), Senate Minority Leader", organization: "Wisconsin State Senate", role_type: "ally", reasoning: "Strongest drug-policy reform voice in WI Senate leadership. Has carried cannabis-legalization bills. Top target for kratom KCPA carrier in the Senate." },
      { name: "UW-Madison School of Pharmacy", title: "Academic institution", organization: "University of Wisconsin-Madison", role_type: "expert", reasoning: "In-state academic voice on pharmacology. Have not publicly engaged on kratom yet but are a known potential resource for repeal-effort expert testimony." },
    ],
  },
  {
    state: "TN",
    name: "Tennessee",
    bill_number: "HB 1649",
    enacted_year: 2026,
    is_new: true,
    title: "Tennessee HB 1649 (2026) — imminent full statewide ban on kratom + 7-OH",
    summary: "Tennessee HB 1649 passed the Senate 23-3 on 2026-04-16 and sits on Gov. Bill Lee's desk. If signed (expected), Tennessee becomes the 7th banning state effective 2026-07-01. Covers natural-leaf kratom AND 7-OH/synthetic concentrates AND gummies/drops/capsules. Framed as 'gas station heroin' ban in legislative debate.",
    opposition_summary_md: `**Sponsor + push**: HB 1649 sponsored by Rep. Lowell Russell (R-Vonore) in the House; Sen. Bo Watson (R-Hixson) Senate carrier. Bill framed kratom as 'gas station heroin' — a deliberate rhetorical move that conflates natural-leaf kratom with 7-OH-concentrated synthetics. The conflation is the core opposition tactic.

**Political coalition**:
- Tennessee Bureau of Investigation pushed framing
- Tennessee Sheriffs' Association supported
- Republican supermajority caucus advanced the bill
- Several 'lost-a-loved-one' parent testifiers in committee hearings

**Funding trail (still developing)**:
- Tennessee Pharmacists Association engaged on the bill
- No documented direct pharma-industry funding link to sponsors yet — but the 2026 TN push parallels the 2026 wave AKA's federal-LDA filings show (multiple new Mac Haddow + Carlucci sub-state engagements)

**What's notable**: TN HB 1649 is the FIRST new full-state-ban since 2017 (RI). If signed, it breaks the 9-year stasis and signals to other states that prohibition framing can still win. Defeating the Lee signature OR repealing immediately after enactment is the highest-leverage state-level kratom fight of 2026.`,
    repeal_plan_md: `**Phase 1 — Pre-signature (URGENT, deadline ~30 days from 2026-04-16)**:
1. **Veto request to Governor Lee** — formal letter from coalition of TN affected businesses + medical experts + AKA. Frame as: 'TN has a working KCPA framework — adopt that instead of full prohibition.'
2. **Media push** — Nashville Tennessean, Chattanooga Times Free Press, Memphis Commercial Appeal. Frame the 'gas station heroin' rhetoric as scientifically inaccurate.
3. **Public-health data** — Tennessee Department of Health overdose data 2014-2026 showing kratom is rarely the primary cause in poly-substance fatalities. Push to public health committee chairs.

**Phase 2 — If signed (effective 2026-07-01)**:
1. **Emergency KCPA bill** — file in 2027 session as 'replacement for HB 1649'. Use the data from the first 6 months of post-ban enforcement (likely to show INCREASED harm as users move to unregulated 7-OH).
2. **Court challenge** — AKA + GKC have litigated similar state bans (see CourtListener tracker). Tennessee-specific case viable under Commerce Clause + administrative-procedure grounds.
3. **Likely legislative allies for repeal**:
   - **Rep. Vincent Dixie (D-Nashville)** — drug-policy reform record
   - **Sen. London Lamar (D-Memphis)** — Senate minority, criminal-justice reform focus
   - **Sen. Bo Watson (R)** — DEFEATED Senate carrier; if HB 1649 fails or is repealed, his future opposition framing is the key concern

**Coalition partners ready to engage**:
- Tennessee Recovery Foundation (drug-policy reform)
- Vanderbilt School of Medicine pharmacology faculty
- Memphis-based harm-reduction orgs
- AKA Tennessee chapter
- Affected retailers (gas stations, smoke shops, herbal stores — large affected base)

**Hardest constraint**: Tennessee's Republican supermajority makes legislative repeal extremely difficult once a bill is signed. Pre-signature veto pressure on Gov. Lee is the highest-leverage moment.`,
    stakeholders: [
      { name: "Rep. Lowell Russell", title: "State Representative (R-Vonore)", organization: "Tennessee State House", role_type: "opponent", reasoning: "HB 1649 House sponsor. Architect of the 'gas station heroin' framing that conflates kratom with 7-OH synthetics. Repeal effort needs to engage him directly with the kratom-vs-7-OH distinction." },
      { name: "Sen. Bo Watson", title: "State Senator (R-Hixson)", organization: "Tennessee State Senate", role_type: "opponent", reasoning: "HB 1649 Senate carrier. Passed Senate 23-3 under his leadership. Most-likely re-sponsor if any later 7-OH-targeting bill emerges. Track closely." },
      { name: "Tennessee Bureau of Investigation", title: "State law enforcement agency", organization: "TN state government", role_type: "opponent", reasoning: "Provided the framing data + testimony that anchored the legislative debate. Engagement strategy: present the kratom-vs-7-OH distinction + KCPA-as-consumer-safety framing." },
      { name: "Rep. Vincent Dixie", title: "State Representative (D-Nashville)", organization: "Tennessee State House", role_type: "ally", reasoning: "Strongest drug-policy reform voice in TN House Democrats. Has carried other reform bills. Top target for a kratom KCPA carrier if/when HB 1649 is signed and needs repeal." },
      { name: "Sen. London Lamar", title: "State Senator (D-Memphis), Senate Democratic Caucus Chair", organization: "Tennessee State Senate", role_type: "ally", reasoning: "Top criminal-justice reform voice in TN Senate Democrats. Memphis-based with strong affected-business base. Top Senate target for kratom repeal coalition." },
      { name: "Tennessee Recovery Foundation", title: "Drug-policy reform org", organization: "Tennessee Recovery Foundation", role_type: "ally", reasoning: "Existing in-state coalition home for harm-reduction policy. Most-likely organizational base for a Tennessee repeal campaign." },
      { name: "Vanderbilt School of Medicine pharmacology faculty", title: "Academic experts", organization: "Vanderbilt University", role_type: "expert", reasoning: "In-state academic voice. Vanderbilt has not publicly engaged on kratom yet but is a known potential resource for expert testimony on kratom-vs-7-OH pharmacology distinction." },
    ],
  },
];

console.log(`Seeding takeback intel for ${STATES.length} banning states${DRY_RUN ? " (DRY RUN)" : ""}…\n`);

let ok = 0, fail = 0, stakeholdersAdded = 0;

for (const s of STATES) {
  console.log(`=== ${s.state} (${s.name}) ===`);

  // Step 1: find existing bill or prepare to create one. We MUST NOT overwrite
  // existing bills' source_url, effective_date, last_action_at, etc. via a blind
  // upsert — only updating the new takeback columns when row exists.
  const { data: existing } = await sb
    .from("bills")
    .select("id, status")
    .eq("state", s.state)
    .eq("bill_number", s.bill_number)
    .maybeSingle();

  let billId = existing?.id ?? null;
  const status = s.is_new ? "passed_chamber" : "enacted";

  if (DRY_RUN) {
    console.log(`  [DRY] ${existing ? "update existing" : "insert new"} bill + ${s.stakeholders.length} stakeholders`);
    ok++;
    continue;
  }

  if (existing) {
    // UPDATE only the takeback-related columns. Leave source_url, effective_date,
    // last_action_at, summary, title, etc. as they are — those came from the
    // upstream sync and shouldn't be clobbered by editorial seed.
    const { error: upErr } = await sb
      .from("bills")
      .update({
        opposition_summary_md: s.opposition_summary_md,
        repeal_plan_md: s.repeal_plan_md,
        last_synced_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    if (upErr) {
      console.error(`  ✗ bill update failed: ${upErr.message?.slice(0, 150)}`);
      fail++;
      continue;
    }
    console.log(`  ✓ bill row updated: ${existing.id.slice(0, 8)} (${status})`);
  } else {
    // INSERT a new stub row — these are older bans (AL/AR/RI/VT/WI) not in
    // our state-legislature sync.
    const row = {
      state: s.state,
      bill_number: s.bill_number,
      title: s.title,
      summary: s.summary,
      status,
      kratom_relevance: "anti",
      relevance_confidence: 1.0,
      last_action: `Enacted ${s.enacted_year}`,
      last_action_at: `${s.enacted_year}-01-01T00:00:00Z`,
      scope: "state",
      targets_natural_leaf: true,
      targets_synthetic_only: false,
      active: true,
      session_id: `${s.state.toLowerCase()}-${s.enacted_year}`,
      opposition_summary_md: s.opposition_summary_md,
      repeal_plan_md: s.repeal_plan_md,
      created_at: new Date().toISOString(),
      last_synced_at: new Date().toISOString(),
    };
    const { data: inserted, error: insErr } = await sb
      .from("bills")
      .insert(row)
      .select("id")
      .single();
    if (insErr) {
      console.error(`  ✗ bill insert failed: ${insErr.message?.slice(0, 150)}`);
      fail++;
      continue;
    }
    billId = inserted.id;
    console.log(`  ✓ bill row inserted: ${billId.slice(0, 8)} (${status})`);
  }

  // Step 2: clear and reinsert stakeholders (idempotent)
  await sb.from("bill_stakeholders").delete().eq("bill_id", billId);
  const stakeholderRows = s.stakeholders.map(st => ({
    bill_id: billId,
    name: st.name,
    title: st.title,
    organization: st.organization,
    role_type: st.role_type,
    reasoning: st.reasoning,
  }));
  const { error: stErr, data: stData } = await sb.from("bill_stakeholders").insert(stakeholderRows).select("id");
  if (stErr) {
    console.error(`  ✗ stakeholders insert failed: ${stErr.message?.slice(0, 150)}`);
  } else {
    console.log(`  ✓ ${stData.length} stakeholders inserted`);
    stakeholdersAdded += stData.length;
  }
  ok++;
}

console.log(`\nDone. ${ok} states processed, ${stakeholdersAdded} stakeholders inserted, ${fail} fails.`);
