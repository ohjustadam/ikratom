"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Condensed desktop header nav. 10 flat links collapse into 4
 * categorized dropdowns:
 *
 *   Action      — what to do right now: Pulse / Campaigns
 *   Legislative — what to track: Bills / BoP Watch / Legislators
 *   Knowledge   — what to read: News / Library / Briefings
 *   Community   — who else is here: Forum / Communities
 *
 * Each dropdown is keyboard-accessible (Tab through, Escape to close,
 * Enter to activate). Click outside closes. Hover keeps it open while
 * the mouse stays over either the trigger or the panel.
 *
 * Mobile nav stays in MobileNav.tsx — this is only mounted on md+.
 */

type NavItem = { href: string; label: string; description?: string };
type NavGroup = { label: string; items: NavItem[] };

const GROUPS: NavGroup[] = [
  {
    label: "Action",
    items: [
      { href: "/now", label: "👉 Do this now", description: "One screen. One action. The single highest-leverage thing you can do today. Phone-first." },
      { href: "/my-district", label: "🗳 My District", description: "Your personalized hub: your state's kratom + 7-OH status, your single top action, and your local officials." },
      { href: "/brief", label: "☕ Daily brief", description: "Today's roll-up for your state: alerts, watched-bill movements, active operations, one-click actions." },
      { href: "/pulse", label: "Pulse", description: "Live alerts: hostile bills, BoP rules, breaking news." },
      { href: "/campaigns", label: "Campaigns", description: "One-click letters to your reps." },
      { href: "/calls", label: "📞 Call your reps", description: "Phone-tree tracker with achievement badges. Calls beat emails 10:1 for impact." },
      { href: "/events", label: "🎤 Town halls + hearings", description: "Upcoming public-comment opportunities + legislator town halls in your state." },
      { href: "/takeback", label: "🎯 Takeback", description: "Every banned state's repeal plan + named legislators." },
      { href: "/banned", label: "🚫 Banned tracker", description: "Every US state, county, and city where kratom is illegal." },
      { href: "/submit", label: "Submit", description: "Intel tips, stories, forum threads — central submit hub." },
    ],
  },
  {
    label: "Legislative",
    items: [
      { href: "/bills", label: "Bills", description: "Every kratom + 7-OH bill in every state." },
      { href: "/bop-watch", label: "BoP Watch", description: "Daily monitoring of state pharmacy boards." },
      { href: "/legislators", label: "Legislators", description: "Find + contact your federal + state reps." },
      { href: "/states", label: "By state", description: "Single-state landing pages aggregating bills, meetings, alerts, campaigns." },
      { href: "/people", label: "🧠 People of interest", description: "Allies, experts, journalists, opponents tracked across all kratom bills." },
    ],
  },
  {
    label: "Intel",
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
    ],
  },
  {
    label: "Knowledge",
    items: [
      { href: "/research", label: "🔬 Research", description: "Peer-reviewed kratom + 7-OH evidence library. PubMed-sourced, AI-evaluated." },
      { href: "/news", label: "News", description: "AI-classified kratom news from every state." },
      { href: "/library", label: "Library", description: "Research, white papers, talking points." },
      { href: "/briefings", label: "Briefings", description: "Short reads. Print-friendly PDFs available." },
      { href: "/ethics", label: "🌿 Code of Morals", description: "What iKratom stands for. Choosing peace via cooperation, not war." },
    ],
  },
  {
    label: "Community",
    items: [
      { href: "/coalitions", label: "🤝 Coalitions", description: "Multi-advocate teams with invite codes. Private by default — coordinate around a state or bill." },
      { href: "/forum", label: "Forum", description: "State-by-state advocate discussion." },
      { href: "/communities", label: "Communities", description: "Topic-focused groups: vets, shop owners, etc." },
      { href: "/stories", label: "📖 Story bank", description: "Real kratom-advocate stories. The most persuasive thing legislators read." },
    ],
  },
];

export function HeaderNav() {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Click-outside closes the open panel.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpenIdx(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenIdx(null);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div ref={rootRef} className="flex items-center gap-1 text-sm">
      {GROUPS.map((g, i) => (
        <NavDropdown
          key={g.label}
          group={g}
          open={openIdx === i}
          onOpen={() => setOpenIdx(i)}
          onClose={() => setOpenIdx(null)}
        />
      ))}
    </div>
  );
}

function NavDropdown({
  group,
  open,
  onOpen,
  onClose,
}: {
  group: NavGroup;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function scheduleClose() {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(onClose, 120);
  }
  function cancelClose() {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }

  return (
    <div
      className="relative"
      onMouseEnter={() => {
        cancelClose();
        onOpen();
      }}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => (open ? onClose() : onOpen())}
        onFocus={onOpen}
        className={`inline-flex items-center gap-0.5 rounded px-2.5 py-1 hover:text-emerald-400 ${open ? "text-emerald-400" : "text-zinc-200"}`}
      >
        {group.label}
        <span aria-hidden className="text-[8px]">▾</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-40 mt-1 w-64 rounded-md border border-zinc-800 bg-zinc-950 p-1 shadow-2xl"
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          {group.items.map((item) => (
            <a
              key={item.href}
              role="menuitem"
              href={item.href}
              className="block rounded px-3 py-2 hover:bg-zinc-900"
              onClick={onClose}
            >
              <div className="font-medium text-zinc-100">{item.label}</div>
              {item.description && (
                <div className="mt-0.5 text-[11px] text-zinc-500">{item.description}</div>
              )}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
