import Link from "next/link";

export const metadata = {
  title: "iKratom · full roadmap & build-velocity comparison",
  description: "Everything left in scope, phase-by-phase, with time estimates against standard vs premium build seat. Plus an honest assessment of in-site AI to replace external dependence.",
  robots: { index: false, follow: false },
};

/**
 * /pitch/roadmap — printable, exhaustive roadmap brief.
 *
 * Designed as a partner-meeting follow-up to /pitch/partnership.
 * Where /partnership argues "why keep the seat", this page answers
 * "exactly what does keeping the seat buy us, and on what timeline."
 *
 * Six sections, each `print:break-after-page`:
 *   1. Vision + phase summary table
 *   2. Phase 1-2 line-items (ship + revenue)
 *   3. Phase 3 line-items (intel depth)
 *   4. Phase 4-6 line-items (polish + internal tools + v3)
 *   5. Standard vs premium seat throughput comparison
 *   6. In-site AI bot — honest feasibility assessment
 *
 * No DB reads — this is a planning artifact, not a live status. Reads
 * directly from this file's typed task list, so the partner sees the
 * same numbers Claude is planning against.
 */

type Effort = { premium: string; standard: string };
type Task = {
  id: string;
  title: string;
  detail: string;
  effort: Effort;
  status?: "open" | "in_progress" | "queued";
};
type Phase = {
  num: number;
  title: string;
  goal: string;
  tasks: Task[];
};

