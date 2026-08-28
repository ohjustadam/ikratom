"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CATEGORIES } from "@/config/nav-categories";

import Link from "next/link";
/**
 * Mobile menu — full-screen overlay (NOT a side drawer).
 *
 * Why full-screen: side drawers depend on flex sizing inside fixed-
 * position containers, which is fragile on mobile Safari (URL bar
 * animations, viewport-unit quirks). A full-screen overlay using
 * `fixed inset-0` fills the whole visible viewport with no sizing
 * tricks — works everywhere.
 *
 * Structure:
 *   - Top bar with logo + close X
 *   - Auth slot (Dashboard / Account / Admin / Sign out — same as desktop nav)
 *   - Primary nav (10 main pages with emoji icons)
 *   - Account submenu (collapsible <details>)
 *   - Admin submenu (collapsible <details>, only when isAdmin)
 *   - Footer (Terms / Privacy / Cookies)
 *
 * Submenus use native <details>/<summary> so they degrade gracefully
 * if hydration stalls on flaky mobile networks.
 */

const PRIMARY_LINKS = [
  { href: "/dashboard", label: "Dashboard", icon: "🎛️" },
  { href: "/my-district", label: "My district", icon: "🗳️" },
  { href: "/campaigns", label: "Campaigns", icon: "📣" },
  { href: "/calls", label: "Call reps", icon: "📞" },
  { href: "/events", label: "Town halls + hearings", icon: "🎤" },
  { href: "/takeback", label: "Takeback", icon: "🎯" },
  { href: "/banned", label: "Banned tracker", icon: "🚫" },
  { href: "/bills", label: "Bills", icon: "📜" },
  { href: "/bop-watch", label: "BoP Watch", icon: "🛡️" },
  { href: "/submit", label: "Submit", icon: "➕" },
  { href: "/legislators", label: "Legislators", icon: "🏛️" },
  { href: "/people", label: "People", icon: "🧠" },
  { href: "/intel", label: "Intel hub", icon: "◉" },
  { href: "/intel/threat-matrix", label: "Threat matrix", icon: "🎯" },
  { href: "/intel/operations", label: "Coordinated operations", icon: "🕸" },
  { href: "/intel/donations", label: "Donor leaderboard", icon: "🧮" },
  { href: "/states", label: "By state", icon: "📍" },
  { href: "/forum", label: "Community", icon: "💬" },
  { href: "/news", label: "News", icon: "📰" },
  { href: "/research", label: "Research library", icon: "🔬" },
  { href: "/messages", label: "Messages", icon: "✉️" },
  { href: "/stories", label: "Stories", icon: "📖" },
  { href: "/library", label: "Library", icon: "📚" },
  { href: "/ethics", label: "Code of Morals", icon: "🌿" },
  { href: "/notifications", label: "Notifications", icon: "🔔" },
];

const ACCOUNT_LINKS = [
  { href: "/account", label: "Profile + civic info" },
  { href: "/account/security", label: "Security · 2FA · trusted devices" },
  { href: "/account/saved-searches", label: "Saved searches" },
  { href: "/account/invite", label: "Invite friends" },
  { href: "/account/email-presets", label: "Email tone presets" },
  { href: "/account/badges", label: "Mission patches" },
  { href: "/account/vendor", label: "Vendor status" },
];

