"use client";

import { useState, useTransition } from "react";
import { savePrivacySettings } from "../actions";
import { SECTION_AUDIENCES, type Audience, type SectionAudienceKey } from "../audience";
import { VIEWERS, previewFor } from "../privacy-preview";
import { PrivacyTable } from "./PrivacyTable";

const DISCOVERABILITY = [
  { id: "public", label: "Show my @handle on my posts, and let members find me in search", hint: "Recommended. Still never your real name." },
  { id: "recruiters_only", label: "Only the leader who invited me can find me", hint: "Your posts show without your handle." },
  { id: "private", label: "Hide my @handle everywhere", hint: "Your posts show as \"Member\". Nobody can find your profile." },
] as const;

/** /account/privacy — every audience, discoverability, and a live preview. */
export function PrivacySettings({ initial, discoverability }: { initial: Record<SectionAudienceKey, Audience>; discoverability: string }) {
  const [aud, setAud] = useState(initial);
  const [disc, setDisc] = useState(discoverability);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="space-y-6">
      <PrivacyTable value={aud} onChange={(k, v) => setAud((a) => ({ ...a, [k]: v }))} />

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 sm:p-5">
        <h2 className="text-sm font-semibold">Being found</h2>
        <div className="mt-3 space-y-2">
          {DISCOVERABILITY.map((d) => (
            <label key={d.id} className="flex cursor-pointer gap-3 rounded-md border border-zinc-800 p-3 hover:border-zinc-600">
              <input type="radio" name="discoverability" value={d.id} checked={disc === d.id} onChange={() => setDisc(d.id)} className="mt-1 accent-emerald-500" />
              <span>
                <span className="block text-sm text-zinc-200">{d.label}</span>
                <span className="text-xs text-zinc-500">{d.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 sm:p-5">
        <h2 className="text-sm font-semibold">Preview: who sees what</h2>
        <p className="mt-1 text-xs text-zinc-500">Updates as you change the settings above. Blocked members never see anything.</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[22rem] text-left text-xs">
            <thead>
              <tr className="text-zinc-500">
                <th className="py-1 pr-2 font-normal">Section</th>
                {VIEWERS.map((v) => <th key={v.id} className="px-2 py-1 text-center font-normal">{v.label}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {SECTION_AUDIENCES.filter((s) => s.key !== "photos_default_audience").map((s) => (
                <tr key={s.key}>
                  <td className="py-1.5 pr-2 text-zinc-300">{s.label}</td>
                  {VIEWERS.map((v) => {
                    const on = previewFor(v.id, aud)[s.key];
                    return <td key={v.id} className={`px-2 text-center ${on ? "text-emerald-400" : "text-zinc-600"}`}>{on ? "✓ sees" : "—"}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-3 border-t border-zinc-800 bg-zinc-950/95 px-4 py-3 sm:mx-0 sm:rounded-lg sm:border">
        <button type="button" disabled={pending}
          onClick={() => { setMsg(null); start(async () => {
            const r = await savePrivacySettings({ audiences: aud, discoverability: disc });
            setMsg("error" in r ? { ok: false, text: r.error } : { ok: true, text: "Saved." });
          }); }}
          className="rounded-md bg-emerald-500 px-5 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50">
          {pending ? "Saving…" : "Save privacy settings"}
        </button>
        {msg && <span role="status" className={`text-sm ${msg.ok ? "text-emerald-400" : "text-red-400"}`}>{msg.text}</span>}
      </div>
    </div>
  );
}