const PHASES: Phase[] = [
  {
    num: 1,
    title: "Ship the queue (immediate)",
    goal: "App stores, brand polish, and the partner-meeting backlog.",
    tasks: [
      { id: "1.1", title: "App-store P0 unblockers", detail: "Supabase Auth Site URL → ikratom.org · 5 portrait screenshots · Bubblewrap SHA-256 → assetlinks.json · reconcile org.ikratom.twa vs .app package ID.", effort: { premium: "3–5 days", standard: "2–3 weeks" } },
      { id: "1.2", title: "Bubblewrap APK + Google Play submission", detail: "Bubblewrap init + signing key backup + .aab upload + listing copy (already drafted in private/STORE_LISTING_COPY.md).", effort: { premium: "1–2 days", standard: "1 week" } },
      { id: "1.3", title: "PWABuilder iOS + Apple App Store submission", detail: "Bundle ID org.ikratom.app · Archive → App Store Connect · privacy nutrition label (drafted).", effort: { premium: "1–2 days", standard: "1–2 weeks" } },
      { id: "1.4", title: "Microsoft Store submission", detail: "PWABuilder → MSIX · $0 Partner Center signup · third store target.", effort: { premium: "1 day", standard: "3–5 days" } },
      { id: "1.5", title: "Floating feedback / error-report widget", detail: "Fixed right-edge button on every page · screenshot attach · Supabase Storage · admin notification · /admin/feedback review surface · Gmail send-on-behalf to owner.", effort: { premium: "2–3 days", standard: "1–2 weeks" } },
      { id: "1.6", title: "Theme system: dark/light + custom + war-room mode", detail: "CSS custom properties · data-theme on <html> · persistence to profiles · architect for user-picked brand color · advocate-vs-war-room density toggle pattern.", effort: { premium: "1–2 weeks", standard: "4–8 weeks" } },
      { id: "1.7", title: "Powered-by-r3dpillai badge", detail: "Footer + near feedback widget · clickable → r3dpillai.com.", effort: { premium: "2 hours", standard: "1 day" } },
      { id: "1.8", title: "Competitor gap-check (KratomIndex + GKC Advocacy Buddy)", detail: "Browser screenshot each, feature-by-feature gap audit, ensure parity-plus.", effort: { premium: "1 day", standard: "3–5 days" } },
      { id: "1.9", title: "Site-wide text-overflow / wrap pass", detail: "Source URLs sprawling off the page on small screens · grep raw URL renders · add break-words / overflow-wrap base.", effort: { premium: "1 day", standard: "3–5 days" } },
    ],
  },
  {
    num: 2,
    title: "Revenue infrastructure",
    goal: "Turn the three revenue lanes from designed-in seams into shipped product.",
    tasks: [
      { id: "2.1", title: "Vendor self-serve onboarding + Stripe billing", detail: "Partner-shop module already exists · add Stripe Connect · tiered pricing (free / featured / state spotlight / newsletter sponsor) · admin approval queue.", effort: { premium: "1–2 weeks", standard: "4–6 weeks" } },
      { id: "2.2", title: "Pro tier paywall + weekly digest", detail: "Stripe subscription · feature-flag premium routes · curated weekly-digest cron (highest-priority action per user's state) · uses existing alerts pipeline.", effort: { premium: "1–2 weeks", standard: "4–6 weeks" } },
      { id: "2.3", title: "Donation page + recurring-donor recognition", detail: "Stripe one-time + recurring · anonymous-by-default recognition (we already render @username everywhere public) · 'enabled N calls this month' transparency.", effort: { premium: "1 week", standard: "3–4 weeks" } },
      { id: "2.4", title: "In-site user assistant (free-tier AI chat)", detail: "Chat UI on top of existing AI router · reads user profile + state + active campaigns · answers natural-language platform questions · drafts outreach. Zero added AI cost — uses Groq/Gemini/Cerebras router already in place.", effort: { premium: "2–3 weeks", standard: "8–12 weeks" } },
      { id: "2.5", title: "Auto-PR self-healing for cron errors", detail: "When a cron source errors N times, auto-open a PR with proposed fix + push-notify owner · NOT auto-merge · uses free-tier AI for the diff suggestion.", effort: { premium: "1 week", standard: "3–4 weeks" } },
      { id: "2.6", title: "Codebase-map.mjs internal tool", detail: "Ollama-powered local read-only audits ('where is X used / what's the schema') · offloads exploration work from premium seat to free local AI.", effort: { premium: "1 week", standard: "3–4 weeks" } },
    ],
  },
  {
    num: 3,
    title: "Mission Control + intel depth",
    goal: "Per-state canonical truth, predictive threat modeling, and the lobbying / litigation intel layer.",
    tasks: [
      { id: "3.1", title: "Mission Control PR2 — state_status migration + cross-ref", detail: "state_status table (derived_leaf, derived_7oh, enacted-vs-pending, admin override/confirm/note) · AKA + GKC + statute cross-reference layer (orgs as sources, never as endorsement).", effort: { premium: "1–2 weeks", standard: "4–6 weeks" } },
      { id: "3.2", title: "Mission Control PR3 — enacted-only derivation cron", detail: "Nightly cron that derives per-state status from enacted bills ONLY · treats introduced/dead anti bills as pending-threat, not current law · fixes the FL/TX/UT 'banned' false positives the audit found.", effort: { premium: "1 week", standard: "3–4 weeks" } },
      { id: "3.3", title: "Mission Control PR4 — admin confirm queue", detail: "/admin/state-status surface · flags ambiguous/mismatched states · admin sets canonical, derivation respects override · load-bearing for IN-style statute-only bans.", effort: { premium: "1 week", standard: "3–4 weeks" } },
      { id: "3.4", title: "Mission Control PR5 — state page canonical header", detail: "/states/[code] gets a 'leaf status · 7-OH status · enacted law vs pending' header with confirmed/auto badge · cross-ref source list (statute, LegiScan, AKA, GKC) neutrally attributed.", effort: { premium: "1–2 weeks", standard: "4–6 weeks" } },
      { id: "3.5", title: "Litigation intel layer", detail: "Extends existing CourtListener sync · constitutional challenges to bans · wrongful-death verdicts (esp. 7-OH) · class actions / MDL formation · FDA seizure · state AG consumer-protection suits · feeds the threat forecast.", effort: { premium: "3–4 weeks", standard: "12–16 weeks" } },
      { id: "3.6", title: "Bill-DNA / model-legislation detector", detail: "Fingerprint bill text via existing embeddings · detect ~94% identical language across states · output: 'IN SB-x matches TN March ban; watch OH/MO/KY/SC next' · reveals the funded campaign behind scattered bills.", effort: { premium: "2–3 weeks", standard: "8–12 weeks" } },
      { id: "3.7", title: "Pressure Index", detail: "P_against (ban bills, AG actions, BoP items, anti-lobbying activity, negative news) vs P_for (campaign sends, calls, testimony) · headline = pressure gap · doubles as threat detection AND mobilization targeting.", effort: { premium: "2–3 weeks", standard: "8–12 weeks" } },
      { id: "3.8", title: "Kratom Threat Forecast", detail: "Per-jurisdiction model predicting ban probability + timing in 60–120 days · fuses leading indicators we already collect · ranked Threat Board with drivers · the predictive capstone.", effort: { premium: "3–4 weeks", standard: "12–16 weeks" } },
      { id: "3.9", title: "Per-legislator news mentions sync", detail: "Cross-reference Google News mentions with legislator names · build per-leg news-velocity signal · feeds briefings.", effort: { premium: "1–2 weeks", standard: "4–6 weeks" } },
      { id: "3.10", title: "STOCK Act federal PTRs", detail: "Federal legislator stock-trade disclosures · cross-reference with kratom-adjacent industries (pharma, alcohol, tobacco) · flag conflicts of interest.", effort: { premium: "1–2 weeks", standard: "4–6 weeks" } },
      { id: "3.11", title: "State lobbying disclosures (50 scrapers)", detail: "One scraper per state · stagger build over weeks · UT already prototyped · biggest single multiplier on intel depth.", effort: { premium: "4–8 weeks", standard: "16–32 weeks" } },
      { id: "3.12", title: "Voting roll-call sync", detail: "Per-bill, per-legislator vote records · enables 'who voted against your interest' surface · accountability multiplier.", effort: { premium: "2–3 weeks", standard: "8–12 weeks" } },
    ],
  },
  {
    num: 4,
    title: "Product polish + reach",
    goal: "Engagement, retention, and the surface-area upgrades that turn the platform from useful into beloved.",
    tasks: [
      { id: "4.1", title: "Audio Phase 3 — podcast feed", detail: "/podcast/feed.xml iTunes-compatible RSS from existing daily MP3s · submit to Apple Podcasts / Spotify / YouTube Music · MP3 archive already accumulating.", effort: { premium: "1 week", standard: "3–4 weeks" } },
      { id: "4.2", title: "Voice readback on /bills + /news", detail: "Reuse BriefAudioButton · render MP3 first visit (not nightly) · bill reader line-number stripping for TTS (UI keeps numbered version).", effort: { premium: "1 week", standard: "3–4 weeks" } },
      { id: "4.3", title: "Bill text formatting fix", detail: "Mid-priority pre-existing bug · pairs with 4.2's clean_text work.", effort: { premium: "3–5 days", standard: "1–2 weeks" } },
      { id: "4.4", title: "Brief archive", detail: "/brief/archive + /brief/[date] · data already in daily_brief_summaries + Storage MP3s · purely UI.", effort: { premium: "3–5 days", standard: "1–2 weeks" } },
      { id: "4.5", title: "Pro/anti stance filter on /news + default-filter customization", detail: "3rd chip row from linked bill's kratom_relevance · 'Save current as default' per page (localStorage).", effort: { premium: "3–5 days", standard: "1–2 weeks" } },
      { id: "4.6", title: "Immersive UI polish (Framer Motion)", detail: "Owner asked for 'visually stunning on phones/tablets/PCs' · animated alert cards, sticky bottom mobile nav, tablet 3-col dashboard, hero/Lottie on landing.", effort: { premium: "2–3 weeks", standard: "8–12 weeks" } },
      { id: "4.7", title: "News scrape-time hard dedupe", detail: "Unique constraint on canonical_url + upsert · belt-and-suspenders on top of render/cron dedupe.", effort: { premium: "3–5 days", standard: "1–2 weeks" } },
      { id: "4.8", title: "Medical recruitment full build", detail: "Currently flagged off · shop owners + medical pros as first-class users · onboarding flow + verification.", effort: { premium: "3–4 weeks", standard: "12–16 weeks" } },
      { id: "4.9", title: "AI personalization full build", detail: "Currently flagged off · per-user campaign body generation from their stake + state · all on free-tier router.", effort: { premium: "2–3 weeks", standard: "8–12 weeks" } },
      { id: "4.10", title: "Native iOS push (after Apple submission)", detail: "Replace Web Push fallback with native APNs once we have the Apple cert · sidesteps Safari Web Push limitations.", effort: { premium: "2–3 weeks", standard: "8–12 weeks" } },
      { id: "4.11", title: "NY Senate committee scraper (Cloudflare bypass)", detail: "playwright-extra-stealth · ~½ day premium · was deferred from earlier wave.", effort: { premium: "3–5 days", standard: "1–2 weeks" } },
      { id: "4.12", title: "Sentry + Next patch bumps", detail: "SENTRY_DSN configured · ongoing Next 16 patch upgrades.", effort: { premium: "2–3 days", standard: "1 week" } },
    ],
  },
  {
    num: 5,
    title: "Internal AI tooling (parallel track)",
    goal: "Reduce dependence on the premium build seat for routine work by building internal tools that route to free models.",
    tasks: [
      { id: "5.1", title: "Free-tier AI router widening (ongoing)", detail: "Already at 9 cloud providers + Ollama · add new free providers as they emerge (Together AI free tier, fireworks.ai free trial, etc.) · cooldown-aware fallback already in place.", effort: { premium: "ongoing", standard: "ongoing" } },
      { id: "5.2", title: "In-site code-fix bot — small-change tier", detail: "Free-tier-only · scoped to single-file edits: copy edits, button labels, CSS tweaks, simple migrations (add column/index), routine bug fixes where the stack trace points at one file · tool-use scaffold + GitHub API + RLS-aware test runner. SEE PAGE 6 for honest feasibility scope.", effort: { premium: "6–8 weeks", standard: "24–32 weeks" } },
      { id: "5.3", title: "Voice cloning (low priority)", detail: "Owner records ~60s · XTTS-v2 local clone replaces Christopher Neural for daily brief audio · /admin/voice/record page · 100% free, runs on owner's machine.", effort: { premium: "1–2 weeks", standard: "4–6 weeks" } },
    ],
  },
  {
    num: 6,
    title: "V3 vision (12+ months out)",
    goal: "Geographic and substance expansion once the kratom-vertical engine is the validated template.",
    tasks: [
      { id: "6.1", title: "Multi-substance expansion", detail: "Kava · mitragyna varieties · other embattled botanicals · same pipeline shape, retune the classifier ensemble per substance.", effort: { premium: "3–6 months", standard: "12–24 months" } },
      { id: "6.2", title: "International advocacy (UK / EU / AU / CA)", detail: "Per-country statute crawler · per-country legislator data sources · per-country donor / lobbying registries where they exist.", effort: { premium: "3–6 months", standard: "12–24 months" } },
      { id: "6.3", title: "Coalition tooling (multi-org)", detail: "Multi-tenant where each org has its own brand + member roster but shares the underlying intel pipeline · revenue lane: org-seat $249/mo from /pitch/partnership.", effort: { premium: "2–3 months", standard: "8–12 months" } },
    ],
  },
];

