"use client";

import { useState } from "react";
import type { Legislator } from "@/lib/legislators";
import { ROLE_SHORT } from "@/lib/legislators";

export function MyRepCard({ legislator: l }: { legislator: Legislator }) {
  const emailIsForm = l.email?.startsWith("http") ?? false;
  const isLocal = l.level === "municipal" || l.level === "county";

  return (
    <li className="rounded-lg border border-emerald-700/50 bg-emerald-950/10 p-4">
      <div className="text-xs uppercase tracking-wider text-emerald-400">
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
