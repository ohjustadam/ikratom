"use client";

import { SECTION_AUDIENCES, type Audience, type SectionAudienceKey } from "../audience";
import { AudienceSelect } from "./AudienceSelect";

/**
 * Every section audience in one table. Reused by the editor and the privacy
 * settings page. Real name, email, address and phone have no row because they
 * are never shown to anyone.
 */
export function PrivacyTable({
  value,
  onChange,
}: {
  value: Record<SectionAudienceKey, Audience>;
  onChange: (k: SectionAudienceKey, v: Audience) => void;
}) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 sm:p-5">
      <h2 className="text-sm font-semibold">Who can see what</h2>
      <p className="mt-1 text-xs text-zinc-500">
        Other members only ever see your @username. Your real name, email, address and phone are never shown, whatever you pick here.
      </p>
      <ul className="mt-3 divide-y divide-zinc-800">
        {SECTION_AUDIENCES.map((s) => (
          <li key={s.key} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm text-zinc-200">{s.label}</p>
              <p className="text-xs text-zinc-500">{s.hint}</p>
            </div>
            <AudienceSelect compact label={s.label} value={value[s.key]} onChange={(v) => onChange(s.key, v)} />
          </li>
        ))}
      </ul>
    </section>
  );
}