const PHASE_SUMMARY: Array<{ num: number; title: string; premium: string; standard: string }> = [
  { num: 1, title: "Ship the queue", premium: "3–4 weeks", standard: "12–18 weeks" },
  { num: 2, title: "Revenue infrastructure", premium: "5–8 weeks", standard: "20–32 weeks" },
  { num: 3, title: "Mission Control + intel", premium: "20–32 weeks", standard: "80–120 weeks" },
  { num: 4, title: "Product polish + reach", premium: "12–20 weeks", standard: "48–80 weeks" },
  { num: 5, title: "Internal AI tooling", premium: "8–11 weeks", standard: "28–40 weeks" },
  { num: 6, title: "V3 vision", premium: "8–15 months", standard: "32–60 months" },
];

export default function RoadmapPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-12 text-zinc-100 sm:px-6 lg:px-8 print:max-w-none print:py-0">
      <Link href="/pitch" className="text-xs text-zinc-500 hover:text-emerald-400 print:hidden">
        ← Pitch overview
      </Link>

      {/* ═════════════════════════════════════════════════════════════ */}
      {/* SLIDE 1 — Vision + phase summary                              */}
      {/* ═════════════════════════════════════════════════════════════ */}
      <Slide>
        <header className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">
            Full roadmap brief · 2026
          </p>
          <h1 className="mt-3 text-4xl font-bold sm:text-5xl">
            Everything left in scope. Phased. Time-boxed against the build seat.
          </h1>
          <p className="mt-3 max-w-3xl text-base text-zinc-400">
            This is the full list. Six phases, ~40 substantive line-items
            between today and v3. Each item lists its scope + the time it
            takes on the premium build seat vs the standard seat. Page 5
            rolls that up. Page 6 answers the in-site-AI question
            honestly — including which parts of this list a free-tier
            internal bot could realistically take over, and which still
            require external AI.
          </p>
        </header>

        <Eyebrow>The vision in one paragraph</Eyebrow>
        <p className="mt-2 text-sm text-zinc-300">
          A nonpartisan civic-action platform that turns every form of
          pressure on kratom (legislative, administrative, cultural,
          litigative) into per-state, per-legislator, per-day actionable
          intel — delivered via one-tap actions to an opted-in advocate
          base. Predictive, not reactive. Sustainable on free-tier
          infrastructure. Revenue from vendor sponsorships, Pro
          memberships, and donations — never from gating the advocacy
          core. Designed to generalize to any embattled substance once
          the kratom-vertical engine is the proof.
        </p>

        <div className="mt-6">
          <Eyebrow>Phase summary</Eyebrow>
          <div className="mt-3 overflow-x-auto rounded-lg border border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-950/60 text-left text-[10px] uppercase tracking-wider text-zinc-500">
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Phase</th>
                  <th className="px-3 py-2">Premium seat</th>
                  <th className="px-3 py-2">Standard seat</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-900 text-zinc-300">
                {PHASE_SUMMARY.map((p) => (
                  <tr key={p.num}>
                    <td className="px-3 py-2 font-mono text-zinc-500">{p.num}</td>
                    <td className="px-3 py-2 font-medium text-zinc-100">{p.title}</td>
                    <td className="px-3 py-2 font-mono text-emerald-200">{p.premium}</td>
                    <td className="px-3 py-2 font-mono text-amber-200">{p.standard}</td>
                  </tr>
                ))}
                <tr className="bg-emerald-950/15">
                  <td className="px-3 py-2 font-bold text-emerald-200">∑</td>
                  <td className="px-3 py-2 font-bold text-emerald-200">Total to v3-ready</td>
                  <td className="px-3 py-2 font-mono font-bold text-emerald-200">~14–22 months</td>
                  <td className="px-3 py-2 font-mono font-bold text-amber-200">~48–72 months</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-zinc-500">
            Premium seat estimate assumes sustained ~2–4 focused PRs per day
            (the current cadence — PRs #460–#466 shipped in ~one week). Standard
            seat estimate assumes ~½ focused PR per day before daily limits
            throttle and momentum stalls (typical Sonnet-tier cap behavior).
          </p>
        </div>
      </Slide>

      {/* ═════════════════════════════════════════════════════════════ */}
      {/* SLIDE 2 — Phases 1 + 2                                        */}
      {/* ═════════════════════════════════════════════════════════════ */}
      <Slide>
        <Eyebrow>Phases 1 + 2 detail</Eyebrow>
        <h2 className="mt-2 text-3xl font-bold">Ship the queue, then turn on revenue.</h2>
        <p className="mt-2 text-sm text-zinc-400">
          These two phases together = the next ~2 months of premium-seat work.
          By the end of Phase 2 the platform is in three app stores, has a
          feedback loop, and has all three revenue lanes wired to Stripe.
        </p>
        <PhaseDetail phase={PHASES[0]} />
        <PhaseDetail phase={PHASES[1]} />
      </Slide>

      {/* ═════════════════════════════════════════════════════════════ */}
      {/* SLIDE 3 — Phase 3                                             */}
      {/* ═════════════════════════════════════════════════════════════ */}
      <Slide>
        <Eyebrow>Phase 3 detail</Eyebrow>
        <h2 className="mt-2 text-3xl font-bold">The intel depth that makes the platform defensible.</h2>
        <p className="mt-2 text-sm text-zinc-400">
          Mission Control finishes the canonical state-status truth model.
          The intel layer (litigation + Bill-DNA + Pressure + Threat
          Forecast) is the moat — it&apos;s the work no other kratom advocacy
          tool is doing, and it&apos;s the headline feature for the Pro tier.
        </p>
        <PhaseDetail phase={PHASES[2]} />
      </Slide>

      {/* ═════════════════════════════════════════════════════════════ */}
      {/* SLIDE 4 — Phases 4 + 5 + 6                                    */}
      {/* ═════════════════════════════════════════════════════════════ */}
      <Slide>
        <Eyebrow>Phases 4–6 detail</Eyebrow>
        <h2 className="mt-2 text-3xl font-bold">Polish, internal tooling, then the expansion.</h2>
        <p className="mt-2 text-sm text-zinc-400">
          Phase 4 is the engagement/retention surface — voice, immersive UI,
          medical recruitment, AI personalization. Phase 5 is the internal
          tooling that lets us route routine work onto free models (Phase 5.2
          is the &ldquo;in-site code-fix bot&rdquo; — see Page 6 for the honest
          feasibility scope). Phase 6 is the kratom→other-substances and
          international expansion.
        </p>
        <PhaseDetail phase={PHASES[3]} />
        <PhaseDetail phase={PHASES[4]} />
        <PhaseDetail phase={PHASES[5]} />
      </Slide>

      {/* ═════════════════════════════════════════════════════════════ */}
      {/* SLIDE 5 — Standard vs Premium comparison                      */}
      {/* ═════════════════════════════════════════════════════════════ */}
      <Slide>
        <Eyebrow>The throughput question</Eyebrow>
        <h2 className="mt-2 text-3xl font-bold">Standard seat vs premium seat — what each one buys.</h2>
        <p className="mt-2 text-sm text-zinc-400">
          The roadmap above is the same on either seat. The variable is how
          long it takes to ship — and momentum decays at standard cadence in
          ways the timeline doesn&apos;t fully capture.
        </p>

        <div className="mt-6 overflow-x-auto rounded-lg border border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-950/60 text-left text-[10px] uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-3 py-2">Dimension</th>
                <th className="px-3 py-2">Standard seat</th>
                <th className="px-3 py-2 text-emerald-300">Premium seat</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900 text-zinc-300">
              <tr>
                <td className="px-3 py-2 font-medium text-zinc-100">Model tier</td>
                <td className="px-3 py-2">Sonnet, daily limit hit in ~2–4 hours of focused work</td>
                <td className="px-3 py-2 text-emerald-200">Opus 4.x sustained, with high daily ceiling</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-medium text-zinc-100">PR cadence</td>
                <td className="px-3 py-2">~3–5 PRs / week (cap-bound)</td>
                <td className="px-3 py-2 text-emerald-200">~15–25 PRs / week sustained (PRs #460–#466 = ~1 week)</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-medium text-zinc-100">Multi-file refactor</td>
                <td className="px-3 py-2">Splits across days · context lost between sessions</td>
                <td className="px-3 py-2 text-emerald-200">Single coherent session · full codebase context</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-medium text-zinc-100">Bug response time</td>
                <td className="px-3 py-2">Often tomorrow · wait for cap to refresh</td>
                <td className="px-3 py-2 text-emerald-200">Same hour, including during a meeting</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-medium text-zinc-100">Sustained architectural work</td>
                <td className="px-3 py-2">Hard — momentum dies in throttle cycles</td>
                <td className="px-3 py-2 text-emerald-200">The Mission Control intel layer requires this</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-medium text-zinc-100">Time to v2-complete (Phases 1–4)</td>
                <td className="px-3 py-2 font-mono text-amber-200">~36–62 weeks (9–15 months)</td>
                <td className="px-3 py-2 font-mono text-emerald-200">~9–16 weeks (2–4 months)</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-medium text-zinc-100">Time to v3-ready (Phases 1–6)</td>
                <td className="px-3 py-2 font-mono text-amber-200">~48–72 months</td>
                <td className="px-3 py-2 font-mono text-emerald-200">~14–22 months</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-medium text-zinc-100">Cost equivalent</td>
                <td className="px-3 py-2">~$20/mo seat</td>
                <td className="px-3 py-2 text-emerald-200">~$200/mo seat = 10× the spend, ~4–5× the throughput, ~3× the quality on complex work · vs a part-time engineer hire at $2,500–5,000/mo</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="mt-4 text-sm text-zinc-300">
          The compound effect matters: revenue infrastructure (Phase 2) is the
          gate on the platform paying for itself. On the standard timeline,
          the revenue lanes turn on ~5–8 months from now. On premium, ~1–2
          months. That delta — 4–6 months of revenue running vs not running —
          dwarfs the seat cost difference by an order of magnitude.
        </p>
      </Slide>

      {/* ═════════════════════════════════════════════════════════════ */}
      {/* SLIDE 6 — In-site AI bot feasibility                          */}
      {/* ═════════════════════════════════════════════════════════════ */}
      <Slide>
        <Eyebrow>The honest question</Eyebrow>
        <h2 className="mt-2 text-3xl font-bold">
          Can we build an in-site AI bot that does &ldquo;everything&rdquo; — including writing and fixing our own code?
        </h2>
        <p className="mt-3 text-sm text-zinc-400">
          Yes for some of it. Not yet for the rest. Here&apos;s the honest
          breakdown — three tiers, only one of which is fully feasible today.
        </p>

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <FeasibilityCard
            verdict="YES — fully feasible now"
            tone="emerald"
            title="Tier 1 · In-site assistant for users"
            scope={[
              "Q&A about the platform ('which bill in my state is moving fastest right now?')",
              "Drafting outreach copy / personalizing campaign emails",
              "Summarizing bills + state briefings on demand",
              "Classifying user submissions (intel tips, story moderation)",
              "Translating content into the 6 locales we already support",
              "Routine spam / abuse detection",
            ]}
            why="Already runs in production for our backend classifiers — Groq (Llama 3.3 70B), Gemini Flash 2.5, Cerebras, etc. via the existing AI router. A user-facing chat UI is the only missing piece. ~80% built today; ~2-3 weeks of premium-seat work to wrap a chat surface around it."
            cost="$0/mo added. Routes through the same free-tier providers already in place."
          />
          <FeasibilityCard
            verdict="PARTIALLY feasible · scoped tier only"
            tone="amber"
            title="Tier 2 · Internal code-fix bot for small changes"
            scope={[
              "Copy edits + button label changes",
              "Simple CSS tweaks (color, spacing, single-class swaps)",
              "Routine bug fixes where stack trace points at ONE file",
              "Adding a new admin page following an existing template",
              "Simple migrations (add column, add index)",
              "Bumping dependency patch versions",
            ]}
            why="Open-source models on the free-tier router (Llama 3.3 70B, Qwen Coder, DeepSeek V3) CAN write single-file code competently when the task is well-scoped and the failure mode is obvious. They CANNOT yet do multi-file refactors, architectural decisions, subtle bug diagnosis, or RLS-aware migrations correctly without supervision. Building the tool-use scaffold (GitHub API + test runner + RLS-safety check + auto-revert on test fail) = ~6–8 weeks premium-seat work."
            cost="$0/mo added. Routes free-tier. Saves ~20–30% of routine premium-seat usage. Architectural / multi-file work still requires Claude."
          />
          <FeasibilityCard
            verdict="NOT yet feasible — revisit annually"
            tone="red"
            title="Tier 3 · Full Claude replacement (everything)"
            scope={[
              "Multi-file refactors (5–15+ files touched)",
              "Architectural decisions / approach tradeoffs",
              "Long-context reasoning across the whole codebase",
              "Subtle bug diagnosis (symptom far from root cause)",
              "Designing migrations respecting all existing invariants",
              "Maintaining code quality + security + RLS correctness at scale",
            ]}
            why="The capability gap between Claude Opus 4.x and the best open-weight models (DeepSeek V3, Qwen 2.5 Coder, Llama 3.3 70B) is real and currently large for systems-engineering work. Frontier open-weight is improving fast — DeepSeek V3 is closing the gap — but a year ago this gap was 'unusable', now it's 'usable for small tasks'. Twelve months from now it may well be 'usable for medium tasks'. Until then, the work in Phase 3 (Mission Control + intel layer) needs Claude."
            cost="Honest framing: build Tier 1 + Tier 2 in Phases 2 + 5. Re-evaluate Tier 3 in mid-2027 as open-weight models continue maturing. Don't bet the roadmap on a capability gap closing on a deadline."
          />
        </div>

        <div className="mt-8 rounded-lg border border-emerald-700/40 bg-emerald-950/15 p-5">
          <Eyebrow>Recommended path</Eyebrow>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-zinc-300">
            <li><strong className="text-emerald-200">Phase 2.4</strong> — ship the in-site user assistant (Tier 1) on the existing free-tier router. Adds product value, costs $0/mo, gives users a chat surface.</li>
            <li><strong className="text-emerald-200">Phase 2.6</strong> — ship codebase-map.mjs (Ollama-powered, local) for read-only code audits. Offloads exploration work from premium seat. ~1 week of effort.</li>
            <li><strong className="text-emerald-200">Phase 5.2</strong> — build the small-change internal code-fix bot (Tier 2). Reduces premium-seat usage on routine work by ~20–30%. ~6–8 weeks of effort.</li>
            <li><strong className="text-emerald-200">Premium seat remains the spine</strong> for architectural + Mission Control / intel-layer work until at least mid-2027. Re-evaluate annually as open-weight models mature.</li>
          </ol>
          <p className="mt-3 text-xs text-zinc-400">
            Net effect of Tiers 1 + 2: the platform itself never pays for AI
            (already true) AND we offload ~20–30% of build-side AI usage onto
            free local/cloud models. The premium seat goes from &ldquo;does
            everything&rdquo; to &ldquo;does the architectural 70% that free
            models can&apos;t&rdquo; — which is the right shape long-term.
          </p>
        </div>

        <p className="mt-6 text-[10px] text-zinc-600 print:mt-4">
          support@ikratom.org · ikratom.org/pitch/roadmap · companion to /pitch/partnership + /pitch/efficiency
        </p>
      </Slide>
    </div>
  );
}

