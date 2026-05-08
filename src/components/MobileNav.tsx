"use client";

import { useEffect, useState } from "react";

/**
 * Mobile drawer nav. Opens when the user taps the hamburger; closes via
 * the X, the backdrop, Escape key, or any link click.
 *
 * Structure:
 *   - Primary section — direct nav to top-level pages
 *   - Account section — every /account/* subpage in one expandable list
 *   - Admin section — every /admin/* subpage (only visible when isAdmin)
 *   - Footer auth slot — Dashboard / Account / Admin / Sign out from
 *     HeaderAuth (the same component the desktop nav uses, so anything
 *     server-rendered stays consistent)
 *
 * Why <details>/<summary> for the submenus: native disclosure that
 * works without JavaScript and degrades gracefully if hydration is slow
 * on flaky mobile connections. Drawer state itself (open/closed) needs
 * JS for the backdrop + body-scroll-lock so it stays React.
 */

const PRIMARY_LINKS = [
  { href: "/dashboard", label: "Dashboard", icon: "🎛️" },
  { href: "/campaigns", label: "Campaigns", icon: "📣" },
  { href: "/bills", label: "Bills", icon: "📜" },
  { href: "/legislators", label: "Legislators", icon: "🏛️" },
  { href: "/forum", label: "Community", icon: "💬" },
  { href: "/news", label: "News", icon: "📰" },
  { href: "/messages", label: "Messages", icon: "✉️" },
  { href: "/stories", label: "Stories", icon: "📖" },
  { href: "/library", label: "Library", icon: "📚" },
  { href: "/notifications", label: "Notifications", icon: "🔔" },
];

const ACCOUNT_LINKS = [
  { href: "/account", label: "Profile + civic info" },
  { href: "/account/security", label: "Security · 2FA · trusted devices" },
  { href: "/account/saved-searches", label: "Saved searches" },
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
}: {
  authSlot: React.ReactNode;
  isAdmin?: boolean;
}) {
  const [open, setOpen] = useState(false);

  // Close on escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    if (open) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Lock body scroll when drawer is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

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
        className="md:hidden inline-flex h-10 w-10 items-center justify-center rounded-md border border-zinc-800 hover:border-emerald-500"
      >
        <HamburgerIcon />
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <button
            type="button"
            aria-label="Close menu"
            onClick={close}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
          />

          {/* Drawer */}
          <div
            className="fixed right-0 top-0 z-50 flex h-full w-[88%] max-w-sm flex-col border-l border-zinc-800 bg-zinc-950 shadow-2xl md:hidden"
            style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
          >
            <div className="flex items-center justify-between border-b border-zinc-800 px-4 pb-3">
              <a
                href="/"
                className="flex items-center gap-1 text-lg font-bold"
                onClick={close}
              >
                <span className="text-emerald-400">i</span>
                <span>Kratom</span>
              </a>
              <button
                type="button"
                aria-label="Close menu"
                onClick={close}
                className="inline-flex h-10 w-10 items-center justify-center rounded-md hover:bg-zinc-900"
              >
                <CloseIcon />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto px-2 py-3">
              {/* Auth slot (Dashboard / Account / Admin / Sign out) */}
              <div className="mb-3 rounded-md border border-zinc-800 bg-zinc-950/40 p-2" onClick={close}>
                {authSlot}
              </div>

              {/* Primary nav */}
              <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                Navigate
              </p>
              <ul className="mb-4 space-y-0.5">
                {PRIMARY_LINKS.map((l) => (
                  <li key={l.href}>
                    <a
                      href={l.href}
                      onClick={close}
                      className="flex min-h-[44px] items-center gap-3 rounded-md px-3 text-base font-medium text-zinc-200 hover:bg-zinc-900 hover:text-emerald-400"
                    >
                      <span className="w-5 text-center text-base" aria-hidden>
                        {l.icon}
                      </span>
                      <span>{l.label}</span>
                    </a>
                  </li>
                ))}
              </ul>

              {/* Account submenu */}
              <details className="mb-3 rounded-md border border-zinc-800 bg-zinc-950/40">
                <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between px-3 text-sm font-semibold text-zinc-200 [&::-webkit-details-marker]:hidden">
                  <span className="flex items-center gap-2">
                    <span aria-hidden>👤</span>
                    Account settings
                  </span>
                  <span className="text-xs text-zinc-500" aria-hidden>▾</span>
                </summary>
                <ul className="border-t border-zinc-900 py-1 text-sm">
                  {ACCOUNT_LINKS.map((l) => (
                    <li key={l.href}>
                      <a
                        href={l.href}
                        onClick={close}
                        className="flex min-h-[40px] items-center px-5 text-zinc-300 hover:bg-zinc-900 hover:text-emerald-400"
                      >
                        {l.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </details>

              {/* Admin submenu — only when authorized */}
              {isAdmin && (
                <details className="mb-3 rounded-md border border-emerald-900/40 bg-emerald-950/10">
                  <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between px-3 text-sm font-semibold text-emerald-300 [&::-webkit-details-marker]:hidden">
                    <span className="flex items-center gap-2">
                      <span aria-hidden>🛠️</span>
                      Admin
                    </span>
                    <span className="text-xs text-emerald-500/70" aria-hidden>▾</span>
                  </summary>
                  <ul className="border-t border-emerald-900/40 py-1 text-sm">
                    {ADMIN_LINKS.map((l) => (
                      <li key={l.href}>
                        <a
                          href={l.href}
                          onClick={close}
                          className="flex min-h-[40px] items-center px-5 text-zinc-300 hover:bg-zinc-900 hover:text-emerald-400"
                        >
                          {l.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {/* Misc utility links */}
              <ul className="mt-2 space-y-0.5 border-t border-zinc-900 pt-3 text-sm text-zinc-400">
                <li>
                  <a
                    href="/how-it-works"
                    onClick={close}
                    className="block min-h-[40px] px-3 py-2 hover:text-emerald-400"
                  >
                    How it works
                  </a>
                </li>
                <li>
                  <a
                    href="/glossary"
                    onClick={close}
                    className="block min-h-[40px] px-3 py-2 hover:text-emerald-400"
                  >
                    Glossary
                  </a>
                </li>
              </ul>
            </nav>

            <div
              className="border-t border-zinc-800 px-3 py-3 text-center text-xs text-zinc-600"
              style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
            >
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
        </>
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
