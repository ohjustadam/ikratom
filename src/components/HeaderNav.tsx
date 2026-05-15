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
      { href: "/pulse", label: "Pulse", description: "Live alerts: hostile bills, BoP rules, breaking news." },
      { href: "/campaigns", label: "Campaigns", description: "One-click letters to your reps." },
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
    label: "Knowledge",
    items: [
      { href: "/news", label: "News", description: "AI-classified kratom news from every state." },
      { href: "/library", label: "Library", description: "Research, white papers, talking points." },
      { href: "/briefings", label: "Briefings", description: "Short reads. Print-friendly PDFs available." },
    ],
  },
  {
    label: "Community",
    items: [
      { href: "/forum", label: "Forum", description: "State-by-state advocate discussion." },
      { href: "/communities", label: "Communities", description: "Topic-focused groups: vets, shop owners, etc." },
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