function Slide({ children }: { children: React.ReactNode }) {
  return (
    <section className="mb-12 break-inside-avoid border-b border-zinc-800 pb-12 last:border-b-0 last:pb-0 print:break-after-page print:pb-6">
      {children}
    </section>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
      {children}
    </p>
  );
}

function PhaseDetail({ phase }: { phase: Phase }) {
  return (
    <div className="mt-8">
      <div className="mb-3 flex items-baseline gap-3">
        <span className="font-mono text-xs text-zinc-500">Phase {phase.num}</span>
        <h3 className="text-xl font-bold text-zinc-100">{phase.title}</h3>
      </div>
      <p className="mb-4 text-xs text-zinc-400 italic">{phase.goal}</p>
      <div className="overflow-x-auto rounded-lg border border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-950/60 text-left text-[10px] uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="px-3 py-2 w-12">#</th>
              <th className="px-3 py-2">Line item</th>
              <th className="px-3 py-2 w-28">Premium</th>
              <th className="px-3 py-2 w-32">Standard</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-900 text-zinc-300">
            {phase.tasks.map((t) => (
              <tr key={t.id}>
                <td className="px-3 py-2 align-top font-mono text-[11px] text-zinc-500">{t.id}</td>
                <td className="px-3 py-2 align-top">
                  <p className="font-medium text-zinc-100">{t.title}</p>
                  <p className="mt-0.5 text-[11px] text-zinc-400">{t.detail}</p>
                </td>
                <td className="px-3 py-2 align-top font-mono text-emerald-200">{t.effort.premium}</td>
                <td className="px-3 py-2 align-top font-mono text-amber-200">{t.effort.standard}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FeasibilityCard({
  verdict,
  tone,
  title,
  scope,
  why,
  cost,
}: {
  verdict: string;
  tone: "emerald" | "amber" | "red";
  title: string;
  scope: string[];
  why: string;
  cost: string;
}) {
  const borderCls =
    tone === "emerald" ? "border-emerald-700/50 bg-emerald-950/15"
    : tone === "amber" ? "border-amber-700/50 bg-amber-950/15"
    : "border-red-700/50 bg-red-950/15";
  const verdictCls =
    tone === "emerald" ? "text-emerald-300"
    : tone === "amber" ? "text-amber-300"
    : "text-red-300";
  return (
    <div className={`rounded-lg border p-4 ${borderCls}`}>
      <p className={`text-xs font-semibold uppercase tracking-wider ${verdictCls}`}>{verdict}</p>
      <h3 className="mt-2 text-base font-bold text-zinc-100">{title}</h3>
      <p className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">In scope</p>
      <ul className="mt-1 space-y-1 text-xs text-zinc-300">
        {scope.map((s) => (
          <li key={s} className="flex gap-1.5">
            <span aria-hidden className="text-zinc-600">•</span>
            <span>{s}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Why this verdict</p>
      <p className="mt-1 text-xs text-zinc-400">{why}</p>
      <p className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Cost / impact</p>
      <p className="mt-1 text-xs text-zinc-300">{cost}</p>
    </div>
  );
}
