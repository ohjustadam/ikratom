"use client";

import { useRef, useState } from "react";
import { uploadPhoto } from "@/modules/profile/prepare-image";

/** A group post's image. Opens full size, so a member can save it to share. */
export function GroupImage({ id }: { id: string }) {
  return (
    <a href={`/api/media/${id}`} target="_blank" rel="noreferrer" className="mt-2 block">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/media/${id}`}
        alt="Posted by a group member"
        loading="lazy"
        className="max-h-[32rem] w-auto max-w-full rounded-md border border-zinc-800"
      />
    </a>
  );
}

/** Attach one image to a group post. The photo is stored the moment it's picked. */
export function GroupImagePicker({
  photoId,
  onChange,
}: {
  photoId: string | null;
  onChange: (id: string | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const { id } = await uploadPhoto(file, "group");
      onChange(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add that image.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="text-xs">
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        aria-label="Add an image"
        onChange={(e) => void pick(e.target.files?.[0])}
      />
      {photoId ? (
        <div className="flex items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/media/${photoId}`} alt="Your image" className="h-20 w-auto rounded border border-zinc-800" />
          <button type="button" onClick={() => onChange(null)} className="text-zinc-500 hover:text-red-300">
            Remove image
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => input.current?.click()}
          className="text-zinc-400 hover:text-emerald-400 disabled:opacity-50"
        >
          {busy ? "Adding image…" : "🖼 Add an image"}
        </button>
      )}
      {error && <p className="mt-1 text-red-300">{error}</p>}
    </div>
  );
}
