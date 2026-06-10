"use client";

import { useEffect, useRef, useState } from "react";
import { CATEGORIES, type Category } from "@/config/nav-categories";

/**
 * Condensed desktop header nav: the five categories from
 * src/config/nav-categories.ts (single source of truth, shared with the
 * mobile nav + the category landing pages).
 *
 * Each category LABEL is a link to its landing page (/action, /intel, …);
 * hover (or the ▾ button) opens the dropdown of its features. Keyboard-
 * accessible (Tab through, Escape to close, Enter to activate). Click
 * outside closes.
 *
 * Mobile nav stays in MobileNav.tsx — this is only mounted on md+.
 */

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
      {CATEGORIES.map((g, i) => (
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
  group: Category;
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
      {/* Label navigates to the category landing page; the ▾ toggles the
          dropdown (hover also opens it, so mouse users lose nothing). */}
      <span className={`inline-flex items-center rounded ${open ? "text-emerald-400" : "text-zinc-200"}`}>
        <a
          href={group.href}
          onFocus={onOpen}
          className="rounded py-1 pl-2.5 pr-1 hover:text-emerald-400"
        >
          {group.label}
        </a>
        <button
          type="button"
          aria-haspopup="true"
          aria-expanded={open}
          aria-label={`Open ${group.label} menu`}
          onClick={() => (open ? onClose() : onOpen())}
          className="rounded py-1 pl-0.5 pr-2 text-[8px] hover:text-emerald-400"
        >
          <span aria-hidden>▾</span>
        </button>
      </span>

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
