"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { assignDistrictCaptain, removeDistrictCaptain } from "@/modules/coalitions/captain-actions";

/** Organizers name a captain for a district (migration 0295). @handle only. */
export function AssignCaptainForm({ coalitionId, slug, chamber, districts, members }: {
  coalitionId: string; slug: string; chamber: string;
  districts: { value: string; label: string }[];
  members: { user_id: string; handle: string }[];
}) {
  const router = useRouter();
  const [district, setDistrict] = useState("");
  const [member, setMember] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const select = "mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-2 py-2 text-base text-zinc-100 sm:text-sm";
  return (
    <form className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const r = await assignDistrictCaptain(coalitionId, slug, chamber, district, member);
          if (!r.ok) { setError(r.error); return; }
          setDistrict(""); setMember("");
          router.refresh();
        });
      }}>
      <p className="text-xs font-semibold text-zinc-300">Name a captain</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block text-xs text-zinc-400">District
          <select value={district} onChange={(e) => setDistrict(e.target.value)} required className={select}>
            <option value="">Pick a district</option>
            {districts.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
        </label>
        <label className="block text-xs text-zinc-400">Captain
          <select value={member} onChange={(e) => setMember(e.target.value)} required className={select}>
            <option value="">Pick a member</option>
            {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.handle}</option>)}
          </select>
        </label>
      </div>
      {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
      <button type="submit" disabled={pending || !district || !member}
        className="min-h-11 rounded-md bg-emerald-500 px-4 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-40">
        {pending ? "Saving…" : "★ Name captain"}
      </button>
    </form>
  );
}

export function RemoveCaptainButton({ coalitionId, slug, chamber, district }: {
  coalitionId: string; slug: string; chamber: string; district: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <button type="button" disabled={pending} className="text-xs text-zinc-500 hover:text-red-300"
        onClick={() => start(async () => {
          const r = await removeDistrictCaptain(coalitionId, slug, chamber, district);
          if (!r.ok) setError(r.error); else router.refresh();
        })}>
        {pending ? "Removing…" : "Remove"}
      </button>
      {error && <span className="text-xs text-amber-300">{error}</span>}
    </>
  );
}
