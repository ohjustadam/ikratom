"use client";

import { useEffect, useState } from "react";

const NAV_LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/campaigns", label: "Campaigns" },
  { href: "/legislators", label: "Legislators" },
  { href: "/bills", label: "Bills" },
  { href: "/news", label: "News" },
  { href: "/library", label: "Library" },
  { href: "/forum", label: "Forum" },
  { href: "/messages", label: "Messages" },
];

export function MobileNav({
  authSlot,
}: {
  authSlot: React.ReactNode;
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
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
          />

          {/* Drawer */}
          <div
            className="fixed right-0 top-0 z-50 flex h-full w-[85%] max-w-sm flex-col border-l border-zinc-800 bg-zinc-950 shadow-2xl md:hidden"
            style={{ paddingTop: "max(1rem, env(safe-area-inset-top))" }}
          >
            <div className="flex items-center justify-between border-b border-zinc-800 px-4 pb-4">
              <a href="/" className="flex items-center gap-1 text-lg font-bold" onClick={() => setOpen(false)}>
                <span className="text-emerald-400">i</span>
                <span>Kratom</span>
              </a>
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-md hover:bg-zinc-900"
              >
                <CloseIcon />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto px-2 py-4">
              <ul className="space-y-1">
                {NAV_LINKS.map((l) => (
                  <li key={l.href}>
                    <a
                      href={l.href}
                      onClick={() => setOpen(false)}
                      className="flex min-h-[44px] items-center rounded-md px-3 text-base font-medium text-zinc-200 hover:bg-zinc-900 hover:text-emerald-400"
                    >
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>

              <div className="mt-6 border-t border-zinc-800 pt-4">
                <p className="px-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Account
                </p>
                <div className="mt-2 px-3" onClick={() => setOpen(false)}>
                  {authSlot}
                </div>
              </div>

              <div className="mt-6 border-t border-zinc-800 pt-4">
                <ul className="space-y-1 text-sm text-zinc-400">
                  <li><a href="/account" className="block min-h-[40px] px-3 py-2 hover:text-emerald-400" onClick={() => setOpen(false)}>Account settings</a></li>
                  <li><a href="/notifications" className="block min-h-[40px] px-3 py-2 hover:text-emerald-400" onClick={() => setOpen(false)}>Notifications</a></li>
                </ul>
              </div>
            </nav>

            <div
              className="border-t border-zinc-800 px-3 py-4 text-center text-xs text-zinc-600"
              style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
            >
              <a href="/terms" className="px-2 hover:text-emerald-400" onClick={() => setOpen(false)}>Terms</a>
              ·
              <a href="/privacy" className="px-2 hover:text-emerald-400" onClick={() => setOpen(false)}>Privacy</a>
              ·
              <a href="/cookies" className="px-2 hover:text-emerald-400" onClick={() => setOpen(false)}>Cookies</a>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function HamburgerIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}
