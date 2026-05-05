"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  suggestOfficialsAction,
  acceptSuggestions,
} from "@/modules/admin/ai-actions";
import type { SuggestedOfficial } from "@/lib/ai/suggest-officials";

const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

const ROLE_LABEL: Record<string, string> = {
  mayor: "Mayor",
  city_council: "City Council",
  county_executive: "County Executive",
  county_commissioner: "County Commissioner",
  school_board: "School Board",
  other_local: "Other",
};

export function SuggestPanel() {
  const router = useRouter();
  const [city, setCity] = useState("");
  const [state, setState] = useState("OK");
  const [pending, startTransition] = useTransition();
  const [results, setResults] = useState<SuggestedOfficial[] | null>(null);
  const [sources, setSources] = useState<string[]>([]);
  const [locality, setLocality] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [acceptMsg, setAcceptMsg] = useState<string | null>(null);

  function search() {
    setError(null);
    setResults(null);
    setSources([]);
    setPicked(new Set());
    setAcceptMsg(null);
    startTransition(async () => {
      const result = await suggestOfficialsAction({ city, state });
      if ("error" in result) {
        setError(result.error);
      } else {
        setResults(result.officials);
        setSources(result.sources);
        setLocality(result.locality);
        setPicked(new Set(result.officials.map((_, i) => i))); // pre-check all
      }
    });
  }

  function toggle(i: number) {
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
  }

  function accept() {
    if (!results || picked.size === 0) return;
    const selected = Array.from(picked).map((i) => results[i]);
    startTransition(async () => {
      const r = await acceptSuggestions({
        state,
        locality,
        officials: selected,
      });
      if ("error" in r) {
        setAcceptMsg(`✗ ${r.error}`);
      } else {
        setAcceptMsg(`✓ Added ${r.added} officials`);
        setTimeout(() => router.push("/admin/locals"), 1500);
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[180px]">
            <label className="block text-xs font-medium text-zinc-400">
              City or county name
            </label>
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Tulsa  ·  or  ·  Tulsa County"
              className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400">State</label>
            <select
              value={state}
              onChange={(e) => setState(e.target.value)}
              className="mt-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
            >
              {STATES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <button
            onClick={search}
            disabled={pending || !city.trim()}
            className="rounded-md bg-emerald-500 px-5 py-2 font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
          >
            {pending && !results ? "Searching…" : "✨ Suggest"}
          </button>
        </div>

        {error && (
          <p className="mt-4 rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}
      </div>

      {results && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="text-lg font-semibold">
              {results.length} suggested official{results.length === 1 ? "" : "s"} for{" "}
              <span className="text-emerald-300">{locality}</span>
            </h2>
            <div className="text-xs text-zinc-500">{picked.size} selected</div>
          </div>

          {results.length === 0 ? (
            <p className="rounded-md border border-amber-900/40 bg-amber-950/20 p-4 text-sm text-amber-200">
              No verifiable officials found. Try the manual form, or check the source URLs below to add them yourself.
            </p>
          ) : (
            <ul className="space-y-2">
              {results.map((o, i) => (
                <li key={i} className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
                  <label className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={picked.has(i)}
                      onChange={() => toggle(i)}
                      className="mt-1 h-4 w-4 rounded border-zinc-700 bg-zinc-950"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="font-semibold">{o.full_name}</span>
                        <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-zinc-400">
                          {ROLE_LABEL[o.role] ?? o.role}
                        </span>
                        {o.district && (
                          <span className="text-xs text-zinc-500">District {o.district}</span>
                        )}
                        {o.party && (
                          <span className="text-xs text-zinc-500">· {o.party}</span>
                        )}
                      </div>
                      {o.title && o.title !== ROLE_LABEL[o.role] && (
                        <p className="text-xs text-zinc-400">{o.title}</p>
                      )}
                      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
                        {o.email && <span>📧 {o.email}</span>}
                        {o.phone && <span>📞 {o.phone}</span>}
                        {o.website && (
                          <a
                            href={o.website}
                            target="_blank"
                            rel="noreferrer"
                            className="text-emerald-400 hover:underline"
                          >
                            🔗 {o.website.replace(/^https?:\/\//, "").slice(0, 40)}
                          </a>
                        )}
                      </div>
                      {o.source_note && (
                        <p className="mt-1 text-[11px] italic text-zinc-600">
                          {o.source_note}
                        </p>
                      )}
                    </div>
                  </label>
                </li>
              ))}
            </ul>
          )}

          {sources.length > 0 && (
            <div className="mt-4 border-t border-zinc-800 pt-3 text-xs text-zinc-500">
              <span className="font-semibold text-zinc-400">Sources:</span>{" "}
              {sources.map((s, i) => (
                <span key={s}>
                  <a
                    href={s}
                    target="_blank"
                    rel="noreferrer"
                    className="text-emerald-400 hover:underline"
                  >
                    {s.replace(/^https?:\/\//, "").slice(0, 50)}
                  </a>
                  {i < sources.length - 1 && " · "}
                </span>
              ))}
            </div>
          )}

          {results.length > 0 && (
            <div className="mt-5 flex items-center justify-between gap-3">
              {acceptMsg && (
                <span className={`text-sm ${acceptMsg.startsWith("✓") ? "text-emerald-300" : "text-red-300"}`}>
                  {acceptMsg}
                </span>
              )}
              <button
                onClick={accept}
                disabled={pending || picked.size === 0}
                className="ml-auto rounded-md bg-emerald-500 px-5 py-2 font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
              >
                {pending && acceptMsg === null ? "Adding…" : `Add ${picked.size} to roster →`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
