"use client";

import { useState } from "react";
import type { Legislator } from "@/lib/legislators";
import { ROLE_SHORT } from "@/lib/legislators";

/**
 * Single rep card on /dashboard. Now shows a scope badge
 * (federal / state / local) with color-coding so the user can tell
 * at-a-glance which jurisdiction each rep covers.
 *
 * Scope inference: legislator.level (when 'municipal'/'county' →
 * local), else the role prefix (us_* → federal, state_* → state).
 */
type Scope = "federal" | "state" | "local";

function scopeOf(l: Legislator): Scope {
  if (l.level === "municipal" || l.level === "county") return "local";
  if (l.role.startsWith("us_")) return "federal";
  if (l.role.startsWith("state_")) return "state";
  if (l.level === "state") return "state";
  if (l.level === "federal") return "federal";
  return "state"; // safe fallback
}

const SCOPE_BADGE: Record<Scope, { label: string; cls: string }> = {
  federal: { label: "Federal", cls: "bg-amber-950/40 text-amber-300 border-amber-800/50" },
  state: { label: "State", cls: "bg-blue-950/40 text-blue-300 border-blue-800/50" },
  local: { label: "Local", cls: "bg-emerald-950/40 text-emerald-300 border-emerald-800/50" },
};

const CARD_BORDER: Record<Scope, string> = {
  federal: "border-amber-700/40 bg-amber-950/5",
  state: "border-blue-700/40 bg-blue-950/5",
  local: "border-emerald-700/50 bg-emerald-950/10",
};

export function MyRepCard({ legislator: l }: { legislator: Legislator }) {
  const emailIsForm = l.email?.startsWith("http") ?? false;
  const scope = scopeOf(l);
  const isLocal = scope === "local";
  const badge = SCOPE_BADGE[scope];

  return (
    <li className={`rounded-lg border p-4 ${CARD_BORDER[scope]}`}>
      <div className="mb-1 flex items-center gap-2">
        <span
          className={`rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${badge.cls}`}
        >
          {badge.label}
        </span>
        {l.locality && isLocal && (
          <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
            {l.locality}
          </span>
        )}
      </div>
      <div className="text-xs uppercase tracking-wider text-zinc-400">
        {l.title || ROLE_SHORT[l.role] || l.role}
        {l.district && !isLocal && (
          <span className="ml-1 text-zinc-500">· Dist. {l.district}</span>
        )}
      </div>
      <h3 className="mt-1 font-semibold">{l.full_name}</h3>
      {l.body && <p className="text-[11px] text-zinc-500">{l.body}</p>}

      <div className="mt-3 space-y-1.5">
        {l.email && !emailIsForm && (
          <ContactLine value={l.email} href={`mailto:${l.email}`} />
        )}
        {l.email && emailIsForm && (
          <ContactLine value="Use contact form" href={l.email} external />
        )}
        {l.phone && <ContactLine value={l.phone} href={`tel:${l.phone}`} />}
      </div>
    </li>
  );
}

function ContactLine({ value, href, external }: { value: string; href: string; external?: boolean }) {
  const [copied, setCopied] = useState(false);
  async function copy(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }
  return (
    <div className="group flex items-center gap-2 text-xs">
      <a
        href={href}
        target={external ? "_blank" : undefined}
        rel={external ? "noreferrer" : undefined}
        className="min-w-0 flex-1 truncate text-zinc-300 hover:text-emerald-300"
      >
        {value}
      </a>
      <button
        type="button"
        onClick={copy}
        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-zinc-500 opacity-0 transition group-hover:opacity-100 hover:bg-zinc-900 hover:text-zinc-200"
      >
        {copied ? "✓" : "Copy"}
      </button>
    </div>
  );
}
