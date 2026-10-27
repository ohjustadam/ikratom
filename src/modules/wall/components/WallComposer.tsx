"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AUDIENCES, AUDIENCE_ICON, AUDIENCE_LABEL } from "@/modules/profile/audience";
import { uploadPhoto } from "@/modules/profile/prepare-image";
import { createWallPost } from "../actions";
import { POST_MAX } from "../types";

/**
 * Write on a wall. A photo is re-encoded in the browser (no metadata leaves
 * the device), stripped again on the server, and stored on R2 as a wall photo
 * that is only ever served alongside this post. Only the wall's owner picks an
 * audience; friends' posts follow the wall.
 */
export function WallComposer({ ownerId, isSelf, handle }: { ownerId: string; isSelf: boolean; handle: string }) {
  const router = useRouter();
  const file = useRef<HTMLInputElement>(null);
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState("");
  const [photo, setPhoto] = useState<{ id: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  async function pick(f: File | undefined) {
    if (!f) return;
    setErr(null);
    setBusy(true);
    try {
      setPhoto(await uploadPhoto(f, "wall"));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (file.current) file.current.value = "";
    }
  }

  function submit() {
    setErr(null);
    start(async () => {
      const r = await createWallPost({ ownerId, body, photoId: photo?.id ?? null, audience: audience || null });
      if ("error" in r) return setErr(r.error);
      setBody("");
      setPhoto(null);
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <label htmlFor="wall-body" className="sr-only">Write a post</label>
      <textarea id="wall-body" value={body} onChange={(e) => setBody(e.target.value)} maxLength={POST_MAX} rows={3}
        placeholder={isSelf ? "Share an update with your people…" : `Write something to ${handle}…`}
        className="w-full resize-y rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm" />
      {photo && (
        <div className="relative mt-2 inline-block">
          {/* eslint-disable-next-line @next/next/no-img-element -- privacy route */}
          <img src={photo.url} alt="Attached photo" className="max-h-40 rounded-md" />
          <button type="button" onClick={() => setPhoto(null)} className="absolute right-1 top-1 rounded bg-zinc-950/80 px-1.5 text-xs">✕</button>
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input ref={file} type="file" accept="image/*" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
        <button type="button" disabled={busy || !!photo} onClick={() => file.current?.click()}
          className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs hover:border-emerald-500 disabled:opacity-50">
          {busy ? "Uploading…" : "📷 Photo"}
        </button>
        {isSelf && (
          <select aria-label="Who can see this post" value={audience} onChange={(e) => setAudience(e.target.value)}
            className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs">
            <option value="">Wall default</option>
            {AUDIENCES.map((a) => <option key={a} value={a}>{AUDIENCE_ICON[a]} {AUDIENCE_LABEL[a]}</option>)}
          </select>
        )}
        <button type="button" onClick={submit} disabled={pending || busy || !body.trim()}
          className="ml-auto rounded-md bg-emerald-500 px-4 py-1.5 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50">
          {pending ? "Posting…" : "Post"}
        </button>
      </div>
      {err && <p role="alert" className="mt-2 text-xs text-red-400">{err}</p>}
    </div>
  );
}
