"use client";

import { useState, useTransition } from "react";
import { setProviderTier } from "../send-batch-actions";
import type { ProviderTier } from "@/lib/email/provider-limits";

/**
 * Lets a user correct their detected mail-provider tier.
 *
 * Detection is right in the cases that matter — a free Gmail account cannot
 * send from a custom domain via the API, and an @gmail.com address is never a
 * Workspace primary — but it cannot see everything. An admin may have lowered
 * a tenant's limit, or someone may be on a plan we guessed generously. When we
 * are unsure we resolve to the FLOOR, so the common correction is a user
 * telling us they can send MORE than we assumed.
 *
 * The number shown is our EFFECTIVE limit (15% under the provider's documented
 * ceiling), not the marketing figure, because that headroom is the thing
 * keeping their personal account off a throttle list.
 */
export function ProviderTierSetting({
  provider,
  detectedLabel,
  currentTier,
  options,
}: {
  provider: "gmail" | "outlook";
  detectedLabel: string;
  currentTier: ProviderTier | null;
  options: { tier: ProviderTier; label: string; effectiveDaily: number; sourceNote: string }[];
}) {
  const [tier, setTier] = useState<ProviderTier | "">(currentTier ?? "");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save(next: ProviderTier | "") {
    setTier(next);
    setSaved(false);
    setError(null);
    startTransition(async () => {
      const res = await setProviderTier(next === "" ? null : next);
      if (res.ok) setSaved(true);
      else setError(res.error ?? "Could not save.");
    });
  }

  const active = options.find((o) => o.tier === tier);

  return (
    <div className="mt-4 border-t border-zinc-800 pt-4">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
        Daily sending limit
      </h4>
      <p className="mt-1 text-xs text-zinc-400">
        We detected <strong className="text-zinc-200">{detectedLabel}</strong>. Change this only if
        it&apos;s wrong — setting it higher than your account really allows can get your mailbox
        throttled by {provider === "gmail" ? "Google" : "Microsoft"}.
      </p>

      <select
        value={tier}
        onChange={(e) => save(e.target.value as ProviderTier | "")}
        disabled={pending}
        className="mt-2 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 disabled:opacity-50"
      >
        <option value="">Auto-detect ({detectedLabel})</option>
        {options.map((o) => (
          <option key={o.tier} value={o.tier}>
            {o.label} — up to {o.effectiveDaily.toLocaleString()}/day
          </option>
        ))}
      </select>

      {active && <p className="mt-1.5 text-[11px] text-zinc-500">{active.sourceNote}</p>}
      {saved && <p className="mt-1.5 text-xs text-emerald-400">Saved.</p>}
      {error && <p className="mt-1.5 text-xs text-red-400">{error}</p>}
    </div>
  );
}
