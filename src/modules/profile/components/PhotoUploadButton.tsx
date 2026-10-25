"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { uploadPhoto } from "../prepare-image";

/**
 * A button that picks a photo, strips it in the browser, uploads it, and
 * refreshes the page. Used for the avatar, the cover and the album.
 */
export function PhotoUploadButton({
  kind,
  label,
  audience,
  className,
}: {
  kind: "avatar" | "cover" | "album";
  label: string;
  audience?: string;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setErr(null);
    setBusy(true);
    try {
      await uploadPhoto(file, kind, { audience });
      router.refresh();
    } catch (x) {
      setErr(x instanceof Error ? x.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        className={className ?? "rounded-md border border-zinc-700 bg-zinc-900/80 px-3 py-1.5 text-xs font-semibold text-zinc-100 hover:border-emerald-500 disabled:opacity-50"}
      >
        {busy ? "Uploading…" : label}
      </button>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" className="hidden" onChange={onPick} />
      {err && <span role="alert" className="max-w-xs rounded bg-zinc-950/90 px-2 py-1 text-xs text-red-400">{err}</span>}
    </span>
  );
}
