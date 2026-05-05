"use client";

import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Home", match: (p: string) => p === "/" },
  { href: "/campaigns", label: "Campaigns", match: (p: string) => p.startsWith("/campaigns") },
  { href: "/forum", label: "Forum", match: (p: string) => p.startsWith("/forum") },
  { href: "/news", label: "News", match: (p: string) => p.startsWith("/news") },
  { href: "/messages", label: "Messages", match: (p: string) => p.startsWith("/messages") },
];

export function MobileTabBar() {
  const pathname = usePathname() ?? "/";

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Primary navigation"
    >
      <ul className="flex">
        {TABS.map((t) => {
          const active = t.match(pathname);
          return (
            <li key={t.href} className="flex-1">
              <a
                href={t.href}
                className={`flex min-h-[56px] flex-col items-center justify-center gap-0.5 px-1 py-1 text-[10px] font-medium transition ${
                  active ? "text-emerald-400" : "text-zinc-400"
                }`}
                aria-current={active ? "page" : undefined}
              >
                <Icon name={t.label} active={active} />
                <span>{t.label}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function Icon({ name, active }: { name: string; active: boolean }) {
  const cls = `h-5 w-5 ${active ? "" : ""}`;
  const stroke = "currentColor";
  switch (name) {
    case "Home":
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke={stroke} strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3v-6h6v6h3a1 1 0 001-1V10" />
        </svg>
      );
    case "Campaigns":
      return (
        <svg className={cls} fill={active ? "currentColor" : "none"} viewBox="0 0 24 24" stroke={stroke} strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 2L3 14h7l-1 8 11-14h-7l1-6z" />
        </svg>
      );
    case "Forum":
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke={stroke} strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      );
    case "News":
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke={stroke} strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2M9 7h6M9 11h6m-6 4h4" />
        </svg>
      );
    case "Messages":
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke={stroke} strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l9 6 9-6M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      );
    default:
      return null;
  }
}
