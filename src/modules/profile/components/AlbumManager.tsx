"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deletePhoto, updatePhoto } from "../photo-actions";
import { isAudience, type Audience } from "../audience";
import { AudienceSelect } from "./AudienceSelect";

export type OwnPhoto = { id: string; kind: string; caption: string | null; audience: string | null };

/** The owner's own photos: change who sees each one, caption it, or delete it. */
export function AlbumManager({ photos }: { photos: OwnPhoto[] }) {
  if (!photos.length) return <p className="text-sm text-zinc-500">No photos yet.</p>;
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {photos.map((p) => <PhotoRow key={p.id} photo={p} />)}
    </ul>
  );
}

function PhotoRow({ photo }: { photo: OwnPhoto }) {
  const router = useRouter();
  const [aud, setAud] = useState<Audience>(isAudience(photo.audience) ? photo.audience : "friends");
  const [caption, setCaption] = useState(photo.caption ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: true } | { error: string }>, done: string) =>
    start(async () => {
      const r = await fn();
      setMsg("error" in r ? r.error : done);
      if (!("error" in r)) router.refresh();
    });

  return (
    <li className="flex gap-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
      {/* eslint-disable-next-line @next/next/no-img-element -- privacy route */}
      <img src={`/api/media/${photo.id}`} alt={photo.caption ?? "Photo"} loading="lazy" className="h-20 w-20 shrink-0 rounded-md object-cover sm:h-24 sm:w-24" />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs uppercase tracking-wider text-zinc-500">{photo.kind === "album" ? "Album" : photo.kind === "avatar" ? "Profile photo" : "Cover"}</span>
          <AudienceSelect compact label="photo" value={aud} onChange={(v) => { setAud(v); run(() => updatePhoto(photo.id, { audience: v }), "Privacy updated."); }} />
        </div>
        <input value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={300} placeholder="Caption (optional)" aria-label="Caption"
          onBlur={() => caption !== (photo.caption ?? "") && run(() => updatePhoto(photo.id, { caption }), "Caption saved.")}
          className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs" />
        <div className="flex items-center gap-3 text-xs">
          <button type="button" disabled={pending}
            onClick={() => confirm("Delete this photo? This can't be undone.") && run(() => deletePhoto(photo.id), "Deleted.")}
            className="text-zinc-500 hover:text-red-400 disabled:opacity-50">Delete</button>
          {msg && <span role="status" className="text-zinc-400">{msg}</span>}
        </div>
      </div>
    </li>
  );
}
