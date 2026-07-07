/**
 * The five top-level categories — SINGLE SOURCE OF TRUTH for the desktop
 * dropdowns (HeaderNav), the mobile category chips (MobileNav), and the
 * category landing pages (/action, /legislative, /knowledge, /community —
 * Intel's landing is the existing /intel hub).
 *
 * Every feature lists a 1–2 line plain-English walkthrough so users
 * understand a page before clicking it (PR-I: discoverability is part of
 * the "entrenched, locked-in" war-room).
 */

export type CategoryItem = { href: string; label: string; description: string };
export type Category = {
  slug: "action" | "legislative" | "intel" | "knowledge" | "community";
  label: string;
  href: string; // the category landing page
  tagline: string;
  items: CategoryItem[];
};

export const CATEGORIES: Category[] = [
  {
    slug: "action",
    label: "Action",
    href: "/action",
    tagline: "What to do right now — one-click letters, calls, hearings, and the single highest-leverage move today.",
    items: [
      { href: "/now", label: "👉 Do this now", description: "One screen. One action. The single highest-leverage thing you can do today. Phone-first." },
      { href: "/my-district", label: "🗳 My District", description: "Your personalized hub: your state's kratom + 7-OH status, your single top action, and your local officials." },
      { href: "/brief", label: "☕ Daily brief", description: "Today's roll-up for your state: alerts, watched-bill movements, active operations, one-click actions." },
      { href: "/pulse", label: "Pulse", description: "Live alerts: hostile bills, BoP rules, breaking news." },
      { href: "/campaigns", label: "Campaigns", description: "One-click letters to your reps." },
      { href: "/calls", label: "📞 Call your reps", description: "Phone-tree tracker with achievement badges. Calls beat emails 10:1 for impact." },
      { href: "/calendar", label: "🗓️ Community Calendar", description: "Every public kratom event in one place: elections + primaries, town halls + hearings, city/county meetings, bill actions, and sessions. Subscribe to your state's .ics feed." },
      { href: "/takeback", label: "🎯 Takeback", description: "Every banned state's repeal plan + named legislators." },
      { href: "/banned", label: "🚫 Banned tracker", description: "Every US state, county, and city where kratom is illegal." },
      { href: "/submit", label: "Submit", description: "Intel tips, stories, forum threads — central submit hub." },
    ],
  },
  {
    slug: "legislative",
    label: "Legislative",
    href: "/legislative",
    tagline: "What to track — every bill, board, and legislator shaping kratom policy.",
    items: [
      { href: "/bills", label: "Bills", description: "Every kratom + 7-OH bill in every state." },
      { href: "/bop-watch", label: "BoP Watch", description: "Daily monitoring of state pharmacy boards." },
      { href: "/legislators", label: "Legislators", description: "Find + contact your federal + state reps." },
      { href: "/states", label: "By state", description: "Single-state landing pages aggregating bills, meetings, alerts, campaigns." },
      { href: "/people", label: "🧠 People of interest", description: "Allies, experts, journalists, opponents tracked across all kratom bills." },
      { href: "/topics", label: "🏷 Topic explorer", description: "Bills across every substance-policy topic we track — kratom in depth, the rest via LegiScan discovery." },
    ],
  },
  {
    slug: "intel",
    label: "Intel",
    href: "/intel",
    tagline: "Where the influence actually flows — money, lobbying, courts, coordinated operations.",
    items: [
      { href: "/intel", label: "◉ Intel hub", description: "Where the influence actually flows — lobbying, courts, rulemaking, money, actors." },
      { href: "/intel/threat-matrix", label: "🎯 Threat matrix", description: "Every legislator ranked into action tiers (opponent / flippable / champion). One targeting view." },
      { href: "/intel/operations", label: "🕸 Coordinated operations", description: "Model legislation pushed across states. Every detected operation named + traced." },
      { href: "/intel/operations/network", label: "🕸 Operations network map", description: "The coordination graph: multi-cluster operators, hybrid-tactic bills, federal lobbyist firms, state index." },
      { href: "/intel/donations", label: "🧮 Donor leaderboard", description: "Federal legislators ranked by substance-policy-adjacent industry contributions." },
      { href: "/intel/lobbying", label: "📜 Lobbying filings", description: "Senate LDA disclosures mentioning kratom. AKA, GKC, BEA, retained DC firms." },
      { href: "/intel/cases", label: "⚖ Court litigation", description: "Industry lawsuits, state-ban challenges. CourtListener + RECAP." },
      { href: "/intel/rulemaking", label: "🏛 Federal rulemaking", description: "FDA / DEA / HHS rules + open public comment periods." },
      { href: "/intel/awards", label: "💰 Federal money flow", description: "USAspending grants + contracts mentioning kratom." },
      { href: "/intel/votes", label: "🗳 Voting record", description: "Every recorded kratom roll call. Side-by-side state comparison grid — who voted yes/no on what." },
      { href: "/intel/actors", label: "🎭 Actor registry", description: "Lobbyists, industry execs, regulators — the people behind the dollars." },
      { href: "/intel/opposition", label: "🛰 Org roster", description: "90 confirmed policy orgs — opposition, pro-access, regulators — with stances and websites." },
    ],
  },
  {
    slug: "knowledge",
    label: "Knowledge",
    href: "/knowledge",
    tagline: "What to read — research, news, briefings, and the library.",
    items: [
      { href: "/research", label: "🔬 Research", description: "Peer-reviewed kratom + 7-OH evidence library. PubMed-sourced, AI-evaluated." },
      { href: "/news", label: "News", description: "AI-classified kratom news from every state." },
      { href: "/library", label: "Library", description: "Research, white papers, talking points." },
      { href: "/briefings", label: "Briefings", description: "Short reads. Print-friendly PDFs available." },
      { href: "/glossary", label: "📖 Glossary", description: "KCPA, 7-OH, scheduling, BoP — every term of art in plain English." },
      { href: "/ethics", label: "🌿 Code of Morals", description: "What iKratom stands for. Choosing peace via cooperation, not war." },
    ],
  },
  {
    slug: "community",
    label: "Community",
    href: "/community",
    tagline: "Who else is here — advocates, coalitions, and real stories.",
    items: [
      { href: "/coalitions", label: "🤝 Coalitions", description: "Multi-advocate teams with invite codes. Private by default — coordinate around a state or bill." },
      { href: "/forum", label: "Forum", description: "State-by-state advocate discussion + topic groups (vets, shop owners, caregivers)." },
      { href: "/communities", label: "Communities", description: "Directory of kratom communities across the web — Facebook groups, subreddits, Discords." },
      { href: "/stories", label: "📖 Story bank", description: "Real kratom-advocate stories. The most persuasive thing legislators read." },
      { href: "/spread", label: "📣 Spread the word", description: "Share kits, QR codes, and embeds for shops + socials." },
    ],
  },
];

export function categoryBySlug(slug: string): Category | null {
  return CATEGORIES.find((c) => c.slug === slug) ?? null;
}