const ADMIN_LINKS = [
  { href: "/admin", label: "Control room" },
  { href: "/admin/campaigns", label: "Campaigns" },
  { href: "/admin/campaigns/pending", label: "Campaign review" },
  { href: "/admin/forum", label: "Forum moderation" },
  { href: "/admin/lounge", label: "Lounge moderation" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/legislators", label: "State + federal sync" },
  { href: "/admin/locals", label: "Local officials" },
  { href: "/admin/local-rep-requests", label: "Local rep requests" },
  { href: "/admin/partners", label: "Partner shops" },
  { href: "/admin/discord-integrations", label: "Discord integrations" },
  { href: "/admin/announcements", label: "Announcements" },
  { href: "/admin/ai-control", label: "AI Command Center" },
  { href: "/admin/vendor-applications", label: "Vendor applications" },
  { href: "/admin/stories", label: "Story moderation" },
  { href: "/admin/events/new", label: "Town halls + hearings" },
  { href: "/admin/audit", label: "Audit log" },
  { href: "/admin/exports", label: "Data exports" },
  { href: "/admin/emergency", label: "🚨 Emergency mode" },
];

export function MobileNav({
  authSlot,
  isAdmin = false,
  isLeader = false,
}: {
  authSlot: React.ReactNode;
  isAdmin?: boolean;
  isLeader?: boolean;
}) {
  const [open, setOpen] = useState(false);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    if (open) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // NOTE: deliberately NOT locking body scroll. On iOS Safari, setting
  // body { overflow: hidden } while a fixed-position overlay is rendered
  // can cause the overlay's INNER CONTENT to clip or render offscreen
  // (the overlay's bg paints fine, but text disappears) — exactly the
  // symptom the owner reported. The portal approach below + the
  // overlay's own overflow-y-auto handle scroll just fine.

  // SSR safety — createPortal needs document.body which doesn't exist
  // during SSR. Track whether we're mounted before rendering the portal.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  function close() {
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        aria-label="Open menu"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="lg:hidden inline-flex h-10 w-10 items-center justify-center rounded-md border border-zinc-800 hover:border-emerald-500"
      >
        <HamburgerIcon />
      </button>

      {/* Render the overlay via a portal at document.body so it escapes
          any parent flex / transform / sticky context that might be
          interfering with content rendering. The previous version
          rendered as a Fragment sibling of the hamburger button, which
          made it a child of the header's `flex lg:hidden` wrapper —
          fixed positioning normally escapes flow but iOS Safari has
          known edge cases where ancestor flex contexts clip fixed
          descendants. Portal sidesteps the whole class of bugs. */}
      {open && mounted && createPortal(
        <div
          className="fixed inset-0 z-[100] overflow-y-auto overscroll-contain bg-zinc-950 lg:hidden"
          style={{
            paddingTop: "env(safe-area-inset-top)",
            paddingBottom: "env(safe-area-inset-bottom)",
          }}
          role="dialog"
          aria-modal="true"
          aria-label="Site menu"
        >
          {/* Top bar — sticky inside the scroll container so it's always
              reachable even on long admin lists. */}
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-800 bg-zinc-950/95 px-4 py-3 backdrop-blur">
            <Link
              href="/"
              className="flex items-center gap-1 text-lg font-bold"
              onClick={close}
            >
              <span className="text-emerald-400">i</span>
              <span>Kratom</span>
            </Link>
            <button
              type="button"
              aria-label="Close menu"
              onClick={close}
              className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-zinc-800 hover:bg-zinc-900"
            >
              <CloseIcon />
            </button>
          </div>

          <div className="mx-auto max-w-md px-4 py-4">
            {/* Auth row pinned at top */}
            <div className="mb-4 rounded-md border border-zinc-800 bg-zinc-900/40 p-3" onClick={close}>
              {authSlot}
            </div>

            {/* Category landing pages — the five-pillar map of the platform
                (shared source: src/config/nav-categories.ts) */}
            <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
              Browse by category
            </p>
            <div className="mb-5 flex flex-wrap gap-2">
              {CATEGORIES.map((c) => (
                <a
                  key={c.slug}
                  href={c.href}
                  onClick={close}
                  className="rounded-full border border-zinc-700 bg-zinc-900/60 px-3 py-1.5 text-sm font-medium text-zinc-200 hover:border-emerald-500 hover:text-emerald-300"
                >
                  {c.label}
                </a>
              ))}
            </div>

            {/* Primary nav */}
            <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
              Navigate
            </p>
            <ul className="mb-5 space-y-1">
              {PRIMARY_LINKS.map((l) => (
                <li key={l.href}>
                  <a
                    href={l.href}
                    onClick={close}
                    className="flex min-h-[48px] items-center gap-3 rounded-md border border-zinc-800 bg-zinc-950/40 px-4 text-base font-medium text-zinc-100 hover:border-emerald-500 hover:text-emerald-300"
                  >
                    <span className="w-6 text-center text-base" aria-hidden>
                      {l.icon}
                    </span>
                    <span>{l.label}</span>
                  </a>
                </li>
              ))}
            </ul>

            {/* Account submenu */}
            <details className="mb-3 rounded-md border border-zinc-800 bg-zinc-950/40">
              <summary className="flex min-h-[48px] cursor-pointer list-none items-center justify-between px-4 text-sm font-semibold text-zinc-200 [&::-webkit-details-marker]:hidden">
                <span className="flex items-center gap-2">
                  <span aria-hidden>👤</span>
                  Account settings
                </span>
                <span className="text-xs text-zinc-500" aria-hidden>
                  ▾
                </span>
              </summary>
              <ul className="border-t border-zinc-900 py-1 text-sm">
                {ACCOUNT_LINKS.map((l) => (
                  <li key={l.href}>
                    <a
                      href={l.href}
                      onClick={close}
                      className="flex min-h-[44px] items-center px-5 text-zinc-300 hover:bg-zinc-900 hover:text-emerald-400"
                    >
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </details>

            {/* Leader workshop link — for advocate-leaders (admins/owners
                also see /admin which already covers it). */}
            {isLeader && !isAdmin && (
              <a
                href="/leader"
                onClick={close}
                className="mb-3 flex min-h-[48px] items-center justify-between rounded-md border border-sky-900/40 bg-sky-950/10 px-4 text-sm font-semibold text-sky-300"
              >
                <span className="flex items-center gap-2">
                  <span aria-hidden>📍</span>
                  Leader workshop
                </span>
                <span className="text-xs text-sky-500/70" aria-hidden>
                  →
                </span>
              </a>
            )}

            {/* Admin submenu — only for authorized users */}
            {isAdmin && (
              <details className="mb-3 rounded-md border border-emerald-900/40 bg-emerald-950/10">
                <summary className="flex min-h-[48px] cursor-pointer list-none items-center justify-between px-4 text-sm font-semibold text-emerald-300 [&::-webkit-details-marker]:hidden">
                  <span className="flex items-center gap-2">
                    <span aria-hidden>🛠️</span>
                    Admin
                  </span>
                  <span className="text-xs text-emerald-500/70" aria-hidden>
                    ▾
                  </span>
                </summary>
                <ul className="border-t border-emerald-900/40 py-1 text-sm">
                  {ADMIN_LINKS.map((l) => (
                    <li key={l.href}>
                      <a
                        href={l.href}
                        onClick={close}
                        className="flex min-h-[44px] items-center px-5 text-zinc-300 hover:bg-zinc-900 hover:text-emerald-400"
                      >
                        {l.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {/* Misc utility links */}
            <ul className="mt-4 space-y-1 border-t border-zinc-900 pt-4 text-sm text-zinc-400">
              <li>
                <a
                  href="/how-it-works"
                  onClick={close}
                  className="block min-h-[44px] px-3 py-2 hover:text-emerald-400"
                >
                  How it works
                </a>
              </li>
              <li>
                <a
                  href="/glossary"
                  onClick={close}
                  className="block min-h-[44px] px-3 py-2 hover:text-emerald-400"
                >
                  Glossary
                </a>
              </li>
            </ul>

            <div className="mt-6 border-t border-zinc-900 px-3 py-4 text-center text-xs text-zinc-600">
              <a href="/terms" className="px-2 hover:text-emerald-400" onClick={close}>
                Terms
              </a>
              ·
              <a href="/privacy" className="px-2 hover:text-emerald-400" onClick={close}>
                Privacy
              </a>
              ·
              <a href="/cookies" className="px-2 hover:text-emerald-400" onClick={close}>
                Cookies
              </a>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

function HamburgerIcon() {
  return (
    <svg
      className="h-5 w-5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      className="h-5 w-5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}
